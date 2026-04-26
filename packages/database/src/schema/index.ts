import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const guilds = pgTable('guilds', {
  id: text('id').primaryKey(),
  name: text('name'),
  locale: text('locale').notNull().default('en'),
  timezone: text('timezone').notNull().default('UTC'),
  embedColor: text('embed_color'),
  diagnosticsEnabled: boolean('diagnostics_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const guildSettings = pgTable(
  'guild_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    guildSettingKeyUnique: uniqueIndex('guild_settings_guild_id_key_unique').on(
      table.guildId,
      table.key,
    ),
  }),
);

export const trackedClans = pgTable(
  'tracked_clans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    clanTag: text('clan_tag').notNull(),
    name: text('name'),
    alias: text('alias'),
    categoryId: uuid('category_id'),
    isActive: boolean('is_active').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    guildClanTagUnique: uniqueIndex('tracked_clans_guild_id_clan_tag_unique').on(
      table.guildId,
      table.clanTag,
    ),
    clanTagIndex: index('tracked_clans_clan_tag_idx').on(table.clanTag),
  }),
);

export const playerLinks = pgTable(
  'player_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: text('guild_id').references(() => guilds.id, { onDelete: 'cascade' }),
    discordUserId: text('discord_user_id').notNull(),
    playerTag: text('player_tag').notNull(),
    isVerified: boolean('is_verified').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    userPlayerUnique: uniqueIndex('player_links_user_player_unique').on(
      table.discordUserId,
      table.playerTag,
    ),
    playerTagIndex: index('player_links_player_tag_idx').on(table.playerTag),
    discordUserIndex: index('player_links_discord_user_id_idx').on(table.discordUserId),
  }),
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: text('guild_id').references(() => guilds.id, { onDelete: 'set null' }),
    actorDiscordUserId: text('actor_discord_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    auditGuildCreatedIndex: index('audit_logs_guild_id_created_at_idx').on(
      table.guildId,
      table.createdAt,
    ),
  }),
);

export const globalAccessBlocks = pgTable(
  'global_access_blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    targetName: text('target_name'),
    createdByDiscordUserId: text('created_by_discord_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    activeTargetUnique: uniqueIndex('global_access_blocks_active_target_unique')
      .on(table.targetType, table.targetId)
      .where(sql`${table.deletedAt} is null`),
    targetLookupIndex: index('global_access_blocks_target_lookup_idx').on(
      table.targetType,
      table.targetId,
      table.deletedAt,
    ),
  }),
);

export const pollingLeases = pgTable(
  'polling_leases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    ownerId: text('owner_id'),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pollingResourceUnique: uniqueIndex('polling_leases_resource_unique').on(
      table.resourceType,
      table.resourceId,
    ),
    pollingDueIndex: index('polling_leases_due_idx').on(table.runAfter, table.lockedUntil),
  }),
);

export const guildRelations = relations(guilds, ({ many }) => ({
  settings: many(guildSettings),
  clans: many(trackedClans),
}));
