import type { NotificationOutboxDeliveryStore } from '@clashmate/database';
import type { Logger } from '@clashmate/logger';

export interface NotificationDeliveryLoopIntervalConfig {
  readonly baseSeconds: number;
  readonly jitterSeconds: number;
}

export interface DiscordNotificationSender {
  sendChannelMessage: (channelId: string, content: string) => Promise<void>;
}

export interface NotificationDeliveryLoopOptions {
  readonly deliveryStore: NotificationOutboxDeliveryStore;
  readonly sender: DiscordNotificationSender;
  readonly ownerId: string;
  readonly lockForSeconds?: number;
  readonly interval: NotificationDeliveryLoopIntervalConfig;
  readonly batchSize?: number;
  readonly maxAttempts?: number;
  readonly retryBaseSeconds?: number;
  readonly random?: () => number;
  readonly logger?: Pick<Logger, 'debug' | 'error' | 'info'>;
}

export interface NotificationDeliveryLoopController {
  stop: () => void;
}

export function computeNotificationDeliveryLoopDelayMs(
  interval: NotificationDeliveryLoopIntervalConfig,
  random = Math.random,
): number {
  if (interval.baseSeconds <= 0 || interval.jitterSeconds < 0) {
    throw new Error(
      'Notification delivery loop intervals must be positive with non-negative jitter.',
    );
  }
  const jitter = Math.floor(random() * (interval.jitterSeconds + 1));
  return (interval.baseSeconds + jitter) * 1000;
}

export function computeNotificationRetryAt(now: Date, attempts: number, baseSeconds = 30): Date {
  if (!Number.isInteger(attempts) || attempts < 0) {
    throw new Error('Notification retry attempts must be a non-negative integer.');
  }
  if (!Number.isFinite(baseSeconds) || baseSeconds <= 0) {
    throw new Error('Notification retry base seconds must be positive.');
  }
  const exponent = Math.min(attempts, 6);
  return new Date(now.getTime() + baseSeconds * 2 ** exponent * 1000);
}

export async function runNotificationDeliveryIteration(
  options: NotificationDeliveryLoopOptions,
): Promise<void> {
  const batchSize = options.batchSize ?? 50;
  const maxAttempts = options.maxAttempts ?? 5;
  const lockForSeconds = options.lockForSeconds ?? 60;
  const claimed = await options.deliveryStore.claimDueNotificationOutboxEntries({
    ownerId: options.ownerId,
    lockForSeconds,
    limit: batchSize,
    maxAttempts,
  });

  if (claimed.length === 0) {
    options.logger?.debug?.('No due notification outbox entries to deliver');
    return;
  }

  for (const entry of claimed) {
    try {
      if (entry.targetType !== 'discord_channel') {
        throw new Error(`Unsupported notification target type: ${entry.targetType}`);
      }

      await options.sender.sendChannelMessage(
        entry.targetId,
        formatNotificationOutboxMessage(entry),
      );
      await options.deliveryStore.markNotificationOutboxSent(entry.id, options.ownerId, new Date());
      options.logger?.info?.({ outboxId: entry.id, targetId: entry.targetId }, 'Sent notification');
    } catch (error) {
      const retryAt = computeNotificationRetryAt(
        new Date(),
        entry.attempts + 1,
        options.retryBaseSeconds,
      );
      await options.deliveryStore.markNotificationOutboxFailed({
        id: entry.id,
        ownerId: options.ownerId,
        error,
        retryAt,
        maxAttempts,
      });
      options.logger?.error?.({ error, outboxId: entry.id }, 'Failed to send notification');
    }
  }
}

export function startNotificationDeliveryLoop(
  options: NotificationDeliveryLoopOptions,
): NotificationDeliveryLoopController {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (stopped) return;
    const delayMs = computeNotificationDeliveryLoopDelayMs(options.interval, options.random);
    timer = setTimeout(async () => {
      await runNotificationDeliveryIteration(options).catch((error: unknown) => {
        options.logger?.error?.({ error }, 'Notification delivery iteration failed');
      });
      schedule();
    }, delayMs);
  };

  void runNotificationDeliveryIteration(options).catch((error: unknown) => {
    options.logger?.error?.({ error }, 'Initial notification delivery iteration failed');
  });
  schedule();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export function formatNotificationOutboxMessage(entry: {
  sourceType?: string;
  payload: unknown;
}): string {
  if (entry.sourceType === 'war_attack_event') {
    const payload = parseWarAttackNotificationPayload(entry.payload);
    const fresh = payload.freshAttack ? ' fresh' : '';
    const duration = payload.duration === null ? '' : ` in ${payload.duration}s`;
    return `⚔️ **${payload.attackerTag}** attacked **${payload.defenderTag}** in clan **${payload.clanTag}** for **${payload.stars}★** and **${payload.destructionPercentage}%**${fresh}${duration}.`;
  }

  const payload = parseClanMemberNotificationPayload(entry.payload);
  const verb = payload.eventType === 'left' ? 'left' : 'joined';
  return `**${payload.playerName} (${payload.playerTag})** ${verb} clan **${payload.clanTag}**.`;
}

function parseWarAttackNotificationPayload(payload: unknown): {
  clanTag: string;
  attackerTag: string;
  defenderTag: string;
  stars: number;
  destructionPercentage: number;
  duration: number | null;
  freshAttack: boolean;
} {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Notification payload must be an object.');
  }
  const record = payload as Record<string, unknown>;
  const clanTag = readPayloadString(record, 'clanTag');
  const attackerTag = readPayloadString(record, 'attackerTag');
  const defenderTag = readPayloadString(record, 'defenderTag');
  const stars = readPayloadNumber(record, 'stars');
  const destructionPercentage = readPayloadNumber(record, 'destructionPercentage');
  const { duration: durationValue } = record;
  const duration = durationValue === null ? null : readPayloadNumber(record, 'duration');
  const freshAttack = readPayloadBoolean(record, 'freshAttack');
  return { clanTag, attackerTag, defenderTag, stars, destructionPercentage, duration, freshAttack };
}

function parseClanMemberNotificationPayload(payload: unknown): {
  clanTag: string;
  playerTag: string;
  playerName: string;
  eventType: 'joined' | 'left';
} {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Notification payload must be an object.');
  }

  const record = payload as Record<string, unknown>;
  const clanTag = readPayloadString(record, 'clanTag');
  const playerTag = readPayloadString(record, 'playerTag');
  const playerName = readPayloadString(record, 'playerName');
  const eventType = readPayloadString(record, 'eventType');
  if (eventType !== 'joined' && eventType !== 'left') {
    throw new Error(`Unsupported clan member notification event type: ${eventType}`);
  }

  return { clanTag, playerTag, playerName, eventType };
}

function readPayloadString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Notification payload requires ${key}.`);
  }
  return value.trim();
}

function readPayloadNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Notification payload requires ${key}.`);
  }
  return value;
}

function readPayloadBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Notification payload requires ${key}.`);
  }
  return value;
}
