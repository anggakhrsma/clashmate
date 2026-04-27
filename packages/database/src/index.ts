import { and, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDatabase>;

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

export interface ProcessClanMemberSnapshotsInput {
  clanTag: string;
  fetchedAt: Date;
  members: readonly ClanMemberSnapshotInput[];
}

export interface ProcessClanMemberSnapshotsResult {
  status: 'processed' | 'not_linked';
  joined: number;
  left: number;
}

export interface ClanMemberEventStore {
  processClanMemberSnapshots: (
    input: ProcessClanMemberSnapshotsInput,
  ) => Promise<ProcessClanMemberSnapshotsResult>;
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

        if (linkedClans.length === 0) return { status: 'not_linked', joined: 0, left: 0 };

        const previousMembers = await tx
          .select({
            playerTag: schema.clanMemberSnapshots.playerTag,
            name: schema.clanMemberSnapshots.name,
            rawMember: schema.clanMemberSnapshots.rawMember,
            lastSeenAt: schema.clanMemberSnapshots.lastSeenAt,
          })
          .from(schema.clanMemberSnapshots)
          .where(eq(schema.clanMemberSnapshots.clanTag, clanTag));
        const previousMemberTags = new Set(previousMembers.map((member) => member.playerTag));
        const isInitialSnapshot = previousMembers.length === 0;

        let joined = 0;
        let left = 0;

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

        for (const member of members) {
          if (!isInitialSnapshot && !previousMemberTags.has(member.playerTag)) {
            joined += await insertEvents({
              playerTag: member.playerTag,
              playerName: member.name,
              eventType: 'joined',
              previousSnapshot: null,
              currentSnapshot: member.rawMember,
            });
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

        return { status: 'processed', joined, left };
      });
    },
  };
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
