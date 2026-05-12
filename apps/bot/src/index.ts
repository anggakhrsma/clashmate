import { ClashMateCocClient } from '@clashmate/coc';
import { loadConfig } from '@clashmate/config';
import {
  createCapitalRaidSeasonReader,
  createClanGamesHistoryReader,
  createClanGamesScoreboardReader,
  createClanMemberJoinLeaveHistoryReader,
  createClanMemberSnapshotReader,
  createDatabase,
  createDatabaseAutoroleSettingsStore,
  createDatabaseBotGrowthRecorder,
  createDatabaseCallerBaseStore,
  createDatabaseClanMemberNotificationConfigStore,
  createDatabaseCommandUsageRecorder,
  createDatabaseCommandWhitelistStore,
  createDatabaseConfigStore,
  createDatabaseDebugReader,
  createDatabaseLayoutConfigStore,
  createDatabaseNicknameConfigStore,
  createDatabasePlayerLinkStore,
  createDatabaseReconciliationPlanningOutcomeStore,
  createDatabaseReminderSettingsStore,
  createDatabaseStatusMetrics,
  createDatabaseTrackedClanStore,
  createDatabaseUsageMetrics,
  createDatabaseUserTimezonePreferenceStore,
  createDonationHistoryReader,
  createDonationSnapshotReader,
  createGlobalAccessBlockStore,
  createLastSeenSnapshotReader,
  createMissedWarAttackEventStore,
  createWarAttackHistoryReader,
  createWarSnapshotStore,
} from '@clashmate/database';
import {
  isOwner,
  routeAutocompleteInteraction,
  type SlashCommandDefinition,
} from '@clashmate/discord';
import { createLogger } from '@clashmate/logger';
import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  type InteractionReplyOptions,
  PermissionFlagsBits,
} from 'discord.js';

import { createBotCommandRegistry } from './commands/index.js';
import { loadBotPackageVersion, type StatusMetricReader } from './commands/status.js';

const config = loadConfig();
const logger = createLogger('bot', config.LOG_LEVEL);
const startupStartedAt = Date.now();
const database = createDatabase(config.DATABASE_URL);
const botGrowthRecorder = createDatabaseBotGrowthRecorder(database);
const commandUsageRecorder = createDatabaseCommandUsageRecorder(database);
const commandWhitelistStore = createDatabaseCommandWhitelistStore(database);
const databaseAutoroleSettingsStore = createDatabaseAutoroleSettingsStore(database);
const databaseCallerBaseStore = createDatabaseCallerBaseStore(database);
const databaseConfigStore = createDatabaseConfigStore(database);
const databaseNicknameConfigStore = createDatabaseNicknameConfigStore(database);
const databaseReconciliationPlanningOutcomes =
  createDatabaseReconciliationPlanningOutcomeStore(database);
const databaseDebugReader = createDatabaseDebugReader(database);
const databaseLayoutConfigStore = createDatabaseLayoutConfigStore(database);
const databaseStatusMetrics = createDatabaseStatusMetrics(database);
const databaseUsageMetrics = createDatabaseUsageMetrics(database);
const databaseUserTimezonePreferences = createDatabaseUserTimezonePreferenceStore(database);
const databaseTrackedClans = createDatabaseTrackedClanStore(database);
const databaseClanGamesScoreboards = createClanGamesScoreboardReader(database);
const databaseClanGamesHistory = createClanGamesHistoryReader(database);
const databaseCapitalRaids = createCapitalRaidSeasonReader(database);
const databaseClanMemberNotifications = createDatabaseClanMemberNotificationConfigStore(database);
const databasePlayerLinks = createDatabasePlayerLinkStore(database);
const databaseReminderSettings = createDatabaseReminderSettingsStore(database);
const databaseLastSeenSnapshots = createLastSeenSnapshotReader(database);
const databaseClanMemberSnapshots = createClanMemberSnapshotReader(database);
const databaseDonationSnapshots = createDonationSnapshotReader(database);
const databaseDonationHistory = createDonationHistoryReader(database);
const databaseClanMemberJoinLeaveHistory = createClanMemberJoinLeaveHistoryReader(database);
const databaseWarAttackHistory = createWarAttackHistoryReader(database);
const databaseWarSnapshots = createWarSnapshotStore(database);
const databaseMissedWarAttacks = createMissedWarAttackEventStore(database);
const globalAccessBlocks = createGlobalAccessBlockStore(database);
const cocClient = new ClashMateCocClient({ token: config.CLASH_OF_CLANS_API_TOKEN });

const statusMetricReader: StatusMetricReader = {
  countCommandsUsedLast30Days: databaseStatusMetrics.countCommandsUsedLast30Days,
  countClans: databaseStatusMetrics.countTrackedClans,
  countLinks: databaseStatusMetrics.countPlayerLinks,
  listRecentReconciliationPlanningOutcomes:
    databaseReconciliationPlanningOutcomes.listRecentReconciliationPlanningOutcomes,
};

const { GIT_SHA: gitSha, SOURCE_REPOSITORY_URL: sourceRepositoryUrl } = process.env;

const loadedCommandNames = [
  'activity',
  'alias',
  'army',
  'attacks',
  'autorole',
  'blacklist',
  'boosts',
  'capital',
  'caller',
  'category',
  'clan-games',
  'clan',
  'clans',
  'compo',
  'config',
  'cwl',
  'debug',
  'donations',
  'events',
  'guild-ban',
  'help',
  'history',
  'invite',
  'lastseen',
  'layout',
  'leaderboard',
  'legend',
  'lineup',
  'link',
  'members',
  'nickname',
  'player',
  'profile',
  'remaining',
  'reminders',
  'rushed',
  'search',
  'setup',
  'stats',
  'summary',
  'status',
  'timezone',
  'units',
  'upgrades',
  'usage',
  'verify',
  'war',
  'warlog',
  'whitelist',
] as const;

const commandRegistry = createBotCommandRegistry({
  activity: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
    },
    timezones: databaseUserTimezonePreferences,
  },
  alias: {
    store: databaseTrackedClans,
  },
  blacklist: {
    accessBlocks: globalAccessBlocks,
  },
  attacks: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listPlayerTagsForUser: databasePlayerLinks.listPlayerTagsForUser,
    },
    coc: cocClient,
  },
  autorole: {
    store: {
      getAutoroleSettings: databaseAutoroleSettingsStore.getAutoroleSettings,
      updateAutoroleSettings: databaseAutoroleSettingsStore.updateAutoroleSettings,
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
    },
    getGuildConfig: databaseConfigStore.getGuildConfig,
  },
  boosts: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
    },
    coc: cocClient,
  },
  capital: {
    store: {
      listClansForGuild: databaseTrackedClans.listClansForGuild,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
      listCapitalRaidSeasonsForGuild: databaseCapitalRaids.listCapitalRaidSeasonsForGuild,
      listPlayerTagsForUser: databasePlayerLinks.listPlayerTagsForUser,
    },
  },
  caller: {
    store: {
      getLatestWarSnapshotsForGuild: databaseWarSnapshots.getLatestWarSnapshotsForGuild,
      assignCallerBase: databaseCallerBaseStore.assignCallerBase,
      clearCallerBase: databaseCallerBaseStore.clearCallerBase,
    },
  },
  category: {
    store: databaseTrackedClans,
  },
  clanGames: {
    reader: databaseClanGamesScoreboards,
    links: {
      listPlayerTagsForUser: databasePlayerLinks.listPlayerTagsForUser,
    },
  },
  clan: {
    coc: cocClient,
  },
  clans: {
    clans: databaseTrackedClans,
  },
  compo: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listPlayerTagsForUser: databasePlayerLinks.listPlayerTagsForUser,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
    },
  },
  config: {
    store: databaseConfigStore,
  },
  cwl: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      getLatestWarSnapshot: databaseWarSnapshots.getLatestWarSnapshot,
      getLatestWarSnapshotsForGuild: databaseWarSnapshots.getLatestWarSnapshotsForGuild,
      getRetainedWarSnapshotsForGuild: (input) =>
        databaseWarSnapshots.getRetainedWarSnapshotsForGuild?.(input) ?? Promise.resolve([]),
      ...(databaseWarSnapshots.listRetainedEndedWarSnapshotsForGuild
        ? {
            listRetainedEndedWarSnapshotsForGuild:
              databaseWarSnapshots.listRetainedEndedWarSnapshotsForGuild,
          }
        : {}),
      getLinkedPlayerTags: databasePlayerLinks.listPlayerTagsForUser,
      listWarAttackHistoryForGuild: databaseWarAttackHistory.listWarAttackHistoryForGuild,
    },
  },
  debug: {
    dataReader: databaseDebugReader,
    logger,
  },
  donations: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listPlayerTagsForUser: databasePlayerLinks.listPlayerTagsForUser,
      listDonationSnapshotsForGuild: databaseDonationSnapshots.listDonationSnapshotsForGuild,
      listDonationHistoryForGuild: databaseDonationHistory.listDonationHistoryForGuild,
    },
  },
  events: {
    timezones: databaseUserTimezonePreferences,
  },
  guildBan: {
    accessBlocks: globalAccessBlocks,
  },
  history: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listClansForGuild: databaseTrackedClans.listClansForGuild,
      listPlayerTagsForUser: databasePlayerLinks.listPlayerTagsForUser,
      listDonationHistoryForGuild: databaseDonationHistory.listDonationHistoryForGuild,
      listWarAttackHistoryForGuild: databaseWarAttackHistory.listWarAttackHistoryForGuild,
      listClanMemberJoinLeaveHistoryForGuild:
        databaseClanMemberJoinLeaveHistory.listClanMemberJoinLeaveHistoryForGuild,
      listClanGamesHistoryForGuild: databaseClanGamesHistory.listClanGamesHistoryForGuild,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
    },
  },
  link: {
    coc: cocClient,
    links: databasePlayerLinks,
    config: databaseConfigStore,
  },
  lineup: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      getLatestWarSnapshot: databaseWarSnapshots.getLatestWarSnapshot,
      getLatestWarSnapshotsForGuild: databaseWarSnapshots.getLatestWarSnapshotsForGuild,
      getLinkedPlayerTags: databasePlayerLinks.listPlayerTagsForUser,
    },
  },
  lastSeen: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listPlayerTagsForUser: databasePlayerLinks.listPlayerTagsForUser,
      listLastSeenSnapshots: databaseLastSeenSnapshots.listLastSeenSnapshots,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
    },
    timezones: databaseUserTimezonePreferences,
  },
  layout: {
    store: databaseLayoutConfigStore,
  },
  leaderboard: {
    store: {
      listClansForGuild: databaseTrackedClans.listClansForGuild,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
    },
  },
  legend: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
    },
  },
  members: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listPlayerTagsForUser: databasePlayerLinks.listPlayerTagsForUser,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
    },
  },
  nickname: {
    store: databaseNicknameConfigStore,
  },
  player: {
    coc: cocClient,
    links: databasePlayerLinks,
  },
  profile: {
    links: databasePlayerLinks,
    timezones: databaseUserTimezonePreferences,
  },
  units: {
    coc: cocClient,
    links: databasePlayerLinks,
  },
  upgrades: {
    coc: cocClient,
    links: databasePlayerLinks,
  },
  remaining: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      getLatestWarSnapshot: databaseWarSnapshots.getLatestWarSnapshot,
      getLatestWarSnapshotsForGuild: databaseWarSnapshots.getLatestWarSnapshotsForGuild,
      getRetainedWarSnapshotsForGuild: (input) =>
        databaseWarSnapshots.getRetainedWarSnapshotsForGuild?.(input) ?? Promise.resolve([]),
      getLinkedPlayerTags: databasePlayerLinks.listPlayerTagsForUser,
      listMissedWarAttacksForWar: (guildId, clanTag, warKey) =>
        databaseMissedWarAttacks.listMissedWarAttacksForWar?.(guildId, clanTag, warKey) ??
        Promise.resolve([]),
    },
  },
  reminders: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
      listPlayerLinksByTags: databasePlayerLinks.listPlayerLinksByTags,
      getReminderSettings: databaseReminderSettings.getReminderSettings,
      createReminderSchedule: databaseReminderSettings.createReminderSchedule,
      updateReminderScheduleDuration: databaseReminderSettings.updateReminderScheduleDuration,
      deleteReminderSchedule: databaseReminderSettings.deleteReminderSchedule,
      setReminderPingExclusion: databaseReminderSettings.setReminderPingExclusion,
    },
  },
  search: {
    coc: cocClient,
  },
  rushed: {
    coc: cocClient,
    links: databasePlayerLinks,
    clans: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
    },
  },
  setupClan: {
    clans: databaseTrackedClans,
    coc: cocClient,
    memberNotifications: databaseClanMemberNotifications,
  },
  stats: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listPlayerTagsForUser: databasePlayerLinks.listPlayerTagsForUser,
      listWarAttackHistoryForGuild: databaseWarAttackHistory.listWarAttackHistoryForGuild,
    },
  },
  summary: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listClansForGuild: databaseTrackedClans.listClansForGuild,
      listDonationSnapshotsForGuild: databaseDonationSnapshots.listDonationSnapshotsForGuild,
      listClanMemberSnapshotsForGuild: databaseClanMemberSnapshots.listClanMemberSnapshotsForGuild,
      listWarAttackHistoryForGuild: databaseWarAttackHistory.listWarAttackHistoryForGuild,
      getLatestWarSnapshotsForGuild: databaseWarSnapshots.getLatestWarSnapshotsForGuild,
      ...(databaseWarSnapshots.listRetainedEndedWarSnapshotsForGuild
        ? {
            listRetainedEndedWarSnapshotsForGuild:
              databaseWarSnapshots.listRetainedEndedWarSnapshotsForGuild,
          }
        : {}),
      listMissedWarAttackSummaryForGuild:
        databaseMissedWarAttacks.listMissedWarAttackSummaryForGuild,
      listCapitalRaidSeasonsForGuild: databaseCapitalRaids.listCapitalRaidSeasonsForGuild,
    },
  },
  timezone: {
    store: databaseUserTimezonePreferences,
  },
  status: {
    metricReader: statusMetricReader,
    version: loadBotPackageVersion(),
    logger,
    ...(gitSha ? { commitSha: gitSha } : {}),
    ...(sourceRepositoryUrl ? { repositoryUrl: sourceRepositoryUrl } : {}),
  },
  usage: {
    metricReader: databaseUsageMetrics,
    loadedCommandNames,
    logger,
  },
  verify: {
    coc: cocClient,
    links: databasePlayerLinks,
  },
  war: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      getLatestWarSnapshot: databaseWarSnapshots.getLatestWarSnapshot,
      getLatestWarSnapshotsForGuild: databaseWarSnapshots.getLatestWarSnapshotsForGuild,
      getRetainedWarSnapshotsForGuild: (input) =>
        databaseWarSnapshots.getRetainedWarSnapshotsForGuild?.(input) ?? Promise.resolve([]),
      getLinkedPlayerTags: databasePlayerLinks.listPlayerTagsForUser,
    },
  },
  warlog: {
    store: {
      listLinkedClans: databaseTrackedClans.listLinkedClans,
      listRetainedEndedWarSnapshotsForGuild: (input) =>
        databaseWarSnapshots.listRetainedEndedWarSnapshotsForGuild?.(input) ?? Promise.resolve([]),
      getLinkedPlayerTags: databasePlayerLinks.listPlayerTagsForUser,
    },
  },
  whitelist: {
    store: commandWhitelistStore,
    loadedCommandNames,
  },
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

logger.info(
  {
    loadedCommandCount: loadedCommandNames.length,
    registeredSlashCommandCount: commandRegistry.slashCommands.size,
    commandRegistrationMode: config.COMMAND_REGISTRATION,
    ownerIdCount: config.DISCORD_OWNER_IDS.length,
  },
  'Bot runtime initialized',
);

registerShutdownHandlers(client);

client.once('ready', async (readyClient) => {
  logger.info(
    {
      user: readyClient.user.tag,
      startupDurationMs: Date.now() - startupStartedAt,
      loadedCommandCount: loadedCommandNames.length,
      registeredSlashCommandCount: commandRegistry.slashCommands.size,
      commandRegistrationMode: config.COMMAND_REGISTRATION,
      ownerIdCount: config.DISCORD_OWNER_IDS.length,
    },
    'Bot ready',
  );

  try {
    const registrationStartedAt = Date.now();
    await registerSlashCommands(readyClient, Array.from(commandRegistry.slashCommands.values()));
    logger.info(
      {
        commands: commandRegistry.slashCommands.size,
        commandRegistrationMode: config.COMMAND_REGISTRATION,
        registrationDurationMs: Date.now() - registrationStartedAt,
      },
      'Registered slash commands',
    );
  } catch (error) {
    logger.error(
      {
        error,
        commands: commandRegistry.slashCommands.size,
        commandRegistrationMode: config.COMMAND_REGISTRATION,
      },
      'Failed to register slash commands',
    );
  }
});

client.on('guildCreate', async (guild) => {
  if (isOwner(guild.ownerId, config.DISCORD_OWNER_IDS)) return;

  try {
    await botGrowthRecorder.recordGuildAddition({
      guildId: guild.id,
      guildName: guild.name,
    });
    logger.info(
      { guildId: guild.id, guildName: guild.name, ownerId: guild.ownerId },
      'Recorded guild addition growth metric',
    );
  } catch (error) {
    logger.warn(
      { error, guildId: guild.id, guildName: guild.name, ownerId: guild.ownerId },
      'Failed to record guild addition growth metric',
    );
  }
});

client.on('guildDelete', async (guild) => {
  if (isOwner(guild.ownerId, config.DISCORD_OWNER_IDS)) return;

  try {
    await botGrowthRecorder.recordGuildDeletion({
      guildId: guild.id,
      guildName: guild.name,
    });
    logger.info(
      { guildId: guild.id, guildName: guild.name, ownerId: guild.ownerId },
      'Recorded guild deletion growth metric',
    );
  } catch (error) {
    logger.warn(
      { error, guildId: guild.id, guildName: guild.name, ownerId: guild.ownerId },
      'Failed to record guild deletion growth metric',
    );
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    const context = getInteractionLogContext(interaction);
    try {
      const handled = await routeAutocompleteInteraction(commandRegistry, interaction, {
        client,
        ownerIds: config.DISCORD_OWNER_IDS,
      });
      if (!handled) {
        logger.debug(context, 'Autocomplete interaction was not handled; sending empty choices');
        await respondAutocompleteEmpty(interaction, 'Autocomplete interaction was not handled');
      }
    } catch (error) {
      logger.error({ error, ...context }, 'Autocomplete interaction failed');
      await respondAutocompleteEmpty(interaction, 'Failed to send autocomplete fallback response');
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commandRegistry.slashCommands.get(interaction.commandName);
  const context = getInteractionLogContext(interaction);
  if (!command) {
    logger.warn(context, 'Unhandled slash command interaction');
    return;
  }

  const startedAt = Date.now();

  try {
    if (!isOwner(interaction.user.id, config.DISCORD_OWNER_IDS)) {
      if (await globalAccessBlocks.isUserBlacklisted(interaction.user.id)) {
        logger.info({ ...context, reason: 'user_blacklisted' }, 'Blocked command interaction');
        await interaction.reply({
          content: 'You are not allowed to use ClashMate commands.',
          ephemeral: true,
        });
        return;
      }

      if (
        interaction.guildId &&
        (await globalAccessBlocks.isGuildBlacklisted(interaction.guildId))
      ) {
        logger.info({ ...context, reason: 'guild_blacklisted' }, 'Blocked command interaction');
        await interaction.reply({
          content: 'This server is not allowed to use ClashMate commands.',
          ephemeral: true,
        });
        return;
      }
    }

    if (!(await enforceCommandWhitelist(interaction))) return;

    await command.execute(interaction, { client, ownerIds: config.DISCORD_OWNER_IDS });
    logger.info(
      { ...context, durationMs: Date.now() - startedAt },
      'Slash command execution completed',
    );

    if (isOwner(interaction.user.id, config.DISCORD_OWNER_IDS)) {
      logger.debug({ ...context, reason: 'owner_invocation' }, 'Skipped command usage metric');
      return;
    }

    try {
      await commandUsageRecorder.recordCommandUsage({
        commandName: interaction.commandName,
        guildId: interaction.guildId,
      });
    } catch (error) {
      logger.warn({ error, ...context }, 'Failed to record command usage');
    }
  } catch (error) {
    logger.error({ error, ...context, durationMs: Date.now() - startedAt }, 'Slash command failed');
    await sendCommandFailure(interaction);
  }
});

client.on('error', (error) => {
  logger.error({ error }, 'Discord client error');
});

await startBot(client, config.DISCORD_TOKEN);

async function startBot(discordClient: Client, token: string): Promise<void> {
  try {
    await discordClient.login(token);
  } catch (error) {
    process.exitCode = 1;
    logger.error(
      { error, startupDurationMs: Date.now() - startupStartedAt, exitCode: process.exitCode },
      'Bot startup failed',
    );
    throw error;
  }
}

function registerShutdownHandlers(discordClient: Client): void {
  let isShuttingDown = false;

  const handleShutdown = (signal: NodeJS.Signals): void => {
    if (isShuttingDown) {
      logger.warn({ signal, exitCode: process.exitCode ?? 0 }, 'Ignored duplicate shutdown signal');
      return;
    }
    isShuttingDown = true;

    logger.info({ signal, exitCode: process.exitCode ?? 0 }, 'Bot shutdown started');

    try {
      discordClient.destroy();
      process.exitCode = 0;
      logger.info({ signal, exitCode: process.exitCode }, 'Bot shutdown completed');
    } catch (error) {
      process.exitCode = 1;
      logger.error({ error, signal, exitCode: process.exitCode }, 'Bot shutdown failed');
    }
  };

  process.once('SIGTERM', handleShutdown);
  process.once('SIGINT', handleShutdown);
}

function getInteractionLogContext(
  interaction: AutocompleteInteraction | ChatInputCommandInteraction,
): {
  command: string;
  guildId: string | null;
  channelId: string | null;
  userId: string;
  interactionId: string;
} {
  return {
    command: interaction.commandName,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    interactionId: interaction.id,
  };
}

export interface CommandWhitelistAccessInput {
  commandName: string;
  userId: string;
  ownerIds: readonly string[];
  hasManageGuild: boolean;
  roleIds: readonly string[];
  botManagerRoleIds: readonly string[];
  entries: readonly { commandName: string; userOrRoleId: string; isRole: boolean }[];
}

export function canUseWhitelistedCommand(input: CommandWhitelistAccessInput): boolean {
  const entries = input.entries.filter((entry) => entry.commandName === input.commandName);
  if (entries.length === 0) return true;
  if (isOwner(input.userId, input.ownerIds)) return true;
  if (input.hasManageGuild) return true;
  if (hasAnyRole(input.roleIds, input.botManagerRoleIds)) return true;
  return entries.some((entry) =>
    entry.isRole ? input.roleIds.includes(entry.userOrRoleId) : entry.userOrRoleId === input.userId,
  );
}

export function hasAnyRole(
  memberRoleIds: readonly string[],
  configuredRoleIds: readonly string[],
): boolean {
  if (configuredRoleIds.length === 0) return false;
  return memberRoleIds.some((roleId) => configuredRoleIds.includes(roleId));
}

async function enforceCommandWhitelist(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guildId) return true;

  const entries = await commandWhitelistStore.listCommandWhitelist(interaction.guildId);
  if (!entries.some((entry) => entry.commandName === interaction.commandName)) return true;

  const roleIds = interaction.inCachedGuild()
    ? interaction.member.roles.cache.map((role) => role.id)
    : [];
  const guildConfig = await databaseConfigStore.getGuildConfig(interaction.guildId);
  const allowed = canUseWhitelistedCommand({
    commandName: interaction.commandName,
    userId: interaction.user.id,
    ownerIds: config.DISCORD_OWNER_IDS,
    hasManageGuild: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
    roleIds,
    botManagerRoleIds: guildConfig.botManagerRoleIds,
    entries,
  });

  if (allowed) return true;

  logger.info(
    {
      ...getInteractionLogContext(interaction),
      reason: 'command_whitelist',
      whitelistEntries: entries.filter((entry) => entry.commandName === interaction.commandName)
        .length,
      roleCount: roleIds.length,
      hasManageGuild: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
    },
    'Denied command interaction by whitelist',
  );

  await interaction.reply({
    content: 'This command is whitelisted for specific users or roles in this server.',
    ephemeral: true,
  });
  return false;
}

async function registerSlashCommands(
  readyClient: Client<true>,
  commands: readonly SlashCommandDefinition[],
): Promise<void> {
  await readyClient.application.commands.set(commands.map((command) => command.data));
}

async function sendCommandFailure(interaction: {
  deferred: boolean;
  replied: boolean;
  reply: (options: InteractionReplyOptions) => Promise<unknown>;
  followUp: (options: InteractionReplyOptions) => Promise<unknown>;
}): Promise<void> {
  const options: InteractionReplyOptions = {
    content: 'Something went wrong while running this command.',
    ephemeral: true,
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(options);
    return;
  }

  await interaction.reply(options);
}

async function respondAutocompleteEmpty(
  interaction: AutocompleteInteraction,
  failureMessage: string,
): Promise<void> {
  if (interaction.responded) return;

  try {
    await interaction.respond([]);
  } catch (error) {
    logger.warn({ error, ...getInteractionLogContext(interaction) }, failureMessage);
  }
}
