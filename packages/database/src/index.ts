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

export interface LastSeenSnapshotRecord {
  playerTag: string;
  playerName: string;
  clanTag: string;
  clanName: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastFetchedAt: Date;
}

export interface LastSeenSnapshotReader {
  listLastSeenSnapshots: (
    guildId: string,
    playerTags: readonly string[],
  ) => Promise<LastSeenSnapshotRecord[]>;
}

export interface ClanMemberSnapshotListRow {
  playerTag: string;
  name: string;
  role: string | null;
  expLevel: number | null;
  leagueId: number | null;
  trophies: number | null;
  clanRank: number | null;
  previousClanRank: number | null;
  donations: number | null;
  donationsReceived: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastFetchedAt: Date;
}

export interface ClanMemberSnapshotListResult {
  clan: {
    id: string;
    clanTag: string;
    name: string | null;
    alias: string | null;
  };
  members: ClanMemberSnapshotListRow[];
}

export interface ClanMemberSnapshotReader {
  listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<ClanMemberSnapshotListResult[]>;
}

export interface DonationSnapshotListRow {
  playerTag: string;
  name: string;
  donations: number | null;
  donationsReceived: number | null;
  lastFetchedAt: Date;
}

export interface DonationSnapshotListResult {
  clan: {
    id: string;
    clanTag: string;
    name: string | null;
    alias: string | null;
  };
  members: DonationSnapshotListRow[];
}

export interface DonationSnapshotReader {
  listDonationSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<DonationSnapshotListResult[]>;
}

export interface DonationHistoryListRow {
  playerTag: string;
  playerName: string;
  donated: number;
  received: number;
  eventCount: number;
  lastDetectedAt: Date;
}

export interface DonationHistoryReader {
  listDonationHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    playerTags?: readonly string[];
    since?: Date;
  }) => Promise<DonationHistoryListRow[]>;
}

export interface WarAttackHistoryListRow {
  attackerTag: string;
  attackerName: string | null;
  attackCount: number;
  totalStars: number;
  averageStars: number;
  totalDestruction: number;
  averageDestruction: number;
  freshAttackCount: number;
  lastAttackedAt: Date;
}

export interface WarAttackHistoryReader {
  listWarAttackHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    attackerTags?: readonly string[];
    since?: Date;
  }) => Promise<WarAttackHistoryListRow[]>;
}

export type ClanMemberJoinLeaveHistoryEventType = 'joined' | 'left';

export interface ClanMemberJoinLeaveHistoryListRow {
  playerTag: string;
  playerName: string;
  clanTag: string;
  clanName: string | null;
  eventType: ClanMemberJoinLeaveHistoryEventType;
  occurredAt: Date;
  detectedAt: Date;
}

export interface ClanMemberJoinLeaveHistoryReader {
  listClanMemberJoinLeaveHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    playerTags?: readonly string[];
    since?: Date;
  }) => Promise<ClanMemberJoinLeaveHistoryListRow[]>;
}

export interface ClanGamesHistoryListRow {
  playerTag: string;
  playerName: string;
  seasonCount: number;
  totalPoints: number;
  averagePoints: number;
  bestPoints: number;
  latestSeasonId: string;
  latestClanTag: string;
  latestClanName: string | null;
  latestUpdatedAt: Date;
}

export interface ClanGamesHistoryReader {
  listClanGamesHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    playerTags?: readonly string[];
    since?: Date;
  }) => Promise<ClanGamesHistoryListRow[]>;
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

export interface ClanRoleChangeDeltaEvent {
  previousRole: string | null;
  currentRole: string | null;
}

export type ClanGamesEventType = 'progress_delta' | 'completed';

export interface ClanGamesPlayerProgressInput {
  playerTag: string;
  playerName: string;
  currentAchievementValue: number;
  rawPlayer: unknown;
}

export interface ProcessClanGamesProgressInput {
  clanTag: string;
  seasonId: string;
  eventMaxPoints: number;
  fetchedAt: Date;
  players: readonly ClanGamesPlayerProgressInput[];
}

export interface ProcessClanGamesProgressResult {
  status: 'processed' | 'not_linked';
  baselinesCreated: number;
  progressEvents: number;
  completedEvents: number;
  clanSnapshots: number;
}

export interface ClanGamesProgressDeltaInput {
  initialPoints: number;
  previousCurrentPoints: number;
  currentAchievementValue: number;
  eventMaxPoints: number;
  wasCompleted: boolean;
}

export interface ClanGamesProgressDelta {
  previousEventPoints: number;
  currentEventPoints: number;
  pointsIncrease: number;
  completed: boolean;
  completedAt: Date | null;
}

export interface BuildClanGamesEventKeyInput {
  clanTag: string;
  seasonId: string;
  playerTag: string;
  eventType: ClanGamesEventType;
  currentPoints: number;
}

export interface ClanGamesEventStore {
  processClanGamesProgress: (
    input: ProcessClanGamesProgressInput,
  ) => Promise<ProcessClanGamesProgressResult>;
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
  roleChangeEvents: number;
}

export interface ClanMemberEventStore {
  processClanMemberSnapshots: (
    input: ProcessClanMemberSnapshotsInput,
  ) => Promise<ProcessClanMemberSnapshotsResult>;
}

export type NotificationSourceType =
  | 'clan_member_event'
  | 'war_attack_event'
  | 'war_state_event'
  | 'missed_war_attack_event'
  | 'clan_donation_event'
  | 'clan_role_change_event'
  | 'clan_games_event';
export type NotificationTargetType = 'discord_channel';

export const CLAN_MEMBER_NOTIFICATION_FANOUT_CURSOR_NAME = 'clan_member_event';
export const CLAN_MEMBER_NOTIFICATION_FANOUT_SOURCE_TYPE = 'clan_member_event';
export const WAR_ATTACK_NOTIFICATION_FANOUT_CURSOR_NAME = 'war_attack_event';
export const WAR_ATTACK_NOTIFICATION_FANOUT_SOURCE_TYPE = 'war_attack_event';
export const WAR_STATE_NOTIFICATION_FANOUT_CURSOR_NAME = 'war_state_event';
export const WAR_STATE_NOTIFICATION_FANOUT_SOURCE_TYPE = 'war_state_event';
export const MISSED_WAR_ATTACK_NOTIFICATION_FANOUT_CURSOR_NAME = 'missed_war_attack_event';
export const MISSED_WAR_ATTACK_NOTIFICATION_FANOUT_SOURCE_TYPE = 'missed_war_attack_event';
export const CLAN_DONATION_NOTIFICATION_FANOUT_CURSOR_NAME = 'clan_donation_event';
export const CLAN_DONATION_NOTIFICATION_FANOUT_SOURCE_TYPE = 'clan_donation_event';
export const CLAN_ROLE_CHANGE_NOTIFICATION_FANOUT_CURSOR_NAME = 'clan_role_change_event';
export const CLAN_ROLE_CHANGE_NOTIFICATION_FANOUT_SOURCE_TYPE = 'clan_role_change_event';
export const CLAN_GAMES_NOTIFICATION_FANOUT_CURSOR_NAME = 'clan_games_event';
export const CLAN_GAMES_NOTIFICATION_FANOUT_SOURCE_TYPE = 'clan_games_event';

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

export interface ClanRoleChangeNotificationFanOutEvent extends NotificationFanOutEventCursorPoint {
  guildId: string;
  trackedClanId: string | null;
  clanTag: string;
  playerTag: string;
  playerName: string;
  eventKey: string;
  previousRole: string | null;
  currentRole: string | null;
  occurredAt: Date;
}

export interface ClanGamesNotificationFanOutEvent extends NotificationFanOutEventCursorPoint {
  guildId: string;
  trackedClanId: string | null;
  clanTag: string;
  seasonId: string;
  eventType: string;
  eventKey: string;
  playerTag: string;
  playerName: string;
  previousPoints: number | null;
  currentPoints: number;
  pointsDelta: number;
  eventMaxPoints: number;
  occurredAt: Date;
}

export interface WarStateNotificationFanOutEvent extends NotificationFanOutEventCursorPoint {
  guildId: string;
  trackedClanId: string | null;
  clanTag: string;
  warKey: string;
  eventKey: string;
  previousState: string | null;
  currentState: string;
  occurredAt: Date;
}

export interface MissedWarAttackNotificationFanOutEvent extends NotificationFanOutEventCursorPoint {
  guildId: string;
  trackedClanId: string | null;
  clanTag: string;
  warKey: string;
  playerTag: string;
  playerName: string;
  attacksUsed: number;
  attacksAvailable: number;
  eventKey: string;
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

export interface EnsureClanRoleChangeNotificationFanOutCursorInput {
  cursorName: string;
  sourceType: 'clan_role_change_event';
  now: Date;
}

export interface EnsureClanGamesNotificationFanOutCursorInput {
  cursorName: string;
  sourceType: 'clan_games_event';
  now: Date;
}

export interface EnsureWarStateNotificationFanOutCursorInput {
  cursorName: string;
  sourceType: 'war_state_event';
  now: Date;
}

export interface EnsureMissedWarAttackNotificationFanOutCursorInput {
  cursorName: string;
  sourceType: 'missed_war_attack_event';
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
export type ListClanRoleChangeEventsAfterFanOutCursorInput =
  ListWarAttackEventsAfterFanOutCursorInput;
export type ListClanGamesEventsAfterFanOutCursorInput = ListWarAttackEventsAfterFanOutCursorInput;
export type ListWarStateEventsAfterFanOutCursorInput = ListWarAttackEventsAfterFanOutCursorInput;
export type ListMissedWarAttackEventsAfterFanOutCursorInput =
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

export interface ClanRoleChangeNotificationFanOutRepository {
  ensureCursor: (input: EnsureClanRoleChangeNotificationFanOutCursorInput) => Promise<void>;
  lockCursor: (cursorName: string) => Promise<NotificationFanOutCursorState | null>;
  listEventsAfterCursor: (
    input: ListClanRoleChangeEventsAfterFanOutCursorInput,
  ) => Promise<ClanRoleChangeNotificationFanOutEvent[]>;
  listTargetsForEvents: (
    eventIds: readonly string[],
  ) => Promise<ClanRoleChangeNotificationFanOutTarget[]>;
  insertOutboxEntries: (values: readonly NotificationOutboxInsertValue[]) => Promise<number>;
  advanceCursor: (input: AdvanceNotificationFanOutCursorInput) => Promise<void>;
}

export interface ClanGamesNotificationFanOutRepository {
  ensureCursor: (input: EnsureClanGamesNotificationFanOutCursorInput) => Promise<void>;
  lockCursor: (cursorName: string) => Promise<NotificationFanOutCursorState | null>;
  listEventsAfterCursor: (
    input: ListClanGamesEventsAfterFanOutCursorInput,
  ) => Promise<ClanGamesNotificationFanOutEvent[]>;
  listTargetsForEvents: (
    eventIds: readonly string[],
  ) => Promise<ClanGamesNotificationFanOutTarget[]>;
  insertOutboxEntries: (values: readonly NotificationOutboxInsertValue[]) => Promise<number>;
  advanceCursor: (input: AdvanceNotificationFanOutCursorInput) => Promise<void>;
}

export interface WarStateNotificationFanOutRepository {
  ensureCursor: (input: EnsureWarStateNotificationFanOutCursorInput) => Promise<void>;
  lockCursor: (cursorName: string) => Promise<NotificationFanOutCursorState | null>;
  listEventsAfterCursor: (
    input: ListWarStateEventsAfterFanOutCursorInput,
  ) => Promise<WarStateNotificationFanOutEvent[]>;
  listTargetsForEvents: (
    eventIds: readonly string[],
  ) => Promise<WarStateNotificationFanOutTarget[]>;
  insertOutboxEntries: (values: readonly NotificationOutboxInsertValue[]) => Promise<number>;
  advanceCursor: (input: AdvanceNotificationFanOutCursorInput) => Promise<void>;
}

export interface MissedWarAttackNotificationFanOutRepository {
  ensureCursor: (input: EnsureMissedWarAttackNotificationFanOutCursorInput) => Promise<void>;
  lockCursor: (cursorName: string) => Promise<NotificationFanOutCursorState | null>;
  listEventsAfterCursor: (
    input: ListMissedWarAttackEventsAfterFanOutCursorInput,
  ) => Promise<MissedWarAttackNotificationFanOutEvent[]>;
  listTargetsForEvents: (
    eventIds: readonly string[],
  ) => Promise<MissedWarAttackNotificationFanOutTarget[]>;
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
export type FanOutClanRoleChangeEventNotificationsInput = FanOutClanMemberEventNotificationsInput;
export type FanOutClanRoleChangeEventNotificationsResult = FanOutClanMemberEventNotificationsResult;
export type FanOutClanGamesEventNotificationsInput = FanOutClanMemberEventNotificationsInput;
export type FanOutClanGamesEventNotificationsResult = FanOutClanMemberEventNotificationsResult;
export type FanOutWarStateEventNotificationsInput = FanOutClanMemberEventNotificationsInput;
export type FanOutWarStateEventNotificationsResult = FanOutClanMemberEventNotificationsResult;
export type FanOutMissedWarAttackEventNotificationsInput = FanOutClanMemberEventNotificationsInput;
export type FanOutMissedWarAttackEventNotificationsResult =
  FanOutClanMemberEventNotificationsResult;

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
  fanOutClanRoleChangeEventNotifications: (
    input?: FanOutClanRoleChangeEventNotificationsInput,
  ) => Promise<FanOutClanRoleChangeEventNotificationsResult>;
  fanOutClanGamesEventNotifications?: (
    input?: FanOutClanGamesEventNotificationsInput,
  ) => Promise<FanOutClanGamesEventNotificationsResult>;
  fanOutWarStateEventNotifications: (
    input?: FanOutWarStateEventNotificationsInput,
  ) => Promise<FanOutWarStateEventNotificationsResult>;
  fanOutMissedWarAttackEventNotifications: (
    input?: FanOutMissedWarAttackEventNotificationsInput,
  ) => Promise<FanOutMissedWarAttackEventNotificationsResult>;
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

export interface ClanRoleChangeNotificationFanOutTarget {
  eventId: string;
  guildId: string;
  configId: string;
  discordChannelId: string;
  clanTag: string;
  playerTag: string;
  playerName: string;
  eventKey: string;
  previousRole: string | null;
  currentRole: string | null;
  occurredAt: Date;
  detectedAt: Date;
}

export interface ClanGamesNotificationFanOutTarget {
  eventId: string;
  guildId: string;
  configId: string;
  discordChannelId: string;
  clanTag: string;
  seasonId: string;
  eventType: string;
  eventKey: string;
  playerTag: string;
  playerName: string;
  previousPoints: number | null;
  currentPoints: number;
  pointsDelta: number;
  eventMaxPoints: number;
  occurredAt: Date;
  detectedAt: Date;
}

export interface WarStateNotificationFanOutTarget {
  eventId: string;
  guildId: string;
  configId: string;
  discordChannelId: string;
  clanTag: string;
  warKey: string;
  eventKey: string;
  previousState: string | null;
  currentState: string;
  occurredAt: Date;
  detectedAt: Date;
}

export interface MissedWarAttackNotificationFanOutTarget {
  eventId: string;
  guildId: string;
  configId: string;
  discordChannelId: string;
  clanTag: string;
  warKey: string;
  playerTag: string;
  playerName: string;
  attacksUsed: number;
  attacksAvailable: number;
  eventKey: string;
  occurredAt: Date;
  detectedAt: Date;
}

export interface NotificationOutboxInsertValue {
  guildId: string;
  configId?: string | null;
  warAttackConfigId?: string | null;
  warStateConfigId?: string | null;
  missedWarAttackConfigId?: string | null;
  clanDonationConfigId?: string | null;
  clanRoleChangeConfigId?: string | null;
  clanGamesConfigId?: string | null;
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

export interface RetainWarSnapshotInput extends UpsertLatestWarSnapshotInput {
  warKey: string;
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

export interface GuildLatestWarSnapshot extends NormalizedLatestWarSnapshot {
  trackedClan: {
    id: string;
    clanTag: string;
    name: string | null;
    alias: string | null;
  };
}

export interface GuildRetainedWarSnapshot extends GuildLatestWarSnapshot {
  warKey: string;
}

export interface ListRetainedEndedWarSnapshotsInput {
  guildId: string;
  clanTag?: string;
  limit?: number;
}

export interface WarSnapshotStore {
  getLatestWarSnapshot: (clanTag: string) => Promise<NormalizedLatestWarSnapshot | null>;
  getLatestWarSnapshotsForGuild: (guildId: string) => Promise<GuildLatestWarSnapshot[]>;
  getRetainedWarSnapshotsForGuild?: (input: {
    guildId: string;
    warKey: string;
    clanTag?: string;
  }) => Promise<GuildRetainedWarSnapshot[]>;
  listRetainedEndedWarSnapshotsForGuild?: (
    input: ListRetainedEndedWarSnapshotsInput,
  ) => Promise<GuildRetainedWarSnapshot[]>;
  upsertLatestWarSnapshot: (
    input: UpsertLatestWarSnapshotInput,
  ) => Promise<UpsertLatestWarSnapshotResult>;
  retainWarSnapshot?: (input: RetainWarSnapshotInput) => Promise<{ inserted: number }>;
}

export interface ClanGamesScoreboardMember {
  playerTag: string;
  playerName: string;
  points: number;
}

export interface ClanGamesScoreboardSnapshot {
  guildId: string;
  clanTag: string;
  clanName: string | null;
  clanAlias: string | null;
  seasonId: string;
  eventMaxPoints: number;
  sourceFetchedAt: Date;
  updatedAt: Date;
  members: ClanGamesScoreboardMember[];
  totalPoints: number;
}

export interface ClanGamesScoreboardQuery {
  guildId: string;
  clanTag?: string;
  seasonId?: string;
}

export interface ClanGamesScoreboardChoice {
  clanTag: string;
  clanName: string | null;
  clanAlias: string | null;
  seasonId: string | null;
  updatedAt: Date | null;
}

export interface ClanGamesScoreboardReader {
  getLatestScoreboard: (
    query: ClanGamesScoreboardQuery,
  ) => Promise<ClanGamesScoreboardSnapshot | null>;
  listScoreboardChoices: (guildId: string, query?: string) => Promise<ClanGamesScoreboardChoice[]>;
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

export interface WarStateEventInput {
  clanTag: string;
  warKey: string;
  previousState?: string | null;
  currentState: string;
  previousSnapshot?: unknown | null;
  currentSnapshot: unknown;
  sourceFetchedAt: Date;
  occurredAt: Date;
  detectedAt?: Date;
}

export interface NormalizedWarStateEventInput extends WarStateEventInput {
  clanTag: string;
  warKey: string;
  previousState: string | null;
  currentState: string;
  previousSnapshot: unknown | null;
}

export interface InsertWarStateEventsResult {
  status: 'processed' | 'not_linked';
  inserted: number;
}

export interface WarStateEventStore {
  insertWarStateEvents: (
    input: readonly WarStateEventInput[],
  ) => Promise<InsertWarStateEventsResult>;
}

export interface MissedWarAttackEventInput {
  clanTag: string;
  warKey: string;
  playerTag: string;
  playerName: string;
  attacksUsed: number;
  attacksAvailable: number;
  warSnapshot: unknown;
  memberSnapshot: unknown;
  stateEventId?: string | null;
  sourceFetchedAt: Date;
  warStartedAt?: Date | null;
  warEndedAt?: Date | null;
  occurredAt: Date;
  detectedAt?: Date;
}

export interface NormalizedMissedWarAttackEventInput extends MissedWarAttackEventInput {
  clanTag: string;
  warKey: string;
  playerTag: string;
  playerName: string;
  attacksUsed: number;
  attacksAvailable: number;
  stateEventId: string | null;
  warStartedAt: Date | null;
  warEndedAt: Date | null;
}

export interface InsertMissedWarAttackEventsResult {
  status: 'processed' | 'not_linked';
  inserted: number;
}

export interface MissedWarAttackRecord {
  playerTag: string;
  playerName: string;
  attacksUsed: number;
  attacksAvailable: number;
}

export interface MissedWarAttackEventStore {
  insertMissedWarAttackEvents: (
    input: readonly MissedWarAttackEventInput[],
  ) => Promise<InsertMissedWarAttackEventsResult>;
  listMissedWarAttacksForWar?: (
    guildId: string,
    clanTag: string,
    warKey: string,
  ) => Promise<MissedWarAttackRecord[]>;
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
  setAlias: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
    alias: string;
  }) => Promise<
    | {
        status: 'updated';
        clan: { id: string; clanTag: string; name: string; alias: string | null };
      }
    | { status: 'not_found' }
  >;
  clearAlias: (input: { guildId: string; actorDiscordUserId: string; clanTag: string }) => Promise<
    | {
        status: 'cleared';
        clan: { id: string; clanTag: string; name: string; alias: string | null };
      }
    | { status: 'not_found' }
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

const clanGamesNotificationEventTypes = ['progress_delta', 'completed'];

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
  configureWarStateNotifications: (input: {
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
  disableWarStateNotifications: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
  }) => Promise<
    | { status: 'disabled'; clanName: string; clanTag: string }
    | { status: 'not_configured'; clanName: string; clanTag: string }
    | { status: 'clan_not_linked' }
  >;
  configureMissedWarAttackNotifications: (input: {
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
  disableMissedWarAttackNotifications: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
  }) => Promise<
    | { status: 'disabled'; clanName: string; clanTag: string }
    | { status: 'not_configured'; clanName: string; clanTag: string }
    | { status: 'clan_not_linked' }
  >;
  configureDonationNotifications: (input: {
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
  disableDonationNotifications: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
  }) => Promise<
    | { status: 'disabled'; clanName: string; clanTag: string }
    | { status: 'not_configured'; clanName: string; clanTag: string }
    | { status: 'clan_not_linked' }
  >;
  configureRoleChangeNotifications: (input: {
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
  disableRoleChangeNotifications: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
  }) => Promise<
    | { status: 'disabled'; clanName: string; clanTag: string }
    | { status: 'not_configured'; clanName: string; clanTag: string }
    | { status: 'clan_not_linked' }
  >;
  configureClanGamesNotifications: (input: {
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
  disableClanGamesNotifications: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
  }) => Promise<
    | { status: 'disabled'; clanName: string; clanTag: string }
    | { status: 'not_configured'; clanName: string; clanTag: string }
    | { status: 'clan_not_linked' }
  >;
}

export interface LinkPlayerInput {
  guildId: string;
  actorDiscordUserId: string;
  discordUserId: string;
  playerTag: string;
  isDefault: boolean;
}

export interface DeletePlayerLinkInput {
  guildId: string;
  actorDiscordUserId: string;
  playerTag: string;
  canDeleteOtherUsers: boolean;
}

export interface VerifyPlayerLinkInput {
  guildId: string;
  discordUserId: string;
  playerTag: string;
}

export type LinkPlayerResult =
  | { status: 'linked'; wasDefault: boolean }
  | { status: 'already_linked_to_user' }
  | { status: 'already_linked_to_other_user'; discordUserId: string }
  | { status: 'max_accounts_reached'; maxAccounts: number };

export interface PlayerLinkRecord {
  discordUserId: string;
  playerTag: string;
  isVerified: boolean;
  isDefault: boolean;
}

export type DeletePlayerLinkResult =
  | { status: 'deleted'; discordUserId: string; promotedDefaultTag: string | null }
  | { status: 'not_found' }
  | { status: 'permission_denied'; discordUserId: string };

export type VerifyPlayerLinkResult =
  | { status: 'verified'; wasDefault: boolean; transferredFromUserId?: string }
  | { status: 'max_accounts_reached'; maxAccounts: number };

export interface DatabasePlayerLinkStore {
  linkPlayer: (input: LinkPlayerInput) => Promise<LinkPlayerResult>;
  verifyPlayerLink: (input: VerifyPlayerLinkInput) => Promise<VerifyPlayerLinkResult>;
  listPlayerLinksByTags: (playerTags: readonly string[]) => Promise<PlayerLinkRecord[]>;
  listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
  deletePlayerLink: (input: DeletePlayerLinkInput) => Promise<DeletePlayerLinkResult>;
}

export const MAX_PLAYER_LINKS_PER_USER = 25;

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 10,
    prepare: false,
  });

  return drizzle(client, { schema });
}

export function createDatabasePlayerLinkStore(database: Database): DatabasePlayerLinkStore {
  return {
    verifyPlayerLink: async (input) => {
      return database.transaction(async (tx) => {
        const existingRows = await tx
          .select({
            id: schema.playerLinks.id,
            discordUserId: schema.playerLinks.discordUserId,
            isDefault: schema.playerLinks.isDefault,
          })
          .from(schema.playerLinks)
          .where(eq(schema.playerLinks.playerTag, input.playerTag));

        const existingForUser = existingRows.find(
          (row) => row.discordUserId === input.discordUserId,
        );
        const conflictingRows = existingRows.filter(
          (row) => row.discordUserId !== input.discordUserId,
        );
        const userRows = await tx
          .select({ id: schema.playerLinks.id, playerTag: schema.playerLinks.playerTag })
          .from(schema.playerLinks)
          .where(eq(schema.playerLinks.discordUserId, input.discordUserId));

        const plan = buildVerifyPlayerLinkPlan({
          existingForUser: Boolean(existingForUser),
          userLinkCount: userRows.length,
          conflictingUserIds: conflictingRows.map((row) => row.discordUserId),
        });

        if (plan.status === 'max_accounts_reached') return plan;

        const now = new Date();
        const shouldBeDefault = plan.shouldBeDefault;

        if (conflictingRows.length > 0) {
          await tx
            .delete(schema.playerLinks)
            .where(
              and(
                eq(schema.playerLinks.playerTag, input.playerTag),
                ne(schema.playerLinks.discordUserId, input.discordUserId),
              ),
            );
        }

        if (shouldBeDefault) {
          await tx
            .update(schema.playerLinks)
            .set({ isDefault: false, updatedAt: now })
            .where(eq(schema.playerLinks.discordUserId, input.discordUserId));
        }

        if (existingForUser) {
          await tx
            .update(schema.playerLinks)
            .set({
              isVerified: true,
              isDefault: existingForUser.isDefault || shouldBeDefault,
              updatedAt: now,
            })
            .where(eq(schema.playerLinks.id, existingForUser.id));
        } else {
          await tx.insert(schema.playerLinks).values({
            guildId: input.guildId,
            discordUserId: input.discordUserId,
            playerTag: input.playerTag,
            isVerified: true,
            isDefault: shouldBeDefault,
            createdAt: now,
            updatedAt: now,
          });
        }

        const transferredFromUserId = plan.transferredFromUserId;
        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.discordUserId,
          action: transferredFromUserId
            ? 'player_link_verified_transferred'
            : 'player_link_verified',
          targetType: 'player_link',
          targetId: input.playerTag,
          metadata: {
            discordUserId: input.discordUserId,
            transferredFromUserIds: conflictingRows.map((row) => row.discordUserId),
            isDefault: existingForUser?.isDefault || shouldBeDefault,
          },
          createdAt: now,
        });

        return {
          status: 'verified',
          wasDefault: existingForUser?.isDefault || shouldBeDefault,
          ...(transferredFromUserId ? { transferredFromUserId } : {}),
        };
      });
    },
    deletePlayerLink: async (input) => {
      return database.transaction(async (tx) => {
        const [link] = await tx
          .select({
            id: schema.playerLinks.id,
            discordUserId: schema.playerLinks.discordUserId,
            playerTag: schema.playerLinks.playerTag,
            isDefault: schema.playerLinks.isDefault,
          })
          .from(schema.playerLinks)
          .where(eq(schema.playerLinks.playerTag, input.playerTag))
          .limit(1);

        if (!link) return { status: 'not_found' };
        const deletingOtherUser = link.discordUserId !== input.actorDiscordUserId;
        if (deletingOtherUser && !input.canDeleteOtherUsers) {
          return { status: 'permission_denied', discordUserId: link.discordUserId };
        }

        const now = new Date();
        await tx.delete(schema.playerLinks).where(eq(schema.playerLinks.id, link.id));

        let promotedDefaultTag: string | null = null;
        if (link.isDefault) {
          const [replacement] = await tx
            .select({ id: schema.playerLinks.id, playerTag: schema.playerLinks.playerTag })
            .from(schema.playerLinks)
            .where(eq(schema.playerLinks.discordUserId, link.discordUserId))
            .orderBy(asc(schema.playerLinks.createdAt), asc(schema.playerLinks.playerTag))
            .limit(1);

          if (replacement) {
            promotedDefaultTag = replacement.playerTag;
            await tx
              .update(schema.playerLinks)
              .set({ isDefault: true, updatedAt: now })
              .where(eq(schema.playerLinks.id, replacement.id));
          }
        }

        if (deletingOtherUser) {
          await tx.insert(schema.auditLogs).values({
            guildId: input.guildId,
            actorDiscordUserId: input.actorDiscordUserId,
            action: 'player_link_deleted',
            targetType: 'player_link',
            targetId: link.playerTag,
            metadata: {
              discordUserId: link.discordUserId,
              promotedDefaultTag,
            },
            createdAt: now,
          });
        }

        return { status: 'deleted', discordUserId: link.discordUserId, promotedDefaultTag };
      });
    },
    listPlayerLinksByTags: async (playerTags) => {
      const uniqueTags = [
        ...new Set(playerTags.map((tag) => tag.trim().toUpperCase()).filter(Boolean)),
      ];
      if (uniqueTags.length === 0) return [];

      return database
        .select({
          discordUserId: schema.playerLinks.discordUserId,
          playerTag: schema.playerLinks.playerTag,
          isVerified: schema.playerLinks.isVerified,
          isDefault: schema.playerLinks.isDefault,
        })
        .from(schema.playerLinks)
        .where(inArray(schema.playerLinks.playerTag, uniqueTags));
    },
    listPlayerTagsForUser: async (guildId, discordUserId) => {
      const rows = await database
        .select({ playerTag: schema.playerLinks.playerTag })
        .from(schema.playerLinks)
        .where(
          and(
            eq(schema.playerLinks.discordUserId, discordUserId),
            or(eq(schema.playerLinks.guildId, guildId), isNull(schema.playerLinks.guildId)),
          ),
        )
        .orderBy(desc(schema.playerLinks.isDefault), asc(schema.playerLinks.createdAt));

      return rows.map((row) => row.playerTag);
    },
    linkPlayer: async (input) => {
      return database.transaction(async (tx) => {
        const [existingForTag] = await tx
          .select({
            discordUserId: schema.playerLinks.discordUserId,
            isVerified: schema.playerLinks.isVerified,
          })
          .from(schema.playerLinks)
          .where(eq(schema.playerLinks.playerTag, input.playerTag))
          .limit(1);

        if (existingForTag && existingForTag.discordUserId !== input.discordUserId) {
          return {
            status: 'already_linked_to_other_user',
            discordUserId: existingForTag.discordUserId,
          };
        }

        const rows = await tx
          .select({ id: schema.playerLinks.id, playerTag: schema.playerLinks.playerTag })
          .from(schema.playerLinks)
          .where(eq(schema.playerLinks.discordUserId, input.discordUserId));

        if (existingForTag && !input.isDefault) {
          return { status: 'already_linked_to_user' };
        }

        if (!existingForTag && rows.length >= MAX_PLAYER_LINKS_PER_USER) {
          return { status: 'max_accounts_reached', maxAccounts: MAX_PLAYER_LINKS_PER_USER };
        }

        const shouldBeDefault = input.isDefault || rows.length === 0;
        const now = new Date();

        if (shouldBeDefault) {
          await tx
            .update(schema.playerLinks)
            .set({ isDefault: false, updatedAt: now })
            .where(eq(schema.playerLinks.discordUserId, input.discordUserId));
        }

        if (existingForTag) {
          await tx
            .update(schema.playerLinks)
            .set({ isDefault: shouldBeDefault, updatedAt: now })
            .where(
              and(
                eq(schema.playerLinks.discordUserId, input.discordUserId),
                eq(schema.playerLinks.playerTag, input.playerTag),
              ),
            );
        } else {
          await tx.insert(schema.playerLinks).values({
            guildId: input.guildId,
            discordUserId: input.discordUserId,
            playerTag: input.playerTag,
            isVerified: false,
            isDefault: shouldBeDefault,
            createdAt: now,
            updatedAt: now,
          });
        }

        if (input.actorDiscordUserId !== input.discordUserId) {
          await tx.insert(schema.auditLogs).values({
            guildId: input.guildId,
            actorDiscordUserId: input.actorDiscordUserId,
            action: existingForTag ? 'player_link_default_updated' : 'player_link_created',
            targetType: 'player_link',
            targetId: input.playerTag,
            metadata: {
              discordUserId: input.discordUserId,
              isDefault: shouldBeDefault,
            },
            createdAt: now,
          });
        }

        return { status: 'linked', wasDefault: shouldBeDefault };
      });
    },
  };
}

export function createLastSeenSnapshotReader(database: Database): LastSeenSnapshotReader {
  return {
    listLastSeenSnapshots: async (guildId, playerTags) => {
      const uniqueTags = [
        ...new Set(playerTags.map((tag) => tag.trim().toUpperCase()).filter(Boolean)),
      ];
      if (uniqueTags.length === 0) return [];

      return database
        .select({
          playerTag: schema.clanMemberSnapshots.playerTag,
          playerName: schema.clanMemberSnapshots.name,
          clanTag: schema.clanMemberSnapshots.clanTag,
          clanName: schema.trackedClans.name,
          firstSeenAt: schema.clanMemberSnapshots.firstSeenAt,
          lastSeenAt: schema.clanMemberSnapshots.lastSeenAt,
          lastFetchedAt: schema.clanMemberSnapshots.lastFetchedAt,
        })
        .from(schema.clanMemberSnapshots)
        .innerJoin(
          schema.trackedClans,
          and(
            eq(schema.trackedClans.clanTag, schema.clanMemberSnapshots.clanTag),
            eq(schema.trackedClans.guildId, guildId),
            eq(schema.trackedClans.isActive, true),
          ),
        )
        .where(inArray(schema.clanMemberSnapshots.playerTag, uniqueTags))
        .orderBy(
          asc(schema.clanMemberSnapshots.playerTag),
          desc(schema.clanMemberSnapshots.lastSeenAt),
          desc(schema.clanMemberSnapshots.lastFetchedAt),
        );
    },
  };
}

export function createClanMemberSnapshotReader(database: Database): ClanMemberSnapshotReader {
  return {
    listClanMemberSnapshotsForGuild: async (input) => {
      const filters = [
        eq(schema.trackedClans.guildId, input.guildId),
        eq(schema.trackedClans.isActive, true),
      ];
      if (input.clanTag) filters.push(eq(schema.trackedClans.clanTag, input.clanTag));

      const rows = await database
        .select({
          trackedClanId: schema.trackedClans.id,
          trackedClanTag: schema.trackedClans.clanTag,
          trackedClanName: schema.trackedClans.name,
          trackedClanAlias: schema.trackedClans.alias,
          playerTag: schema.clanMemberSnapshots.playerTag,
          name: schema.clanMemberSnapshots.name,
          role: schema.clanMemberSnapshots.role,
          expLevel: schema.clanMemberSnapshots.expLevel,
          leagueId: schema.clanMemberSnapshots.leagueId,
          trophies: schema.clanMemberSnapshots.trophies,
          clanRank: schema.clanMemberSnapshots.clanRank,
          previousClanRank: schema.clanMemberSnapshots.previousClanRank,
          donations: schema.clanMemberSnapshots.donations,
          donationsReceived: schema.clanMemberSnapshots.donationsReceived,
          firstSeenAt: schema.clanMemberSnapshots.firstSeenAt,
          lastSeenAt: schema.clanMemberSnapshots.lastSeenAt,
          lastFetchedAt: schema.clanMemberSnapshots.lastFetchedAt,
        })
        .from(schema.trackedClans)
        .innerJoin(
          schema.clanMemberSnapshots,
          eq(schema.clanMemberSnapshots.clanTag, schema.trackedClans.clanTag),
        )
        .where(and(...filters))
        .orderBy(
          asc(schema.trackedClans.sortOrder),
          asc(schema.trackedClans.name),
          asc(schema.trackedClans.clanTag),
          asc(schema.clanMemberSnapshots.clanRank),
          asc(schema.clanMemberSnapshots.name),
          asc(schema.clanMemberSnapshots.playerTag),
        );

      const byClan = new Map<string, ClanMemberSnapshotListResult>();
      for (const row of rows) {
        const clan = byClan.get(row.trackedClanId) ?? {
          clan: {
            id: row.trackedClanId,
            clanTag: row.trackedClanTag,
            name: row.trackedClanName,
            alias: row.trackedClanAlias,
          },
          members: [],
        };
        clan.members.push({
          playerTag: row.playerTag,
          name: row.name,
          role: row.role,
          expLevel: row.expLevel,
          leagueId: row.leagueId,
          trophies: row.trophies,
          clanRank: row.clanRank,
          previousClanRank: row.previousClanRank,
          donations: row.donations,
          donationsReceived: row.donationsReceived,
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          lastFetchedAt: row.lastFetchedAt,
        });
        byClan.set(row.trackedClanId, clan);
      }

      return [...byClan.values()];
    },
  };
}

export function createDonationSnapshotReader(database: Database): DonationSnapshotReader {
  return {
    listDonationSnapshotsForGuild: async (input) => {
      const snapshots =
        await createClanMemberSnapshotReader(database).listClanMemberSnapshotsForGuild(input);

      return snapshots.map((snapshot) => ({
        clan: snapshot.clan,
        members: snapshot.members.map((member) => ({
          playerTag: member.playerTag,
          name: member.name,
          donations: member.donations,
          donationsReceived: member.donationsReceived,
          lastFetchedAt: member.lastFetchedAt,
        })),
      }));
    },
  };
}

export function createDonationHistoryReader(database: Database): DonationHistoryReader {
  return {
    listDonationHistoryForGuild: async (input) => {
      const since = input.since ?? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
      const filters = [
        eq(schema.clanDonationEvents.guildId, input.guildId),
        eq(schema.trackedClans.guildId, input.guildId),
        eq(schema.trackedClans.isActive, true),
        gte(schema.clanDonationEvents.detectedAt, since),
      ];

      if (input.clanTags?.length) {
        filters.push(inArray(schema.clanDonationEvents.clanTag, [...input.clanTags]));
      }
      if (input.playerTags?.length) {
        filters.push(inArray(schema.clanDonationEvents.playerTag, [...input.playerTags]));
      }

      const rows = await database
        .select({
          playerTag: schema.clanDonationEvents.playerTag,
          playerName: sql<string>`max(${schema.clanDonationEvents.playerName})`,
          donated: sql<number>`coalesce(sum(${schema.clanDonationEvents.donationDelta}), 0)`,
          received: sql<number>`coalesce(sum(${schema.clanDonationEvents.receivedDelta}), 0)`,
          eventCount: count(schema.clanDonationEvents.id),
          lastDetectedAt: sql<Date>`max(${schema.clanDonationEvents.detectedAt})`,
        })
        .from(schema.clanDonationEvents)
        .innerJoin(
          schema.trackedClans,
          eq(schema.trackedClans.id, schema.clanDonationEvents.trackedClanId),
        )
        .where(and(...filters))
        .groupBy(schema.clanDonationEvents.playerTag)
        .orderBy(
          desc(sql<number>`coalesce(sum(${schema.clanDonationEvents.donationDelta}), 0)`),
          asc(schema.clanDonationEvents.playerTag),
        );

      return rows.map((row) => ({
        playerTag: row.playerTag,
        playerName: row.playerName,
        donated: Number(row.donated),
        received: Number(row.received),
        eventCount: Number(row.eventCount),
        lastDetectedAt: row.lastDetectedAt,
      }));
    },
  };
}

export function createWarAttackHistoryReader(database: Database): WarAttackHistoryReader {
  return {
    listWarAttackHistoryForGuild: async (input) => {
      const since = input.since ?? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
      const filters = [
        eq(schema.warAttackEvents.guildId, input.guildId),
        eq(schema.trackedClans.guildId, input.guildId),
        eq(schema.trackedClans.isActive, true),
        gte(schema.warAttackEvents.detectedAt, since),
      ];

      if (input.clanTags?.length) {
        filters.push(inArray(schema.warAttackEvents.clanTag, [...input.clanTags]));
      }
      if (input.attackerTags?.length) {
        filters.push(inArray(schema.warAttackEvents.attackerTag, [...input.attackerTags]));
      }

      const rows = await database
        .select({
          attackerTag: schema.warAttackEvents.attackerTag,
          attackerName: sql<string | null>`max(${schema.clanMemberSnapshots.name})`,
          attackCount: count(schema.warAttackEvents.id),
          totalStars: sql<number>`coalesce(sum(${schema.warAttackEvents.stars}), 0)`,
          averageStars: sql<number>`coalesce(avg(${schema.warAttackEvents.stars}), 0)`,
          totalDestruction: sql<number>`coalesce(sum(${schema.warAttackEvents.destructionPercentage}), 0)`,
          averageDestruction: sql<number>`coalesce(avg(${schema.warAttackEvents.destructionPercentage}), 0)`,
          freshAttackCount: sql<number>`coalesce(sum(case when ${schema.warAttackEvents.freshAttack} then 1 else 0 end), 0)`,
          lastAttackedAt: sql<Date>`max(${schema.warAttackEvents.occurredAt})`,
        })
        .from(schema.warAttackEvents)
        .innerJoin(
          schema.trackedClans,
          eq(schema.trackedClans.id, schema.warAttackEvents.trackedClanId),
        )
        .leftJoin(
          schema.clanMemberSnapshots,
          and(
            eq(schema.clanMemberSnapshots.clanTag, schema.warAttackEvents.clanTag),
            eq(schema.clanMemberSnapshots.playerTag, schema.warAttackEvents.attackerTag),
          ),
        )
        .where(and(...filters))
        .groupBy(schema.warAttackEvents.attackerTag)
        .orderBy(
          desc(sql<number>`coalesce(sum(${schema.warAttackEvents.stars}), 0)`),
          desc(count(schema.warAttackEvents.id)),
          asc(schema.warAttackEvents.attackerTag),
        );

      return rows.map((row) => ({
        attackerTag: row.attackerTag,
        attackerName: row.attackerName,
        attackCount: Number(row.attackCount),
        totalStars: Number(row.totalStars),
        averageStars: Number(row.averageStars),
        totalDestruction: Number(row.totalDestruction),
        averageDestruction: Number(row.averageDestruction),
        freshAttackCount: Number(row.freshAttackCount),
        lastAttackedAt: row.lastAttackedAt,
      }));
    },
  };
}

export function createClanMemberJoinLeaveHistoryReader(
  database: Database,
): ClanMemberJoinLeaveHistoryReader {
  return {
    listClanMemberJoinLeaveHistoryForGuild: async (input) => {
      const since = input.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const filters = [
        eq(schema.clanMemberEvents.guildId, input.guildId),
        eq(schema.trackedClans.guildId, input.guildId),
        eq(schema.trackedClans.isActive, true),
        inArray(schema.clanMemberEvents.eventType, [...CLAN_MEMBER_JOIN_LEAVE_EVENT_TYPES]),
        gte(schema.clanMemberEvents.detectedAt, since),
      ];

      if (input.clanTags?.length) {
        filters.push(inArray(schema.clanMemberEvents.clanTag, [...input.clanTags]));
      }
      if (input.playerTags?.length) {
        filters.push(inArray(schema.clanMemberEvents.playerTag, [...input.playerTags]));
      }

      const rows = await database
        .select({
          playerTag: schema.clanMemberEvents.playerTag,
          playerName: schema.clanMemberEvents.playerName,
          clanTag: schema.clanMemberEvents.clanTag,
          clanName: schema.trackedClans.name,
          eventType: schema.clanMemberEvents.eventType,
          occurredAt: schema.clanMemberEvents.occurredAt,
          detectedAt: schema.clanMemberEvents.detectedAt,
        })
        .from(schema.clanMemberEvents)
        .innerJoin(
          schema.trackedClans,
          eq(schema.trackedClans.id, schema.clanMemberEvents.trackedClanId),
        )
        .where(and(...filters))
        .orderBy(
          desc(schema.clanMemberEvents.occurredAt),
          desc(schema.clanMemberEvents.detectedAt),
          desc(schema.clanMemberEvents.id),
        );

      return rows.map((row) => ({
        playerTag: row.playerTag,
        playerName: row.playerName,
        clanTag: row.clanTag,
        clanName: row.clanName,
        eventType: row.eventType === 'left' ? 'left' : 'joined',
        occurredAt: row.occurredAt,
        detectedAt: row.detectedAt,
      }));
    },
  };
}

export interface PlayerLinkDefaultPromotionCandidate {
  playerTag: string;
  createdAt: Date;
}

export interface VerifyPlayerLinkPlanInput {
  existingForUser: boolean;
  userLinkCount: number;
  conflictingUserIds: readonly string[];
}

export type VerifyPlayerLinkPlan =
  | { status: 'verify'; shouldBeDefault: boolean; transferredFromUserId: string | null }
  | { status: 'max_accounts_reached'; maxAccounts: number };

export function buildVerifyPlayerLinkPlan(input: VerifyPlayerLinkPlanInput): VerifyPlayerLinkPlan {
  if (!input.existingForUser && input.userLinkCount >= MAX_PLAYER_LINKS_PER_USER) {
    return { status: 'max_accounts_reached', maxAccounts: MAX_PLAYER_LINKS_PER_USER };
  }

  return {
    status: 'verify',
    shouldBeDefault: input.userLinkCount === 0,
    transferredFromUserId: input.conflictingUserIds[0] ?? null,
  };
}

export function selectPlayerLinkDefaultPromotion(
  candidates: readonly PlayerLinkDefaultPromotionCandidate[],
): string | null {
  const [selected] = [...candidates].sort((left, right) => {
    const createdAtComparison = left.createdAt.getTime() - right.createdAt.getTime();
    if (createdAtComparison !== 0) return createdAtComparison;
    return left.playerTag.localeCompare(right.playerTag);
  });

  return selected?.playerTag ?? null;
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

const MAX_RECENT_USAGE_METRICS_LIMIT = 365;

function validateRecentUsageMetricsLimit(limit: number): number {
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error('Database usage metrics limit must be a finite positive integer.');
  }
  if (limit > MAX_RECENT_USAGE_METRICS_LIMIT) {
    throw new Error(
      `Database usage metrics limit must be between 1 and ${MAX_RECENT_USAGE_METRICS_LIMIT}.`,
    );
  }

  return limit;
}

export function createDatabaseUsageMetrics(database: Database): DatabaseUsageMetrics {
  return {
    listRecentDailyUsage: async (limit) => {
      const validatedLimit = validateRecentUsageMetricsLimit(limit);
      const rows = await database
        .select({
          date: schema.commandUsageDaily.usageDate,
          uses: sql<number>`coalesce(sum(${schema.commandUsageDaily.usageCount}), 0)`,
        })
        .from(schema.commandUsageDaily)
        .groupBy(schema.commandUsageDaily.usageDate)
        .orderBy(desc(schema.commandUsageDaily.usageDate))
        .limit(validatedLimit);

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
      const validatedLimit = validateRecentUsageMetricsLimit(limit);
      return database
        .select({
          date: schema.botGrowthDaily.usageDate,
          guildAdditions: schema.botGrowthDaily.guildAdditions,
          guildDeletions: schema.botGrowthDaily.guildDeletions,
        })
        .from(schema.botGrowthDaily)
        .orderBy(desc(schema.botGrowthDaily.usageDate))
        .limit(validatedLimit);
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
      const linkedPlayerRows = await database
        .select({
          resourceId: schema.playerLinks.playerTag,
        })
        .from(schema.playerLinks);
      const clanGamesMemberRows = await database
        .select({
          resourceId: schema.clanMemberSnapshots.playerTag,
        })
        .from(schema.clanMemberSnapshots)
        .innerJoin(
          schema.clanLatestSnapshots,
          eq(schema.clanLatestSnapshots.clanTag, schema.clanMemberSnapshots.clanTag),
        )
        .innerJoin(
          schema.trackedClans,
          and(
            eq(schema.trackedClans.clanTag, schema.clanMemberSnapshots.clanTag),
            eq(schema.trackedClans.isActive, true),
          ),
        )
        .innerJoin(
          schema.clanGamesNotificationConfigs,
          and(
            eq(schema.clanGamesNotificationConfigs.trackedClanId, schema.trackedClans.id),
            eq(schema.clanGamesNotificationConfigs.isEnabled, true),
            inArray(schema.clanGamesNotificationConfigs.eventType, clanGamesNotificationEventTypes),
          ),
        )
        .where(gte(schema.clanMemberSnapshots.lastSeenAt, schema.clanLatestSnapshots.fetchedAt));
      return syncPollingLeasesForType(
        database,
        'player',
        buildPollingEnrollmentResourceIds([...linkedPlayerRows, ...clanGamesMemberRows]),
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
          return {
            status: 'not_linked',
            joined: 0,
            left: 0,
            donationEvents: 0,
            roleChangeEvents: 0,
          };
        }

        const previousMembers = await tx
          .select({
            playerTag: schema.clanMemberSnapshots.playerTag,
            name: schema.clanMemberSnapshots.name,
            role: schema.clanMemberSnapshots.role,
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
        let roleChangeEvents = 0;

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

        const insertRoleChangeEvents = async (event: {
          playerTag: string;
          playerName: string;
          previousRole: string | null;
          currentRole: string | null;
          previousSnapshot: unknown;
          currentSnapshot: unknown;
        }) => {
          const rows = await tx
            .insert(schema.clanRoleChangeEvents)
            .values(
              linkedClans.map((linkedClan) => ({
                guildId: linkedClan.guildId,
                trackedClanId: linkedClan.id,
                clanTag,
                playerTag: event.playerTag,
                playerName: event.playerName,
                eventKey: buildClanRoleChangeEventKey({
                  clanTag,
                  playerTag: event.playerTag,
                  previousRole: event.previousRole,
                  currentRole: event.currentRole,
                  eventAt: fetchedAt,
                }),
                previousRole: event.previousRole,
                currentRole: event.currentRole,
                previousSnapshot: event.previousSnapshot,
                currentSnapshot: event.currentSnapshot,
                sourceFetchedAt: fetchedAt,
                occurredAt: fetchedAt,
                detectedAt: fetchedAt,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: schema.clanRoleChangeEvents.id });
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
            const roleChangeEvent = computeClanRoleChangeDeltaEvent({
              previousRole: previousMember.role,
              currentRole: member.role,
            });
            if (roleChangeEvent) {
              roleChangeEvents += await insertRoleChangeEvents({
                playerTag: member.playerTag,
                playerName: member.name,
                previousRole: roleChangeEvent.previousRole,
                currentRole: roleChangeEvent.currentRole,
                previousSnapshot: previousMember.rawMember,
                currentSnapshot: member.rawMember,
              });
            }

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

        return { status: 'processed', joined, left, donationEvents, roleChangeEvents };
      });
    },
  };
}

export function createClanGamesEventStore(database: Database): ClanGamesEventStore {
  return {
    processClanGamesProgress: async (input) => {
      const normalized = normalizeClanGamesProgressInput(input);

      return database.transaction(async (tx) => {
        const linkedClans = await tx
          .select({ id: schema.trackedClans.id, guildId: schema.trackedClans.guildId })
          .from(schema.trackedClans)
          .where(
            and(
              eq(schema.trackedClans.clanTag, normalized.clanTag),
              eq(schema.trackedClans.isActive, true),
            ),
          );

        if (linkedClans.length === 0) {
          return {
            status: 'not_linked',
            baselinesCreated: 0,
            progressEvents: 0,
            completedEvents: 0,
            clanSnapshots: 0,
          };
        }

        const previousRows =
          normalized.players.length > 0
            ? await tx
                .select({
                  playerTag: schema.clanGamesSeasonSnapshots.playerTag,
                  playerName: schema.clanGamesSeasonSnapshots.playerName,
                  initialPoints: schema.clanGamesSeasonSnapshots.initialPoints,
                  currentPoints: schema.clanGamesSeasonSnapshots.currentPoints,
                  pointsDelta: schema.clanGamesSeasonSnapshots.pointsDelta,
                  completedAt: schema.clanGamesSeasonSnapshots.completedAt,
                  rawPlayer: schema.clanGamesSeasonSnapshots.rawPlayer,
                })
                .from(schema.clanGamesSeasonSnapshots)
                .where(
                  and(
                    eq(schema.clanGamesSeasonSnapshots.seasonId, normalized.seasonId),
                    inArray(
                      schema.clanGamesSeasonSnapshots.playerTag,
                      normalized.players.map((player) => player.playerTag),
                    ),
                  ),
                )
            : [];
        const previousByTag = new Map(previousRows.map((row) => [row.playerTag, row]));

        let baselinesCreated = 0;
        let progressEvents = 0;
        let completedEvents = 0;
        const members: ClanGamesClanSnapshotMember[] = [];

        for (const player of normalized.players) {
          const previous = previousByTag.get(player.playerTag);
          if (!previous) {
            baselinesCreated += 1;
            await tx
              .insert(schema.clanGamesSeasonSnapshots)
              .values({
                seasonId: normalized.seasonId,
                playerTag: player.playerTag,
                playerName: player.playerName,
                initialPoints: player.currentAchievementValue,
                currentPoints: player.currentAchievementValue,
                pointsDelta: 0,
                firstSeenAt: normalized.fetchedAt,
                lastSeenAt: normalized.fetchedAt,
                lastFetchedAt: normalized.fetchedAt,
                rawPlayer: player.rawPlayer,
                updatedAt: normalized.fetchedAt,
              })
              .onConflictDoNothing();
            members.push({ playerTag: player.playerTag, playerName: player.playerName, points: 0 });
            continue;
          }

          const delta = computeClanGamesProgressDelta({
            initialPoints: previous.initialPoints,
            previousCurrentPoints: previous.currentPoints,
            currentAchievementValue: player.currentAchievementValue,
            eventMaxPoints: normalized.eventMaxPoints,
            wasCompleted: previous.completedAt !== null,
          });

          if (delta.pointsIncrease > 0) {
            progressEvents += await insertClanGamesEvents(tx, {
              linkedClans,
              clanTag: normalized.clanTag,
              seasonId: normalized.seasonId,
              eventType: 'progress_delta',
              playerTag: player.playerTag,
              playerName: player.playerName,
              previousPoints: delta.previousEventPoints,
              currentPoints: delta.currentEventPoints,
              pointsDelta: delta.pointsIncrease,
              eventMaxPoints: normalized.eventMaxPoints,
              previousSnapshot: previous.rawPlayer,
              currentSnapshot: player.rawPlayer,
              fetchedAt: normalized.fetchedAt,
            });
          }

          if (delta.completed) {
            completedEvents += await insertClanGamesEvents(tx, {
              linkedClans,
              clanTag: normalized.clanTag,
              seasonId: normalized.seasonId,
              eventType: 'completed',
              playerTag: player.playerTag,
              playerName: player.playerName,
              previousPoints: delta.previousEventPoints,
              currentPoints: delta.currentEventPoints,
              pointsDelta: delta.pointsIncrease,
              eventMaxPoints: normalized.eventMaxPoints,
              previousSnapshot: previous.rawPlayer,
              currentSnapshot: player.rawPlayer,
              fetchedAt: normalized.fetchedAt,
            });
          }

          await tx
            .update(schema.clanGamesSeasonSnapshots)
            .set({
              playerName: player.playerName,
              currentPoints: player.currentAchievementValue,
              pointsDelta: delta.currentEventPoints,
              completedAt: delta.completed ? normalized.fetchedAt : previous.completedAt,
              lastSeenAt: normalized.fetchedAt,
              lastFetchedAt: normalized.fetchedAt,
              rawPlayer: player.rawPlayer,
              updatedAt: normalized.fetchedAt,
            })
            .where(
              and(
                eq(schema.clanGamesSeasonSnapshots.seasonId, normalized.seasonId),
                eq(schema.clanGamesSeasonSnapshots.playerTag, player.playerTag),
              ),
            );
          members.push({
            playerTag: player.playerTag,
            playerName: player.playerName,
            points: delta.currentEventPoints,
          });
        }

        const existingClanSnapshots = await tx
          .select({
            guildId: schema.clanGamesClanSnapshots.guildId,
            snapshot: schema.clanGamesClanSnapshots.snapshot,
          })
          .from(schema.clanGamesClanSnapshots)
          .where(
            and(
              eq(schema.clanGamesClanSnapshots.clanTag, normalized.clanTag),
              eq(schema.clanGamesClanSnapshots.seasonId, normalized.seasonId),
              inArray(
                schema.clanGamesClanSnapshots.guildId,
                linkedClans.map((linkedClan) => linkedClan.guildId),
              ),
            ),
          );
        const existingClanSnapshotsByGuild = new Map(
          existingClanSnapshots.map((row) => [row.guildId, row.snapshot]),
        );

        const clanSnapshotRows = await tx
          .insert(schema.clanGamesClanSnapshots)
          .values(
            linkedClans.map((linkedClan) => {
              const snapshot = buildClanGamesClanSnapshot({
                seasonId: normalized.seasonId,
                eventMaxPoints: normalized.eventMaxPoints,
                fetchedAt: normalized.fetchedAt,
                members: mergeClanGamesClanSnapshotMembers({
                  existingMembers: parseClanGamesClanSnapshotMembers(
                    existingClanSnapshotsByGuild.get(linkedClan.guildId),
                  ),
                  currentMembers: members,
                }),
              });

              return {
                guildId: linkedClan.guildId,
                trackedClanId: linkedClan.id,
                clanTag: normalized.clanTag,
                seasonId: normalized.seasonId,
                snapshot,
                sourceFetchedAt: normalized.fetchedAt,
                updatedAt: normalized.fetchedAt,
              };
            }),
          )
          .onConflictDoUpdate({
            target: [
              schema.clanGamesClanSnapshots.guildId,
              schema.clanGamesClanSnapshots.clanTag,
              schema.clanGamesClanSnapshots.seasonId,
            ],
            set: {
              snapshot: sql`excluded.snapshot`,
              sourceFetchedAt: normalized.fetchedAt,
              updatedAt: normalized.fetchedAt,
            },
          })
          .returning({ id: schema.clanGamesClanSnapshots.id });

        return {
          status: 'processed',
          baselinesCreated,
          progressEvents,
          completedEvents,
          clanSnapshots: clanSnapshotRows.length,
        };
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
    fanOutWarStateEventNotifications: async (input = {}) => {
      return database.transaction(async (tx) => {
        return fanOutWarStateEventNotificationsWithCursor(
          createWarStateNotificationFanOutRepository(tx),
          input,
        );
      });
    },
    fanOutMissedWarAttackEventNotifications: async (input = {}) => {
      return database.transaction(async (tx) => {
        return fanOutMissedWarAttackEventNotificationsWithCursor(
          createMissedWarAttackNotificationFanOutRepository(tx),
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
    fanOutClanRoleChangeEventNotifications: async (input = {}) => {
      return database.transaction(async (tx) => {
        return fanOutClanRoleChangeEventNotificationsWithCursor(
          createClanRoleChangeNotificationFanOutRepository(tx),
          input,
        );
      });
    },
    fanOutClanGamesEventNotifications: async (input = {}) => {
      return database.transaction(async (tx) => {
        return fanOutClanGamesEventNotificationsWithCursor(
          createClanGamesNotificationFanOutRepository(tx),
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

export async function fanOutWarStateEventNotificationsWithCursor(
  repository: WarStateNotificationFanOutRepository,
  input: FanOutWarStateEventNotificationsInput = {},
): Promise<FanOutWarStateEventNotificationsResult> {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('War state notification fan-out limit must be between 1 and 1000.');
  }
  const now = input.now ?? new Date();

  await repository.ensureCursor({
    cursorName: WAR_STATE_NOTIFICATION_FANOUT_CURSOR_NAME,
    sourceType: WAR_STATE_NOTIFICATION_FANOUT_SOURCE_TYPE,
    now,
  });

  const cursor = await repository.lockCursor(WAR_STATE_NOTIFICATION_FANOUT_CURSOR_NAME);
  if (!cursor) return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };

  const listEventsInput: ListWarStateEventsAfterFanOutCursorInput = { cursor, limit };
  if (input.since) listEventsInput.since = input.since;
  const events = await repository.listEventsAfterCursor(listEventsInput);

  if (events.length === 0) {
    await repository.advanceCursor({ cursorName: WAR_STATE_NOTIFICATION_FANOUT_CURSOR_NAME, now });
    return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };
  }

  const targets = await repository.listTargetsForEvents(events.map((event) => event.eventId));
  const insertedOutboxEntries =
    targets.length > 0
      ? await repository.insertOutboxEntries(buildWarStateNotificationOutboxValues(targets, now))
      : 0;
  const lastEvent = events.at(-1);
  if (!lastEvent) throw new Error('War state notification fan-out lost its event cursor.');

  await repository.advanceCursor({
    cursorName: WAR_STATE_NOTIFICATION_FANOUT_CURSOR_NAME,
    lastDetectedAt: lastEvent.detectedAt,
    lastEventId: lastEvent.eventId,
    now,
  });

  return { eventsScanned: events.length, matchedTargets: targets.length, insertedOutboxEntries };
}

export async function fanOutMissedWarAttackEventNotificationsWithCursor(
  repository: MissedWarAttackNotificationFanOutRepository,
  input: FanOutMissedWarAttackEventNotificationsInput = {},
): Promise<FanOutMissedWarAttackEventNotificationsResult> {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Missed war attack notification fan-out limit must be between 1 and 1000.');
  }
  const now = input.now ?? new Date();

  await repository.ensureCursor({
    cursorName: MISSED_WAR_ATTACK_NOTIFICATION_FANOUT_CURSOR_NAME,
    sourceType: MISSED_WAR_ATTACK_NOTIFICATION_FANOUT_SOURCE_TYPE,
    now,
  });

  const cursor = await repository.lockCursor(MISSED_WAR_ATTACK_NOTIFICATION_FANOUT_CURSOR_NAME);
  if (!cursor) return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };

  const listEventsInput: ListMissedWarAttackEventsAfterFanOutCursorInput = { cursor, limit };
  if (input.since) listEventsInput.since = input.since;
  const events = await repository.listEventsAfterCursor(listEventsInput);

  if (events.length === 0) {
    await repository.advanceCursor({
      cursorName: MISSED_WAR_ATTACK_NOTIFICATION_FANOUT_CURSOR_NAME,
      now,
    });
    return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };
  }

  const targets = await repository.listTargetsForEvents(events.map((event) => event.eventId));
  const insertedOutboxEntries =
    targets.length > 0
      ? await repository.insertOutboxEntries(
          buildMissedWarAttackNotificationOutboxValues(targets, now),
        )
      : 0;
  const lastEvent = events.at(-1);
  if (!lastEvent) throw new Error('Missed war attack notification fan-out lost its event cursor.');

  await repository.advanceCursor({
    cursorName: MISSED_WAR_ATTACK_NOTIFICATION_FANOUT_CURSOR_NAME,
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

export async function fanOutClanRoleChangeEventNotificationsWithCursor(
  repository: ClanRoleChangeNotificationFanOutRepository,
  input: FanOutClanRoleChangeEventNotificationsInput = {},
): Promise<FanOutClanRoleChangeEventNotificationsResult> {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Clan role change notification fan-out limit must be between 1 and 1000.');
  }
  const now = input.now ?? new Date();

  await repository.ensureCursor({
    cursorName: CLAN_ROLE_CHANGE_NOTIFICATION_FANOUT_CURSOR_NAME,
    sourceType: CLAN_ROLE_CHANGE_NOTIFICATION_FANOUT_SOURCE_TYPE,
    now,
  });

  const cursor = await repository.lockCursor(CLAN_ROLE_CHANGE_NOTIFICATION_FANOUT_CURSOR_NAME);
  if (!cursor) return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };

  const listEventsInput: ListClanRoleChangeEventsAfterFanOutCursorInput = { cursor, limit };
  if (input.since) listEventsInput.since = input.since;
  const events = await repository.listEventsAfterCursor(listEventsInput);

  if (events.length === 0) {
    await repository.advanceCursor({
      cursorName: CLAN_ROLE_CHANGE_NOTIFICATION_FANOUT_CURSOR_NAME,
      now,
    });
    return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };
  }

  const targets = await repository.listTargetsForEvents(events.map((event) => event.eventId));
  const insertedOutboxEntries =
    targets.length > 0
      ? await repository.insertOutboxEntries(
          buildClanRoleChangeNotificationOutboxValues(targets, now),
        )
      : 0;
  const lastEvent = events.at(-1);
  if (!lastEvent) throw new Error('Clan role change notification fan-out lost its event cursor.');

  await repository.advanceCursor({
    cursorName: CLAN_ROLE_CHANGE_NOTIFICATION_FANOUT_CURSOR_NAME,
    lastDetectedAt: lastEvent.detectedAt,
    lastEventId: lastEvent.eventId,
    now,
  });

  return { eventsScanned: events.length, matchedTargets: targets.length, insertedOutboxEntries };
}

export async function fanOutClanGamesEventNotificationsWithCursor(
  repository: ClanGamesNotificationFanOutRepository,
  input: FanOutClanGamesEventNotificationsInput = {},
): Promise<FanOutClanGamesEventNotificationsResult> {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Clan Games notification fan-out limit must be between 1 and 1000.');
  }
  const now = input.now ?? new Date();

  await repository.ensureCursor({
    cursorName: CLAN_GAMES_NOTIFICATION_FANOUT_CURSOR_NAME,
    sourceType: CLAN_GAMES_NOTIFICATION_FANOUT_SOURCE_TYPE,
    now,
  });

  const cursor = await repository.lockCursor(CLAN_GAMES_NOTIFICATION_FANOUT_CURSOR_NAME);
  if (!cursor) return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };

  const listEventsInput: ListClanGamesEventsAfterFanOutCursorInput = { cursor, limit };
  if (input.since) listEventsInput.since = input.since;
  const events = await repository.listEventsAfterCursor(listEventsInput);

  if (events.length === 0) {
    await repository.advanceCursor({ cursorName: CLAN_GAMES_NOTIFICATION_FANOUT_CURSOR_NAME, now });
    return { eventsScanned: 0, matchedTargets: 0, insertedOutboxEntries: 0 };
  }

  const targets = await repository.listTargetsForEvents(events.map((event) => event.eventId));
  const insertedOutboxEntries =
    targets.length > 0
      ? await repository.insertOutboxEntries(buildClanGamesNotificationOutboxValues(targets, now))
      : 0;
  const lastEvent = events.at(-1);
  if (!lastEvent) throw new Error('Clan Games notification fan-out lost its event cursor.');

  await repository.advanceCursor({
    cursorName: CLAN_GAMES_NOTIFICATION_FANOUT_CURSOR_NAME,
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

export function buildWarStateNotificationOutboxValues(
  targets: readonly WarStateNotificationFanOutTarget[],
  now: Date,
): NotificationOutboxInsertValue[] {
  return targets.map((target) => ({
    guildId: target.guildId,
    configId: null,
    warAttackConfigId: null,
    warStateConfigId: target.configId,
    sourceType: 'war_state_event',
    sourceId: target.eventId,
    idempotencyKey: buildNotificationOutboxIdempotencyKey({
      guildId: target.guildId,
      sourceType: 'war_state_event',
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
      previousState: target.previousState,
      currentState: target.currentState,
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

export function buildClanRoleChangeNotificationOutboxValues(
  targets: readonly ClanRoleChangeNotificationFanOutTarget[],
  now: Date,
): NotificationOutboxInsertValue[] {
  return targets.map((target) => ({
    guildId: target.guildId,
    configId: null,
    warAttackConfigId: null,
    warStateConfigId: null,
    missedWarAttackConfigId: null,
    clanDonationConfigId: null,
    clanRoleChangeConfigId: target.configId,
    sourceType: 'clan_role_change_event',
    sourceId: target.eventId,
    idempotencyKey: buildNotificationOutboxIdempotencyKey({
      guildId: target.guildId,
      sourceType: 'clan_role_change_event',
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
      previousRole: target.previousRole,
      currentRole: target.currentRole,
      occurredAt: target.occurredAt.toISOString(),
      detectedAt: target.detectedAt.toISOString(),
    },
    attempts: 0,
    nextAttemptAt: now,
    updatedAt: now,
  }));
}

export function buildClanGamesNotificationOutboxValues(
  targets: readonly ClanGamesNotificationFanOutTarget[],
  now: Date,
): NotificationOutboxInsertValue[] {
  return targets.map((target) => ({
    guildId: target.guildId,
    configId: null,
    warAttackConfigId: null,
    warStateConfigId: null,
    missedWarAttackConfigId: null,
    clanDonationConfigId: null,
    clanRoleChangeConfigId: null,
    clanGamesConfigId: target.configId,
    sourceType: 'clan_games_event',
    sourceId: target.eventId,
    idempotencyKey: buildNotificationOutboxIdempotencyKey({
      guildId: target.guildId,
      sourceType: 'clan_games_event',
      sourceId: target.eventId,
      targetType: 'discord_channel',
      targetId: target.discordChannelId,
    }),
    targetType: 'discord_channel',
    targetId: target.discordChannelId,
    status: 'pending',
    payload: {
      clanTag: target.clanTag,
      seasonId: target.seasonId,
      eventType: target.eventType,
      eventKey: target.eventKey,
      playerTag: target.playerTag,
      playerName: target.playerName,
      previousPoints: target.previousPoints,
      currentPoints: target.currentPoints,
      pointsDelta: target.pointsDelta,
      eventMaxPoints: target.eventMaxPoints,
      occurredAt: target.occurredAt.toISOString(),
      detectedAt: target.detectedAt.toISOString(),
    },
    attempts: 0,
    nextAttemptAt: now,
    updatedAt: now,
  }));
}

export function buildMissedWarAttackNotificationOutboxValues(
  targets: readonly MissedWarAttackNotificationFanOutTarget[],
  now: Date,
): NotificationOutboxInsertValue[] {
  return targets.map((target) => ({
    guildId: target.guildId,
    configId: null,
    warAttackConfigId: null,
    warStateConfigId: null,
    missedWarAttackConfigId: target.configId,
    sourceType: 'missed_war_attack_event',
    sourceId: target.eventId,
    idempotencyKey: buildNotificationOutboxIdempotencyKey({
      guildId: target.guildId,
      sourceType: 'missed_war_attack_event',
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
      playerTag: target.playerTag,
      playerName: target.playerName,
      attacksUsed: target.attacksUsed,
      attacksAvailable: target.attacksAvailable,
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

function createWarStateNotificationFanOutRepository(
  tx: DatabaseTransaction,
): WarStateNotificationFanOutRepository {
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
      const cursorPredicate = buildWarStateFanOutCursorPredicate(input.cursor);
      const sincePredicate = input.since
        ? gte(schema.warStateEvents.detectedAt, input.since)
        : sql<boolean>`true`;

      return tx
        .select({
          eventId: schema.warStateEvents.id,
          guildId: schema.warStateEvents.guildId,
          trackedClanId: schema.warStateEvents.trackedClanId,
          clanTag: schema.warStateEvents.clanTag,
          warKey: schema.warStateEvents.warKey,
          eventKey: schema.warStateEvents.eventKey,
          previousState: schema.warStateEvents.previousState,
          currentState: schema.warStateEvents.currentState,
          occurredAt: schema.warStateEvents.occurredAt,
          detectedAt: schema.warStateEvents.detectedAt,
        })
        .from(schema.warStateEvents)
        .where(and(cursorPredicate, sincePredicate))
        .orderBy(asc(schema.warStateEvents.detectedAt), asc(schema.warStateEvents.id))
        .limit(input.limit);
    },
    listTargetsForEvents: async (eventIds) => {
      if (eventIds.length === 0) return [];
      return tx
        .select({
          eventId: schema.warStateEvents.id,
          guildId: schema.warStateEvents.guildId,
          clanTag: schema.warStateEvents.clanTag,
          warKey: schema.warStateEvents.warKey,
          eventKey: schema.warStateEvents.eventKey,
          previousState: schema.warStateEvents.previousState,
          currentState: schema.warStateEvents.currentState,
          occurredAt: schema.warStateEvents.occurredAt,
          detectedAt: schema.warStateEvents.detectedAt,
          configId: schema.warStateNotificationConfigs.id,
          discordChannelId: schema.warStateNotificationConfigs.discordChannelId,
        })
        .from(schema.warStateEvents)
        .innerJoin(
          schema.warStateNotificationConfigs,
          and(
            eq(schema.warStateNotificationConfigs.guildId, schema.warStateEvents.guildId),
            eq(
              schema.warStateNotificationConfigs.trackedClanId,
              schema.warStateEvents.trackedClanId,
            ),
            eq(schema.warStateNotificationConfigs.eventType, 'war_state'),
            eq(schema.warStateNotificationConfigs.isEnabled, true),
            lte(schema.warStateNotificationConfigs.createdAt, schema.warStateEvents.detectedAt),
          ),
        )
        .where(inArray(schema.warStateEvents.id, [...eventIds]))
        .orderBy(
          asc(schema.warStateEvents.detectedAt),
          asc(schema.warStateEvents.id),
          asc(schema.warStateNotificationConfigs.discordChannelId),
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

function buildWarStateFanOutCursorPredicate(cursor: NotificationFanOutCursorState) {
  if (!cursor.lastDetectedAt) return sql<boolean>`true`;
  if (!cursor.lastEventId) return gt(schema.warStateEvents.detectedAt, cursor.lastDetectedAt);

  return (
    or(
      gt(schema.warStateEvents.detectedAt, cursor.lastDetectedAt),
      and(
        eq(schema.warStateEvents.detectedAt, cursor.lastDetectedAt),
        gt(schema.warStateEvents.id, cursor.lastEventId),
      ),
    ) ?? sql<boolean>`false`
  );
}

function createMissedWarAttackNotificationFanOutRepository(
  tx: DatabaseTransaction,
): MissedWarAttackNotificationFanOutRepository {
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
      const cursorPredicate = buildMissedWarAttackFanOutCursorPredicate(input.cursor);
      const sincePredicate = input.since
        ? gte(schema.missedWarAttackEvents.detectedAt, input.since)
        : sql<boolean>`true`;

      return tx
        .select({
          eventId: schema.missedWarAttackEvents.id,
          guildId: schema.missedWarAttackEvents.guildId,
          trackedClanId: schema.missedWarAttackEvents.trackedClanId,
          clanTag: schema.missedWarAttackEvents.clanTag,
          warKey: schema.missedWarAttackEvents.warKey,
          playerTag: schema.missedWarAttackEvents.playerTag,
          playerName: schema.missedWarAttackEvents.playerName,
          attacksUsed: schema.missedWarAttackEvents.attacksUsed,
          attacksAvailable: schema.missedWarAttackEvents.attacksAvailable,
          eventKey: schema.missedWarAttackEvents.eventKey,
          occurredAt: schema.missedWarAttackEvents.occurredAt,
          detectedAt: schema.missedWarAttackEvents.detectedAt,
        })
        .from(schema.missedWarAttackEvents)
        .where(and(cursorPredicate, sincePredicate))
        .orderBy(asc(schema.missedWarAttackEvents.detectedAt), asc(schema.missedWarAttackEvents.id))
        .limit(input.limit);
    },
    listTargetsForEvents: async (eventIds) => {
      if (eventIds.length === 0) return [];
      return tx
        .select({
          eventId: schema.missedWarAttackEvents.id,
          guildId: schema.missedWarAttackEvents.guildId,
          clanTag: schema.missedWarAttackEvents.clanTag,
          warKey: schema.missedWarAttackEvents.warKey,
          playerTag: schema.missedWarAttackEvents.playerTag,
          playerName: schema.missedWarAttackEvents.playerName,
          attacksUsed: schema.missedWarAttackEvents.attacksUsed,
          attacksAvailable: schema.missedWarAttackEvents.attacksAvailable,
          eventKey: schema.missedWarAttackEvents.eventKey,
          occurredAt: schema.missedWarAttackEvents.occurredAt,
          detectedAt: schema.missedWarAttackEvents.detectedAt,
          configId: schema.missedWarAttackNotificationConfigs.id,
          discordChannelId: schema.missedWarAttackNotificationConfigs.discordChannelId,
        })
        .from(schema.missedWarAttackEvents)
        .innerJoin(
          schema.missedWarAttackNotificationConfigs,
          and(
            eq(
              schema.missedWarAttackNotificationConfigs.guildId,
              schema.missedWarAttackEvents.guildId,
            ),
            eq(
              schema.missedWarAttackNotificationConfigs.trackedClanId,
              schema.missedWarAttackEvents.trackedClanId,
            ),
            eq(schema.missedWarAttackNotificationConfigs.eventType, 'missed_war_attack'),
            eq(schema.missedWarAttackNotificationConfigs.isEnabled, true),
            lte(
              schema.missedWarAttackNotificationConfigs.createdAt,
              schema.missedWarAttackEvents.detectedAt,
            ),
          ),
        )
        .where(inArray(schema.missedWarAttackEvents.id, [...eventIds]))
        .orderBy(
          asc(schema.missedWarAttackEvents.detectedAt),
          asc(schema.missedWarAttackEvents.id),
          asc(schema.missedWarAttackNotificationConfigs.discordChannelId),
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

function buildMissedWarAttackFanOutCursorPredicate(cursor: NotificationFanOutCursorState) {
  if (!cursor.lastDetectedAt) return sql<boolean>`true`;
  if (!cursor.lastEventId) {
    return gt(schema.missedWarAttackEvents.detectedAt, cursor.lastDetectedAt);
  }

  return (
    or(
      gt(schema.missedWarAttackEvents.detectedAt, cursor.lastDetectedAt),
      and(
        eq(schema.missedWarAttackEvents.detectedAt, cursor.lastDetectedAt),
        gt(schema.missedWarAttackEvents.id, cursor.lastEventId),
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

function createClanRoleChangeNotificationFanOutRepository(
  tx: DatabaseTransaction,
): ClanRoleChangeNotificationFanOutRepository {
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
      const cursorPredicate = buildClanRoleChangeFanOutCursorPredicate(input.cursor);
      const sincePredicate = input.since
        ? gte(schema.clanRoleChangeEvents.detectedAt, input.since)
        : sql<boolean>`true`;

      return tx
        .select({
          eventId: schema.clanRoleChangeEvents.id,
          guildId: schema.clanRoleChangeEvents.guildId,
          trackedClanId: schema.clanRoleChangeEvents.trackedClanId,
          clanTag: schema.clanRoleChangeEvents.clanTag,
          playerTag: schema.clanRoleChangeEvents.playerTag,
          playerName: schema.clanRoleChangeEvents.playerName,
          eventKey: schema.clanRoleChangeEvents.eventKey,
          previousRole: schema.clanRoleChangeEvents.previousRole,
          currentRole: schema.clanRoleChangeEvents.currentRole,
          occurredAt: schema.clanRoleChangeEvents.occurredAt,
          detectedAt: schema.clanRoleChangeEvents.detectedAt,
        })
        .from(schema.clanRoleChangeEvents)
        .where(and(cursorPredicate, sincePredicate))
        .orderBy(asc(schema.clanRoleChangeEvents.detectedAt), asc(schema.clanRoleChangeEvents.id))
        .limit(input.limit);
    },
    listTargetsForEvents: async (eventIds) => {
      if (eventIds.length === 0) return [];
      return tx
        .select({
          eventId: schema.clanRoleChangeEvents.id,
          guildId: schema.clanRoleChangeEvents.guildId,
          clanTag: schema.clanRoleChangeEvents.clanTag,
          playerTag: schema.clanRoleChangeEvents.playerTag,
          playerName: schema.clanRoleChangeEvents.playerName,
          eventKey: schema.clanRoleChangeEvents.eventKey,
          previousRole: schema.clanRoleChangeEvents.previousRole,
          currentRole: schema.clanRoleChangeEvents.currentRole,
          occurredAt: schema.clanRoleChangeEvents.occurredAt,
          detectedAt: schema.clanRoleChangeEvents.detectedAt,
          configId: schema.clanRoleChangeNotificationConfigs.id,
          discordChannelId: schema.clanRoleChangeNotificationConfigs.discordChannelId,
        })
        .from(schema.clanRoleChangeEvents)
        .innerJoin(
          schema.clanRoleChangeNotificationConfigs,
          and(
            eq(
              schema.clanRoleChangeNotificationConfigs.guildId,
              schema.clanRoleChangeEvents.guildId,
            ),
            eq(
              schema.clanRoleChangeNotificationConfigs.trackedClanId,
              schema.clanRoleChangeEvents.trackedClanId,
            ),
            eq(schema.clanRoleChangeNotificationConfigs.eventType, 'role_change'),
            eq(schema.clanRoleChangeNotificationConfigs.isEnabled, true),
            lte(
              schema.clanRoleChangeNotificationConfigs.createdAt,
              schema.clanRoleChangeEvents.detectedAt,
            ),
          ),
        )
        .where(inArray(schema.clanRoleChangeEvents.id, [...eventIds]))
        .orderBy(
          asc(schema.clanRoleChangeEvents.detectedAt),
          asc(schema.clanRoleChangeEvents.id),
          asc(schema.clanRoleChangeNotificationConfigs.discordChannelId),
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

function buildClanRoleChangeFanOutCursorPredicate(cursor: NotificationFanOutCursorState) {
  if (!cursor.lastDetectedAt) return sql<boolean>`true`;
  if (!cursor.lastEventId) {
    return gt(schema.clanRoleChangeEvents.detectedAt, cursor.lastDetectedAt);
  }

  return (
    or(
      gt(schema.clanRoleChangeEvents.detectedAt, cursor.lastDetectedAt),
      and(
        eq(schema.clanRoleChangeEvents.detectedAt, cursor.lastDetectedAt),
        gt(schema.clanRoleChangeEvents.id, cursor.lastEventId),
      ),
    ) ?? sql<boolean>`false`
  );
}

function createClanGamesNotificationFanOutRepository(
  tx: DatabaseTransaction,
): ClanGamesNotificationFanOutRepository {
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
      const cursorPredicate = buildClanGamesFanOutCursorPredicate(input.cursor);
      const sincePredicate = input.since
        ? gte(schema.clanGamesEvents.detectedAt, input.since)
        : sql<boolean>`true`;

      return tx
        .select({
          eventId: schema.clanGamesEvents.id,
          guildId: schema.clanGamesEvents.guildId,
          trackedClanId: schema.clanGamesEvents.trackedClanId,
          clanTag: schema.clanGamesEvents.clanTag,
          seasonId: schema.clanGamesEvents.seasonId,
          eventType: schema.clanGamesEvents.eventType,
          eventKey: schema.clanGamesEvents.eventKey,
          playerTag: schema.clanGamesEvents.playerTag,
          playerName: schema.clanGamesEvents.playerName,
          previousPoints: schema.clanGamesEvents.previousPoints,
          currentPoints: schema.clanGamesEvents.currentPoints,
          pointsDelta: schema.clanGamesEvents.pointsDelta,
          eventMaxPoints: schema.clanGamesEvents.eventMaxPoints,
          occurredAt: schema.clanGamesEvents.occurredAt,
          detectedAt: schema.clanGamesEvents.detectedAt,
        })
        .from(schema.clanGamesEvents)
        .where(and(cursorPredicate, sincePredicate))
        .orderBy(asc(schema.clanGamesEvents.detectedAt), asc(schema.clanGamesEvents.id))
        .limit(input.limit);
    },
    listTargetsForEvents: async (eventIds) => {
      if (eventIds.length === 0) return [];
      return tx
        .select({
          eventId: schema.clanGamesEvents.id,
          guildId: schema.clanGamesEvents.guildId,
          clanTag: schema.clanGamesEvents.clanTag,
          seasonId: schema.clanGamesEvents.seasonId,
          eventType: schema.clanGamesEvents.eventType,
          eventKey: schema.clanGamesEvents.eventKey,
          playerTag: schema.clanGamesEvents.playerTag,
          playerName: schema.clanGamesEvents.playerName,
          previousPoints: schema.clanGamesEvents.previousPoints,
          currentPoints: schema.clanGamesEvents.currentPoints,
          pointsDelta: schema.clanGamesEvents.pointsDelta,
          eventMaxPoints: schema.clanGamesEvents.eventMaxPoints,
          occurredAt: schema.clanGamesEvents.occurredAt,
          detectedAt: schema.clanGamesEvents.detectedAt,
          configId: schema.clanGamesNotificationConfigs.id,
          discordChannelId: schema.clanGamesNotificationConfigs.discordChannelId,
        })
        .from(schema.clanGamesEvents)
        .innerJoin(
          schema.clanGamesNotificationConfigs,
          and(
            eq(schema.clanGamesNotificationConfigs.guildId, schema.clanGamesEvents.guildId),
            eq(
              schema.clanGamesNotificationConfigs.trackedClanId,
              schema.clanGamesEvents.trackedClanId,
            ),
            eq(schema.clanGamesNotificationConfigs.eventType, schema.clanGamesEvents.eventType),
            eq(schema.clanGamesNotificationConfigs.isEnabled, true),
            lte(schema.clanGamesNotificationConfigs.createdAt, schema.clanGamesEvents.detectedAt),
          ),
        )
        .where(inArray(schema.clanGamesEvents.id, [...eventIds]))
        .orderBy(
          asc(schema.clanGamesEvents.detectedAt),
          asc(schema.clanGamesEvents.id),
          asc(schema.clanGamesNotificationConfigs.discordChannelId),
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

function buildClanGamesFanOutCursorPredicate(cursor: NotificationFanOutCursorState) {
  if (!cursor.lastDetectedAt) return sql<boolean>`true`;
  if (!cursor.lastEventId) return gt(schema.clanGamesEvents.detectedAt, cursor.lastDetectedAt);

  return (
    or(
      gt(schema.clanGamesEvents.detectedAt, cursor.lastDetectedAt),
      and(
        eq(schema.clanGamesEvents.detectedAt, cursor.lastDetectedAt),
        gt(schema.clanGamesEvents.id, cursor.lastEventId),
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

export function isWarStateNotificationConfigEligibleForEvent(input: {
  configCreatedAt: Date;
  eventDetectedAt: Date;
}): boolean {
  return input.configCreatedAt.getTime() <= input.eventDetectedAt.getTime();
}

export function isMissedWarAttackNotificationConfigEligibleForEvent(input: {
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

export function isClanRoleChangeNotificationConfigEligibleForEvent(input: {
  configCreatedAt: Date;
  eventDetectedAt: Date;
}): boolean {
  return input.configCreatedAt.getTime() <= input.eventDetectedAt.getTime();
}

export function isClanGamesNotificationConfigEligibleForEvent(input: {
  configCreatedAt: Date;
  eventDetectedAt: Date;
}): boolean {
  return input.configCreatedAt.getTime() <= input.eventDetectedAt.getTime();
}

export function createWarSnapshotStore(database: Database): WarSnapshotStore {
  return {
    getLatestWarSnapshot: async (clanTagInput) => {
      const clanTag = clanTagInput.trim().toUpperCase();
      if (!clanTag) throw new Error('War snapshot requires a clan tag.');

      const [row] = await database
        .select({
          clanTag: schema.warLatestSnapshots.clanTag,
          state: schema.warLatestSnapshots.state,
          snapshot: schema.warLatestSnapshots.snapshot,
          fetchedAt: schema.warLatestSnapshots.fetchedAt,
        })
        .from(schema.warLatestSnapshots)
        .where(eq(schema.warLatestSnapshots.clanTag, clanTag))
        .limit(1);

      return row ?? null;
    },
    getLatestWarSnapshotsForGuild: async (guildId) => {
      const rows = await database
        .select({
          clanTag: schema.warLatestSnapshots.clanTag,
          state: schema.warLatestSnapshots.state,
          snapshot: schema.warLatestSnapshots.snapshot,
          fetchedAt: schema.warLatestSnapshots.fetchedAt,
          trackedClanId: schema.trackedClans.id,
          trackedClanTag: schema.trackedClans.clanTag,
          trackedClanName: schema.trackedClans.name,
          trackedClanAlias: schema.trackedClans.alias,
          sortOrder: schema.trackedClans.sortOrder,
        })
        .from(schema.trackedClans)
        .innerJoin(
          schema.warLatestSnapshots,
          eq(schema.warLatestSnapshots.clanTag, schema.trackedClans.clanTag),
        )
        .where(
          and(eq(schema.trackedClans.guildId, guildId), eq(schema.trackedClans.isActive, true)),
        )
        .orderBy(asc(schema.trackedClans.sortOrder), asc(schema.trackedClans.clanTag));

      return rows.map((row) => ({
        clanTag: row.clanTag,
        state: row.state,
        snapshot: row.snapshot,
        fetchedAt: row.fetchedAt,
        trackedClan: {
          id: row.trackedClanId,
          clanTag: row.trackedClanTag,
          name: row.trackedClanName,
          alias: row.trackedClanAlias,
        },
      }));
    },
    getRetainedWarSnapshotsForGuild: async (input) => {
      const warKey = input.warKey.trim().toLowerCase();
      if (!warKey) throw new Error('Retained war snapshot requires a war key.');
      const clanTag = input.clanTag?.trim().toUpperCase();
      const conditions = [
        eq(schema.trackedClans.guildId, input.guildId),
        eq(schema.trackedClans.isActive, true),
        sql`lower(${schema.warSnapshots.warKey}) = ${warKey}`,
      ];
      if (clanTag) conditions.push(eq(schema.trackedClans.clanTag, clanTag));

      const rows = await database
        .select({
          clanTag: schema.warSnapshots.clanTag,
          warKey: schema.warSnapshots.warKey,
          state: schema.warSnapshots.state,
          snapshot: schema.warSnapshots.snapshot,
          fetchedAt: schema.warSnapshots.fetchedAt,
          trackedClanId: schema.trackedClans.id,
          trackedClanTag: schema.trackedClans.clanTag,
          trackedClanName: schema.trackedClans.name,
          trackedClanAlias: schema.trackedClans.alias,
        })
        .from(schema.trackedClans)
        .innerJoin(
          schema.warSnapshots,
          eq(schema.warSnapshots.clanTag, schema.trackedClans.clanTag),
        )
        .where(and(...conditions))
        .orderBy(
          asc(schema.trackedClans.sortOrder),
          asc(schema.trackedClans.clanTag),
          desc(schema.warSnapshots.fetchedAt),
        );

      const newestByClan = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        if (!newestByClan.has(row.trackedClanTag)) newestByClan.set(row.trackedClanTag, row);
      }

      return [...newestByClan.values()].map((row) => ({
        clanTag: row.clanTag,
        warKey: row.warKey,
        state: row.state,
        snapshot: row.snapshot,
        fetchedAt: row.fetchedAt,
        trackedClan: {
          id: row.trackedClanId,
          clanTag: row.trackedClanTag,
          name: row.trackedClanName,
          alias: row.trackedClanAlias,
        },
      }));
    },
    listRetainedEndedWarSnapshotsForGuild: async (input) => {
      const clanTag = input.clanTag?.trim().toUpperCase();
      const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
      const conditions = [
        eq(schema.trackedClans.guildId, input.guildId),
        eq(schema.trackedClans.isActive, true),
        sql`lower(replace(${schema.warSnapshots.state}, '_', '')) = 'warended'`,
      ];
      if (clanTag) conditions.push(eq(schema.trackedClans.clanTag, clanTag));

      const rows = await database
        .select({
          clanTag: schema.warSnapshots.clanTag,
          warKey: schema.warSnapshots.warKey,
          state: schema.warSnapshots.state,
          snapshot: schema.warSnapshots.snapshot,
          fetchedAt: schema.warSnapshots.fetchedAt,
          trackedClanId: schema.trackedClans.id,
          trackedClanTag: schema.trackedClans.clanTag,
          trackedClanName: schema.trackedClans.name,
          trackedClanAlias: schema.trackedClans.alias,
        })
        .from(schema.trackedClans)
        .innerJoin(
          schema.warSnapshots,
          eq(schema.warSnapshots.clanTag, schema.trackedClans.clanTag),
        )
        .where(and(...conditions))
        .orderBy(desc(schema.warSnapshots.fetchedAt), desc(schema.warSnapshots.createdAt));

      const newestByWar = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        const key = `${row.trackedClanTag}\u0000${row.warKey.toLowerCase()}`;
        if (!newestByWar.has(key)) newestByWar.set(key, row);
        if (newestByWar.size >= limit) break;
      }

      return [...newestByWar.values()].map((row) => ({
        clanTag: row.clanTag,
        warKey: row.warKey,
        state: row.state,
        snapshot: row.snapshot,
        fetchedAt: row.fetchedAt,
        trackedClan: {
          id: row.trackedClanId,
          clanTag: row.trackedClanTag,
          name: row.trackedClanName,
          alias: row.trackedClanAlias,
        },
      }));
    },
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
    retainWarSnapshot: async (input) => {
      const snapshot = normalizeRetainedWarSnapshotInput(input);
      const result = await database
        .insert(schema.warSnapshots)
        .values({
          clanTag: snapshot.clanTag,
          warKey: snapshot.warKey,
          state: snapshot.state,
          snapshot: snapshot.snapshot,
          fetchedAt: snapshot.fetchedAt,
        })
        .onConflictDoNothing({
          target: [
            schema.warSnapshots.clanTag,
            schema.warSnapshots.warKey,
            schema.warSnapshots.fetchedAt,
          ],
        })
        .returning({ id: schema.warSnapshots.id });

      return { inserted: result.length };
    },
  };
}

export function createClanGamesScoreboardReader(database: Database): ClanGamesScoreboardReader {
  return {
    getLatestScoreboard: async (query) => {
      const clanTag = query.clanTag ? normalizeClanGamesClanTag(query.clanTag) : undefined;
      const conditions = [eq(schema.clanGamesClanSnapshots.guildId, query.guildId)];
      if (clanTag) conditions.push(eq(schema.clanGamesClanSnapshots.clanTag, clanTag));
      if (query.seasonId)
        conditions.push(eq(schema.clanGamesClanSnapshots.seasonId, query.seasonId));

      const [row] = await database
        .select({
          guildId: schema.clanGamesClanSnapshots.guildId,
          clanTag: schema.clanGamesClanSnapshots.clanTag,
          seasonId: schema.clanGamesClanSnapshots.seasonId,
          snapshot: schema.clanGamesClanSnapshots.snapshot,
          sourceFetchedAt: schema.clanGamesClanSnapshots.sourceFetchedAt,
          updatedAt: schema.clanGamesClanSnapshots.updatedAt,
          clanName: schema.trackedClans.name,
          clanAlias: schema.trackedClans.alias,
        })
        .from(schema.clanGamesClanSnapshots)
        .leftJoin(
          schema.trackedClans,
          eq(schema.clanGamesClanSnapshots.trackedClanId, schema.trackedClans.id),
        )
        .where(and(...conditions))
        .orderBy(
          desc(schema.clanGamesClanSnapshots.updatedAt),
          asc(schema.clanGamesClanSnapshots.clanTag),
        )
        .limit(1);

      if (!row) return null;
      return parseClanGamesScoreboardSnapshot(row);
    },
    listScoreboardChoices: async (guildId, query = '') => {
      const rows = await database
        .select({
          clanTag: schema.clanGamesClanSnapshots.clanTag,
          seasonId: schema.clanGamesClanSnapshots.seasonId,
          updatedAt: schema.clanGamesClanSnapshots.updatedAt,
          clanName: schema.trackedClans.name,
          clanAlias: schema.trackedClans.alias,
        })
        .from(schema.clanGamesClanSnapshots)
        .leftJoin(
          schema.trackedClans,
          eq(schema.clanGamesClanSnapshots.trackedClanId, schema.trackedClans.id),
        )
        .where(eq(schema.clanGamesClanSnapshots.guildId, guildId))
        .orderBy(
          desc(schema.clanGamesClanSnapshots.updatedAt),
          asc(schema.clanGamesClanSnapshots.clanTag),
        )
        .limit(100);

      const normalized = query.trim().toLowerCase();
      const seen = new Set<string>();
      return rows
        .filter((row) => {
          if (seen.has(row.clanTag)) return false;
          seen.add(row.clanTag);
          if (!normalized) return true;
          return [row.clanTag, row.clanName, row.clanAlias]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLowerCase().includes(normalized));
        })
        .slice(0, 25)
        .map((row) => ({
          clanTag: row.clanTag,
          clanName: row.clanName,
          clanAlias: row.clanAlias,
          seasonId: row.seasonId,
          updatedAt: row.updatedAt,
        }));
    },
  };
}

export function createClanGamesHistoryReader(database: Database): ClanGamesHistoryReader {
  return {
    listClanGamesHistoryForGuild: async (input) => {
      const since = input.since ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const filters = [
        eq(schema.clanGamesClanSnapshots.guildId, input.guildId),
        eq(schema.trackedClans.guildId, input.guildId),
        eq(schema.trackedClans.isActive, true),
        gte(schema.clanGamesClanSnapshots.updatedAt, since),
      ];

      if (input.clanTags?.length) {
        filters.push(inArray(schema.clanGamesClanSnapshots.clanTag, [...input.clanTags]));
      }

      const rows = await database
        .select({
          guildId: schema.clanGamesClanSnapshots.guildId,
          clanTag: schema.clanGamesClanSnapshots.clanTag,
          seasonId: schema.clanGamesClanSnapshots.seasonId,
          snapshot: schema.clanGamesClanSnapshots.snapshot,
          sourceFetchedAt: schema.clanGamesClanSnapshots.sourceFetchedAt,
          updatedAt: schema.clanGamesClanSnapshots.updatedAt,
          clanName: schema.trackedClans.name,
          clanAlias: schema.trackedClans.alias,
        })
        .from(schema.clanGamesClanSnapshots)
        .innerJoin(
          schema.trackedClans,
          eq(schema.clanGamesClanSnapshots.trackedClanId, schema.trackedClans.id),
        )
        .where(and(...filters));

      const playerTagFilter = input.playerTags?.length ? new Set(input.playerTags) : null;
      const players = new Map<string, ClanGamesHistoryAccumulator>();

      for (const row of rows) {
        const snapshot = parseClanGamesScoreboardSnapshot(row);
        for (const member of snapshot.members) {
          if (playerTagFilter && !playerTagFilter.has(member.playerTag)) continue;
          const existing = players.get(member.playerTag);
          if (!existing) {
            players.set(member.playerTag, createClanGamesHistoryAccumulator(member, snapshot));
            continue;
          }
          existing.playerName = member.playerName;
          existing.seasonCount += 1;
          existing.totalPoints += member.points;
          existing.bestPoints = Math.max(existing.bestPoints, member.points);
          if (snapshot.updatedAt > existing.latestUpdatedAt) {
            existing.latestSeasonId = snapshot.seasonId;
            existing.latestClanTag = snapshot.clanTag;
            existing.latestClanName = snapshot.clanName;
            existing.latestUpdatedAt = snapshot.updatedAt;
          }
        }
      }

      return [...players.values()]
        .map((row) => ({
          playerTag: row.playerTag,
          playerName: row.playerName,
          seasonCount: row.seasonCount,
          totalPoints: row.totalPoints,
          averagePoints: row.totalPoints / row.seasonCount,
          bestPoints: row.bestPoints,
          latestSeasonId: row.latestSeasonId,
          latestClanTag: row.latestClanTag,
          latestClanName: row.latestClanName,
          latestUpdatedAt: row.latestUpdatedAt,
        }))
        .sort(
          (a, b) =>
            b.seasonCount - a.seasonCount ||
            b.totalPoints - a.totalPoints ||
            a.playerName.localeCompare(b.playerName) ||
            a.playerTag.localeCompare(b.playerTag),
        );
    },
  };
}

interface ClanGamesHistoryAccumulator {
  playerTag: string;
  playerName: string;
  seasonCount: number;
  totalPoints: number;
  bestPoints: number;
  latestSeasonId: string;
  latestClanTag: string;
  latestClanName: string | null;
  latestUpdatedAt: Date;
}

function createClanGamesHistoryAccumulator(
  member: ClanGamesScoreboardMember,
  snapshot: ClanGamesScoreboardSnapshot,
): ClanGamesHistoryAccumulator {
  return {
    playerTag: member.playerTag,
    playerName: member.playerName,
    seasonCount: 1,
    totalPoints: member.points,
    bestPoints: member.points,
    latestSeasonId: snapshot.seasonId,
    latestClanTag: snapshot.clanTag,
    latestClanName: snapshot.clanName,
    latestUpdatedAt: snapshot.updatedAt,
  };
}

function parseClanGamesScoreboardSnapshot(row: {
  guildId: string;
  clanTag: string;
  clanName: string | null;
  clanAlias: string | null;
  seasonId: string;
  snapshot: unknown;
  sourceFetchedAt: Date;
  updatedAt: Date;
}): ClanGamesScoreboardSnapshot {
  const snapshot = isRecord(row.snapshot)
    ? (row.snapshot as {
        members?: unknown;
        seasonId?: unknown;
        eventMaxPoints?: unknown;
        sourceFetchedAt?: unknown;
      })
    : {};
  const membersValue = Array.isArray(snapshot.members) ? snapshot.members : [];
  const members = membersValue.filter(isClanGamesMember).sort(compareClanGamesMembers);
  const seasonId =
    typeof snapshot.seasonId === 'string' && snapshot.seasonId ? snapshot.seasonId : row.seasonId;
  const eventMaxPoints =
    typeof snapshot.eventMaxPoints === 'number' && Number.isFinite(snapshot.eventMaxPoints)
      ? snapshot.eventMaxPoints
      : 0;
  const sourceFetchedAt =
    typeof snapshot.sourceFetchedAt === 'string'
      ? new Date(snapshot.sourceFetchedAt)
      : row.sourceFetchedAt;

  return {
    guildId: row.guildId,
    clanTag: row.clanTag,
    clanName: row.clanName,
    clanAlias: row.clanAlias,
    seasonId,
    eventMaxPoints,
    sourceFetchedAt: Number.isNaN(sourceFetchedAt.getTime())
      ? row.sourceFetchedAt
      : sourceFetchedAt,
    updatedAt: row.updatedAt,
    members,
    totalPoints: members.reduce((total, member) => total + member.points, 0),
  };
}

function isClanGamesMember(value: unknown): value is ClanGamesScoreboardMember {
  if (!isRecord(value)) return false;
  const member = value as { playerTag?: unknown; playerName?: unknown; points?: unknown };
  return (
    typeof member.playerTag === 'string' &&
    member.playerTag.length > 0 &&
    typeof member.playerName === 'string' &&
    member.playerName.length > 0 &&
    typeof member.points === 'number' &&
    Number.isFinite(member.points)
  );
}

function compareClanGamesMembers(
  a: ClanGamesScoreboardMember,
  b: ClanGamesScoreboardMember,
): number {
  return (
    b.points - a.points ||
    a.playerName.localeCompare(b.playerName) ||
    a.playerTag.localeCompare(b.playerTag)
  );
}

function normalizeClanGamesClanTag(tag: string): string {
  const trimmed = tag.trim().toUpperCase();
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
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

export function createWarStateEventStore(database: Database): WarStateEventStore {
  return {
    insertWarStateEvents: async (input) => {
      const firstEvent = input[0];
      if (!firstEvent) return { status: 'processed', inserted: 0 };

      const clanTag = normalizeWarStateEventInput(firstEvent).clanTag;
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
          const normalizedEvent = normalizeWarStateEventInput(event);
          return {
            guildId: linkedClan.guildId,
            trackedClanId: linkedClan.id,
            clanTag: normalizedEvent.clanTag,
            warKey: normalizedEvent.warKey,
            eventKey: buildWarStateEventKey(normalizedEvent),
            previousState: normalizedEvent.previousState,
            currentState: normalizedEvent.currentState,
            previousSnapshot: normalizedEvent.previousSnapshot,
            currentSnapshot: normalizedEvent.currentSnapshot,
            sourceFetchedAt: normalizedEvent.sourceFetchedAt,
            occurredAt: normalizedEvent.occurredAt,
            detectedAt: normalizedEvent.detectedAt ?? new Date(),
          };
        }),
      );

      const inserted = await database
        .insert(schema.warStateEvents)
        .values(values)
        .onConflictDoNothing({
          target: [schema.warStateEvents.guildId, schema.warStateEvents.eventKey],
        })
        .returning({ id: schema.warStateEvents.id });

      return { status: 'processed', inserted: inserted.length };
    },
  };
}

export function createMissedWarAttackEventStore(database: Database): MissedWarAttackEventStore {
  return {
    listMissedWarAttacksForWar: async (guildId, clanTagInput, warKey) => {
      const clanTag = clanTagInput.trim().toUpperCase();
      const rows = await database
        .select({
          playerTag: schema.missedWarAttackEvents.playerTag,
          playerName: schema.missedWarAttackEvents.playerName,
          attacksUsed: schema.missedWarAttackEvents.attacksUsed,
          attacksAvailable: schema.missedWarAttackEvents.attacksAvailable,
        })
        .from(schema.missedWarAttackEvents)
        .where(
          and(
            eq(schema.missedWarAttackEvents.guildId, guildId),
            eq(schema.missedWarAttackEvents.clanTag, clanTag),
            eq(schema.missedWarAttackEvents.warKey, warKey),
          ),
        )
        .orderBy(
          asc(schema.missedWarAttackEvents.playerName),
          asc(schema.missedWarAttackEvents.playerTag),
        );

      return rows;
    },
    insertMissedWarAttackEvents: async (input) => {
      const firstEvent = input[0];
      if (!firstEvent) return { status: 'processed', inserted: 0 };

      const clanTag = normalizeMissedWarAttackEventInput(firstEvent).clanTag;
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
          const normalizedEvent = normalizeMissedWarAttackEventInput(event);
          return {
            guildId: linkedClan.guildId,
            trackedClanId: linkedClan.id,
            clanTag: normalizedEvent.clanTag,
            warKey: normalizedEvent.warKey,
            playerTag: normalizedEvent.playerTag,
            playerName: normalizedEvent.playerName,
            attacksUsed: normalizedEvent.attacksUsed,
            attacksAvailable: normalizedEvent.attacksAvailable,
            eventKey: buildMissedWarAttackEventKey(normalizedEvent),
            warSnapshot: normalizedEvent.warSnapshot,
            memberSnapshot: normalizedEvent.memberSnapshot,
            stateEventId: normalizedEvent.stateEventId,
            sourceFetchedAt: normalizedEvent.sourceFetchedAt,
            warStartedAt: normalizedEvent.warStartedAt,
            warEndedAt: normalizedEvent.warEndedAt,
            occurredAt: normalizedEvent.occurredAt,
            detectedAt: normalizedEvent.detectedAt ?? new Date(),
          };
        }),
      );

      const inserted = await database
        .insert(schema.missedWarAttackEvents)
        .values(values)
        .onConflictDoNothing({
          target: [schema.missedWarAttackEvents.guildId, schema.missedWarAttackEvents.eventKey],
        })
        .returning({ id: schema.missedWarAttackEvents.id });

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

interface NormalizedClanGamesProgressInput extends ProcessClanGamesProgressInput {
  clanTag: string;
  seasonId: string;
  players: readonly (ClanGamesPlayerProgressInput & {
    playerTag: string;
    playerName: string;
  })[];
}

interface ClanGamesClanSnapshotMember {
  playerTag: string;
  playerName: string;
  points: number;
}

interface InsertClanGamesEventsInput {
  linkedClans: readonly { id: string; guildId: string }[];
  clanTag: string;
  seasonId: string;
  eventType: ClanGamesEventType;
  playerTag: string;
  playerName: string;
  previousPoints: number;
  currentPoints: number;
  pointsDelta: number;
  eventMaxPoints: number;
  previousSnapshot: unknown;
  currentSnapshot: unknown;
  fetchedAt: Date;
}

function normalizeClanGamesProgressInput(
  input: ProcessClanGamesProgressInput,
): NormalizedClanGamesProgressInput {
  const clanTag = input.clanTag.trim().toUpperCase();
  const seasonId = input.seasonId.trim();
  if (!clanTag) throw new Error('Clan Games progress requires a clan tag.');
  if (!seasonId) throw new Error('Clan Games progress requires a season id.');
  if (!Number.isInteger(input.eventMaxPoints) || input.eventMaxPoints < 0) {
    throw new Error('Clan Games progress requires a non-negative integer event max points value.');
  }

  const players = input.players.map((player) => {
    const playerTag = player.playerTag.trim().toUpperCase();
    const playerName = player.playerName.trim();
    if (!playerTag || !playerName) {
      throw new Error('Clan Games progress requires non-empty player tags and names.');
    }
    if (!Number.isInteger(player.currentAchievementValue) || player.currentAchievementValue < 0) {
      throw new Error('Clan Games progress requires non-negative integer achievement values.');
    }
    return { ...player, playerTag, playerName };
  });

  const playerTags = new Set(players.map((player) => player.playerTag));
  if (playerTags.size !== players.length) {
    throw new Error('Clan Games progress requires unique player tags in a batch.');
  }

  return { ...input, clanTag, seasonId, players };
}

export function buildClanGamesEventKey(input: BuildClanGamesEventKeyInput): string {
  const clanTag = input.clanTag.trim().toUpperCase();
  const seasonId = input.seasonId.trim();
  const playerTag = input.playerTag.trim().toUpperCase();
  if (!clanTag || !seasonId || !playerTag) {
    throw new Error('Clan Games event keys require clan, season, and player identifiers.');
  }
  if (!Number.isInteger(input.currentPoints) || input.currentPoints < 0) {
    throw new Error('Clan Games event keys require non-negative integer current points.');
  }

  return [
    'clan-games',
    seasonId,
    clanTag,
    playerTag,
    input.eventType,
    String(input.currentPoints),
  ].join(':');
}

export function computeClanGamesProgressDelta(
  input: ClanGamesProgressDeltaInput,
): ClanGamesProgressDelta {
  for (const value of [
    input.initialPoints,
    input.previousCurrentPoints,
    input.currentAchievementValue,
    input.eventMaxPoints,
  ]) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error('Clan Games progress delta requires non-negative integer point values.');
    }
  }

  const previousEventPoints = Math.max(0, input.previousCurrentPoints - input.initialPoints);
  const currentEventPoints = Math.max(0, input.currentAchievementValue - input.initialPoints);
  const pointsIncrease = Math.max(0, currentEventPoints - previousEventPoints);
  const completed =
    !input.wasCompleted &&
    input.eventMaxPoints > 0 &&
    previousEventPoints < input.eventMaxPoints &&
    currentEventPoints >= input.eventMaxPoints;

  return {
    previousEventPoints,
    currentEventPoints,
    pointsIncrease,
    completed,
    completedAt: null,
  };
}

async function insertClanGamesEvents(
  tx: DatabaseTransaction,
  input: InsertClanGamesEventsInput,
): Promise<number> {
  const rows = await tx
    .insert(schema.clanGamesEvents)
    .values(
      input.linkedClans.map((linkedClan) => ({
        guildId: linkedClan.guildId,
        trackedClanId: linkedClan.id,
        clanTag: input.clanTag,
        seasonId: input.seasonId,
        eventType: input.eventType,
        eventKey: buildClanGamesEventKey({
          clanTag: input.clanTag,
          seasonId: input.seasonId,
          playerTag: input.playerTag,
          eventType: input.eventType,
          currentPoints: input.currentPoints,
        }),
        playerTag: input.playerTag,
        playerName: input.playerName,
        previousPoints: input.previousPoints,
        currentPoints: input.currentPoints,
        pointsDelta: input.pointsDelta,
        eventMaxPoints: input.eventMaxPoints,
        previousSnapshot: input.previousSnapshot,
        currentSnapshot: input.currentSnapshot,
        sourceFetchedAt: input.fetchedAt,
        occurredAt: input.fetchedAt,
        detectedAt: input.fetchedAt,
      })),
    )
    .onConflictDoNothing({
      target: [schema.clanGamesEvents.guildId, schema.clanGamesEvents.eventKey],
    })
    .returning({ id: schema.clanGamesEvents.id });

  return rows.length;
}

function parseClanGamesClanSnapshotMembers(snapshot: unknown): ClanGamesClanSnapshotMember[] {
  if (!isRecord(snapshot)) return [];
  const snapshotRecord = snapshot as { members?: unknown };
  if (!Array.isArray(snapshotRecord.members)) return [];

  const members: ClanGamesClanSnapshotMember[] = [];
  for (const member of snapshotRecord.members) {
    if (!isRecord(member)) continue;
    const memberRecord = member as {
      playerTag?: unknown;
      playerName?: unknown;
      points?: unknown;
    };
    const playerTagValue = memberRecord.playerTag;
    const playerNameValue = memberRecord.playerName;
    const pointsValue = memberRecord.points;
    if (
      typeof playerTagValue !== 'string' ||
      typeof playerNameValue !== 'string' ||
      typeof pointsValue !== 'number' ||
      !Number.isInteger(pointsValue) ||
      pointsValue < 0
    ) {
      continue;
    }

    const playerTag = playerTagValue.trim().toUpperCase();
    const playerName = playerNameValue.trim();
    if (!playerTag || !playerName) continue;

    members.push({ playerTag, playerName, points: pointsValue });
  }

  return members;
}

function mergeClanGamesClanSnapshotMembers(input: {
  existingMembers: readonly ClanGamesClanSnapshotMember[];
  currentMembers: readonly ClanGamesClanSnapshotMember[];
}): ClanGamesClanSnapshotMember[] {
  const membersByTag = new Map<string, ClanGamesClanSnapshotMember>();

  for (const member of input.existingMembers) {
    membersByTag.set(member.playerTag, member);
  }
  for (const member of input.currentMembers) {
    membersByTag.set(member.playerTag, member);
  }

  return [...membersByTag.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildClanGamesClanSnapshot(input: {
  seasonId: string;
  eventMaxPoints: number;
  fetchedAt: Date;
  members: readonly ClanGamesClanSnapshotMember[];
}): Record<string, unknown> {
  const members = [...input.members]
    .sort((left, right) => {
      const pointsComparison = right.points - left.points;
      if (pointsComparison !== 0) return pointsComparison;
      return (
        left.playerName.localeCompare(right.playerName) ||
        left.playerTag.localeCompare(right.playerTag)
      );
    })
    .map((member) => ({
      playerTag: member.playerTag,
      playerName: member.playerName,
      points: member.points,
    }));

  return {
    seasonId: input.seasonId,
    eventMaxPoints: input.eventMaxPoints,
    sourceFetchedAt: input.fetchedAt.toISOString(),
    totalPoints: members.reduce((total, member) => total + member.points, 0),
    members,
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

export function buildClanRoleChangeEventKey(input: {
  clanTag: string;
  playerTag: string;
  previousRole: string | null | undefined;
  currentRole: string | null | undefined;
  eventAt: Date;
}): string {
  const clanTag = input.clanTag.trim().toUpperCase();
  const playerTag = input.playerTag.trim().toUpperCase();
  if (!clanTag || !playerTag) throw new Error('Clan role change event keys require tags.');

  const previousRole = normalizeClanRoleForEventKey(input.previousRole);
  const currentRole = normalizeClanRoleForEventKey(input.currentRole);
  if (previousRole === currentRole) {
    throw new Error('Clan role change event keys require different roles.');
  }

  return [
    `clan:${clanTag}`,
    `role-change:${playerTag}`,
    `${previousRole}->${currentRole}`,
    input.eventAt.toISOString(),
  ].join(':');
}

function normalizeClanRoleForEventKey(role: string | null | undefined): string {
  const normalized = role?.trim().toLowerCase();
  return normalized || 'none';
}

export function computeClanRoleChangeDeltaEvent(input: {
  previousRole: string | null | undefined;
  currentRole: string | null | undefined;
}): ClanRoleChangeDeltaEvent | null {
  const previousRole = normalizeClanRoleValue(input.previousRole);
  const currentRole = normalizeClanRoleValue(input.currentRole);
  if (previousRole === currentRole) return null;
  return { previousRole, currentRole };
}

function normalizeClanRoleValue(role: string | null | undefined): string | null {
  const normalized = role?.trim();
  return normalized ? normalized : null;
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

export function normalizeRetainedWarSnapshotInput(
  input: RetainWarSnapshotInput,
): RetainWarSnapshotInput & {
  clanTag: string;
  state: string;
  warKey: string;
  fetchedAt: Date;
} {
  const snapshot = normalizeLatestWarSnapshotInput(input);
  const warKey = input.warKey.trim().toLowerCase();
  if (!warKey) throw new Error('War snapshot requires a war key.');

  return { ...snapshot, warKey };
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

export function normalizeWarStateEventInput(
  input: WarStateEventInput,
): NormalizedWarStateEventInput {
  const clanTag = input.clanTag.trim().toUpperCase();
  const warKey = input.warKey.trim().toLowerCase();
  const currentState = input.currentState.trim().toLowerCase();
  const previousState = input.previousState?.trim().toLowerCase() || null;
  if (!clanTag || !warKey || !currentState) {
    throw new Error('War state events require clan, war, and current state identifiers.');
  }

  return {
    ...input,
    clanTag,
    warKey,
    previousState,
    currentState,
    previousSnapshot: input.previousSnapshot ?? null,
  };
}

export function buildWarStateEventKey(input: WarStateEventInput): string {
  const event = normalizeWarStateEventInput(input);
  const previousState = event.previousState ?? 'none';
  return [
    `war:${event.warKey}`,
    `clan:${event.clanTag}`,
    `state:${previousState}->${event.currentState}`,
    event.occurredAt.toISOString(),
  ].join(':');
}

export function normalizeMissedWarAttackEventInput(
  input: MissedWarAttackEventInput,
): NormalizedMissedWarAttackEventInput {
  const clanTag = input.clanTag.trim().toUpperCase();
  const warKey = input.warKey.trim().toLowerCase();
  const playerTag = input.playerTag.trim().toUpperCase();
  const playerName = input.playerName.trim();
  if (!clanTag || !warKey || !playerTag || !playerName) {
    throw new Error('Missed war attack events require clan, war, player, and name identifiers.');
  }
  if (!Number.isInteger(input.attacksUsed) || input.attacksUsed < 0) {
    throw new Error('Missed war attack events require a non-negative used attack count.');
  }
  if (!Number.isInteger(input.attacksAvailable) || input.attacksAvailable <= 0) {
    throw new Error('Missed war attack events require a positive available attack count.');
  }
  if (input.attacksUsed >= input.attacksAvailable) {
    throw new Error('Missed war attack events require fewer used attacks than available attacks.');
  }

  return {
    ...input,
    clanTag,
    warKey,
    playerTag,
    playerName,
    stateEventId: input.stateEventId ?? null,
    warStartedAt: input.warStartedAt ?? null,
    warEndedAt: input.warEndedAt ?? null,
  };
}

export function buildMissedWarAttackEventKey(input: MissedWarAttackEventInput): string {
  const event = normalizeMissedWarAttackEventInput(input);
  return `war-missed:${event.warKey}:${event.clanTag}:${event.playerTag}`;
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
    setAlias: async (input) =>
      database.transaction(async (tx) => {
        const [clan] = await tx
          .update(schema.trackedClans)
          .set({ alias: input.alias, updatedAt: new Date() })
          .where(
            and(
              eq(schema.trackedClans.guildId, input.guildId),
              eq(schema.trackedClans.clanTag, input.clanTag),
              eq(schema.trackedClans.isActive, true),
            ),
          )
          .returning({
            id: schema.trackedClans.id,
            clanTag: schema.trackedClans.clanTag,
            name: schema.trackedClans.name,
            alias: schema.trackedClans.alias,
          });
        if (!clan) return { status: 'not_found' };
        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'tracked_clan.alias_updated',
          targetType: 'tracked_clan',
          targetId: clan.id,
          metadata: { clanTag: clan.clanTag, alias: input.alias },
        });
        return {
          status: 'updated',
          clan: { ...clan, name: clan.name ?? 'Unknown clan' },
        };
      }),
    clearAlias: async (input) =>
      database.transaction(async (tx) => {
        const [clan] = await tx
          .update(schema.trackedClans)
          .set({ alias: null, updatedAt: new Date() })
          .where(
            and(
              eq(schema.trackedClans.guildId, input.guildId),
              eq(schema.trackedClans.clanTag, input.clanTag),
              eq(schema.trackedClans.isActive, true),
            ),
          )
          .returning({
            id: schema.trackedClans.id,
            clanTag: schema.trackedClans.clanTag,
            name: schema.trackedClans.name,
            alias: schema.trackedClans.alias,
          });
        if (!clan) return { status: 'not_found' };
        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'tracked_clan.alias_deleted',
          targetType: 'tracked_clan',
          targetId: clan.id,
          metadata: { clanTag: clan.clanTag },
        });
        return {
          status: 'cleared',
          clan: { ...clan, name: clan.name ?? 'Unknown clan' },
        };
      }),
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
    configureWarStateNotifications: async (input) => {
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
            id: schema.warStateNotificationConfigs.id,
            discordChannelId: schema.warStateNotificationConfigs.discordChannelId,
            eventType: schema.warStateNotificationConfigs.eventType,
          })
          .from(schema.warStateNotificationConfigs)
          .where(
            and(
              eq(schema.warStateNotificationConfigs.guildId, input.guildId),
              eq(schema.warStateNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.warStateNotificationConfigs.eventType, 'war_state'),
            ),
          );

        await tx
          .delete(schema.warStateNotificationConfigs)
          .where(
            and(
              eq(schema.warStateNotificationConfigs.guildId, input.guildId),
              eq(schema.warStateNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.warStateNotificationConfigs.eventType, 'war_state'),
            ),
          );

        const now = new Date();
        await tx.insert(schema.warStateNotificationConfigs).values({
          guildId: input.guildId,
          trackedClanId: trackedClan.id,
          discordChannelId: input.discordChannelId,
          eventType: 'war_state',
          isEnabled: true,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'war_state_notifications.enabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            discordChannelId: input.discordChannelId,
            eventTypes: ['war_state'],
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
    disableWarStateNotifications: async (input) => {
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
            id: schema.warStateNotificationConfigs.id,
            discordChannelId: schema.warStateNotificationConfigs.discordChannelId,
            eventType: schema.warStateNotificationConfigs.eventType,
          })
          .from(schema.warStateNotificationConfigs)
          .where(
            and(
              eq(schema.warStateNotificationConfigs.guildId, input.guildId),
              eq(schema.warStateNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.warStateNotificationConfigs.eventType, 'war_state'),
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
          .delete(schema.warStateNotificationConfigs)
          .where(
            and(
              eq(schema.warStateNotificationConfigs.guildId, input.guildId),
              eq(schema.warStateNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.warStateNotificationConfigs.eventType, 'war_state'),
            ),
          );

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'war_state_notifications.disabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            eventTypes: ['war_state'],
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
    configureMissedWarAttackNotifications: async (input) => {
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
            id: schema.missedWarAttackNotificationConfigs.id,
            discordChannelId: schema.missedWarAttackNotificationConfigs.discordChannelId,
            eventType: schema.missedWarAttackNotificationConfigs.eventType,
          })
          .from(schema.missedWarAttackNotificationConfigs)
          .where(
            and(
              eq(schema.missedWarAttackNotificationConfigs.guildId, input.guildId),
              eq(schema.missedWarAttackNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.missedWarAttackNotificationConfigs.eventType, 'missed_war_attack'),
            ),
          );

        await tx
          .delete(schema.missedWarAttackNotificationConfigs)
          .where(
            and(
              eq(schema.missedWarAttackNotificationConfigs.guildId, input.guildId),
              eq(schema.missedWarAttackNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.missedWarAttackNotificationConfigs.eventType, 'missed_war_attack'),
            ),
          );

        const now = new Date();
        await tx.insert(schema.missedWarAttackNotificationConfigs).values({
          guildId: input.guildId,
          trackedClanId: trackedClan.id,
          discordChannelId: input.discordChannelId,
          eventType: 'missed_war_attack',
          isEnabled: true,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'missed_war_attack_notifications.enabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            discordChannelId: input.discordChannelId,
            eventTypes: ['missed_war_attack'],
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
    disableMissedWarAttackNotifications: async (input) => {
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
            id: schema.missedWarAttackNotificationConfigs.id,
            discordChannelId: schema.missedWarAttackNotificationConfigs.discordChannelId,
            eventType: schema.missedWarAttackNotificationConfigs.eventType,
          })
          .from(schema.missedWarAttackNotificationConfigs)
          .where(
            and(
              eq(schema.missedWarAttackNotificationConfigs.guildId, input.guildId),
              eq(schema.missedWarAttackNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.missedWarAttackNotificationConfigs.eventType, 'missed_war_attack'),
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
          .delete(schema.missedWarAttackNotificationConfigs)
          .where(
            and(
              eq(schema.missedWarAttackNotificationConfigs.guildId, input.guildId),
              eq(schema.missedWarAttackNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.missedWarAttackNotificationConfigs.eventType, 'missed_war_attack'),
            ),
          );

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'missed_war_attack_notifications.disabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            eventTypes: ['missed_war_attack'],
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
    configureDonationNotifications: async (input) => {
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
            id: schema.clanDonationNotificationConfigs.id,
            discordChannelId: schema.clanDonationNotificationConfigs.discordChannelId,
            eventType: schema.clanDonationNotificationConfigs.eventType,
          })
          .from(schema.clanDonationNotificationConfigs)
          .where(
            and(
              eq(schema.clanDonationNotificationConfigs.guildId, input.guildId),
              eq(schema.clanDonationNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.clanDonationNotificationConfigs.eventType, 'instant_donation'),
            ),
          );

        await tx
          .delete(schema.clanDonationNotificationConfigs)
          .where(
            and(
              eq(schema.clanDonationNotificationConfigs.guildId, input.guildId),
              eq(schema.clanDonationNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.clanDonationNotificationConfigs.eventType, 'instant_donation'),
            ),
          );

        const now = new Date();
        await tx.insert(schema.clanDonationNotificationConfigs).values({
          guildId: input.guildId,
          trackedClanId: trackedClan.id,
          discordChannelId: input.discordChannelId,
          eventType: 'instant_donation',
          isEnabled: true,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'clan_donation_notifications.enabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            discordChannelId: input.discordChannelId,
            eventTypes: ['instant_donation'],
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
    disableDonationNotifications: async (input) => {
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
            id: schema.clanDonationNotificationConfigs.id,
            discordChannelId: schema.clanDonationNotificationConfigs.discordChannelId,
            eventType: schema.clanDonationNotificationConfigs.eventType,
          })
          .from(schema.clanDonationNotificationConfigs)
          .where(
            and(
              eq(schema.clanDonationNotificationConfigs.guildId, input.guildId),
              eq(schema.clanDonationNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.clanDonationNotificationConfigs.eventType, 'instant_donation'),
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
          .delete(schema.clanDonationNotificationConfigs)
          .where(
            and(
              eq(schema.clanDonationNotificationConfigs.guildId, input.guildId),
              eq(schema.clanDonationNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.clanDonationNotificationConfigs.eventType, 'instant_donation'),
            ),
          );

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'clan_donation_notifications.disabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            eventTypes: ['instant_donation'],
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
    configureRoleChangeNotifications: async (input) => {
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
            id: schema.clanRoleChangeNotificationConfigs.id,
            discordChannelId: schema.clanRoleChangeNotificationConfigs.discordChannelId,
            eventType: schema.clanRoleChangeNotificationConfigs.eventType,
          })
          .from(schema.clanRoleChangeNotificationConfigs)
          .where(
            and(
              eq(schema.clanRoleChangeNotificationConfigs.guildId, input.guildId),
              eq(schema.clanRoleChangeNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.clanRoleChangeNotificationConfigs.eventType, 'role_change'),
            ),
          );

        await tx
          .delete(schema.clanRoleChangeNotificationConfigs)
          .where(
            and(
              eq(schema.clanRoleChangeNotificationConfigs.guildId, input.guildId),
              eq(schema.clanRoleChangeNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.clanRoleChangeNotificationConfigs.eventType, 'role_change'),
            ),
          );

        const now = new Date();
        await tx.insert(schema.clanRoleChangeNotificationConfigs).values({
          guildId: input.guildId,
          trackedClanId: trackedClan.id,
          discordChannelId: input.discordChannelId,
          eventType: 'role_change',
          isEnabled: true,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'clan_role_change_notifications.enabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            discordChannelId: input.discordChannelId,
            eventTypes: ['role_change'],
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
    disableRoleChangeNotifications: async (input) => {
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
            id: schema.clanRoleChangeNotificationConfigs.id,
            discordChannelId: schema.clanRoleChangeNotificationConfigs.discordChannelId,
            eventType: schema.clanRoleChangeNotificationConfigs.eventType,
          })
          .from(schema.clanRoleChangeNotificationConfigs)
          .where(
            and(
              eq(schema.clanRoleChangeNotificationConfigs.guildId, input.guildId),
              eq(schema.clanRoleChangeNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.clanRoleChangeNotificationConfigs.eventType, 'role_change'),
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
          .delete(schema.clanRoleChangeNotificationConfigs)
          .where(
            and(
              eq(schema.clanRoleChangeNotificationConfigs.guildId, input.guildId),
              eq(schema.clanRoleChangeNotificationConfigs.trackedClanId, trackedClan.id),
              eq(schema.clanRoleChangeNotificationConfigs.eventType, 'role_change'),
            ),
          );

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'clan_role_change_notifications.disabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            eventTypes: ['role_change'],
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
    configureClanGamesNotifications: async (input) => {
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
            id: schema.clanGamesNotificationConfigs.id,
            discordChannelId: schema.clanGamesNotificationConfigs.discordChannelId,
            eventType: schema.clanGamesNotificationConfigs.eventType,
          })
          .from(schema.clanGamesNotificationConfigs)
          .where(
            and(
              eq(schema.clanGamesNotificationConfigs.guildId, input.guildId),
              eq(schema.clanGamesNotificationConfigs.trackedClanId, trackedClan.id),
              inArray(
                schema.clanGamesNotificationConfigs.eventType,
                clanGamesNotificationEventTypes,
              ),
            ),
          );

        await tx
          .delete(schema.clanGamesNotificationConfigs)
          .where(
            and(
              eq(schema.clanGamesNotificationConfigs.guildId, input.guildId),
              eq(schema.clanGamesNotificationConfigs.trackedClanId, trackedClan.id),
              inArray(
                schema.clanGamesNotificationConfigs.eventType,
                clanGamesNotificationEventTypes,
              ),
            ),
          );

        const now = new Date();
        await tx.insert(schema.clanGamesNotificationConfigs).values(
          clanGamesNotificationEventTypes.map((eventType) => ({
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
          action: 'clan_games_notifications.enabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            discordChannelId: input.discordChannelId,
            eventTypes: clanGamesNotificationEventTypes,
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
    disableClanGamesNotifications: async (input) => {
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
            id: schema.clanGamesNotificationConfigs.id,
            discordChannelId: schema.clanGamesNotificationConfigs.discordChannelId,
            eventType: schema.clanGamesNotificationConfigs.eventType,
          })
          .from(schema.clanGamesNotificationConfigs)
          .where(
            and(
              eq(schema.clanGamesNotificationConfigs.guildId, input.guildId),
              eq(schema.clanGamesNotificationConfigs.trackedClanId, trackedClan.id),
              inArray(
                schema.clanGamesNotificationConfigs.eventType,
                clanGamesNotificationEventTypes,
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
          .delete(schema.clanGamesNotificationConfigs)
          .where(
            and(
              eq(schema.clanGamesNotificationConfigs.guildId, input.guildId),
              eq(schema.clanGamesNotificationConfigs.trackedClanId, trackedClan.id),
              inArray(
                schema.clanGamesNotificationConfigs.eventType,
                clanGamesNotificationEventTypes,
              ),
            ),
          );

        await tx.insert(schema.auditLogs).values({
          guildId: input.guildId,
          actorDiscordUserId: input.actorDiscordUserId,
          action: 'clan_games_notifications.disabled',
          targetType: 'tracked_clan',
          targetId: trackedClan.id,
          metadata: {
            clanTag: trackedClan.clanTag,
            clanName: trackedClan.name,
            eventTypes: clanGamesNotificationEventTypes,
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
