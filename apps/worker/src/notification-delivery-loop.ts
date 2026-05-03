import type { NotificationOutboxDeliveryStore } from '@clashmate/database';
import type { Logger } from '@clashmate/logger';

export interface DiscordNotificationEmbedField {
  readonly name: string;
  readonly value: string;
  readonly inline?: boolean;
}

export interface DiscordNotificationEmbed {
  readonly title: string;
  readonly description?: string;
  readonly color?: number;
  readonly fields?: readonly DiscordNotificationEmbedField[];
}

export interface DiscordNotificationMessage {
  readonly content: string;
  readonly embeds?: readonly DiscordNotificationEmbed[];
}

export interface NotificationDeliveryLoopIntervalConfig {
  readonly baseSeconds: number;
  readonly jitterSeconds: number;
}

export interface DiscordNotificationSender {
  sendChannelMessage: (channelId: string, content: string) => Promise<void>;
  sendDiscordNotificationMessage?: (
    channelId: string,
    message: DiscordNotificationMessage,
  ) => Promise<void>;
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

const DISCORD_NOTIFICATION_CONTENT_LIMIT = 2000;
const DISCORD_EMBED_TITLE_LIMIT = 256;
const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;
const DISCORD_EMBED_FIELD_NAME_LIMIT = 256;
const DISCORD_EMBED_FIELD_VALUE_LIMIT = 1024;
const DISCORD_EMBED_MAX_FIELDS = 25;
const TRUNCATION_ELLIPSIS = '…';
const DEFAULT_NOTIFICATION_DELIVERY_BATCH_SIZE = 50;
const MAX_NOTIFICATION_DELIVERY_BATCH_SIZE = 1000;
const DEFAULT_NOTIFICATION_DELIVERY_MAX_ATTEMPTS = 5;
const DEFAULT_NOTIFICATION_DELIVERY_LOCK_SECONDS = 60;
const DEFAULT_NOTIFICATION_DELIVERY_RETRY_BASE_SECONDS = 30;
const MAX_NOTIFICATION_DONATION_DELTA = 1_000_000;
const MAX_CLAN_GAMES_EVENT_POINTS = 100_000;
const MAX_WAR_ATTACK_STARS = 3;
const MAX_DESTRUCTION_PERCENTAGE = 100;
const MAX_WAR_ATTACK_DURATION_SECONDS = 3600;
const MAX_MISSED_WAR_ATTACKS_AVAILABLE = 10;

interface ResolvedNotificationDeliveryIterationOptions {
  readonly batchSize: number;
  readonly maxAttempts: number;
  readonly lockForSeconds: number;
  readonly retryBaseSeconds: number;
}

export function computeNotificationDeliveryLoopDelayMs(
  interval: NotificationDeliveryLoopIntervalConfig,
  random = Math.random,
): number {
  if (
    !Number.isFinite(interval.baseSeconds) ||
    !Number.isFinite(interval.jitterSeconds) ||
    interval.baseSeconds <= 0 ||
    interval.jitterSeconds < 0
  ) {
    throw new Error(
      'Notification delivery loop intervals must be finite and positive with non-negative jitter.',
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

function resolveNotificationDeliveryIterationOptions(
  options: NotificationDeliveryLoopOptions,
): ResolvedNotificationDeliveryIterationOptions {
  const batchSize = options.batchSize ?? DEFAULT_NOTIFICATION_DELIVERY_BATCH_SIZE;
  const maxAttempts = options.maxAttempts ?? DEFAULT_NOTIFICATION_DELIVERY_MAX_ATTEMPTS;
  const lockForSeconds = options.lockForSeconds ?? DEFAULT_NOTIFICATION_DELIVERY_LOCK_SECONDS;
  const retryBaseSeconds =
    options.retryBaseSeconds ?? DEFAULT_NOTIFICATION_DELIVERY_RETRY_BASE_SECONDS;

  assertFinitePositiveInteger('batchSize', batchSize);
  if (batchSize > MAX_NOTIFICATION_DELIVERY_BATCH_SIZE) {
    throw new Error(
      `Notification delivery batchSize must not exceed ${MAX_NOTIFICATION_DELIVERY_BATCH_SIZE}.`,
    );
  }
  assertFinitePositiveInteger('maxAttempts', maxAttempts);
  assertFinitePositiveInteger('lockForSeconds', lockForSeconds);
  if (!Number.isFinite(retryBaseSeconds) || retryBaseSeconds <= 0) {
    throw new Error('Notification delivery retryBaseSeconds must be a finite positive number.');
  }

  return { batchSize, maxAttempts, lockForSeconds, retryBaseSeconds };
}

function assertFinitePositiveInteger(name: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Notification delivery ${name} must be a finite positive integer.`);
  }
}

export async function runNotificationDeliveryIteration(
  options: NotificationDeliveryLoopOptions,
): Promise<void> {
  const { batchSize, lockForSeconds, maxAttempts, retryBaseSeconds } =
    resolveNotificationDeliveryIterationOptions(options);
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

      if (options.sender.sendDiscordNotificationMessage) {
        try {
          await options.sender.sendDiscordNotificationMessage(
            entry.targetId,
            formatDiscordNotificationMessage(entry),
          );
        } catch (richSendError) {
          try {
            await options.sender.sendChannelMessage(
              entry.targetId,
              formatNotificationOutboxMessage(entry),
            );
          } catch {
            throw richSendError;
          }
        }
      } else {
        await options.sender.sendChannelMessage(
          entry.targetId,
          formatNotificationOutboxMessage(entry),
        );
      }
      await options.deliveryStore.markNotificationOutboxSent(entry.id, options.ownerId, new Date());
      options.logger?.info?.({ outboxId: entry.id, targetId: entry.targetId }, 'Sent notification');
    } catch (error) {
      const retryAt = computeNotificationRetryAt(new Date(), entry.attempts + 1, retryBaseSeconds);
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

export function formatDiscordNotificationMessage(entry: {
  sourceType?: string;
  payload: unknown;
}): DiscordNotificationMessage {
  const fallback = formatNotificationOutboxMessage(entry);

  try {
    return {
      content: formatDiscordNotificationContent(buildSafeNotificationContent(entry.sourceType)),
      embeds: [buildNotificationEmbed(entry)],
    };
  } catch {
    return { content: formatDiscordNotificationContent(fallback) };
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
  if (entry.sourceType === 'clan_donation_event') {
    const payload = parseClanDonationNotificationPayload(entry.payload);
    const donated = payload.donationDelta > 0;
    const received = payload.receivedDelta > 0;
    const identity = `**${payload.playerName} (${payload.playerTag})**`;

    if (donated && received) {
      return `🎁 ${identity} donated **${payload.donationDelta}** troops and received **${payload.receivedDelta}** troops in clan **${payload.clanTag}**.`;
    }
    if (donated) {
      return `🎁 ${identity} donated **${payload.donationDelta}** troops in clan **${payload.clanTag}**.`;
    }
    return `🎁 ${identity} received **${payload.receivedDelta}** troops in clan **${payload.clanTag}**.`;
  }

  if (entry.sourceType === 'clan_role_change_event') {
    const payload = parseClanRoleChangeNotificationPayload(entry.payload);
    const previous = payload.previousRole ? ` from **${payload.previousRole}**` : '';
    const current = payload.currentRole ?? 'no role';
    return `👑 **${payload.playerName} (${payload.playerTag})** changed role${previous} to **${current}** in clan **${payload.clanTag}**.`;
  }

  if (entry.sourceType === 'war_attack_event') {
    const payload = parseWarAttackNotificationPayload(entry.payload);
    const fresh = payload.freshAttack ? ' fresh' : '';
    const duration = payload.duration === null ? '' : ` in ${payload.duration}s`;
    return `⚔️ **${payload.attackerTag}** attacked **${payload.defenderTag}** in clan **${payload.clanTag}** for **${payload.stars}★** and **${payload.destructionPercentage}%**${fresh}${duration}.`;
  }

  if (entry.sourceType === 'war_state_event') {
    const payload = parseWarStateNotificationPayload(entry.payload);
    const previous = payload.previousState ? ` from **${payload.previousState}**` : '';
    return `🛡️ War state changed${previous} to **${payload.currentState}** for clan **${payload.clanTag}**.`;
  }

  if (entry.sourceType === 'missed_war_attack_event') {
    const payload = parseMissedWarAttackNotificationPayload(entry.payload);
    const missed = payload.attacksAvailable - payload.attacksUsed;
    return `🚨 **${payload.playerName} (${payload.playerTag})** missed **${missed}** war attack${missed === 1 ? '' : 's'} in clan **${payload.clanTag}**.`;
  }

  if (entry.sourceType === 'clan_games_event') {
    const payload = parseClanGamesNotificationPayload(entry.payload);
    const progress = `**${formatNotificationNumber(payload.currentPoints)}/${formatNotificationNumber(payload.eventMaxPoints)}**`;
    const identity = `**${payload.playerName} (${payload.playerTag})**`;

    if (payload.eventType === 'completed') {
      return `🏅 ${identity} completed Clan Games in clan **${payload.clanTag}** for **${payload.seasonId}** (${progress}).`;
    }

    if (payload.eventType === 'progress_delta') {
      return `🎯 ${identity} gained **${formatNotificationNumber(payload.pointsDelta)}** Clan Games points in clan **${payload.clanTag}** for **${payload.seasonId}** (${progress}).`;
    }

    return `🎯 ${identity} updated Clan Games progress in clan **${payload.clanTag}** for **${payload.seasonId}** (${progress}).`;
  }

  const payload = parseClanMemberNotificationPayload(entry.payload);
  const verb = payload.eventType === 'left' ? 'left' : 'joined';
  return `**${payload.playerName} (${payload.playerTag})** ${verb} clan **${payload.clanTag}**.`;
}

function buildSafeNotificationContent(sourceType?: string): string {
  return `${getNotificationStyle(sourceType).icon} ${getNotificationStyle(sourceType).title}`;
}

function buildNotificationEmbed(entry: {
  sourceType?: string;
  payload: unknown;
}): DiscordNotificationEmbed {
  const style = getNotificationStyle(entry.sourceType);

  if (entry.sourceType === 'clan_donation_event') {
    const payload = parseClanDonationNotificationPayload(entry.payload);
    return buildEmbed(style, `${payload.playerName} (${payload.playerTag})`, [
      field('Clan', payload.clanTag, true),
      field('Donated', formatNotificationNumber(payload.donationDelta), true),
      field('Received', formatNotificationNumber(payload.receivedDelta), true),
      field('Player Tag', payload.playerTag, true),
    ]);
  }

  if (entry.sourceType === 'clan_role_change_event') {
    const payload = parseClanRoleChangeNotificationPayload(entry.payload);
    return buildEmbed(style, `${safeDiscordText(payload.playerName)} (${payload.playerTag})`, [
      field('Clan', payload.clanTag, true),
      field('Previous Role', payload.previousRole ?? 'none', true),
      field('Current Role', payload.currentRole ?? 'none', true),
      field('Player Tag', payload.playerTag, true),
    ]);
  }

  if (entry.sourceType === 'war_attack_event') {
    const payload = parseWarAttackNotificationPayload(entry.payload);
    return buildEmbed(style, `${payload.stars}★ attack for ${payload.destructionPercentage}%`, [
      field('Clan', payload.clanTag, true),
      field('Attacker', payload.attackerTag, true),
      field('Defender', payload.defenderTag, true),
      field('Fresh Attack', payload.freshAttack ? 'Yes' : 'No', true),
      field('Duration', payload.duration === null ? 'Unknown' : `${payload.duration}s`, true),
    ]);
  }

  if (entry.sourceType === 'war_state_event') {
    const payload = parseWarStateNotificationPayload(entry.payload);
    return buildEmbed(style, `War is now ${payload.currentState}`, [
      field('Clan', payload.clanTag, true),
      field('Previous State', payload.previousState ?? 'none', true),
      field('Current State', payload.currentState, true),
    ]);
  }

  if (entry.sourceType === 'missed_war_attack_event') {
    const payload = parseMissedWarAttackNotificationPayload(entry.payload);
    const missed = payload.attacksAvailable - payload.attacksUsed;
    return buildEmbed(
      style,
      `${payload.playerName} missed ${missed} attack${missed === 1 ? '' : 's'}`,
      [
        field('Clan', payload.clanTag, true),
        field('Player Tag', payload.playerTag, true),
        field('Used', String(payload.attacksUsed), true),
        field('Available', String(payload.attacksAvailable), true),
      ],
    );
  }

  if (entry.sourceType === 'clan_games_event') {
    const payload = parseClanGamesNotificationPayload(entry.payload);
    return buildEmbed(style, `${payload.playerName} Clan Games ${payload.eventType}`, [
      field('Clan', payload.clanTag, true),
      field('Season', payload.seasonId, true),
      field('Player Tag', payload.playerTag, true),
      field(
        'Progress',
        `${formatNotificationNumber(payload.currentPoints)}/${formatNotificationNumber(payload.eventMaxPoints)}`,
        true,
      ),
      field('Points Gained', formatNotificationNumber(payload.pointsDelta), true),
    ]);
  }

  const payload = parseClanMemberNotificationPayload(entry.payload);
  const verb = payload.eventType === 'left' ? 'left' : 'joined';
  return buildEmbed(style, `${payload.playerName} ${verb} the clan`, [
    field('Clan', payload.clanTag, true),
    field('Player Tag', payload.playerTag, true),
    field('Event', payload.eventType, true),
  ]);
}

function buildEmbed(
  style: NotificationStyle,
  description: string,
  fields: readonly DiscordNotificationEmbedField[],
): DiscordNotificationEmbed {
  return {
    title: formatDiscordEmbedTitle(`${style.icon} ${style.title}`),
    description: formatDiscordEmbedDescription(description),
    color: style.color,
    fields: fields.slice(0, DISCORD_EMBED_MAX_FIELDS).map((embedField) => ({
      name: formatDiscordEmbedFieldName(embedField.name),
      value: formatDiscordEmbedFieldValue(embedField.value),
      inline: embedField.inline ?? false,
    })),
  };
}

function field(name: string, value: string, inline = false): DiscordNotificationEmbedField {
  return { name, value, inline };
}

interface NotificationStyle {
  readonly title: string;
  readonly icon: string;
  readonly color: number;
}

function getNotificationStyle(sourceType?: string): NotificationStyle {
  switch (sourceType) {
    case 'clan_donation_event':
      return { title: 'Donation Update', icon: '🎁', color: 0x2ecc71 };
    case 'clan_role_change_event':
      return { title: 'Role Change', icon: '👑', color: 0xf1c40f };
    case 'war_attack_event':
      return { title: 'War Attack', icon: '⚔️', color: 0xe74c3c };
    case 'war_state_event':
      return { title: 'War State Update', icon: '🛡️', color: 0x3498db };
    case 'missed_war_attack_event':
      return { title: 'Missed War Attack', icon: '🚨', color: 0xc0392b };
    case 'clan_games_event':
      return { title: 'Clan Games Update', icon: '🎯', color: 0x9b59b6 };
    default:
      return { title: 'Clan Member Update', icon: '👥', color: 0x95a5a6 };
  }
}

function safeDiscordText(value: string): string {
  return value.replace(/@/g, '@\u200b').trim() || 'Unknown';
}

function formatDiscordNotificationContent(value: string): string {
  return truncateDiscordText(safeDiscordText(value), DISCORD_NOTIFICATION_CONTENT_LIMIT);
}

function formatDiscordEmbedTitle(value: string): string {
  return truncateDiscordText(safeDiscordText(value), DISCORD_EMBED_TITLE_LIMIT);
}

function formatDiscordEmbedDescription(value: string): string {
  return truncateDiscordText(safeDiscordText(value), DISCORD_EMBED_DESCRIPTION_LIMIT);
}

function formatDiscordEmbedFieldName(value: string): string {
  return truncateDiscordText(safeDiscordText(value), DISCORD_EMBED_FIELD_NAME_LIMIT);
}

function formatDiscordEmbedFieldValue(value: string): string {
  return truncateDiscordText(safeDiscordText(value), DISCORD_EMBED_FIELD_VALUE_LIMIT);
}

function truncateDiscordText(value: string, limit: number): string {
  if (!Number.isInteger(limit) || limit <= 0) return TRUNCATION_ELLIPSIS;
  if (value.length <= limit) return value;
  if (limit === 1) return TRUNCATION_ELLIPSIS;
  return `${value.slice(0, limit - TRUNCATION_ELLIPSIS.length).trimEnd()}${TRUNCATION_ELLIPSIS}`;
}

function parseClanGamesNotificationPayload(payload: unknown): {
  clanTag: string;
  seasonId: string;
  eventType: string;
  playerTag: string;
  playerName: string;
  previousPoints: number | null;
  currentPoints: number;
  pointsDelta: number;
  eventMaxPoints: number;
} {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Notification payload must be an object.');
  }

  const record = payload as Record<string, unknown>;
  const clanTag = readPayloadString(record, 'clanTag');
  const seasonId = readPayloadString(record, 'seasonId');
  const eventType = readPayloadString(record, 'eventType');
  const playerTag = readPayloadString(record, 'playerTag');
  const playerName = readPayloadString(record, 'playerName');
  const previousPoints = readNullablePayloadIntegerInRange(
    record,
    'previousPoints',
    0,
    MAX_CLAN_GAMES_EVENT_POINTS,
  );
  const currentPoints = readPayloadIntegerInRange(
    record,
    'currentPoints',
    0,
    MAX_CLAN_GAMES_EVENT_POINTS,
  );
  const pointsDelta = readPayloadIntegerInRange(
    record,
    'pointsDelta',
    0,
    MAX_CLAN_GAMES_EVENT_POINTS,
  );
  const eventMaxPoints = readPayloadIntegerInRange(
    record,
    'eventMaxPoints',
    1,
    MAX_CLAN_GAMES_EVENT_POINTS,
  );

  if (currentPoints > eventMaxPoints || pointsDelta > eventMaxPoints) {
    throw new Error('Clan Games notification payload progress cannot exceed event max points.');
  }
  if (previousPoints !== null && previousPoints > eventMaxPoints) {
    throw new Error(
      'Clan Games notification payload previous points cannot exceed event max points.',
    );
  }

  return {
    clanTag,
    seasonId,
    eventType,
    playerTag,
    playerName,
    previousPoints,
    currentPoints,
    pointsDelta,
    eventMaxPoints,
  };
}

function parseClanDonationNotificationPayload(payload: unknown): {
  clanTag: string;
  playerTag: string;
  playerName: string;
  donationDelta: number;
  receivedDelta: number;
} {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Notification payload must be an object.');
  }

  const record = payload as Record<string, unknown>;
  const clanTag = readPayloadString(record, 'clanTag');
  const playerTag = readPayloadString(record, 'playerTag');
  const playerName = readPayloadString(record, 'playerName');
  const donationDelta = readPayloadIntegerInRange(
    record,
    'donationDelta',
    0,
    MAX_NOTIFICATION_DONATION_DELTA,
  );
  const receivedDelta = readPayloadIntegerInRange(
    record,
    'receivedDelta',
    0,
    MAX_NOTIFICATION_DONATION_DELTA,
  );
  if (donationDelta <= 0 && receivedDelta <= 0) {
    throw new Error('Clan donation notification payload requires a positive donation delta.');
  }

  return { clanTag, playerTag, playerName, donationDelta, receivedDelta };
}

function parseClanRoleChangeNotificationPayload(payload: unknown): {
  clanTag: string;
  playerTag: string;
  playerName: string;
  previousRole: string | null;
  currentRole: string | null;
} {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Notification payload must be an object.');
  }
  const record = payload as Record<string, unknown>;
  const clanTag = readPayloadString(record, 'clanTag');
  const playerTag = readPayloadString(record, 'playerTag');
  const playerName = readPayloadString(record, 'playerName');
  const previousRole = readOptionalPayloadString(record, 'previousRole');
  const currentRole = readOptionalPayloadString(record, 'currentRole');
  if (previousRole === currentRole) {
    throw new Error('Clan role change notification requires different roles.');
  }
  return { clanTag, playerTag, playerName, previousRole, currentRole };
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
  const stars = readPayloadIntegerInRange(record, 'stars', 0, MAX_WAR_ATTACK_STARS);
  const destructionPercentage = readPayloadIntegerInRange(
    record,
    'destructionPercentage',
    0,
    MAX_DESTRUCTION_PERCENTAGE,
  );
  const { duration: durationValue } = record;
  const duration =
    durationValue === null
      ? null
      : readPayloadIntegerInRange(record, 'duration', 0, MAX_WAR_ATTACK_DURATION_SECONDS);
  const freshAttack = readPayloadBoolean(record, 'freshAttack');
  return { clanTag, attackerTag, defenderTag, stars, destructionPercentage, duration, freshAttack };
}

function parseWarStateNotificationPayload(payload: unknown): {
  clanTag: string;
  previousState: string | null;
  currentState: string;
} {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Notification payload must be an object.');
  }
  const record = payload as Record<string, unknown>;
  const clanTag = readPayloadString(record, 'clanTag');
  const { previousState: previousStateValue } = record;
  if (previousStateValue !== null && previousStateValue !== undefined) {
    if (typeof previousStateValue !== 'string' || !previousStateValue.trim()) {
      throw new Error('Notification payload requires previousState to be null or a string.');
    }
  }
  const previousState = typeof previousStateValue === 'string' ? previousStateValue.trim() : null;
  const currentState = readPayloadString(record, 'currentState');
  return { clanTag, previousState, currentState };
}

function parseMissedWarAttackNotificationPayload(payload: unknown): {
  clanTag: string;
  playerTag: string;
  playerName: string;
  attacksUsed: number;
  attacksAvailable: number;
} {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Notification payload must be an object.');
  }
  const record = payload as Record<string, unknown>;
  const clanTag = readPayloadString(record, 'clanTag');
  const playerTag = readPayloadString(record, 'playerTag');
  const playerName = readPayloadString(record, 'playerName');
  const attacksUsed = readPayloadIntegerInRange(record, 'attacksUsed', 0, Number.MAX_SAFE_INTEGER);
  const attacksAvailable = readPayloadIntegerInRange(
    record,
    'attacksAvailable',
    1,
    MAX_MISSED_WAR_ATTACKS_AVAILABLE,
  );
  if (attacksAvailable <= attacksUsed) {
    throw new Error('Missed war attack notification requires missed attacks.');
  }
  return { clanTag, playerTag, playerName, attacksUsed, attacksAvailable };
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

function readOptionalPayloadString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Notification payload requires ${key} to be null or a string.`);
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

function readPayloadIntegerInRange(
  record: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number {
  const value = readPayloadNumber(record, key);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Notification payload requires ${key} to be an integer from ${min} to ${max}.`);
  }
  return value;
}

function readNullablePayloadIntegerInRange(
  record: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | null {
  const value = record[key];
  if (value === null) return null;
  return readPayloadIntegerInRange(record, key, min, max);
}

function formatNotificationNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function readPayloadBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Notification payload requires ${key}.`);
  }
  return value;
}
