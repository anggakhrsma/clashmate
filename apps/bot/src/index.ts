import { ClashMateCocClient } from '@clashmate/coc';
import { loadConfig } from '@clashmate/config';
import {
  createClanGamesScoreboardReader,
  createDatabase,
  createDatabaseClanMemberNotificationConfigStore,
  createDatabaseCommandUsageRecorder,
  createDatabaseDebugReader,
  createDatabasePlayerLinkStore,
  createDatabaseStatusMetrics,
  createDatabaseTrackedClanStore,
  createDatabaseUsageMetrics,
  createGlobalAccessBlockStore,
  createLastSeenSnapshotReader,
  createMissedWarAttackEventStore,
  createWarSnapshotStore,
} from '@clashmate/database';
import {
  isOwner,
  routeAutocompleteInteraction,
  type SlashCommandDefinition,
} from '@clashmate/discord';
import { createLogger } from '@clashmate/logger';
import { Client, GatewayIntentBits, type InteractionReplyOptions } from 'discord.js';

import { createBotCommandRegistry } from './commands/index.js';
import { loadBotPackageVersion, type StatusMetricReader } from './commands/status.js';

const config = loadConfig();
const logger = createLogger('bot', config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL);
const commandUsageRecorder = createDatabaseCommandUsageRecorder(database);
const databaseDebugReader = createDatabaseDebugReader(database);
const databaseStatusMetrics = createDatabaseStatusMetrics(database);
const databaseUsageMetrics = createDatabaseUsageMetrics(database);
const databaseTrackedClans = createDatabaseTrackedClanStore(database);
const databaseClanGamesScoreboards = createClanGamesScoreboardReader(database);
const databaseClanMemberNotifications = createDatabaseClanMemberNotificationConfigStore(database);
const databasePlayerLinks = createDatabasePlayerLinkStore(database);
const databaseLastSeenSnapshots = createLastSeenSnapshotReader(database);
const databaseWarSnapshots = createWarSnapshotStore(database);
const databaseMissedWarAttacks = createMissedWarAttackEventStore(database);
const globalAccessBlocks = createGlobalAccessBlockStore(database);
const cocClient = new ClashMateCocClient({ token: config.CLASH_OF_CLANS_API_TOKEN });

const statusMetricReader: StatusMetricReader = {
  countCommandsUsedLast30Days: databaseStatusMetrics.countCommandsUsedLast30Days,
  countClans: databaseStatusMetrics.countTrackedClans,
  countLinks: databaseStatusMetrics.countPlayerLinks,
};

const { GIT_SHA: gitSha, SOURCE_REPOSITORY_URL: sourceRepositoryUrl } = process.env;

const commandRegistry = createBotCommandRegistry({
  blacklist: {
    accessBlocks: globalAccessBlocks,
  },
  clanGames: {
    reader: databaseClanGamesScoreboards,
  },
  clan: {
    coc: cocClient,
  },
  clans: {
    clans: databaseTrackedClans,
  },
  debug: {
    dataReader: databaseDebugReader,
    logger,
  },
  guildBan: {
    accessBlocks: globalAccessBlocks,
  },
  link: {
    coc: cocClient,
    links: databasePlayerLinks,
  },
  lastSeen: {
    store: {
      listPlayerTagsForUser: databasePlayerLinks.listPlayerTagsForUser,
      listLastSeenSnapshots: databaseLastSeenSnapshots.listLastSeenSnapshots,
    },
  },
  player: {
    coc: cocClient,
    links: databasePlayerLinks,
  },
  profile: {
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
  setupClan: {
    clans: databaseTrackedClans,
    coc: cocClient,
    memberNotifications: databaseClanMemberNotifications,
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
    loadedCommandNames: [
      'blacklist',
      'clan-games',
      'clan',
      'clans',
      'debug',
      'guild-ban',
      'help',
      'invite',
      'lastseen',
      'link',
      'player',
      'profile',
      'remaining',
      'setup',
      'status',
      'usage',
      'verify',
      'war',
      'warlog',
    ],
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
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once('ready', async (readyClient) => {
  logger.info({ user: readyClient.user.tag }, 'Bot ready');

  try {
    await registerSlashCommands(readyClient, Array.from(commandRegistry.slashCommands.values()));
    logger.info({ commands: commandRegistry.slashCommands.size }, 'Registered slash commands');
  } catch (error) {
    logger.error({ error }, 'Failed to register slash commands');
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    try {
      await routeAutocompleteInteraction(commandRegistry, interaction, {
        client,
        ownerIds: config.DISCORD_OWNER_IDS,
      });
    } catch (error) {
      logger.error({ error, command: interaction.commandName }, 'Autocomplete interaction failed');
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commandRegistry.slashCommands.get(interaction.commandName);
  if (!command) return;

  try {
    if (!isOwner(interaction.user.id, config.DISCORD_OWNER_IDS)) {
      if (await globalAccessBlocks.isUserBlacklisted(interaction.user.id)) {
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
        await interaction.reply({
          content: 'This server is not allowed to use ClashMate commands.',
          ephemeral: true,
        });
        return;
      }
    }

    await command.execute(interaction, { client, ownerIds: config.DISCORD_OWNER_IDS });

    try {
      await commandUsageRecorder.recordCommandUsage({
        commandName: interaction.commandName,
        guildId: interaction.guildId,
      });
    } catch (error) {
      logger.warn({ error, command: interaction.commandName }, 'Failed to record command usage');
    }
  } catch (error) {
    logger.error({ error, command: interaction.commandName }, 'Slash command failed');
    await sendCommandFailure(interaction);
  }
});

client.on('error', (error) => {
  logger.error({ error }, 'Discord client error');
});

await client.login(config.DISCORD_TOKEN);

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
