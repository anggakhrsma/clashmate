import { loadConfig } from '@clashmate/config';
import {
  createDatabase,
  createDatabaseDebugReader,
  createDatabaseStatusMetrics,
  createGlobalAccessBlockStore,
} from '@clashmate/database';
import { isOwner, type SlashCommandDefinition } from '@clashmate/discord';
import { createLogger } from '@clashmate/logger';
import { Client, GatewayIntentBits, type InteractionReplyOptions } from 'discord.js';

import { createBotCommandRegistry } from './commands/index.js';
import { loadBotPackageVersion, type StatusMetricReader } from './commands/status.js';

const config = loadConfig();
const logger = createLogger('bot', config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL);
const databaseDebugReader = createDatabaseDebugReader(database);
const databaseStatusMetrics = createDatabaseStatusMetrics(database);
const globalAccessBlocks = createGlobalAccessBlockStore(database);

const statusMetricReader: StatusMetricReader = {
  countClans: databaseStatusMetrics.countTrackedClans,
  countLinks: databaseStatusMetrics.countPlayerLinks,
};

const { GIT_SHA: gitSha, SOURCE_REPOSITORY_URL: sourceRepositoryUrl } = process.env;

const commandRegistry = createBotCommandRegistry({
  blacklist: {
    accessBlocks: globalAccessBlocks,
  },
  debug: {
    dataReader: databaseDebugReader,
    logger,
  },
  guildBan: {
    accessBlocks: globalAccessBlocks,
  },
  status: {
    metricReader: statusMetricReader,
    version: loadBotPackageVersion(),
    logger,
    ...(gitSha ? { commitSha: gitSha } : {}),
    ...(sourceRepositoryUrl ? { repositoryUrl: sourceRepositoryUrl } : {}),
  },
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
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
