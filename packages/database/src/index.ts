import { and, count, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
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

export { schema };
