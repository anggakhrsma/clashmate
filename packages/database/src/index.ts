import { and, count, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
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
  syncLinkedPlayerPollingLeases: (
    runAfter?: Date,
  ) => Promise<{ enrolled: number; removed: number }>;
  syncWarPollingLeasesFromLinkedClans: (runAfter?: Date) => Promise<{
    enrolled: number;
    removed: number;
  }>;
}

export interface PollingEnrollmentSource {
  readonly resourceId: string;
  readonly deletedAt?: Date | null;
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
        .where(and(eq(schema.trackedClans.isActive, true), isNull(schema.trackedClans.deletedAt)));

      return row?.value ?? 0;
    },
    countPlayerLinks: async () => {
      const [row] = await database
        .select({ value: count() })
        .from(schema.playerLinks)
        .where(isNull(schema.playerLinks.deletedAt));

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
        .where(and(eq(schema.trackedClans.guildId, guildId), isNull(schema.trackedClans.deletedAt)))
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
        .where(and(eq(schema.guilds.id, guildId), isNull(schema.guilds.deletedAt)))
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
          deletedAt: schema.trackedClans.deletedAt,
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
    syncLinkedPlayerPollingLeases: async (runAfter) => {
      const rows = await database
        .select({
          resourceId: schema.playerLinks.playerTag,
          deletedAt: schema.playerLinks.deletedAt,
        })
        .from(schema.playerLinks);
      return syncPollingLeasesForType(
        database,
        'player',
        buildPollingEnrollmentResourceIds(rows),
        runAfter,
      );
    },
    syncWarPollingLeasesFromLinkedClans: async (runAfter) => {
      const rows = await database
        .select({
          resourceId: schema.trackedClans.clanTag,
          deletedAt: schema.trackedClans.deletedAt,
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

export function buildPollingEnrollmentResourceIds(
  sources: readonly PollingEnrollmentSource[],
): string[] {
  return [
    ...new Set(
      sources
        .filter((source) => source.deletedAt == null && source.isActive !== false)
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
              isNull(schema.globalAccessBlocks.deletedAt),
            ),
          )
          .limit(1);

        if (existing) {
          await tx
            .update(schema.globalAccessBlocks)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
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
    linkClan: async (input) =>
      database.transaction(async (tx) => {
        await tx
          .insert(schema.guilds)
          .values({ id: input.guildId, name: input.guildName })
          .onConflictDoUpdate({
            target: schema.guilds.id,
            set: { name: input.guildName, updatedAt: new Date(), deletedAt: null },
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
              isNull(schema.trackedClans.deletedAt),
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
                  deletedAt: null,
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
              isNull(schema.trackedClanChannels.deletedAt),
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
              isNull(schema.trackedClans.deletedAt),
            ),
          )
          .limit(1);
        if (!clan) return { status: 'not_found' };
        const now = new Date();
        await tx
          .update(schema.trackedClans)
          .set({ isActive: false, deletedAt: now, updatedAt: now })
          .where(eq(schema.trackedClans.id, clan.id));
        await tx
          .update(schema.trackedClanChannels)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(schema.trackedClanChannels.trackedClanId, clan.id),
              isNull(schema.trackedClanChannels.deletedAt),
            ),
          );
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
              isNull(schema.trackedClanChannels.deletedAt),
            ),
          )
          .limit(1);
        if (!row) return { status: 'not_found' };
        await tx
          .update(schema.trackedClanChannels)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
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
    .where(
      and(
        eq(schema.clanCategories.guildId, guildId),
        eq(schema.clanCategories.name, name),
        isNull(schema.clanCategories.deletedAt),
      ),
    )
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
        isNull(schema.globalAccessBlocks.deletedAt),
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
  if (stale.length > 0) {
    await database
      .delete(schema.pollingLeases)
      .where(
        and(
          eq(schema.pollingLeases.resourceType, resourceType),
          inArray(schema.pollingLeases.resourceId, stale),
        ),
      );
  }

  return { enrolled: desired.size, removed: stale.length };
}

export { schema };
