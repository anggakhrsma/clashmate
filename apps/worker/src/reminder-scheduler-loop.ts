import type {
  ClanMemberSnapshotReader,
  DatabasePlayerLinkStore,
  DatabaseReminderDeliveryStore,
  ReminderScheduleDeliveryRecord,
} from '@clashmate/database';
import { normalizeClashTag } from '@clashmate/shared';

interface LoggerLike {
  debug?: (payload: unknown, message?: string) => void;
  error?: (payload: unknown, message?: string) => void;
  info?: (payload: unknown, message?: string) => void;
}

export interface ReminderSchedulerLoopOptions {
  readonly reminders: DatabaseReminderDeliveryStore;
  readonly snapshots: ClanMemberSnapshotReader;
  readonly links: Pick<DatabasePlayerLinkStore, 'listPlayerLinksByTags'>;
  readonly interval: {
    readonly baseSeconds: number;
    readonly jitterSeconds: number;
  };
  readonly batchSize?: number;
  readonly random?: () => number;
  readonly logger?: LoggerLike;
}

export interface ReminderSchedulerLoopController {
  readonly stop: () => void;
}

export interface ReminderSchedulerIterationResult {
  readonly schedulesScanned: number;
  readonly schedulesDue: number;
  readonly outboxInserted: number;
  readonly failures?: number;
}

interface DueReminder {
  readonly schedule: ReminderScheduleDeliveryRecord;
  readonly bucket: string;
  readonly nextRunAt: string;
}

interface ReminderDuration {
  readonly milliseconds: number;
  readonly label: string;
}

type ReminderSnapshot = Awaited<
  ReturnType<ClanMemberSnapshotReader['listClanMemberSnapshotsForGuild']>
>[number];

interface SelectedReminderClan {
  readonly configuredClan: ReminderScheduleDeliveryRecord['clans'][number];
  readonly snapshot: ReminderSnapshot | null;
}

const MAX_REMINDER_MENTIONS = 50;
const MAX_REMINDER_CONTENT_LENGTH = 1900;

export async function runReminderSchedulerIteration(
  options: ReminderSchedulerLoopOptions,
  now = new Date(),
): Promise<ReminderSchedulerIterationResult> {
  validateReminderSchedulerLoopOptions(options);

  const schedules = await options.reminders.listReminderSchedulesForDelivery();
  const due = schedules.flatMap((schedule) => collectDueReminder(schedule, now));
  const limitedDue = due.slice(0, options.batchSize ?? 50);
  let outboxInserted = 0;
  let failures = 0;

  for (const item of limitedDue) {
    try {
      const payload = await buildReminderPayload(item.schedule, options, now);
      const inserted = await options.reminders.insertReminderOutboxEntry({
        guildId: item.schedule.guildId,
        schedule: item.schedule,
        bucket: item.bucket,
        payload,
        now,
      });
      if (inserted) outboxInserted += 1;
    } catch (error) {
      failures += 1;
      options.logger?.error?.(
        {
          error,
          scheduleId: item.schedule.id,
          guildId: item.schedule.guildId,
          channelId: item.schedule.channelId,
          reminderType: item.schedule.type,
          bucket: item.bucket,
          nextRunAt: item.nextRunAt,
        },
        'Reminder scheduler failed to process due reminder',
      );
    }
  }

  const summary = buildReminderSchedulerIterationSummary(
    schedules,
    due,
    limitedDue,
    outboxInserted,
    failures,
  );
  options.logger?.debug?.(summary, 'Reminder scheduler iteration completed');

  return {
    schedulesScanned: schedules.length,
    schedulesDue: due.length,
    outboxInserted,
    ...(failures > 0 ? { failures } : {}),
  };
}

export function startReminderSchedulerLoop(
  options: ReminderSchedulerLoopOptions,
): ReminderSchedulerLoopController {
  validateReminderSchedulerLoopOptions(options);

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (stopped) return;
    const delayMs = computeReminderSchedulerLoopDelayMs(options.interval, options.random);
    timer = setTimeout(async () => {
      await runReminderSchedulerIteration(options).catch((error: unknown) => {
        options.logger?.error?.({ error }, 'Reminder scheduler iteration failed');
      });
      schedule();
    }, delayMs);
  };

  void runReminderSchedulerIteration(options).catch((error: unknown) => {
    options.logger?.error?.({ error }, 'Initial reminder scheduler iteration failed');
  });
  schedule();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export function computeReminderSchedulerLoopDelayMs(
  interval: ReminderSchedulerLoopOptions['interval'],
  random: () => number = Math.random,
): number {
  const baseMs = Math.max(1, Math.trunc(interval.baseSeconds)) * 1000;
  const jitterMs = Math.max(0, Math.trunc(interval.jitterSeconds)) * 1000;
  return baseMs + Math.floor(random() * (jitterMs + 1));
}

function collectDueReminder(schedule: ReminderScheduleDeliveryRecord, now: Date): DueReminder[] {
  const duration = parseReminderDuration(schedule.duration);
  if (!duration) return [];
  const createdAt = new Date(schedule.createdAt);
  if (Number.isNaN(createdAt.getTime())) return [];
  const elapsedMs = now.getTime() - createdAt.getTime();
  if (elapsedMs < duration.milliseconds) return [];
  const bucketNumber = Math.floor(elapsedMs / duration.milliseconds);
  if (bucketNumber < 1) return [];
  return [
    {
      schedule,
      bucket: String(bucketNumber),
      nextRunAt: new Date(
        createdAt.getTime() + (bucketNumber + 1) * duration.milliseconds,
      ).toISOString(),
    },
  ];
}

async function buildReminderPayload(
  schedule: ReminderScheduleDeliveryRecord,
  options: ReminderSchedulerLoopOptions,
  now: Date,
): Promise<Record<string, unknown>> {
  const snapshots = await options.snapshots.listClanMemberSnapshotsForGuild({
    guildId: schedule.guildId,
  });
  const snapshotsByTag = new Map(
    snapshots.map((snapshot) => [normalizeComparableTag(snapshot.clan.clanTag), snapshot]),
  );
  const selected: SelectedReminderClan[] = schedule.clans.flatMap((clan) => {
    if (!clan.clanTag) return [];
    const snapshot = snapshotsByTag.get(normalizeComparableTag(clan.clanTag));
    return [{ configuredClan: clan, snapshot: snapshot ?? null }];
  });
  const playerTags = selected.flatMap(
    (entry) => entry.snapshot?.members.map((member) => member.playerTag) ?? [],
  );
  const links = schedule.excludeParticipantList
    ? []
    : await options.links.listPlayerLinksByTags(playerTags);
  const linkedByTag = new Map(
    links.map((link) => [normalizeComparableTag(link.playerTag), link.discordUserId]),
  );
  const mentions = schedule.excludeParticipantList
    ? []
    : Array.from(
        new Set(
          playerTags
            .map((tag) => linkedByTag.get(normalizeComparableTag(tag)))
            .filter((userId): userId is string => Boolean(userId)),
        ),
      ).slice(0, MAX_REMINDER_MENTIONS);
  const content = truncateReminderContent(
    [
      `**${formatReminderType(schedule.type)} reminder**`,
      schedule.message,
      '',
      ...selected.map((entry) => formatReminderClanSection(entry.configuredClan, entry.snapshot)),
      '',
      schedule.excludeParticipantList
        ? '_Participant list excluded for this reminder._'
        : mentions.length > 0
          ? mentions.map((userId) => `<@${userId}>`).join(' ')
          : '_No linked Discord users were found for current snapshot members._',
      '',
      `Scheduled duration: ${formatReminderDuration(parseReminderDuration(schedule.duration))}. Triggered ${now.toISOString()}.`,
      !schedule.excludeParticipantList && mentions.length >= MAX_REMINDER_MENTIONS
        ? `Mentions capped at ${MAX_REMINDER_MENTIONS} users.`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  return {
    scheduleId: schedule.id,
    type: schedule.type,
    duration: schedule.duration,
    clans: schedule.clans,
    message: schedule.message,
    excludeParticipantList: schedule.excludeParticipantList,
    triggeredAt: now.toISOString(),
    mentionUserIds: mentions,
    content,
  };
}

function formatReminderClanSection(
  clan: ReminderScheduleDeliveryRecord['clans'][number],
  snapshot: ReminderSnapshot | null,
): string {
  const label = clan.name ?? clan.alias ?? clan.clanTag ?? clan.input;
  if (!snapshot) return `• **${label}**: no persisted member snapshot is available yet.`;
  return `• **${label} (${snapshot.clan.clanTag})**: ${snapshot.members.length} snapshot members.`;
}

function parseReminderDuration(value: string): ReminderDuration | null {
  const match = /^(\d+)([mhd])$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number.parseInt(match[1] ?? '', 10);
  const unit = (match[2] ?? '').toLowerCase();
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const minutes = unit === 'm' ? amount : unit === 'h' ? amount * 60 : amount * 24 * 60;
  if (minutes > 30 * 24 * 60) return null;
  const unitLabel = unit === 'm' ? 'minute' : unit === 'h' ? 'hour' : 'day';
  return {
    milliseconds: minutes * 60_000,
    label: `${amount} ${unitLabel}${amount === 1 ? '' : 's'}`,
  };
}

function formatReminderDuration(duration: ReminderDuration | null): string {
  return duration?.label ?? 'unknown duration';
}

function formatReminderType(type: string): string {
  if (type === 'capital-raids') return 'Capital Raids';
  if (type === 'clan-games') return 'Clan Games';
  return 'Clan Wars';
}

function normalizeComparableTag(value: string): string {
  try {
    return normalizeClashTag(value);
  } catch {
    return value.trim().toUpperCase();
  }
}

function truncateReminderContent(value: string): string {
  if (value.length <= MAX_REMINDER_CONTENT_LENGTH) return value;
  return `${value.slice(0, MAX_REMINDER_CONTENT_LENGTH - 40)}\n…truncated for Discord message length.`;
}

function validateReminderSchedulerLoopOptions(options: ReminderSchedulerLoopOptions): void {
  if (!options.reminders) throw new Error('Reminder scheduler store is required.');
  if (!options.snapshots) throw new Error('Reminder scheduler snapshot reader is required.');
  if (!options.links) throw new Error('Reminder scheduler link reader is required.');
  if (!Number.isFinite(options.interval.baseSeconds) || options.interval.baseSeconds < 1) {
    throw new Error('Reminder scheduler base interval must be at least 1 second.');
  }
  if (!Number.isFinite(options.interval.jitterSeconds) || options.interval.jitterSeconds < 0) {
    throw new Error('Reminder scheduler jitter interval cannot be negative.');
  }
}

function buildReminderSchedulerIterationSummary(
  schedules: readonly ReminderScheduleDeliveryRecord[],
  due: readonly DueReminder[],
  limitedDue: readonly DueReminder[],
  outboxInserted: number,
  failures: number,
): Record<string, unknown> {
  const skipped = Math.max(0, limitedDue.length - outboxInserted - failures);
  return {
    schedulesScanned: schedules.length,
    schedulesDue: due.length,
    schedulesProcessed: limitedDue.length,
    outboxInserted,
    outboxSkipped: skipped,
    failures,
    reminderBreakdown: buildReminderSchedulerBreakdown(limitedDue),
    nextRunAtCoverage: buildReminderSchedulerNextRunCoverage(due),
  };
}

function buildReminderSchedulerBreakdown(due: readonly DueReminder[]): {
  readonly guilds: readonly { guildId: string; due: number }[];
  readonly channels: readonly { channelId: string; due: number }[];
  readonly types: readonly { type: string; due: number }[];
} {
  const guilds = new Map<string, number>();
  const channels = new Map<string, number>();
  const types = new Map<string, number>();

  for (const item of due) {
    incrementCount(guilds, item.schedule.guildId);
    incrementCount(channels, item.schedule.channelId ?? 'unknown');
    incrementCount(types, item.schedule.type);
  }

  return {
    guilds: mapCountEntries(guilds, 'guildId'),
    channels: mapCountEntries(channels, 'channelId'),
    types: mapCountEntries(types, 'type'),
  };
}

function buildReminderSchedulerNextRunCoverage(due: readonly DueReminder[]): {
  readonly earliest?: string;
  readonly latest?: string;
} {
  if (due.length === 0) return {};
  const sorted = [...due].sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return {};
  return {
    earliest: first.nextRunAt,
    latest: last.nextRunAt,
  };
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function mapCountEntries<TKey extends string>(
  map: Map<string, number>,
  keyName: TKey,
): readonly ({ [P in TKey]: string } & { due: number })[] {
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([value, count]) =>
        ({ [keyName]: value, due: count }) as { [P in TKey]: string } & { due: number },
    );
}
