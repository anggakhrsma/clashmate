import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDatabase>;

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DatabaseStatusMetrics {
  countCommandsUsedLast30Days: () => Promise<number>;
  countTrackedClans: () => Promise<number>;
  countPlayerLinks: () => Promise<number>;
}

export interface DatabaseUsageDailyRecord {
  date: string;
  uses: number;
}

export interface DatabaseUsageCommandTotalRecord {
  commandName: string;
  uses: number;
}

export interface DatabaseBotGrowthDailyRecord {
  date: string;
  guildAdditions: number;
  guildDeletions: number;
}

export interface DatabaseUsageMetrics {
  listRecentDailyUsage: (limit: number) => Promise<DatabaseUsageDailyRecord[]>;
  listCommandTotals: () => Promise<DatabaseUsageCommandTotalRecord[]>;
  listRecentGrowth: (limit: number) => Promise<DatabaseBotGrowthDailyRecord[]>;
}

export interface RecordCommandUsageInput {
  commandName: string;
  guildId: string | null;
  usedAt?: Date;
}

export interface DatabaseCommandUsageRecorder {
  recordCommandUsage: (input: RecordCommandUsageInput) => Promise<void>;
}

export interface NormalizedCommandUsageIncrement {
  commandName: string;
  guildId: string;
  usageDate: string;
  usedAt: Date;
}

export const DIRECT_MESSAGE_COMMAND_USAGE_GUILD_ID = 'direct-message';

export interface DebugTrackedClanRecord {
  clanTag: string;
  name: string | null;
  isActive: boolean;
  lastSeenAt: Date | null;
}

export interface DatabasePollerDiagnostics {
  clanLeases: number;
  playerLeases: number;
  warLeases: number;
  dueLeases: number;
}

export interface DatabaseConfigDiagnostics {
  diagnosticsEnabled: boolean | 'Unknown';
}

export interface DatabaseDebugReader {
  listTrackedClansForGuild: (guildId: string) => Promise<DebugTrackedClanRecord[]>;
  getPollerDiagnostics: () => Promise<DatabasePollerDiagnostics>;
  getConfigDiagnostics: (guildId: string) => Promise<DatabaseConfigDiagnostics>;
}

export type PollingResourceType = 'clan' | 'player' | 'war';

export const TOP_LEVEL_POLLING_RESOURCE_TYPES = ['clan', 'player', 'war'] as const;

export interface PollingEnrollmentStore {
  upsertPollingLease: (input: {
    resourceType: PollingResourceType;
    resourceId: string;
    runAfter?: Date;
  }) => Promise<void>;
  syncClanPollingLeases: (runAfter?: Date) => Promise<{ enrolled: number; removed: number }>;
  syncPlayerPollingLeases: (runAfter?: Date) => Promise<{ enrolled: number; removed: number }>;
  syncWarPollingLeases: (runAfter?: Date) => Promise<{
    enrolled: number;
    removed: number;
  }>;
}

export interface ClaimedPollingLease {
  resourceType: PollingResourceType;
  resourceId: string;
  ownerId: string;
  runAfter: Date;
  lockedUntil: Date;
  attempts: number;
  lastError: string | null;
}

export interface UpsertLatestClanSnapshotInput {
  clanTag: string;
  name: string;
  snapshot: unknown;
  fetchedAt?: Date;
}

export interface UpsertLatestClanSnapshotResult {
  status: 'upserted' | 'not_linked';
}

export interface NormalizedLatestClanSnapshot {
  clanTag: string;
  name: string;
  snapshot: unknown;
  fetchedAt: Date;
}

export interface ClanSnapshotStore {
  upsertLatestClanSnapshot: (
    input: UpsertLatestClanSnapshotInput,
  ) => Promise<UpsertLatestClanSnapshotResult>;
}

export interface ClanMemberSnapshotInput {
  clanTag: string;
  playerTag: string;
  name: string;
  role?: string | null;
  expLevel?: number | null;
  leagueId?: number | null;
  trophies?: number | null;
  builderBaseTrophies?: number | null;
  clanRank?: number | null;
  previousClanRank?: number | null;
  donations?: number | null;
  donationsReceived?: number | null;
  rawMember: unknown;
}

export interface ClanDonationDeltaEvent {
  previousDonations: number;
  currentDonations: number;
  donationDelta: number;
  previousDonationsReceived: number;
  currentDonationsReceived: number;
  receivedDelta: number;
}

export interface ProcessClanMemberSnapshotsInput {
  clanTag: string;
  fetchedAt: Date;
  members: readonly ClanMemberSnapshotInput[];
}

export interface ProcessClanMemberSnapshotsResult {
  status: 'processed' | 'not_linked';
  joined: number;
  left: number;
  donationEvents: number;
}

export interface ClanMemberEventStore {
  processClanMemberSnapshots: (
    input: ProcessClanMemberSnapshotsInput,
  ) => Promise<ProcessClanMemberSnapshotsResult>;
}

export type NotificationSourceType =
  | 'clan_member_event'
  | 'war_attack_event'
  | 'clan_donation_event';
export type NotificationTargetType = 'discord_channel';

export const CLAN_MEMBER_NOTIFICATION_FANOUT_CURSOR_NAME = 'clan_member_event';
export const CLAN_MEMBER_NOTIFICATION_FANOUT_SOURCE_TYPE = 'clan_member_event';
export const WAR_ATTACK_NOTIFICATION_FANOUT_CURSOR_NAME = 'war_attack_event';
export const WAR_ATTACK_NOTIFICATION_FANOUT_SOURCE_TYPE = 'war_attack_event';
export const CLAN_DONATION_NOTIFICATION_FANOUT_CURSOR_NAME = 'clan_donation_event';
export const CLAN_DONATION_NOTIFICATION_FANOUT_SOURCE_TYPE = 'clan_donation_event';

export interface NotificationFanOutCursorState {
  cursorName: string;
  sourceType: string;
  lastDetectedAt: Date | null;
  lastEventId: string | null;
}

export interface NotificationFanOutEventCursorPoint {
  eventId: string;
  detectedAt: Date;
}

export interface ClanMemberNotificationFanOutEvent extends NotificationFanOutEventCursorPoint {
  guildId: string;
  trackedClanId: string | null;
  clanTag: string;
  playerTag: string;
  playerName: string;
  eventType: string;
  eventKey: string;
  occurredAt: Date;
}

export interface WarAttackNotificationFanOutEvent extends NotificationFanOutEventCursorPoint {
  guildId: string;
  trackedClanId: string | null;
  clanTag: string;
  warKey: string;
  eventKey: string;
  attackerTag: string;
  defenderTag: string;
  attackOrder: number;
  stars: number;
  destructionPercentage: number;
  duration: number | null;
  freshAttack: boolean;
  occurredAt: Date;
}

export interface ClanDonationNotificationFanOutEvent extends NotificationFanOutEventCursorPoint {
  guildId: string;
  trackedClanId: string | null;
  clanTag: string;
  playerTag: string;
  playerName: string;
  eventKey: string;
  donationDelta: number;
  receivedDelta: number;
  occurredAt: Date;
}

export interface EnsureNotificationFanOutCursorInput {
  cursorName: string;
  sourceType: NotificationSourceType;
  now: Date;
}

export interface EnsureClanMemberNotificationFanOutCursorInput {
  cursorName: string;
  sourceType: 'clan_member_event';
  now: Date;
}

export interface EnsureWarAttackNotificationFanOutCursorInput {
  cursorName: string;
  sourceType: 'war_attack_event';
  now: Date;
}

export interface EnsureClanDonationNotificationFanOutCursorInput {
  cursorName: string;
  sourceType: 'clan_donation_event';
  now: Date;
}

export interface ListClanMemberEventsAfterFanOutCursorInput {
  cursor: NotificationFanOutCursorState;
  since?: Date;
  limit: number;
}

export interface ListWarAttackEventsAfterFanOutCursorInput {
  cursor: NotificationFanOutCursorState;
  since?: Date;
  limit: number;
}

export type ListClanDonationEventsAfterFanOutCursorInput =
  ListWarAttackEventsAfterFanOutCursorInput;

export interface AdvanceNotificationFanOutCursorInput {
  cursorName: string;
  lastDetectedAt?: Date;
  lastEventId?: string;
  now: Date;
}

export interface ClanMemberNotificationFanOutRepository {
  ensureCursor: (input: EnsureClanMemberNotificationFanOutCursorInput) => Promise<void>;
  lockCursor: (cursorName: string) => Promise<NotificationFanOutCursorState | null>;
  listEventsAfterCursor: (
    input: ListClanMemberEventsAfterFanOutCursorInput,
  ) => Promise<ClanMemberNotificationFanOutEvent[]>;
  listTargetsForEvents: (
    eventIds: readonly string[],
  ) => Promise<ClanMemberNotificationFanOutTarget[]>;
  insertOutboxEntries: (values: readonly NotificationOutboxInsertValue[]) => Promise<number>;
  advanceCursor: (input: AdvanceNotificationFanOutCursorInput) => Promise<void>;
}

export interface WarAttackNotificationFanOutRepository {
  ensureCursor: (input: EnsureWarAttackNotificationFanOutCursorInput) => Promise<void>;
  lockCursor: (cursorName: string) => Promise<NotificationFanOutCursorState | null>;
  listEventsAfterCursor: (
    input: ListWarAttackEventsAfterFanOutCursorInput,
  ) => Promise<WarAttackNotificationFanOutEvent[]>;
  listTargetsForEvents: (
    eventIds: readonly string[],
  ) => Promise<WarAttackNotificationFanOutTarget[]>;
  insertOutboxEntries: (values: readonly NotificationOutboxInsertValue[]) => Promise<number>;
  advanceCursor: (input: AdvanceNotificationFanOutCursorInput) => Promise<void>;
}

export interface ClanDonationNotificationFanOutRepository {
  ensureCursor: (input: EnsureClanDonationNotificationFanOutCursorInput) => Promise<void>;
  lockCursor: (cursorName: string) => Promise<NotificationFanOutCursorState | null>;
  listEventsAfterCursor: (
    input: ListClanDonationEventsAfterFanOutCursorInput,
  ) => Promise<ClanDonationNotificationFanOutEvent[]>;
  listTargetsForEvents: (
    eventIds: readonly string[],
  ) => Promise<ClanDonationNotificationFanOutTarget[]>;
  insertOutboxEntries: (values: readonly NotificationOutboxInsertValue[]) => Promise<number>;
  advanceCursor: (input: AdvanceNotificationFanOutCursorInput) => Promise<void>;
}

export interface BuildNotificationOutboxIdempotencyKeyInput {
  guildId: string;
  sourceType: NotificationSourceType;
  sourceId: string;
  targetType: NotificationTargetType;
  targetId: string;
}

export interface FanOutClanMemberEventNotificationsInput {
  since?: Date;
  limit?: number;
  now?: Date;
}

export interface FanOutClanMemberEventNotificationsResult {
  eventsScanned: number;
  matchedTargets: number;
  insertedOutboxEntries: number;
}

export type FanOutWarAttackEventNotificationsInput = FanOutClanMemberEventNotificationsInput;
export type FanOutWarAttackEventNotificationsResult = FanOutClanMemberEventNotificationsResult;
export type FanOutClanDonationEventNotificationsInput = FanOutClanMemberEventNotificationsInput;
export type FanOutClanDonationEventNotificationsResult = FanOutClanMemberEventNotificationsResult;

export interface NotificationFanOutStore {
  fanOutClanMemberEventNotifications: (
    input?: FanOutClanMemberEventNotificationsInput,
  ) => Promise<FanOutClanMemberEventNotificationsResult>;
  fanOutWarAttackEventNotifications: (
    input?: FanOutWarAttackEventNotificationsInput,
  ) => Promise<FanOutWarAttackEventNotificationsResult>;
  fanOutClanDonationEventNotifications: (
    input?: FanOutClanDonationEventNotificationsInput,
  ) => Promise<FanOutClanDonationEventNotificationsResult>;
}

export interface ClanMemberNotificationFanOutTarget {
  eventId: string;
  guildId: string;
  configId: string;
  discordChannelId: string;
  clanTag: string;
  playerTag: string;
  playerName: string;
  eventType: string;
  eventKey: string;
  occurredAt: Date;
  detectedAt: Date;
}

export interface WarAttackNotificationFanOutTarget {
  eventId: string;
  guildId: string;
  configId: string;
  discordChannelId: string;
  clanTag: string;
  warKey: string;
  eventKey: string;
  attackerTag: string;
  defenderTag: string;
  attackOrder: number;
  stars: number;
  destructionPercentage: number;
  duration: number | null;
  freshAttack: boolean;
  occurredAt: Date;
  detectedAt: Date;
}

export interface ClanDonationNotificationFanOutTarget {
  eventId: string;
  guildId: string;
  configId: string;
  discordChannelId: string;
  clanTag: string;
  playerTag: string;
  playerName: string;
  eventKey: string;
  donationDelta: number;
  receivedDelta: number;
  occurredAt: Date;
  detectedAt: Date;
}

export interface NotificationOutboxInsertValue {
  guildId: string;
  configId?: string | null;
  warAttackConfigId?: string | null;
  clanDonationConfigId?: string | null;
  sourceType: NotificationSourceType;
  sourceId: string;
  idempotencyKey: string;
  targetType: NotificationTargetType;
  targetId: string;
  status: 'pending';
  payload: Record<string, unknown>;
  attempts: number;
  nextAttemptAt: Date;
  updatedAt: Date;
}

export interface ClaimNotificationOutboxEntriesInput {
  ownerId: string;
  lockForSeconds: number;
  limit?: number;
  maxAttempts?: number;
  now?: Date;
}

export interface ClaimedNotificationOutboxEntry {
  id: string;
  guildId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  payload: unknown;
  attempts: number;
}

export interface MarkNotificationOutboxFailedInput {
  id: string;
  ownerId: string;
  error: unknown;
  retryAt: Date;
  maxAttempts?: number;
}

export interface NotificationOutboxDeliveryStore {
  claimDueNotificationOutboxEntries: (
    input: ClaimNotificationOutboxEntriesInput,
  ) => Promise<ClaimedNotificationOutboxEntry[]>;
  markNotificationOutboxSent: (id: string, ownerId: string, deliveredAt?: Date) => Promise<void>;
  markNotificationOutboxFailed: (input: MarkNotificationOutboxFailedInput) => Promise<void>;
}

export interface UpsertLatestWarSnapshotInput {
  clanTag: string;
  state: string;
  snapshot: unknown;
  fetchedAt?: Date;
}

export interface UpsertLatestWarSnapshotResult {
  status: 'upserted' | 'not_linked';
}

export interface NormalizedLatestWarSnapshot {
  clanTag: string;
  state: string;
  snapshot: unknown;
  fetchedAt: Date;
}

export interface WarSnapshotStore {
  upsertLatestWarSnapshot: (
    input: UpsertLatestWarSnapshotInput,
  ) => Promise<UpsertLatestWarSnapshotResult>;
}

export interface WarAttackEventInput {
  clanTag: string;
  warKey: string;
  attackerTag: string;
  defenderTag: string;
  attackOrder: number;
  stars: number;
  destructionPercentage: number;
  duration?: number | null;
  freshAttack: boolean;
  rawAttack: unknown;
  sourceFetchedAt: Date;
  occurredAt: Date;
  detectedAt?: Date;
}

export interface InsertWarAttackEventsResult {
  status: 'processed' | 'not_linked';
  inserted: number;
}

export interface WarAttackEventStore {
  insertWarAttackEvents: (
    input: readonly WarAttackEventInput[],
  ) => Promise<InsertWarAttackEventsResult>;
}

export interface UpsertLatestPlayerSnapshotInput {
  playerTag: string;
  name: string;
  snapshot: unknown;
  fetchedAt?: Date;
}

export interface UpsertLatestPlayerSnapshotResult {
  status: 'upserted' | 'not_linked';
}

export interface NormalizedLatestPlayerSnapshot {
  playerTag: string;
  name: string;
  snapshot: unknown;
  fetchedAt: Date;
}

export interface PlayerSnapshotStore {
  upsertLatestPlayerSnapshot: (
    input: UpsertLatestPlayerSnapshotInput,
  ) => Promise<UpsertLatestPlayerSnapshotResult>;
}

export interface PollingLeaseStore {
  claimDuePollingLease: (
    resourceType: PollingResourceType,
    ownerId: string,
    lockForSeconds: number,
    now?: Date,
  ) => Promise<ClaimedPollingLease | null>;
  completePollingLease: (
    resourceType: PollingResourceType,
    resourceId: string,
    ownerId: string,
    nextRun: Date,
  ) => Promise<void>;
  failPollingLease: (
    resourceType: PollingResourceType,
    resourceId: string,
    ownerId: string,
    error: unknown,
    nextRun: Date,
  ) => Promise<void>;
}

export interface PollingIntervalConfig {
  baseSeconds: number;
  jitterSeconds: number;
}

export interface PollingEnrollmentSource {
  readonly resourceId: string;
  readonly isActive?: boolean;
}

export type GlobalAccessBlockTargetType = 'user' | 'guild';

export interface ToggleGlobalAccessBlockInput {
  targetType: GlobalAccessBlockTargetType;
  targetId: string;
  targetName: string | null;
  actorDiscordUserId: string;
}

export interface ToggleGlobalAccessBlockResult {
  action: 'created' | 'deleted';
}

export interface GlobalAccessBlockStore {
  isUserBlacklisted: (discordUserId: string) => Promise<boolean>;
  isGuildBlacklisted: (discordGuildId: string) => Promise<boolean>;
  toggle: (input: ToggleGlobalAccessBlockInput) => Promise<ToggleGlobalAccessBlockResult>;
}

export interface DatabaseTrackedClanStore {
  listClanCategories: (
    guildId: string,
  ) => Promise<Array<{ id: string; displayName: string; sortOrder?: number }>>;
  listLinkedClans: (
    guildId: string,
  ) => Promise<Array<{ id: string; clanTag: string; name: string; alias: string | null }>>;
  listClansForGuild: (guildId: string) => Promise<
    Array<{
      id: string;
      clanTag: string;
      name: string | null;
      alias: string | null;
      categoryId: string | null;
      sortOrder: number;
      snapshot?: unknown;
    }>
  >;
  linkClan: (input: {
    guildId: string;
    guildName: string;
    actorDiscordUserId: string;
    clan: { tag: string; name: string };
    category?: string;
    channelId?: string;
    channelType?: string;
  }) => Promise<
    | {
        status: 'linked';
        clanName: string;
        clanTag: string;
        category?: { id: string; displayName: string };
        channelLinked: boolean;
      }
    | { status: 'channel_conflict'; conflict: { clanName: string; clanTag: string } }
  >;
  unlinkClan: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
  }) => Promise<
    | { status: 'unlinked'; clan: { id: string; clanTag: string; name: string } }
    | { status: 'not_found' }
  >;
  unlinkChannel: (input: {
    guildId: string;
    actorDiscordUserId: string;
    channelId: string;
  }) => Promise<{ status: 'unlinked'; clanName: string } | { status: 'not_found' }>;
}

export interface DatabaseClanMemberNotificationConfigStore {
  configureJoinLeaveNotifications: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
    discordChannelId: string;
  }) => Promise<
    | {
        status: 'configured';
        clanName: string;
        clanTag: string;
        discordChannelId: string;
      }
    | { status: 'clan_not_linked' }
  >;
  disableJoinLeaveNotifications: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
  }) => Promise<
    | { status: 'disabled'; clanName: string; clanTag: string }
    | { status: 'not_configured'; clanName: string; clanTag: string }
    | { status: 'clan_not_linked' }
  >;
  configureWarAttackNotifications: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
    discordChannelId: string;
  }) => Promise<
    | {
        status: 'configured';
        clanName: string;
        clanTag: string;
        discordChannelId: string;
      }
    | { status: 'clan_not_linked' }
  >;
  disableWarAttackNotifications: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
  }) => Promise<
    | { status: 'disabled'; clanName: string; clanTag: string }
    | { status: 'not_configured'; clanName: string; clanTag: string }
    | { status: 'clan_not_linked' }
  >;
}

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 10,
    prepare: false,
  });

  return drizzle(client, { schema });
}

export function createDatabaseStatusMetrics(database: Database): DatabaseStatusMetrics {
  return {
    countCommandsUsedLast30Days: async () => {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - 30);
      const sinceDate = since.toISOString().slice(0, 10);
      const [row] = await database
        .select({ value: sql<number>`coalesce(sum(${schema.commandUsageDaily.usageCount}), 0)` })
        .from(schema.commandUsageDaily)
        .where(gte(schema.commandUsageDaily.usageDate, sinceDate));

      return Number(row?.value ?? 0);
    },
    countTrackedClans: async () => {
      const [row] = await database
        .select({ value: count() })
        .from(schema.trackedClans)
        .where(eq(schema.trackedClans.isActive, true));

      return row?.value ?? 0;
    },
    countPlayerLinks: async () => {
      const [row] = await database.select({ value: count() }).from(schema.playerLinks);

      return row?.value ?? 0;
    },
  };
}

export function createDatabaseUsageMetrics(database: Database): DatabaseUsageMetrics {
  return {
    listRecentDailyUsage: async (limit) => {
      const rows = await database
        .select({
          date: schema.commandUsageDaily.usageDate,
          uses: sql<number>`coalesce(sum(${schema.commandUsageDaily.usageCount}), 0)`,
        })
        .from(schema.commandUsageDaily)
        .groupBy(schema.commandUsageDaily.usageDate)
        .orderBy(desc(schema.commandUsageDaily.usageDate))
        .limit(limit);

      return rows.map((row) => ({ date: row.date, uses: Number(row.uses) }));
    },
    listCommandTotals: async () => {
      const rows = await database
        .select({
          commandName: schema.commandUsageTotals.commandName,
          uses: schema.commandUsageTotals.usageCount,
        })
        .from(schema.commandUsageTotals)
        .orderBy(desc(schema.commandUsageTotals.usageCount));

      return rows.map((row) => ({ commandName: row.commandName, uses: Number(row.uses) }));
    },
    listRecentGrowth: async (limit) => {
      return database
        .select({
          date: schema.botGrowthDaily.usageDate,
          guildAdditions: schema.botGrowthDaily.guildAdditions,
          guildDeletions: schema.botGrowthDaily.guildDeletions,
        })
        .from(schema.botGrowthDaily)
        .orderBy(desc(schema.botGrowthDaily.usageDate))
        .limit(limit);
    },
  };
}

export function createDatabaseCommandUsageRecorder(
  database: Database,
): DatabaseCommandUsageRecorder {
  return {
    recordCommandUsage: async (input) => {
      const increment = normalizeCommandUsageIncrement(input);

      await database.transaction(async (tx) => {
        await tx
          .insert(schema.commandUsageDaily)
          .values({
            usageDate: increment.usageDate,
            commandName: increment.commandName,
            guildId: increment.guildId,
            usageCount: 1,
            createdAt: increment.usedAt,
            updatedAt: increment.usedAt,
          })
          .onConflictDoUpdate({
            target: [
              schema.commandUsageDaily.usageDate,
              schema.commandUsageDaily.commandName,
              schema.commandUsageDaily.guildId,
            ],
            set: {
              usageCount: sql`${schema.commandUsageDaily.usageCount} + 1`,
              updatedAt: increment.usedAt,
            },
          });

        await tx
          .insert(schema.commandUsageTotals)
          .values({
            commandName: increment.commandName,
            usageCount: 1,
            firstUsedAt: increment.usedAt,
            lastUsedAt: increment.usedAt,
            updatedAt: increment.usedAt,
          })
          .onConflictDoUpdate({
            target: schema.commandUsageTotals.commandName,
            set: {
              usageCount: sql`${schema.commandUsageTotals.usageCount} + 1`,
              lastUsedAt: increment.usedAt,
              updatedAt: increment.usedAt,
            },
          });
      });
    },
  };
}

export function normalizeCommandUsageIncrement(
  input: RecordCommandUsageInput,
): NormalizedCommandUsageIncrement {
  const commandName = input.commandName.trim().toLowerCase();

  if (!commandName) {
    throw new Error('Command usage requires a command name.');
  }

  const usedAt = input.usedAt ?? new Date();

  return {
    commandName,
    guildId: input.guildId ?? DIRECT_MESSAGE_COMMAND_USAGE_GUILD_ID,
    usageDate: usedAt.toISOString().slice(0, 10),
    usedAt,
  };
}

export function createDatabaseDebugReader(database: Database): DatabaseDebugReader {
  return {
    listTrackedClansForGuild: async (guildId) => {
      return database
        .select({
          clanTag: schema.trackedClans.clanTag,
          name: schema.trackedClans.name,
          isActive: schema.trackedClans.isActive,
          lastSeenAt: schema.trackedClans.lastSeenAt,
        })
        .from(schema.trackedClans)
        .where(eq(schema.trackedClans.guildId, guildId))
        .orderBy(schema.trackedClans.name, schema.trackedClans.clanTag);
    },
    getPollerDiagnostics: async () => {
      const [clanLeases, playerLeases, warLeases, dueLeases] = await Promise.all([
        countPollingLeases(database, 'clan'),
        countPollingLeases(database, 'player'),
        countPollingLeases(database, 'war'),
        countDuePollingLeases(database),
      ]);

      return { clanLeases, playerLeases, warLeases, dueLeases };
    },
    getConfigDiagnostics: async (guildId) => {
      const [row] = await database
        .select({ diagnosticsEnabled: schema.guilds.diagnosticsEnabled })
        .from(schema.guilds)
        .where(eq(schema.guilds.id, guildId))
        .limit(1);

      return { diagnosticsEnabled: row?.diagnosticsEnabled ?? 'Unknown' };
    },
  };
}

export function createPollingEnrollmentStore(database: Database): PollingEnrollmentStore {
  return {
    upsertPollingLease: async (input) => {
      assertTopLevelPollingResourceType(input.resourceType);
      await upsertPollingLease(database, input.resourceType, input.resourceId, input.runAfter);
    },
    syncClanPollingLeases: async (runAfter) => {
      const rows = await database
        .select({
          resourceId: schema.trackedClans.clanTag,
          isActive: schema.trackedClans.isActive,
        })
        .from(schema.trackedClans);
      return syncPollingLeasesForType(
        database,
        'clan',
        buildPollingEnrollmentResourceIds(rows),
        runAfter,
      );
    },
    syncPlayerPollingLeases: async (runAfter) => {
      const rows = await database
        .select({
          resourceId: schema.playerLinks.playerTag,
        })
        .from(schema.playerLinks);
      return syncPollingLeasesForType(
        database,
        'player',
        buildPollingEnrollmentResourceIds(rows),
        runAfter,
      );
    },
    syncWarPollingLeases: async (runAfter) => {
      const rows = await database
        .select({
          resourceId: schema.trackedClans.clanTag,
          isActive: schema.trackedClans.isActive,
        })
        .from(schema.trackedClans);
      const resourceIds = buildPollingEnrollmentResourceIds(rows).map(
        (clanTag) => `current-war:${clanTag}`,
      );
      return syncPollingLeasesForType(database, 'war', resourceIds, runAfter);
    },
  };
}

export function createClanSnapshotStore(database: Database): ClanSnapshotStore {
  return {
    upsertLatestClanSnapshot: async (input) => {
      const snapshot = normalizeLatestClanSnapshotInput(input);
      const [linkedClan] = await database
        .select({ clanTag: schema.trackedClans.clanTag })
        .from(schema.trackedClans)
        .where(
          and(
            eq(schema.trackedClans.clanTag, snapshot.clanTag),
            eq(schema.trackedClans.isActive, true),
          ),
        )
        .limit(1);

      if (!linkedClan) return { status: 'not_linked' };

      await database
        .insert(schema.clanLatestSnapshots)
        .values({
          clanTag: snapshot.clanTag,
          name: snapshot.name,
          snapshot: snapshot.snapshot,
          fetchedAt: snapshot.fetchedAt,
          updatedAt: snapshot.fetchedAt,
        })
        .onConflictDoUpdate({
          target: schema.clanLatestSnapshots.clanTag,
          set: {
            name: snapshot.name,
            snapshot: snapshot.snapshot,
            fetchedAt: snapshot.fetchedAt,
            updatedAt: snapshot.fetchedAt,
          },
        });

      await database
        .update(schema.trackedClans)
        .set({ name: snapshot.name, lastSeenAt: snapshot.fetchedAt, updatedAt: snapshot.fetchedAt })
        .where(
          and(
            eq(schema.trackedClans.clanTag, snapshot.clanTag),
            eq(schema.trackedClans.isActive, true),
          ),
        );

      return { status: 'upserted' };
    },
  };
}

export function createClanMemberEventStore(database: Database): ClanMemberEventStore {
  return {
    processClanMemberSnapshots: async (input) => {
      const clanTag = input.clanTag.trim().toUpperCase();
      if (!clanTag) throw new Error('Clan member snapshots require a clan tag.');
      const fetchedAt = input.fetchedAt;
      const members = input.members.map((member) => ({
        ...member,
        clanTag,
        playerTag: member.playerTag.trim().toUpperCase(),
      }));
      const memberTags = new Set(members.map((member) => member.playerTag).filter(Boolean));
      if (memberTags.size !== members.length) {
        throw new Error('Clan member snapshots require unique non-empty player tags.');
      }

      return database.transaction(async (tx) => {
        const linkedClans = await tx
          .select({ id: schema.trackedClans.id, guildId: schema.trackedClans.guildId })
          .from(schema.trackedClans)
          .where(
            and(eq(schema.trackedClans.clanTag, clanTag), eq(schema.trackedClans.isActive, true)),
          );

        if (linkedClans.length === 0) {
          return { status: 'not_linked', joined: 0, left: 0, donationEvents: 0 };
        }

        const previousMembers = await tx
          .select({
            playerTag: schema.clanMemberSnapshots.playerTag,
            name: schema.clanMemberSnapshots.name,
            donations: schema.clanMemberSnapshots.donations,
            donationsReceived: schema.clanMemberSnapshots.donationsReceived,
            rawMember: schema.clanMemberSnapshots.rawMember,
            lastSeenAt: schema.clanMemberSnapshots.lastSeenAt,
          })
          .from(schema.clanMemberSnapshots)
          .where(eq(schema.clanMemberSnapshots.clanTag, clanTag));
        const previousMemberTags = new Set(previousMembers.map((member) => member.playerTag));
        const previousMembersByTag = new Map(
          previousMembers.map((member) => [member.playerTag, member]),
        );
        const isInitialSnapshot = previousMembers.length === 0;

        let joined = 0;
        let left = 0;
        let donationEvents = 0;

        const insertEvents = async (event: {
          playerTag: string;
          playerName: string;
          eventType: 'joined' | 'left';
          previousSnapshot: unknown;
          currentSnapshot: unknown;
        }) => {
          const rows = await tx
            .insert(schema.clanMemberEvents)
            .values(
              linkedClans.map((linkedClan) => ({
                guildId: linkedClan.guildId,
                trackedClanId: linkedClan.id,
                clanTag,
                playerTag: event.playerTag,
                playerName: event.playerName,
                eventType: event.eventType,
                eventKey: buildClanMemberEventKey({
                  clanTag,
                  playerTag: event.playerTag,
                  eventType: event.eventType,
                  eventAt: fetchedAt,
                }),
                previousSnapshot: event.previousSnapshot,
                currentSnapshot: event.currentSnapshot,
                sourceFetchedAt: fetchedAt,
                occurredAt: fetchedAt,
                detectedAt: fetchedAt,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: schema.clanMemberEvents.id });
          return rows.length;
        };

        const insertDonationEvents = async (event: {
          playerTag: string;
          playerName: string;
          previousDonations: number;
          currentDonations: number;
          donationDelta: number;
          previousDonationsReceived: number;
          currentDonationsReceived: number;
          receivedDelta: number;
          previousSnapshot: unknown;
          currentSnapshot: unknown;
        }) => {
          const rows = await tx
            .insert(schema.clanDonationEvents)
            .values(
              linkedClans.map((linkedClan) => ({
                guildId: linkedClan.guildId,
                trackedClanId: linkedClan.id,
                clanTag,
                playerTag: event.playerTag,
                playerName: event.playerName,
                eventKey: buildClanDonationEventKey({
                  clanTag,
                  playerTag: event.playerTag,
                  eventAt: fetchedAt,
                  donationDelta: event.donationDelta,
                  receivedDelta: event.receivedDelta,
                }),
                previousDonations: event.previousDonations,
                currentDonations: event.currentDonations,
                donationDelta: event.donationDelta,
                previousDonationsReceived: event.previousDonationsReceived,
                currentDonationsReceived: event.currentDonationsReceived,
                receivedDelta: event.receivedDelta,
                previousSnapshot: event.previousSnapshot,
                currentSnapshot: event.currentSnapshot,
                sourceFetchedAt: fetchedAt,
                occurredAt: fetchedAt,
                detectedAt: fetchedAt,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: schema.clanDonationEvents.id });
          return rows.length;
        };

        for (const member of members) {
          const previousMember = previousMembersByTag.get(member.playerTag);
          if (!isInitialSnapshot && !previousMemberTags.has(member.playerTag)) {
            joined += await insertEvents({
              playerTag: member.playerTag,
              playerName: member.name,
              eventType: 'joined',
              previousSnapshot: null,
              currentSnapshot: member.rawMember,
            });
          }

          if (previousMember) {
            const previousDonations = previousMember.donations;
            const currentDonations = member.donations;
            const previousDonationsReceived = previousMember.donationsReceived;
            const currentDonationsReceived = member.donationsReceived;
            const donationDeltaEvent = computeClanDonationDeltaEvent({
              previousDonations,
              currentDonations,
              previousDonationsReceived,
              currentDonationsReceived,
            });
            if (donationDeltaEvent) {
              donationEvents += await insertDonationEvents({
                playerTag: member.playerTag,
                playerName: member.name,
                previousDonations: donationDeltaEvent.previousDonations,
                currentDonations: donationDeltaEvent.currentDonations,
                donationDelta: donationDeltaEvent.donationDelta,
                previousDonationsReceived: donationDeltaEvent.previousDonationsReceived,
                currentDonationsReceived: donationDeltaEvent.currentDonationsReceived,
                receivedDelta: donationDeltaEvent.receivedDelta,
                previousSnapshot: previousMember.rawMember,
                currentSnapshot: member.rawMember,
              });
            }
          }

          await tx
            .insert(schema.clanMemberSnapshots)
            .values({
              clanTag,
              playerTag: member.playerTag,
              name: member.name,
              role: member.role,
              expLevel: member.expLevel,
              leagueId: member.leagueId,
              trophies: member.trophies,
              builderBaseTrophies: member.builderBaseTrophies,
              clanRank: member.clanRank,
              previousClanRank: member.previousClanRank,
              donations: member.donations,
              donationsReceived: member.donationsReceived,
              rawMember: member.rawMember,
              firstSeenAt: fetchedAt,
              lastSeenAt: fetchedAt,
              lastFetchedAt: fetchedAt,
              updatedAt: fetchedAt,
            })
            .onConflictDoUpdate({
              target: [schema.clanMemberSnapshots.clanTag, schema.clanMemberSnapshots.playerTag],
              set: {
                name: member.name,
                role: member.role,
                expLevel: member.expLevel,
                leagueId: member.leagueId,
                trophies: member.trophies,
                builderBaseTrophies: member.builderBaseTrophies,
                clanRank: member.clanRank,
                previousClanRank: member.previousClanRank,
                donations: member.donations,
                donationsReceived: member.donationsReceived,
                rawMember: member.rawMember,
                lastSeenAt: fetchedAt,
                lastFetchedAt: fetchedAt,
                updatedAt: fetchedAt,
              },
            });
        }

        for (const previousMember of previousMembers) {
          if (memberTags.has(previousMember.playerTag) || previousMember.lastSeenAt >= fetchedAt)
            continue;
          left += await insertEvents({
            playerTag: previousMember.playerTag,
            playerName: previousMember.name,
            eventType: 'left',
            previousSnapshot: previousMember.rawMember,
            currentSnapshot: null,
          });
        }

        return { status: 'processed', joined, left, donationEvents };
      });
    },
  };
}

export function createNotificationFanOutStore(database: Database): NotificationFanOutStore {
  return {
    fanOutClanMemberEventNotifications: async (input = {}) => {
      return database.transaction(async (tx) => {
        return fanOutClanMemberEventNotificationsWithCursor(
          createClanMemberNotificationFanOutRepository(tx),
          input,
        );
      });
    },
    fanOutWarAttackEventNotifications: async (input = {}) => {
      return database.transaction(async (tx) => {
        return fanOutWarAttackEventNotificationsWithCursor(
          createWarAttackNotificationFanOutRepository(tx),
          input,
        );
      });
    },
    fanOutClanDonationEventNotifications: async (input = {}) => {
      return database.transaction(async (tx) => {
        return fanOutClanDonationEventNotificationsWithCursor(
          createClanDonationNotificationFanOutRepository(tx),
          input,
        );
      });
    },
  };
}

export async function fanOutClanMemberEventNotificationsWithCursor(
  repository: ClanMemberNotificationFanOutRepository,
  input: FanOutClanMemberEventNotificationsInput = {},
): Promise<FanOutClanMemberEventNotificationsResult> {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Clan member notification fan-out limit must be between 1 and 1000.');
  }
  const now = input.now ?? new Date();

  await repository.ensureCursor({
    cursorName: CLAN_MEMBER_NOTIFICATION_FANOUT_CURSOR_NAME,
    sourceType: CLAN_MEMBER_NOTIFICATION_FANOUT_SOURCE_TYPE,
    now,
  });

  const cursor = await repository.lockCursor(CLAN_MEMBER_NOTIFICATION_FANOUT_CURSOR_NAME);
  if (!cursor) return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };

  const listEventsInput: ListClanMemberEventsAfterFanOutCursorInput = { cursor, limit };
  if (input.since) listEventsInput.since = input.since;
  const events = await repository.listEventsAfterCursor(listEventsInput);

  if (events.length === 0) {
    await repository.advanceCursor({
      cursorName: CLAN_MEMBER_NOTIFICATION_FANOUT_CURSOR_NAME,
      now,
    });
    return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };
  }

  const targets = await repository.listTargetsForEvents(events.map((event) => event.eventId));
  const insertedOutboxEntries =
    targets.length > 0
      ? await repository.insertOutboxEntries(buildClanMemberNotificationOutboxValues(targets, now))
      : 0;
  const lastEvent = events.at(-1);
  if (!lastEvent) throw new Error('Clan member notification fan-out lost its event cursor.');

  await repository.advanceCursor({
    cursorName: CLAN_MEMBER_NOTIFICATION_FANOUT_CURSOR_NAME,
    lastDetectedAt: lastEvent.detectedAt,
    lastEventId: lastEvent.eventId,
    now,
  });

  return {
    eventsScanned: events.length,
    matchedTargets: targets.length,
    insertedOutboxEntries,
  };
}

export async function fanOutWarAttackEventNotificationsWithCursor(
  repository: WarAttackNotificationFanOutRepository,
  input: FanOutWarAttackEventNotificationsInput = {},
): Promise<FanOutWarAttackEventNotificationsResult> {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('War attack notification fan-out limit must be between 1 and 1000.');
  }
  const now = input.now ?? new Date();

  await repository.ensureCursor({
    cursorName: WAR_ATTACK_NOTIFICATION_FANOUT_CURSOR_NAME,
    sourceType: WAR_ATTACK_NOTIFICATION_FANOUT_SOURCE_TYPE,
    now,
  });

  const cursor = await repository.lockCursor(WAR_ATTACK_NOTIFICATION_FANOUT_CURSOR_NAME);
  if (!cursor) return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };

  const listEventsInput: ListWarAttackEventsAfterFanOutCursorInput = { cursor, limit };
  if (input.since) listEventsInput.since = input.since;
  const events = await repository.listEventsAfterCursor(listEventsInput);

  if (events.length === 0) {
    await repository.advanceCursor({ cursorName: WAR_ATTACK_NOTIFICATION_FANOUT_CURSOR_NAME, now });
    return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };
  }

  const targets = await repository.listTargetsForEvents(events.map((event) => event.eventId));
  const insertedOutboxEntries =
    targets.length > 0
      ? await repository.insertOutboxEntries(buildWarAttackNotificationOutboxValues(targets, now))
      : 0;
  const lastEvent = events.at(-1);
  if (!lastEvent) throw new Error('War attack notification fan-out lost its event cursor.');

  await repository.advanceCursor({
    cursorName: WAR_ATTACK_NOTIFICATION_FANOUT_CURSOR_NAME,
    lastDetectedAt: lastEvent.detectedAt,
    lastEventId: lastEvent.eventId,
    now,
  });

  return { eventsScanned: events.length, matchedTargets: targets.length, insertedOutboxEntries };
}

export async function fanOutClanDonationEventNotificationsWithCursor(
  repository: ClanDonationNotificationFanOutRepository,
  input: FanOutClanDonationEventNotificationsInput = {},
): Promise<FanOutClanDonationEventNotificationsResult> {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Clan donation notification fan-out limit must be between 1 and 1000.');
  }
  const now = input.now ?? new Date();

  await repository.ensureCursor({
    cursorName: CLAN_DONATION_NOTIFICATION_FANOUT_CURSOR_NAME,
    sourceType: CLAN_DONATION_NOTIFICATION_FANOUT_SOURCE_TYPE,
    now,
  });

  const cursor = await repository.lockCursor(CLAN_DONATION_NOTIFICATION_FANOUT_CURSOR_NAME);
  if (!cursor) return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };

  const listEventsInput: ListClanDonationEventsAfterFanOutCursorInput = { cursor, limit };
  if (input.since) listEventsInput.since = input.since;
  const events = await repository.listEventsAfterCursor(listEventsInput);

  if (events.length === 0) {
    await repository.advanceCursor({
      cursorName: CLAN_DONATION_NOTIFICATION_FANOUT_CURSOR_NAME,
      now,
    });
    return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };
  }

  const targets = await repository.listTargetsForEvents(events.map((event) => event.eventId));
  const insertedOutboxEntries =
    targets.length > 0
      ? await repository.insertOutboxEntries(
          buildClanDonationNotificationOutboxValues(targets, now),
        )
      : 0;
  const lastEvent = events.at(-1);
  if (!lastEvent) throw new Error('Clan donation notification fan-out lost its event cursor.');

  await repository.advanceCursor({
    cursorName: CLAN_DONATION_NOTIFICATION_FANOUT_CURSOR_NAME,
    lastDetectedAt: lastEvent.detectedAt,
    lastEventId: lastEvent.eventId,
    now,
  });

  return { eventsScanned: events.length, matchedTargets: targets.length, insertedOutboxEntries };
}

export function createNotificationOutboxDeliveryStore(
  database: Database,
): NotificationOutboxDeliveryStore {
  return {
    claimDueNotificationOutboxEntries: async (input) => {
      const limit = input.limit ?? 50;
      const maxAttempts = input.maxAttempts ?? 5;
      const ownerId = input.ownerId.trim();
      const lockForSeconds = input.lockForSeconds;
      if (!ownerId) throw new Error('Notification delivery ownerId is required.');
      if (!Number.isInteger(lockForSeconds) || lockForSeconds < 1) {
        throw new Error('Notification delivery lockForSeconds must be a positive integer.');
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error('Notification delivery claim limit must be between 1 and 1000.');
      }
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new Error('Notification delivery max attempts must be a positive integer.');
      }
      const now = input.now ?? new Date();
      const lockedUntil = new Date(now.getTime() + lockForSeconds * 1000);

      const rows = await database.execute(sql<ClaimedNotificationOutboxEntry>`
        update notification_outbox
        set status = 'sending',
            owner_id = ${ownerId},
            locked_until = ${lockedUntil},
            updated_at = ${now}
        where id in (
          select id
          from notification_outbox
          where attempts < ${maxAttempts}
            and (
              (status in ('pending', 'retry') and next_attempt_at <= ${now})
              or (status = 'sending' and (locked_until is null or locked_until <= ${now}))
            )
          order by next_attempt_at asc, created_at asc
          for update skip locked
          limit ${limit}
        )
        returning id,
                  guild_id as "guildId",
                  source_type as "sourceType",
                  source_id as "sourceId",
                  target_type as "targetType",
                  target_id as "targetId",
                  payload,
                  attempts
      `);

      return normalizeExecuteRows<ClaimedNotificationOutboxEntry>(rows);
    },
    markNotificationOutboxSent: async (id, ownerId, deliveredAt = new Date()) => {
      if (!ownerId.trim()) throw new Error('Notification delivery ownerId is required.');
      await database
        .update(schema.notificationOutbox)
        .set({
          status: 'sent',
          deliveredAt,
          ownerId: null,
          lockedUntil: null,
          lastError: null,
          updatedAt: deliveredAt,
        })
        .where(
          and(
            eq(schema.notificationOutbox.id, id),
            eq(schema.notificationOutbox.ownerId, ownerId),
            eq(schema.notificationOutbox.status, 'sending'),
          ),
        );
    },
    markNotificationOutboxFailed: async (input) => {
      const maxAttempts = input.maxAttempts ?? 5;
      const ownerId = input.ownerId.trim();
      if (!ownerId) throw new Error('Notification delivery ownerId is required.');
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new Error('Notification delivery max attempts must be a positive integer.');
      }
      const now = new Date();
      const error = formatPollingLeaseError(input.error);
      await database.execute(sql`
        update notification_outbox
        set attempts = attempts + 1,
            status = case when attempts + 1 >= ${maxAttempts} then 'failed' else 'retry' end,
            owner_id = null,
            locked_until = null,
            next_attempt_at = case
              when attempts + 1 >= ${maxAttempts} then next_attempt_at
              else ${input.retryAt}
            end,
            last_error = ${error},
            updated_at = ${now}
        where id = ${input.id}
          and owner_id = ${ownerId}
          and status = 'sending'
      `);
    },
  };
}

export function buildClanMemberNotificationOutboxValues(
  targets: readonly ClanMemberNotificationFanOutTarget[],
  now: Date,
): NotificationOutboxInsertValue[] {
  return targets.map((target) => ({
    guildId: target.guildId,
    configId: target.configId,
    sourceType: 'clan_member_event',
    sourceId: target.eventId,
    idempotencyKey: buildNotificationOutboxIdempotencyKey({
      guildId: target.guildId,
      sourceType: 'clan_member_event',
      sourceId: target.eventId,
      targetType: 'discord_channel',
      targetId: target.discordChannelId,
    }),
    targetType: 'discord_channel',
    targetId: target.discordChannelId,
    status: 'pending',
    payload: {
      clanTag: target.clanTag,
      playerTag: target.playerTag,
      playerName: target.playerName,
      eventType: target.eventType,
      eventKey: target.eventKey,
      occurredAt: target.occurredAt.toISOString(),
      detectedAt: target.detectedAt.toISOString(),
    },
    attempts: 0,
    nextAttemptAt: now,
    updatedAt: now,
  }));
}

export function buildWarAttackNotificationOutboxValues(
  targets: readonly WarAttackNotificationFanOutTarget[],
  now: Date,
): NotificationOutboxInsertValue[] {
  return targets.map((target) => ({
    guildId: target.guildId,
    configId: null,
    warAttackConfigId: target.configId,
    sourceType: 'war_attack_event',
    sourceId: target.eventId,
    idempotencyKey: buildNotificationOutboxIdempotencyKey({
      guildId: target.guildId,
      sourceType: 'war_attack_event',
      sourceId: target.eventId,
      targetType: 'discord_channel',
      targetId: target.discordChannelId,
    }),
    targetType: 'discord_channel',
    targetId: target.discordChannelId,
    status: 'pending',
    payload: {
      clanTag: target.clanTag,
      warKey: target.warKey,
      eventKey: target.eventKey,
      attackerTag: target.attackerTag,
      defenderTag: target.defenderTag,
      attackOrder: target.attackOrder,
      stars: target.stars,
      destructionPercentage: target.destructionPercentage,
      duration: target.duration,
      freshAttack: target.freshAttack,
      occurredAt: target.occurredAt.toISOString(),
      detectedAt: target.detectedAt.toISOString(),
    },
    attempts: 0,
    nextAttemptAt: now,
    updatedAt: now,
  }));
}

export function buildClanDonationNotificationOutboxValues(
  targets: readonly ClanDonationNotificationFanOutTarget[],
  now: Date,
): NotificationOutboxInsertValue[] {
  return targets.map((target) => ({
    guildId: target.guildId,
    configId: null,
    warAttackConfigId: null,
    clanDonationConfigId: target.configId,
    sourceType: 'clan_donation_event',
    sourceId: target.eventId,
    idempotencyKey: buildNotificationOutboxIdempotencyKey({
      guildId: target.guildId,
      sourceType: 'clan_donation_event',
      sourceId: target.eventId,
      targetType: 'discord_channel',
      targetId: target.discordChannelId,
    }),
    targetType: 'discord_channel',
    targetId: target.discordChannelId,
    status: 'pending',
    payload: {
      clanTag: target.clanTag,
      eventKey: target.eventKey,
      playerTag: target.playerTag,
      playerName: target.playerName,
      donationDelta: target.donationDelta,
      receivedDelta: target.receivedDelta,
      occurredAt: target.occurredAt.toISOString(),
      detectedAt: target.detectedAt.toISOString(),
    },
    attempts: 0,
    nextAttemptAt: now,
    updatedAt: now,
  }));
}

function createClanMemberNotificationFanOutRepository(
  tx: DatabaseTransaction,
): ClanMemberNotificationFanOutRepository {
  return {
    ensureCursor: async (input) => {
      await tx
        .insert(schema.notificationFanoutCursors)
        .values({
          cursorName: input.cursorName,
          sourceType: input.sourceType,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing({ target: schema.notificationFanoutCursors.cursorName });
    },
    lockCursor: async (cursorName) => {
      const rows = await tx.execute(sql<NotificationFanOutCursorState>`
        select cursor_name as "cursorName",
               source_type as "sourceType",
               last_detected_at as "lastDetectedAt",
               last_event_id as "lastEventId"
        from notification_fanout_cursors
        where cursor_name = ${cursorName}
        for update skip locked
      `);

      return normalizeExecuteRows<NotificationFanOutCursorState>(rows)[0] ?? null;
    },
    listEventsAfterCursor: async (input) => {
      const cursorPredicate = buildClanMemberFanOutCursorPredicate(input.cursor);
      const sincePredicate = input.since
        ? gte(schema.clanMemberEvents.detectedAt, input.since)
        : sql<boolean>`true`;

      return tx
        .select({
          eventId: schema.clanMemberEvents.id,
          guildId: schema.clanMemberEvents.guildId,
          trackedClanId: schema.clanMemberEvents.trackedClanId,
          clanTag: schema.clanMemberEvents.clanTag,
          playerTag: schema.clanMemberEvents.playerTag,
          playerName: schema.clanMemberEvents.playerName,
          eventType: schema.clanMemberEvents.eventType,
          eventKey: schema.clanMemberEvents.eventKey,
          occurredAt: schema.clanMemberEvents.occurredAt,
          detectedAt: schema.clanMemberEvents.detectedAt,
        })
        .from(schema.clanMemberEvents)
        .where(and(cursorPredicate, sincePredicate))
        .orderBy(asc(schema.clanMemberEvents.detectedAt), asc(schema.clanMemberEvents.id))
        .limit(input.limit);
    },
    listTargetsForEvents: async (eventIds) => {
      if (eventIds.length === 0) return [];

      return tx
        .select({
          eventId: schema.clanMemberEvents.id,
          guildId: schema.clanMemberEvents.guildId,
          trackedClanId: schema.clanMemberEvents.trackedClanId,
          clanTag: schema.clanMemberEvents.clanTag,
          playerTag: schema.clanMemberEvents.playerTag,
          playerName: schema.clanMemberEvents.playerName,
          eventType: schema.clanMemberEvents.eventType,
          eventKey: schema.clanMemberEvents.eventKey,
          occurredAt: schema.clanMemberEvents.occurredAt,
          detectedAt: schema.clanMemberEvents.detectedAt,
          configId: schema.clanMemberNotificationConfigs.id,
          discordChannelId: schema.clanMemberNotificationConfigs.discordChannelId,
        })
        .from(schema.clanMemberEvents)
        .innerJoin(
          schema.clanMemberNotificationConfigs,
          and(
            eq(schema.clanMemberNotificationConfigs.guildId, schema.clanMemberEvents.guildId),
            eq(
              schema.clanMemberNotificationConfigs.trackedClanId,
              schema.clanMemberEvents.trackedClanId,
            ),
            eq(schema.clanMemberNotificationConfigs.eventType, schema.clanMemberEvents.eventType),
            eq(schema.clanMemberNotificationConfigs.isEnabled, true),
            lte(schema.clanMemberNotificationConfigs.createdAt, schema.clanMemberEvents.detectedAt),
          ),
        )
        .where(inArray(schema.clanMemberEvents.id, [...eventIds]))
        .orderBy(
          asc(schema.clanMemberEvents.detectedAt),
          asc(schema.clanMemberEvents.id),
          asc(schema.clanMemberNotificationConfigs.discordChannelId),
        );
    },
    insertOutboxEntries: async (values) => {
      if (values.length === 0) return 0;

      const rows = await tx
        .insert(schema.notificationOutbox)
        .values([...values])
        .onConflictDoNothing({ target: schema.notificationOutbox.idempotencyKey })
        .returning({ id: schema.notificationOutbox.id });

      return rows.length;
    },
    advanceCursor: async (input) => {
      if (input.lastDetectedAt && input.lastEventId) {
        await tx
          .update(schema.notificationFanoutCursors)
          .set({
            lastDetectedAt: input.lastDetectedAt,
            lastEventId: input.lastEventId,
            updatedAt: input.now,
          })
          .where(eq(schema.notificationFanoutCursors.cursorName, input.cursorName));
        return;
      }

      await tx
        .update(schema.notificationFanoutCursors)
        .set({ updatedAt: input.now })
        .where(eq(schema.notificationFanoutCursors.cursorName, input.cursorName));
    },
  };
}

function buildClanMemberFanOutCursorPredicate(cursor: NotificationFanOutCursorState) {
  if (!cursor.lastDetectedAt) return sql<boolean>`true`;
  if (!cursor.lastEventId) return gt(schema.clanMemberEvents.detectedAt, cursor.lastDetectedAt);

  return (
    or(
      gt(schema.clanMemberEvents.detectedAt, cursor.lastDetectedAt),
      and(
        eq(schema.clanMemberEvents.detectedAt, cursor.lastDetectedAt),
        gt(schema.clanMemberEvents.id, cursor.lastEventId),
      ),
    ) ?? sql<boolean>`false`
  );
}

function createWarAttackNotificationFanOutRepository(
  tx: DatabaseTransaction,
): WarAttackNotificationFanOutRepository {
  return {
    ensureCursor: async (input) => {
      await tx
        .insert(schema.notificationFanoutCursors)
        .values({
          cursorName: input.cursorName,
          sourceType: input.sourceType,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing({ target: schema.notificationFanoutCursors.cursorName });
    },
    lockCursor: async (cursorName) => {
      const rows = await tx.execute(sql<NotificationFanOutCursorState>`
        select cursor_name as "cursorName",
               source_type as "sourceType",
               last_detected_at as "lastDetectedAt",
               last_event_id as "lastEventId"
        from notification_fanout_cursors
        where cursor_name = ${cursorName}
        for update skip locked
      `);
      return normalizeExecuteRows<NotificationFanOutCursorState>(rows)[0] ?? null;
    },
    listEventsAfterCursor: async (input) => {
      const cursorPredicate = buildWarAttackFanOutCursorPredicate(input.cursor);
      const sincePredicate = input.since
        ? gte(schema.warAttackEvents.detectedAt, input.since)
        : sql<boolean>`true`;

      return tx
        .select({
          eventId: schema.warAttackEvents.id,
          guildId: schema.warAttackEvents.guildId,
          trackedClanId: schema.warAttackEvents.trackedClanId,
          clanTag: schema.warAttackEvents.clanTag,
          warKey: schema.warAttackEvents.warKey,
          eventKey: schema.warAttackEvents.eventKey,
          attackerTag: schema.warAttackEvents.attackerTag,
          defenderTag: schema.warAttackEvents.defenderTag,
          attackOrder: schema.warAttackEvents.attackOrder,
          stars: schema.warAttackEvents.stars,
          destructionPercentage: schema.warAttackEvents.destructionPercentage,
          duration: schema.warAttackEvents.duration,
          freshAttack: schema.warAttackEvents.freshAttack,
          occurredAt: schema.warAttackEvents.occurredAt,
          detectedAt: schema.warAttackEvents.detectedAt,
        })
        .from(schema.warAttackEvents)
        .where(and(cursorPredicate, sincePredicate))
        .orderBy(asc(schema.warAttackEvents.detectedAt), asc(schema.warAttackEvents.id))
        .limit(input.limit);
    },
    listTargetsForEvents: async (eventIds) => {
      if (eventIds.length === 0) return [];
      return tx
        .select({
          eventId: schema.warAttackEvents.id,
          guildId: schema.warAttackEvents.guildId,
          clanTag: schema.warAttackEvents.clanTag,
          warKey: schema.warAttackEvents.warKey,
          eventKey: schema.warAttackEvents.eventKey,
          attackerTag: schema.warAttackEvents.attackerTag,
          defenderTag: schema.warAttackEvents.defenderTag,
          attackOrder: schema.warAttackEvents.attackOrder,
          stars: schema.warAttackEvents.stars,
          destructionPercentage: schema.warAttackEvents.destructionPercentage,
          duration: schema.warAttackEvents.duration,
          freshAttack: schema.warAttackEvents.freshAttack,
          occurredAt: schema.warAttackEvents.occurredAt,
          detectedAt: schema.warAttackEvents.detectedAt,
          configId: schema.warAttackNotificationConfigs.id,
          discordChannelId: schema.warAttackNotificationConfigs.discordChannelId,
        })
        .from(schema.warAttackEvents)
        .innerJoin(
          schema.warAttackNotificationConfigs,
          and(
            eq(schema.warAttackNotificationConfigs.guildId, schema.warAttackEvents.guildId),
            eq(
              schema.warAttackNotificationConfigs.trackedClanId,
              schema.warAttackEvents.trackedClanId,
            ),
            eq(schema.warAttackNotificationConfigs.eventType, 'war_attack'),
            eq(schema.warAttackNotificationConfigs.isEnabled, true),
            lte(schema.warAttackNotificationConfigs.createdAt, schema.warAttackEvents.detectedAt),
          ),
        )
        .where(inArray(schema.warAttackEvents.id, [...eventIds]))
        .orderBy(
          asc(schema.warAttackEvents.detectedAt),
          asc(schema.warAttackEvents.id),
          asc(schema.warAttackNotificationConfigs.discordChannelId),
        );
    },
    insertOutboxEntries: async (values) => {
      if (values.length === 0) return 0;
      const rows = await tx
        .insert(schema.notificationOutbox)
        .values([...values])
        .onConflictDoNothing({ target: schema.notificationOutbox.idempotencyKey })
        .returning({ id: schema.notificationOutbox.id });
      return rows.length;
    },
    advanceCursor: async (input) => {
      if (input.lastDetectedAt && input.lastEventId) {
        await tx
          .update(schema.notificationFanoutCursors)
          .set({
            lastDetectedAt: input.lastDetectedAt,
            lastEventId: input.lastEventId,
            updatedAt: input.now,
          })
          .where(eq(schema.notificationFanoutCursors.cursorName, input.cursorName));
        return;
      }
      await tx
        .update(schema.notificationFanoutCursors)
        .set({ updatedAt: input.now })
        .where(eq(schema.notificationFanoutCursors.cursorName, input.cursorName));
    },
  };
}

function buildWarAttackFanOutCursorPredicate(cursor: NotificationFanOutCursorState) {
  if (!cursor.lastDetectedAt) return sql<boolean>`true`;
  if (!cursor.lastEventId) return gt(schema.warAttackEvents.detectedAt, cursor.lastDetectedAt);

  return (
    or(
      gt(schema.warAttackEvents.detectedAt, cursor.lastDetectedAt),
      and(
        eq(schema.warAttackEvents.detectedAt, cursor.lastDetectedAt),
        gt(schema.warAttackEvents.id, cursor.lastEventId),
      ),
    ) ?? sql<boolean>`false`
  );
}

function createClanDonationNotificationFanOutRepository(
  tx: DatabaseTransaction,
): ClanDonationNotificationFanOutRepository {
  return {
    ensureCursor: async (input) => {
      await tx
        .insert(schema.notificationFanoutCursors)
        .values({
          cursorName: input.cursorName,
          sourceType: input.sourceType,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing({ target: schema.notificationFanoutCursors.cursorName });
    },
    lockCursor: async (cursorName) => {
      const rows = await tx.execute(sql<NotificationFanOutCursorState>`
        select cursor_name as "cursorName",
               source_type as "sourceType",
               last_detected_at as "lastDetectedAt",
               last_event_id as "lastEventId"
        from notification_fanout_cursors
        where cursor_name = ${cursorName}
        for update skip locked
      `);
      return normalizeExecuteRows<NotificationFanOutCursorState>(rows)[0] ?? null;
    },
    listEventsAfterCursor: async (input) => {
      const cursorPredicate = buildClanDonationFanOutCursorPredicate(input.cursor);
      const sincePredicate = input.since
        ? gte(schema.clanDonationEvents.detectedAt, input.since)
        : sql<boolean>`true`;

      return tx
        .select({
          eventId: schema.clanDonationEvents.id,
          guildId: schema.clanDonationEvents.guildId,
          trackedClanId: schema.clanDonationEvents.trackedClanId,
          clanTag: schema.clanDonationEvents.clanTag,
          playerTag: schema.clanDonationEvents.playerTag,
          playerName: schema.clanDonationEvents.playerName,
          eventKey: schema.clanDonationEvents.eventKey,
          donationDelta: schema.clanDonationEvents.donationDelta,
          receivedDelta: schema.clanDonationEvents.receivedDelta,
          occurredAt: schema.clanDonationEvents.occurredAt,
          detectedAt: schema.clanDonationEvents.detectedAt,
        })
        .from(schema.clanDonationEvents)
        .where(and(cursorPredicate, sincePredicate))
        .orderBy(asc(schema.clanDonationEvents.detectedAt), asc(schema.clanDonationEvents.id))
        .limit(input.limit);
    },
    listTargetsForEvents: async (eventIds) => {
      if (eventIds.length === 0) return [];
      return tx
        .select({
          eventId: schema.clanDonationEvents.id,
          guildId: schema.clanDonationEvents.guildId,
          clanTag: schema.clanDonationEvents.clanTag,
          playerTag: schema.clanDonationEvents.playerTag,
          playerName: schema.clanDonationEvents.playerName,
          eventKey: schema.clanDonationEvents.eventKey,
          donationDelta: schema.clanDonationEvents.donationDelta,
          receivedDelta: schema.clanDonationEvents.receivedDelta,
          occurredAt: schema.clanDonationEvents.occurredAt,
          detectedAt: schema.clanDonationEvents.detectedAt,
          configId: schema.clanDonationNotificationConfigs.id,
          discordChannelId: schema.clanDonationNotificationConfigs.discordChannelId,
        })
        .from(schema.clanDonationEvents)
        .innerJoin(
          schema.clanDonationNotificationConfigs,
          and(
            eq(schema.clanDonationNotificationConfigs.guildId, schema.clanDonationEvents.guildId),
            eq(
              schema.clanDonationNotificationConfigs.trackedClanId,
              schema.clanDonationEvents.trackedClanId,
            ),
            eq(schema.clanDonationNotificationConfigs.eventType, 'instant_donation'),
            eq(schema.clanDonationNotificationConfigs.isEnabled, true),
            lte(
              schema.clanDonationNotificationConfigs.createdAt,
              schema.clanDonationEvents.detectedAt,
            ),
          ),
        )
        .where(inArray(schema.clanDonationEvents.id, [...eventIds]))
        .orderBy(
          asc(schema.clanDonationEvents.detectedAt),
          asc(schema.clanDonationEvents.id),
          asc(schema.clanDonationNotificationConfigs.discordChannelId),
        );
    },
    insertOutboxEntries: async (values) => {
      if (values.length === 0) return 0;
      const rows = await tx
        .insert(schema.notificationOutbox)
        .values([...values])
        .onConflictDoNothing({ target: schema.notificationOutbox.idempotencyKey })
        .returning({ id: schema.notificationOutbox.id });
      return rows.length;
    },
    advanceCursor: async (input) => {
      if (input.lastDetectedAt && input.lastEventId) {
        await tx
          .update(schema.notificationFanoutCursors)
          .set({
            lastDetectedAt: input.lastDetectedAt,
            lastEventId: input.lastEventId,
            updatedAt: input.now,
          })
          .where(eq(schema.notificationFanoutCursors.cursorName, input.cursorName));
        return;
      }
      await tx
        .update(schema.notificationFanoutCursors)
        .set({ updatedAt: input.now })
        .where(eq(schema.notificationFanoutCursors.cursorName, input.cursorName));
    },
  };
}

function buildClanDonationFanOutCursorPredicate(cursor: NotificationFanOutCursorState) {
  if (!cursor.lastDetectedAt) return sql<boolean>`true`;
  if (!cursor.lastEventId) return gt(schema.clanDonationEvents.detectedAt, cursor.lastDetectedAt);

  return (
    or(
      gt(schema.clanDonationEvents.detectedAt, cursor.lastDetectedAt),
      and(
        eq(schema.clanDonationEvents.detectedAt, cursor.lastDetectedAt),
        gt(schema.clanDonationEvents.id, cursor.lastEventId),
      ),
    ) ?? sql<boolean>`false`
  );
}

export function compareNotificationFanOutEventCursorPoints(
  left: NotificationFanOutEventCursorPoint,
  right: NotificationFanOutEventCursorPoint,
): number {
  const detectedAtComparison = left.detectedAt.getTime() - right.detectedAt.getTime();
  if (detectedAtComparison !== 0) return detectedAtComparison;
  return left.eventId.localeCompare(right.eventId);
}

export function isNotificationFanOutEventAfterCursor(
  event: NotificationFanOutEventCursorPoint,
  cursor: Pick<NotificationFanOutCursorState, 'lastDetectedAt' | 'lastEventId'>,
): boolean {
  if (!cursor.lastDetectedAt) return true;
  const detectedAtComparison = event.detectedAt.getTime() - cursor.lastDetectedAt.getTime();
  if (detectedAtComparison > 0) return true;
  if (detectedAtComparison < 0 || !cursor.lastEventId) return false;
  return event.eventId.localeCompare(cursor.lastEventId) > 0;
}

export function isClanMemberNotificationConfigEligibleForEvent(input: {
  configCreatedAt: Date;
  eventDetectedAt: Date;
}): boolean {
  return input.configCreatedAt.getTime() <= input.eventDetectedAt.getTime();
}

export function isWarAttackNotificationConfigEligibleForEvent(input: {
  configCreatedAt: Date;
  eventDetectedAt: Date;
}): boolean {
  return input.configCreatedAt.getTime() <= input.eventDetectedAt.getTime();
}

export function isClanDonationNotificationConfigEligibleForEvent(input: {
  configCreatedAt: Date;
  eventDetectedAt: Date;
}): boolean {
  return input.configCreatedAt.getTime() <= input.eventDetectedAt.getTime();
}

export function createWarSnapshotStore(database: Database): WarSnapshotStore {
  return {
    upsertLatestWarSnapshot: async (input) => {
      const snapshot = normalizeLatestWarSnapshotInput(input);
      const [linkedClan] = await database
        .select({ clanTag: schema.trackedClans.clanTag })
        .from(schema.trackedClans)
        .where(
          and(
            eq(schema.trackedClans.clanTag, snapshot.clanTag),
            eq(schema.trackedClans.isActive, true),
          ),
        )
        .limit(1);

      if (!linkedClan) return { status: 'not_linked' };

      await database
        .insert(schema.warLatestSnapshots)
        .values({
          clanTag: snapshot.clanTag,
          state: snapshot.state,
          snapshot: snapshot.snapshot,
          fetchedAt: snapshot.fetchedAt,
          updatedAt: snapshot.fetchedAt,
        })
        .onConflictDoUpdate({
          target: schema.warLatestSnapshots.clanTag,
          set: {
            state: snapshot.state,
            snapshot: snapshot.snapshot,
            fetchedAt: snapshot.fetchedAt,
            updatedAt: snapshot.fetchedAt,
          },
        });

      return { status: 'upserted' };
    },
  };
}

export function createWarAttackEventStore(database: Database): WarAttackEventStore {
  return {
    insertWarAttackEvents: async (input) => {
      const firstEvent = input[0];
      if (!firstEvent) return { status: 'processed', inserted: 0 };

      const clanTag = normalizeWarAttackEventInput(firstEvent).clanTag;
      const linkedClans = await database
        .select({
          id: schema.trackedClans.id,
          guildId: schema.trackedClans.guildId,
          clanTag: schema.trackedClans.clanTag,
        })
        .from(schema.trackedClans)
        .where(
          and(eq(schema.trackedClans.clanTag, clanTag), eq(schema.trackedClans.isActive, true)),
        );

      if (linkedClans.length === 0) return { status: 'not_linked', inserted: 0 };

      const values = linkedClans.flatMap((linkedClan) =>
        input.map((event) => {
          const normalizedEvent = normalizeWarAttackEventInput(event);
          return {
            guildId: linkedClan.guildId,
            trackedClanId: linkedClan.id,
            clanTag: normalizedEvent.clanTag,
            warKey: normalizedEvent.warKey,
            eventKey: buildWarAttackEventKey(normalizedEvent),
            attackerTag: normalizedEvent.attackerTag,
            defenderTag: normalizedEvent.defenderTag,
            attackOrder: normalizedEvent.attackOrder,
            stars: normalizedEvent.stars,
            destructionPercentage: normalizedEvent.destructionPercentage,
            duration: normalizedEvent.duration,
            freshAttack: normalizedEvent.freshAttack,
            rawAttack: normalizedEvent.rawAttack,
            sourceFetchedAt: normalizedEvent.sourceFetchedAt,
            occurredAt: normalizedEvent.occurredAt,
            detectedAt: normalizedEvent.detectedAt ?? new Date(),
          };
        }),
      );

      const inserted = await database
        .insert(schema.warAttackEvents)
        .values(values)
        .onConflictDoNothing({
          target: [schema.warAttackEvents.guildId, schema.warAttackEvents.eventKey],
        })
        .returning({ id: schema.warAttackEvents.id });

      return { status: 'processed', inserted: inserted.length };
    },
  };
}

export function createPlayerSnapshotStore(database: Database): PlayerSnapshotStore {
  return {
    upsertLatestPlayerSnapshot: async (input) => {
      const snapshot = normalizeLatestPlayerSnapshotInput(input);
      const [linkedPlayer] = await database
        .select({ playerTag: schema.playerLinks.playerTag })
        .from(schema.playerLinks)
        .where(eq(schema.playerLinks.playerTag, snapshot.playerTag))
        .limit(1);

      if (!linkedPlayer) return { status: 'not_linked' };

      await database
        .insert(schema.playerLatestSnapshots)
        .values({
          playerTag: snapshot.playerTag,
          name: snapshot.name,
          snapshot: snapshot.snapshot,
          fetchedAt: snapshot.fetchedAt,
          updatedAt: snapshot.fetchedAt,
        })
        .onConflictDoUpdate({
          target: schema.playerLatestSnapshots.playerTag,
          set: {
            name: snapshot.name,
            snapshot: snapshot.snapshot,
            fetchedAt: snapshot.fetchedAt,
            updatedAt: snapshot.fetchedAt,
          },
        });

      return { status: 'upserted' };
    },
  };
}

export function createPollingLeaseStore(database: Database): PollingLeaseStore {
  return {
    claimDuePollingLease: async (resourceType, ownerId, lockForSeconds, now = new Date()) => {
      assertTopLevelPollingResourceType(resourceType);
      if (!ownerId.trim()) throw new Error('Polling lease ownerId is required.');
      if (!Number.isFinite(lockForSeconds) || lockForSeconds <= 0) {
        throw new Error('Polling lease lock duration must be a positive number of seconds.');
      }

      const lockedUntil = new Date(now.getTime() + lockForSeconds * 1000);
      const rows = await database.execute(sql<ClaimedPollingLease>`
        update polling_leases
        set owner_id = ${ownerId},
            locked_until = ${lockedUntil},
            updated_at = ${now}
        where id = (
          select id
          from polling_leases
          where resource_type = ${resourceType}
            and run_after <= ${now}
            and (locked_until is null or locked_until <= ${now})
          order by run_after asc, created_at asc
          for update skip locked
          limit 1
        )
        returning resource_type as "resourceType",
                  resource_id as "resourceId",
                  owner_id as "ownerId",
                  run_after as "runAfter",
                  locked_until as "lockedUntil",
                  attempts,
                  last_error as "lastError"
      `);

      return normalizeExecuteRows<ClaimedPollingLease>(rows)[0] ?? null;
    },
    completePollingLease: async (resourceType, resourceId, ownerId, nextRun) => {
      assertTopLevelPollingResourceType(resourceType);
      if (!ownerId.trim()) throw new Error('Polling lease ownerId is required.');
      await database
        .update(schema.pollingLeases)
        .set({
          ownerId: null,
          lockedUntil: null,
          runAfter: nextRun,
          attempts: 0,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.pollingLeases.resourceType, resourceType),
            eq(schema.pollingLeases.resourceId, resourceId),
            eq(schema.pollingLeases.ownerId, ownerId),
          ),
        );
    },
    failPollingLease: async (resourceType, resourceId, ownerId, error, nextRun) => {
      assertTopLevelPollingResourceType(resourceType);
      if (!ownerId.trim()) throw new Error('Polling lease ownerId is required.');
      await database
        .update(schema.pollingLeases)
        .set({
          ownerId: null,
          lockedUntil: null,
          runAfter: nextRun,
          attempts: sql`${schema.pollingLeases.attempts} + 1`,
          lastError: formatPollingLeaseError(error),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.pollingLeases.resourceType, resourceType),
            eq(schema.pollingLeases.resourceId, resourceId),
            eq(schema.pollingLeases.ownerId, ownerId),
          ),
        );
    },
  };
}

export function normalizeLatestClanSnapshotInput(
  input: UpsertLatestClanSnapshotInput,
): NormalizedLatestClanSnapshot {
  const clanTag = input.clanTag.trim().toUpperCase();
  if (!clanTag) throw new Error('Clan snapshot requires a clan tag.');

  return {
    clanTag,
    name: input.name,
    snapshot: input.snapshot,
    fetchedAt: input.fetchedAt ?? new Date(),
  };
}

export function buildClanMemberEventKey(input: {
  clanTag: string;
  playerTag: string;
  eventType: 'joined' | 'left';
  eventAt: Date;
}): string {
  const clanTag = input.clanTag.trim().toUpperCase();
  const playerTag = input.playerTag.trim().toUpperCase();
  if (!clanTag || !playerTag) throw new Error('Clan member event keys require tags.');
  return `clan:${clanTag}:member:${playerTag}:${input.eventType}:${input.eventAt.toISOString()}`;
}

export function buildClanDonationEventKey(input: {
  clanTag: string;
  playerTag: string;
  eventAt: Date;
  donationDelta: number;
  receivedDelta: number;
}): string {
  const clanTag = input.clanTag.trim().toUpperCase();
  const playerTag = input.playerTag.trim().toUpperCase();
  if (!clanTag || !playerTag) throw new Error('Clan donation event keys require tags.');
  if (!Number.isInteger(input.donationDelta) || !Number.isInteger(input.receivedDelta)) {
    throw new Error('Clan donation event keys require integer deltas.');
  }
  if (input.donationDelta <= 0 && input.receivedDelta <= 0) {
    throw new Error('Clan donation event keys require at least one positive delta.');
  }

  return [
    `clan:${clanTag}`,
    `donations:${playerTag}`,
    input.eventAt.toISOString(),
    `donated:${input.donationDelta}`,
    `received:${input.receivedDelta}`,
  ].join(':');
}

export function computeClanDonationDeltaEvent(input: {
  previousDonations: number | null | undefined;
  currentDonations: number | null | undefined;
  previousDonationsReceived: number | null | undefined;
  currentDonationsReceived: number | null | undefined;
}): ClanDonationDeltaEvent | null {
  if (
    input.previousDonations === null ||
    input.previousDonations === undefined ||
    input.currentDonations === null ||
    input.currentDonations === undefined ||
    input.previousDonationsReceived === null ||
    input.previousDonationsReceived === undefined ||
    input.currentDonationsReceived === null ||
    input.currentDonationsReceived === undefined
  ) {
    return null;
  }

  const donationDelta = Math.max(0, input.currentDonations - input.previousDonations);
  const receivedDelta = Math.max(
    0,
    input.currentDonationsReceived - input.previousDonationsReceived,
  );
  if (donationDelta === 0 && receivedDelta === 0) return null;

  return {
    previousDonations: input.previousDonations,
    currentDonations: input.currentDonations,
    donationDelta,
    previousDonationsReceived: input.previousDonationsReceived,
    currentDonationsReceived: input.currentDonationsReceived,
    receivedDelta,
  };
}

export function buildNotificationOutboxIdempotencyKey(
  input: BuildNotificationOutboxIdempotencyKeyInput,
): string {
  const guildId = input.guildId.trim();
  const sourceId = input.sourceId.trim().toLowerCase();
  const targetId = input.targetId.trim();
  if (!guildId || !sourceId || !targetId) {
    throw new Error('Notification outbox idempotency keys require guild, source, and target IDs.');
  }

  return [
    'notification',
    `guild:${guildId}`,
    `source:${input.sourceType}:${sourceId}`,
    `target:${input.targetType}:${targetId}`,
  ].join(':');
}

export function normalizeLatestWarSnapshotInput(
  input: UpsertLatestWarSnapshotInput,
): NormalizedLatestWarSnapshot {
  const clanTag = input.clanTag.trim().toUpperCase();
  if (!clanTag) throw new Error('War snapshot requires a clan tag.');
  const state = input.state.trim().toLowerCase();
  if (!state) throw new Error('War snapshot requires a state.');

  return {
    clanTag,
    state,
    snapshot: input.snapshot,
    fetchedAt: input.fetchedAt ?? new Date(),
  };
}

export function normalizeWarAttackEventInput(input: WarAttackEventInput): WarAttackEventInput {
  const clanTag = input.clanTag.trim().toUpperCase();
  const warKey = input.warKey.trim().toLowerCase();
  const attackerTag = input.attackerTag.trim().toUpperCase();
  const defenderTag = input.defenderTag.trim().toUpperCase();
  if (!clanTag || !warKey || !attackerTag || !defenderTag) {
    throw new Error('War attack events require clan, war, attacker, and defender identifiers.');
  }
  if (!Number.isInteger(input.attackOrder) || input.attackOrder < 0) {
    throw new Error('War attack events require a non-negative attack order.');
  }

  return { ...input, clanTag, warKey, attackerTag, defenderTag };
}

export function buildWarAttackEventKey(input: WarAttackEventInput): string {
  const event = normalizeWarAttackEventInput(input);
  return `war:${event.warKey}:attack:${event.attackerTag}:${event.defenderTag}:${event.attackOrder}`;
}

export function normalizeLatestPlayerSnapshotInput(
  input: UpsertLatestPlayerSnapshotInput,
): NormalizedLatestPlayerSnapshot {
  const playerTag = input.playerTag.trim().toUpperCase();
  if (!playerTag) throw new Error('Player snapshot requires a player tag.');

  return {
    playerTag,
    name: input.name,
    snapshot: input.snapshot,
    fetchedAt: input.fetchedAt ?? new Date(),
  };
}

export function computeJitteredNextRun(
  now: Date,
  config: PollingIntervalConfig,
  random = Math.random,
): Date {
  if (config.baseSeconds < 0 || config.jitterSeconds < 0) {
    throw new Error('Polling intervals must not be negative.');
  }
  const jitter = Math.floor(random() * (config.jitterSeconds + 1));
  return new Date(now.getTime() + (config.baseSeconds + jitter) * 1000);
}

export function buildPollingEnrollmentResourceIds(
  sources: readonly PollingEnrollmentSource[],
): string[] {
  return [
    ...new Set(
      sources
        .filter((source) => source.isActive !== false)
        .map((source) => source.resourceId.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].sort();
}

export function assertTopLevelPollingResourceType(
  resourceType: string,
): asserts resourceType is PollingResourceType {
  if (!TOP_LEVEL_POLLING_RESOURCE_TYPES.includes(resourceType as PollingResourceType)) {
    throw new Error(`Unsupported top-level polling resource type: ${resourceType}`);
  }
}

function formatPollingLeaseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 4000);
}

function normalizeExecuteRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}

export function createGlobalAccessBlockStore(database: Database): GlobalAccessBlockStore {
  return {
    isUserBlacklisted: async (discordUserId) => {
      return isTargetBlacklisted(database, 'user', discordUserId);
    },
    isGuildBlacklisted: async (discordGuildId) => {
      return isTargetBlacklisted(database, 'guild', discordGuildId);
    },
    toggle: async (input) => {
      return database.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: schema.globalAccessBlocks.id })
          .from(schema.globalAccessBlocks)
          .where(
            and(
              eq(schema.globalAccessBlocks.targetType, input.targetType),
              eq(schema.globalAccessBlocks.targetId, input.targetId),
            ),
          )
          .limit(1);

        if (existing) {
          await tx
            .delete(schema.globalAccessBlocks)
            .where(eq(schema.globalAccessBlocks.id, existing.id));
          await tx.insert(schema.auditLogs).values({
            guildId: null,
            actorDiscordUserId: input.actorDiscordUserId,
            action: 'global_access_block.delete',
            targetType: input.targetType === 'user' ? 'discord_user' : 'discord_guild',
            targetId: input.targetId,
            metadata: { targetName: input.targetName },
          });
          return { action: 'deleted' };
        }

        await tx.insert(schema.globalAccessBlocks).values({
          targetType: input.targetType,
          targetId: input.targetId,
          targetName: input.targetName,
          createdByDiscordUserId: input.actorDiscordUserId,
        });
        await tx.insert(schema.auditLogs).values({
          guildId: null,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'global_access_block.create',
          targetType: input.targetType === 'user' ? 'discord_user' : 'discord_guild',
          targetId: input.targetId,
          metadata: { targetName: input.targetName },
        });
        return { action: 'created' };
      });
    },
  };
}

export function createDatabaseTrackedClanStore(database: Database): DatabaseTrackedClanStore {
  return {
    listClanCategories: async (guildId) => {
      return database
        .select({
          id: schema.clanCategories.id,
          displayName: schema.clanCategories.displayName,
          sortOrder: schema.clanCategories.sortOrder,
        })
        .from(schema.clanCategories)
        .where(eq(schema.clanCategories.guildId, guildId))
        .orderBy(schema.clanCategories.sortOrder, schema.clanCategories.displayName)
        .limit(25);
    },
    listLinkedClans: async (guildId) => {
      const rows = await database
        .select({
          id: schema.trackedClans.id,
          clanTag: schema.trackedClans.clanTag,
          name: schema.trackedClans.name,
          alias: schema.trackedClans.alias,
        })
        .from(schema.trackedClans)
        .where(
          and(eq(schema.trackedClans.guildId, guildId), eq(schema.trackedClans.isActive, true)),
        )
        .orderBy(schema.trackedClans.name, schema.trackedClans.clanTag)
        .limit(25);

      return rows.map((row) => ({ ...row, name: row.name ?? row.clanTag }));
    },
    listClansForGuild: async (guildId) => {
      return database
        .select({
          id: schema.trackedClans.id,
          clanTag: schema.trackedClans.clanTag,
          name: schema.trackedClans.name,
          alias: schema.trackedClans.alias,
          categoryId: schema.trackedClans.categoryId,
          sortOrder: schema.trackedClans.sortOrder,
          snapshot: schema.clanLatestSnapshots.snapshot,
        })
        .from(schema.trackedClans)
        .leftJoin(
          schema.clanLatestSnapshots,
          eq(schema.trackedClans.clanTag, schema.clanLatestSnapshots.clanTag),
        )
        .where(
          and(eq(schema.trackedClans.guildId, guildId), eq(schema.trackedClans.isActive, true)),
        )
        .orderBy(
          schema.trackedClans.categoryId,
          schema.trackedClans.sortOrder,
          schema.trackedClans.name,
          schema.trackedClans.clanTag,
        );
    },
    linkClan: async (input) =>
      database.transaction(async (tx) => {
        await tx
          .insert(schema.guilds)
          .values({ id: input.guildId, name: input.guildName })
          .onConflictDoUpdate({
            target: schema.guilds.id,
            set: { name: input.guildName, updatedAt: new Date() },
          });

        const category = input.category
          ? await findOrCreateClanCategory(
              tx,
              input.guildId,
              input.category,
              input.actorDiscordUserId,
            )
          : undefined;

        const [existing] = await tx
          .select({ id: schema.trackedClans.id, categoryId: schema.trackedClans.categoryId })
          .from(schema.trackedClans)
          .where(
            and(
              eq(schema.trackedClans.guildId, input.guildId),
              eq(schema.trackedClans.clanTag, input.clan.tag),
            ),
          )
          .limit(1);

        const categoryId = category?.id ?? existing?.categoryId ?? null;
        const trackedClan = existing
          ? (
              await tx
                .update(schema.trackedClans)
                .set({
                  name: input.clan.name,
                  categoryId,
                  isActive: true,
                  updatedAt: new Date(),
                })
                .where(eq(schema.trackedClans.id, existing.id))
                .returning({ id: schema.trackedClans.id })
            )[0]
          : (
              await tx
                .insert(schema.trackedClans)
                .values({
                  guildId: input.guildId,
                  clanTag: input.clan.tag,
                  name: input.clan.name,
                  categoryId,
                  isActive: true,
                })
                .returning({ id: schema.trackedClans.id })
            )[0];

        if (!trackedClan) throw new Error('Failed to upsert tracked clan.');

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: existing ? 'tracked_clan.updated' : 'tracked_clan.linked',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: { clanTag: input.clan.tag, categoryId },
        });

        if (!input.channelId) {
          return {
            status: 'linked',
            clanName: input.clan.name,
            clanTag: input.clan.tag,
            ...(category ? { category } : {}),
            channelLinked: false,
          };
        }

        const [conflict] = await tx
          .select({ clanName: schema.trackedClans.name, clanTag: schema.trackedClans.clanTag })
          .from(schema.trackedClanChannels)
          .innerJoin(
            schema.trackedClans,
            eq(schema.trackedClanChannels.trackedClanId, schema.trackedClans.id),
          )
          .where(
            and(
              eq(schema.trackedClanChannels.guildId, input.guildId),
              eq(schema.trackedClanChannels.discordChannelId, input.channelId),
              ne(schema.trackedClans.clanTag, input.clan.tag),
            ),
          )
          .limit(1);

        if (conflict) {
          return {
            status: 'channel_conflict',
            conflict: { clanName: conflict.clanName ?? 'Unknown clan', clanTag: conflict.clanTag },
          };
        }

        await tx
          .insert(schema.trackedClanChannels)
          .values({
            guildId: input.guildId,
            trackedClanId: trackedClan.id,
            discordChannelId: input.channelId,
            channelType: input.channelType,
          })
          .onConflictDoNothing();

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'tracked_clan.channel_linked',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: { clanTag: input.clan.tag, channelId: input.channelId },
        });

        return {
          status: 'linked',
          clanName: input.clan.name,
          clanTag: input.clan.tag,
          ...(category ? { category } : {}),
          channelLinked: true,
        };
      }),
    unlinkClan: async (input) =>
      database.transaction(async (tx) => {
        const [clan] = await tx
          .select({
            id: schema.trackedClans.id,
            clanTag: schema.trackedClans.clanTag,
            name: schema.trackedClans.name,
          })
          .from(schema.trackedClans)
          .where(
            and(
              eq(schema.trackedClans.guildId, input.guildId),
              eq(schema.trackedClans.clanTag, input.clanTag),
            ),
          )
          .limit(1);
        if (!clan) return { status: 'not_found' };
        await tx
          .delete(schema.trackedClanChannels)
          .where(eq(schema.trackedClanChannels.trackedClanId, clan.id));
        await tx.delete(schema.trackedClans).where(eq(schema.trackedClans.id, clan.id));
        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'tracked_clan.unlinked',
          targetType: 'tracked_clan',
          targetId: clan.id,
          metadata: { clanTag: clan.clanTag },
        });
        return {
          status: 'unlinked',
          clan: { id: clan.id, clanTag: clan.clanTag, name: clan.name ?? 'Unknown clan' },
        };
      }),
    unlinkChannel: async (input) =>
      database.transaction(async (tx) => {
        const [row] = await tx
          .select({
            channelId: schema.trackedClanChannels.id,
            clanId: schema.trackedClans.id,
            clanName: schema.trackedClans.name,
          })
          .from(schema.trackedClanChannels)
          .innerJoin(
            schema.trackedClans,
            eq(schema.trackedClanChannels.trackedClanId, schema.trackedClans.id),
          )
          .where(
            and(
              eq(schema.trackedClanChannels.guildId, input.guildId),
              eq(schema.trackedClanChannels.discordChannelId, input.channelId),
            ),
          )
          .limit(1);
        if (!row) return { status: 'not_found' };
        await tx
          .delete(schema.trackedClanChannels)
          .where(eq(schema.trackedClanChannels.id, row.channelId));
        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'tracked_clan.channel_unlinked',
          targetType: 'tracked_clan',
          targetId: row.clanId,
          metadata: { channelId: input.channelId },
        });
        return { status: 'unlinked', clanName: row.clanName ?? 'Unknown clan' };
      }),
  };
}

const CLAN_MEMBER_JOIN_LEAVE_EVENT_TYPES = ['joined', 'left'] as const;

export function createDatabaseClanMemberNotificationConfigStore(
  database: Database,
): DatabaseClanMemberNotificationConfigStore {
  return {
    configureJoinLeaveNotifications: async (input) => {
      const clanTag = input.clanTag.trim().toUpperCase();
      return database.transaction(async (tx) => {
        const [trackedClan] = await tx
          .select({
            id: schema.trackedClans.id,
            clanTag: schema.trackedClans.clanTag,
            name: schema.trackedClans.name,
          })
          .from(schema.trackedClans)
          .where(
            and(
              eq(schema.trackedClans.guildId, input.guildId),
              eq(schema.trackedClans.clanTag, clanTag),
              eq(schema.trackedClans.isActive, true),
            ),
          )
          .limit(1);

        if (!trackedClan) return { status: 'clan_not_linked' as const };

        const existing = await tx
          .select({
            id: schema.clanMemberNotificationConfigs.id,
            discordChannelId: schema.clanMemberNotificationConfigs.discordChannelId,
            eventType: schema.clanMemberNotificationConfigs.eventType,
          })
          .from(schema.clanMemberNotificationConfigs)
          .where(
            and(
              eq(schema.clanMemberNotificationConfigs.guildId, input.guildId),
              eq(schema.clanMemberNotificationConfigs.trackedClanId, trackedClan.id),
              inArray(
                schema.clanMemberNotificationConfigs.eventType,
                CLAN_MEMBER_JOIN_LEAVE_EVENT_TYPES,
              ),
            ),
          );

        await tx
          .delete(schema.clanMemberNotificationConfigs)
          .where(
            and(
              eq(schema.clanMemberNotificationConfigs.guildId, input.guildId),
              eq(schema.clanMemberNotificationConfigs.trackedClanId, trackedClan.id),
              inArray(
                schema.clanMemberNotificationConfigs.eventType,
                CLAN_MEMBER_JOIN_LEAVE_EVENT_TYPES,
              ),
            ),
          );

        const now = new Date();
        await tx.insert(schema.clanMemberNotificationConfigs).values(
          CLAN_MEMBER_JOIN_LEAVE_EVENT_TYPES.map((eventType) => ({
            guildId: input.guildId,
            trackedClanId: trackedClan.id,
            discordChannelId: input.discordChannelId,
            eventType,
            isEnabled: true,
            createdAt: now,
            updatedAt: now,
          })),
        );

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'clan_member_notifications.enabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            discordChannelId: input.discordChannelId,
            eventTypes: [...CLAN_MEMBER_JOIN_LEAVE_EVENT_TYPES],
            previousConfigs: existing,
          },
        });

        return {
          status: 'configured' as const,
          clanName: trackedClan.name ?? trackedClan.clanTag,
          clanTag: trackedClan.clanTag,
          discordChannelId: input.discordChannelId,
        };
      });
    },
    disableJoinLeaveNotifications: async (input) => {
      const clanTag = input.clanTag.trim().toUpperCase();
      return database.transaction(async (tx) => {
        const [trackedClan] = await tx
          .select({
            id: schema.trackedClans.id,
            clanTag: schema.trackedClans.clanTag,
            name: schema.trackedClans.name,
          })
          .from(schema.trackedClans)
          .where(
            and(
              eq(schema.trackedClans.guildId, input.guildId),
              eq(schema.trackedClans.clanTag, clanTag),
              eq(schema.trackedClans.isActive, true),
            ),
          )
          .limit(1);

        if (!trackedClan) return { status: 'clan_not_linked' as const };

        const existing = await tx
          .select({
            id: schema.clanMemberNotificationConfigs.id,
            discordChannelId: schema.clanMemberNotificationConfigs.discordChannelId,
            eventType: schema.clanMemberNotificationConfigs.eventType,
          })
          .from(schema.clanMemberNotificationConfigs)
          .where(
            and(
              eq(schema.clanMemberNotificationConfigs.guildId, input.guildId),
              eq(schema.clanMemberNotificationConfigs.trackedClanId, trackedClan.id),
              inArray(
                schema.clanMemberNotificationConfigs.eventType,
                CLAN_MEMBER_JOIN_LEAVE_EVENT_TYPES,
              ),
            ),
          );

        if (existing.length === 0) {
          return {
            status: 'not_configured' as const,
            clanName: trackedClan.name ?? trackedClan.clanTag,
            clanTag: trackedClan.clanTag,
          };
        }

        await tx
          .delete(schema.clanMemberNotificationConfigs)
          .where(
            and(
              eq(schema.clanMemberNotificationConfigs.guildId, input.guildId),
              eq(schema.clanMemberNotificationConfigs.trackedClanId, trackedClan.id),
              inArray(
                schema.clanMemberNotificationConfigs.eventType,
                CLAN_MEMBER_JOIN_LEAVE_EVENT_TYPES,
              ),
            ),
          );

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'clan_member_notifications.disabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            eventTypes: [...CLAN_MEMBER_JOIN_LEAVE_EVENT_TYPES],
            removedConfigs: existing,
          },
        });

        return {
          status: 'disabled' as const,
          clanName: trackedClan.name ?? trackedClan.clanTag,
          clanTag: trackedClan.clanTag,
        };
      });
    },
    configureWarAttackNotifications: async (input) => {
      const clanTag = input.clanTag.trim().toUpperCase();
      return database.transaction(async (tx) => {
        const [trackedClan] = await tx
          .select({
            id: schema.trackedClans.id,
            clanTag: schema.trackedClans.clanTag,
            name: schema.trackedClans.name,
          })
          .from(schema.trackedClans)
          .where(
            and(
              eq(schema.trackedClans.guildId, input.guildId),
              eq(schema.trackedClans.clanTag, clanTag),
              eq(schema.trackedClans.isActive, true),
            ),
          )
          .limit(1);

        if (!trackedClan) return { status: 'clan_not_linked' as const };

        const existing = await tx
          .select({
            id: schema.warAttackNotificationConfigs.id,
            discordChannelId: schema.warAttackNotificationConfigs.discordChannelId,
            eventType: schema.warAttackNotificationConfigs.eventType,
          })
          .from(schema.warAttackNotificationConfigs)
          .where(
            and(
              eq(schema.warAttackNotificationConfigs.guildId, input.guildId),
              eq(schema.warAttackNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.warAttackNotificationConfigs.eventType, 'war_attack'),
            ),
          );

        await tx
          .delete(schema.warAttackNotificationConfigs)
          .where(
            and(
              eq(schema.warAttackNotificationConfigs.guildId, input.guildId),
              eq(schema.warAttackNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.warAttackNotificationConfigs.eventType, 'war_attack'),
            ),
          );

        const now = new Date();
        await tx.insert(schema.warAttackNotificationConfigs).values({
          guildId: input.guildId,
          trackedClanId: trackedClan.id,
          discordChannelId: input.discordChannelId,
          eventType: 'war_attack',
          isEnabled: true,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'war_attack_notifications.enabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            discordChannelId: input.discordChannelId,
            eventTypes: ['war_attack'],
            previousConfigs: existing,
          },
        });

        return {
          status: 'configured' as const,
          clanName: trackedClan.name ?? trackedClan.clanTag,
          clanTag: trackedClan.clanTag,
          discordChannelId: input.discordChannelId,
        };
      });
    },
    disableWarAttackNotifications: async (input) => {
      const clanTag = input.clanTag.trim().toUpperCase();
      return database.transaction(async (tx) => {
        const [trackedClan] = await tx
          .select({
            id: schema.trackedClans.id,
            clanTag: schema.trackedClans.clanTag,
            name: schema.trackedClans.name,
          })
          .from(schema.trackedClans)
          .where(
            and(
              eq(schema.trackedClans.guildId, input.guildId),
              eq(schema.trackedClans.clanTag, clanTag),
              eq(schema.trackedClans.isActive, true),
            ),
          )
          .limit(1);

        if (!trackedClan) return { status: 'clan_not_linked' as const };

        const existing = await tx
          .select({
            id: schema.warAttackNotificationConfigs.id,
            discordChannelId: schema.warAttackNotificationConfigs.discordChannelId,
            eventType: schema.warAttackNotificationConfigs.eventType,
          })
          .from(schema.warAttackNotificationConfigs)
          .where(
            and(
              eq(schema.warAttackNotificationConfigs.guildId, input.guildId),
              eq(schema.warAttackNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.warAttackNotificationConfigs.eventType, 'war_attack'),
            ),
          );

        if (existing.length === 0) {
          return {
            status: 'not_configured' as const,
            clanName: trackedClan.name ?? trackedClan.clanTag,
            clanTag: trackedClan.clanTag,
          };
        }

        await tx
          .delete(schema.warAttackNotificationConfigs)
          .where(
            and(
              eq(schema.warAttackNotificationConfigs.guildId, input.guildId),
              eq(schema.warAttackNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.warAttackNotificationConfigs.eventType, 'war_attack'),
            ),
          );

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'war_attack_notifications.disabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            eventTypes: ['war_attack'],
            removedConfigs: existing,
          },
        });

        return {
          status: 'disabled' as const,
          clanName: trackedClan.name ?? trackedClan.clanTag,
          clanTag: trackedClan.clanTag,
        };
      });
    },
  };
}

async function findOrCreateClanCategory(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  guildId: string,
  category: string,
  actorDiscordUserId: string,
): Promise<{ id: string; displayName: string }> {
  const displayName = category.trim();
  const name = displayName.toLowerCase().replace(/\s+/g, '_');
  const [existing] = await tx
    .select({ id: schema.clanCategories.id, displayName: schema.clanCategories.displayName })
    .from(schema.clanCategories)
    .where(and(eq(schema.clanCategories.guildId, guildId), eq(schema.clanCategories.name, name)))
    .limit(1);
  if (existing) return existing;
  const [maxSort] = await tx
    .select({ value: sql<number>`coalesce(max(${schema.clanCategories.sortOrder}), -1)` })
    .from(schema.clanCategories)
    .where(eq(schema.clanCategories.guildId, guildId));
  const [created] = await tx
    .insert(schema.clanCategories)
    .values({ guildId, name, displayName, sortOrder: Number(maxSort?.value ?? -1) + 1 })
    .returning({ id: schema.clanCategories.id, displayName: schema.clanCategories.displayName });
  if (!created) throw new Error('Failed to create clan category.');
  await tx.insert(schema.auditLogs).values({
    guildId,
    actorDiscordUserId,
    action: 'clan_category.created',
    targetType: 'clan_category',
    targetId: created.id,
    metadata: { name, displayName },
  });
  return created;
}

async function isTargetBlacklisted(
  database: Database,
  targetType: GlobalAccessBlockTargetType,
  targetId: string,
): Promise<boolean> {
  const [row] = await database
    .select({ id: schema.globalAccessBlocks.id })
    .from(schema.globalAccessBlocks)
    .where(
      and(
        eq(schema.globalAccessBlocks.targetType, targetType),
        eq(schema.globalAccessBlocks.targetId, targetId),
      ),
    )
    .limit(1);

  return Boolean(row);
}

async function countPollingLeases(database: Database, resourceType: string): Promise<number> {
  const [row] = await database
    .select({ value: count() })
    .from(schema.pollingLeases)
    .where(eq(schema.pollingLeases.resourceType, resourceType));

  return row?.value ?? 0;
}

async function countDuePollingLeases(database: Database): Promise<number> {
  const [row] = await database
    .select({ value: count() })
    .from(schema.pollingLeases)
    .where(lte(schema.pollingLeases.runAfter, new Date()));

  return row?.value ?? 0;
}

async function upsertPollingLease(
  database: Database,
  resourceType: PollingResourceType,
  resourceId: string,
  runAfter = new Date(),
): Promise<void> {
  await database
    .insert(schema.pollingLeases)
    .values({ resourceType, resourceId, runAfter, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.pollingLeases.resourceType, schema.pollingLeases.resourceId],
      set: { runAfter, updatedAt: new Date() },
    });
}

async function syncPollingLeasesForType(
  database: Database,
  resourceType: PollingResourceType,
  resourceIds: readonly string[],
  runAfter = new Date(),
): Promise<{ enrolled: number; removed: number }> {
  assertTopLevelPollingResourceType(resourceType);
  const existingRows = await database
    .select({ resourceId: schema.pollingLeases.resourceId })
    .from(schema.pollingLeases)
    .where(eq(schema.pollingLeases.resourceType, resourceType));
  const existing = new Set(existingRows.map((row) => row.resourceId));
  const desired = new Set(resourceIds);

  for (const resourceId of desired) {
    await upsertPollingLease(database, resourceType, resourceId, runAfter);
  }

  const stale = [...existing].filter((resourceId) => !desired.has(resourceId));
  let removed = 0;
  if (stale.length > 0) {
    const deletedRows = await database
      .delete(schema.pollingLeases)
      .where(
        and(
          eq(schema.pollingLeases.resourceType, resourceType),
          inArray(schema.pollingLeases.resourceId, stale),
          or(
            isNull(schema.pollingLeases.lockedUntil),
            lte(schema.pollingLeases.lockedUntil, runAfter),
          ),
        ),
      )
      .returning({ resourceId: schema.pollingLeases.resourceId });
    removed = deletedRows.length;
  }

  return { enrolled: desired.size, removed };
}

export { schema };
