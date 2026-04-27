import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
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
  },
  (table) => ({
    guildSettingKeyUnique: uniqueIndex('guild_settings_guild_id_key_unique').on(
      table.guildId,
      table.key,
    ),
  }),
);

export const clanCategories = pgTable(
  'clan_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    displayName: text('display_name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clanCategoryNameUnique: uniqueIndex('clan_categories_guild_id_name_unique').on(
      table.guildId,
      table.name,
    ),
    clanCategorySortOrderIndex: index('clan_categories_guild_id_sort_order_idx').on(
      table.guildId,
      table.sortOrder,
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
    categoryId: uuid('category_id').references(() => clanCategories.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    guildClanTagUnique: uniqueIndex('tracked_clans_guild_id_clan_tag_unique').on(
      table.guildId,
      table.clanTag,
    ),
    clanTagIndex: index('tracked_clans_clan_tag_idx').on(table.clanTag),
    guildActiveIndex: index('tracked_clans_guild_id_active_idx').on(table.guildId, table.isActive),
    guildCategorySortOrderIndex: index('tracked_clans_guild_id_category_id_sort_order_idx').on(
      table.guildId,
      table.categoryId,
      table.sortOrder,
    ),
  }),
);

export const trackedClanChannels = pgTable(
  'tracked_clan_channels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    trackedClanId: uuid('tracked_clan_id')
      .notNull()
      .references(() => trackedClans.id, { onDelete: 'cascade' }),
    discordChannelId: text('discord_channel_id').notNull(),
    channelType: text('channel_type'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    guildChannelUnique: uniqueIndex('tracked_clan_channels_guild_id_channel_unique').on(
      table.guildId,
      table.discordChannelId,
    ),
    clanChannelUnique: uniqueIndex('tracked_clan_channels_clan_id_channel_unique').on(
      table.trackedClanId,
      table.discordChannelId,
    ),
    trackedClanIndex: index('tracked_clan_channels_tracked_clan_id_idx').on(table.trackedClanId),
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
  },
  (table) => ({
    targetUnique: uniqueIndex('global_access_blocks_target_unique').on(
      table.targetType,
      table.targetId,
    ),
    targetLookupIndex: index('global_access_blocks_target_lookup_idx').on(
      table.targetType,
      table.targetId,
    ),
  }),
);

export const commandUsageDaily = pgTable(
  'command_usage_daily',
  {
    usageDate: date('usage_date').notNull(),
    commandName: text('command_name').notNull(),
    guildId: text('guild_id'),
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    commandUsageDailyUnique: uniqueIndex('command_usage_daily_unique').on(
      table.usageDate,
      table.commandName,
      table.guildId,
    ),
    commandUsageDailyDateIndex: index('command_usage_daily_date_idx').on(table.usageDate),
  }),
);

export const commandUsageTotals = pgTable('command_usage_totals', {
  commandName: text('command_name').primaryKey(),
  usageCount: integer('usage_count').notNull().default(0),
  firstUsedAt: timestamp('first_used_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const botGrowthDaily = pgTable('bot_growth_daily', {
  usageDate: date('usage_date').primaryKey(),
  guildAdditions: integer('guild_additions').notNull().default(0),
  guildDeletions: integer('guild_deletions').notNull().default(0),
  guildRetention: integer('guild_retention').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clanLatestSnapshots = pgTable(
  'clan_latest_snapshots',
  {
    clanTag: text('clan_tag').primaryKey(),
    name: text('name').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clanLatestSnapshotsFetchedAtIndex: index('clan_latest_snapshots_fetched_at_idx').on(
      table.fetchedAt,
    ),
  }),
);

export const clanMemberSnapshots = pgTable(
  'clan_member_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clanTag: text('clan_tag').notNull(),
    playerTag: text('player_tag').notNull(),
    name: text('name').notNull(),
    role: text('role'),
    expLevel: integer('exp_level'),
    leagueId: integer('league_id'),
    trophies: integer('trophies'),
    builderBaseTrophies: integer('builder_base_trophies'),
    clanRank: integer('clan_rank'),
    previousClanRank: integer('previous_clan_rank'),
    donations: integer('donations'),
    donationsReceived: integer('donations_received'),
    rawMember: jsonb('raw_member').notNull().default(sql`'{}'::jsonb`),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clanMemberUnique: uniqueIndex('clan_member_snapshots_clan_tag_player_tag_unique').on(
      table.clanTag,
      table.playerTag,
    ),
    clanMemberClanLastSeenIndex: index('clan_member_snapshots_clan_tag_last_seen_idx').on(
      table.clanTag,
      table.lastSeenAt,
    ),
    clanMemberPlayerIndex: index('clan_member_snapshots_player_tag_idx').on(table.playerTag),
    clanMemberLastFetchedIndex: index('clan_member_snapshots_last_fetched_at_idx').on(
      table.lastFetchedAt,
    ),
  }),
);

export const clanMemberEvents = pgTable(
  'clan_member_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    trackedClanId: uuid('tracked_clan_id').references(() => trackedClans.id, {
      onDelete: 'set null',
    }),
    clanTag: text('clan_tag').notNull(),
    playerTag: text('player_tag').notNull(),
    playerName: text('player_name').notNull(),
    eventType: text('event_type').notNull(),
    eventKey: text('event_key').notNull(),
    previousSnapshot: jsonb('previous_snapshot'),
    currentSnapshot: jsonb('current_snapshot'),
    sourceFetchedAt: timestamp('source_fetched_at', { withTimezone: true }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clanMemberEventGuildKeyUnique: uniqueIndex('clan_member_events_guild_id_event_key_unique').on(
      table.guildId,
      table.eventKey,
    ),
    clanMemberEventGuildClanDetectedIndex: index(
      'clan_member_events_guild_id_clan_tag_detected_at_idx',
    ).on(table.guildId, table.clanTag, table.detectedAt),
    clanMemberEventClanPlayerDetectedIndex: index(
      'clan_member_events_clan_tag_player_tag_detected_at_idx',
    ).on(table.clanTag, table.playerTag, table.detectedAt),
    clanMemberEventTypeDetectedIndex: index('clan_member_events_event_type_detected_at_idx').on(
      table.eventType,
      table.detectedAt,
    ),
  }),
);

export const warLatestSnapshots = pgTable(
  'war_latest_snapshots',
  {
    clanTag: text('clan_tag').primaryKey(),
    state: text('state').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    warLatestSnapshotsFetchedAtIndex: index('war_latest_snapshots_fetched_at_idx').on(
      table.fetchedAt,
    ),
    warLatestSnapshotsStateIndex: index('war_latest_snapshots_state_idx').on(table.state),
  }),
);

export const playerLatestSnapshots = pgTable(
  'player_latest_snapshots',
  {
    playerTag: text('player_tag').primaryKey(),
    name: text('name').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    playerLatestSnapshotsFetchedAtIndex: index('player_latest_snapshots_fetched_at_idx').on(
      table.fetchedAt,
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
  clanCategories: many(clanCategories),
  clans: many(trackedClans),
  clanChannels: many(trackedClanChannels),
  clanMemberEvents: many(clanMemberEvents),
}));

export const guildSettingsRelations = relations(guildSettings, ({ one }) => ({
  guild: one(guilds, {
    fields: [guildSettings.guildId],
    references: [guilds.id],
  }),
}));

export const clanCategoryRelations = relations(clanCategories, ({ one, many }) => ({
  guild: one(guilds, {
    fields: [clanCategories.guildId],
    references: [guilds.id],
  }),
  clans: many(trackedClans),
}));

export const trackedClanRelations = relations(trackedClans, ({ one, many }) => ({
  guild: one(guilds, {
    fields: [trackedClans.guildId],
    references: [guilds.id],
  }),
  category: one(clanCategories, {
    fields: [trackedClans.categoryId],
    references: [clanCategories.id],
  }),
  channels: many(trackedClanChannels),
  memberEvents: many(clanMemberEvents),
}));

export const trackedClanChannelRelations = relations(trackedClanChannels, ({ one }) => ({
  guild: one(guilds, {
    fields: [trackedClanChannels.guildId],
    references: [guilds.id],
  }),
  trackedClan: one(trackedClans, {
    fields: [trackedClanChannels.trackedClanId],
    references: [trackedClans.id],
  }),
}));

export const clanMemberEventRelations = relations(clanMemberEvents, ({ one }) => ({
  guild: one(guilds, {
    fields: [clanMemberEvents.guildId],
    references: [guilds.id],
  }),
  trackedClan: one(trackedClans, {
    fields: [clanMemberEvents.trackedClanId],
    references: [trackedClans.id],
  }),
}));
