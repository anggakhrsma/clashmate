import { readFileSync } from 'node:fs';
import os from 'node:os';
import { type CommandContext, isOwner, type SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  type Client,
  type ColorResolvable,
  EmbedBuilder,
  type Guild,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const STATUS_COMMAND_NAME = 'status';
export const STATUS_COMMAND_DESCRIPTION = "Shows information about the bot's status.";
export const DEFAULT_STATUS_EMBED_COLOR = 0x5865f2;

export const statusCommandData = new SlashCommandBuilder()
  .setName(STATUS_COMMAND_NAME)
  .setDescription(STATUS_COMMAND_DESCRIPTION)
  .setDMPermission(false);

export interface StatusMetricReader {
  countCommandsUsedLast30Days?: () => Promise<number | undefined>;
  countClans?: () => Promise<number | undefined>;
  countPlayers?: () => Promise<number | undefined>;
  countLinks?: () => Promise<number | undefined>;
}

export interface StatusLogger {
  warn: (bindings: Record<string, unknown>, message: string) => void;
}

export interface StatusCommandOptions {
  metricReader?: StatusMetricReader;
  version: string;
  commitSha?: string;
  repositoryUrl?: string;
  logger?: StatusLogger;
}

export interface StatusMetrics {
  memoryUsedMb: number;
  freeMemoryMb: number;
  uptimeSeconds: number;
  servers: number;
  commandsUsedLast30Days?: number;
  clans?: number;
  players?: number;
  links?: number;
  runtime: string;
  version: string;
  commitSha?: string;
  repositoryUrl?: string;
}

export interface StatusView {
  botName: string;
  botAvatarUrl?: string;
  color?: ColorResolvable;
  metrics: StatusMetrics;
}

interface PackageJsonShape {
  version: string;
}

export function createStatusSlashCommand(options: StatusCommandOptions): SlashCommandDefinition {
  return {
    name: STATUS_COMMAND_NAME,
    data: statusCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      await executeStatusInteraction(interaction, context, options);
    },
  };
}

export async function executeStatusInteraction(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  options: StatusCommandOptions,
): Promise<void> {
  if (!isOwner(interaction.user.id, context.ownerIds)) {
    await interaction.reply({ content: 'Only bot owners can use `/status`.', ephemeral: true });
    return;
  }

  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: '`/status` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (
    interaction.appPermissions &&
    !interaction.appPermissions.has(PermissionFlagsBits.EmbedLinks)
  ) {
    await interaction.reply({
      content: 'I need the **Embed Links** permission to show `/status`.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: false });

  const view = await collectStatusView({
    client: context.client,
    guild: interaction.guild,
    metricReader: options.metricReader,
    version: options.version,
    commitSha: options.commitSha,
    repositoryUrl: options.repositoryUrl,
    logger: options.logger,
  });

  await interaction.editReply({ embeds: [buildStatusEmbed(view)] });
}

export async function collectStatusView(options: {
  client: Client;
  guild: Guild;
  metricReader: StatusMetricReader | undefined;
  version: string;
  commitSha: string | undefined;
  repositoryUrl: string | undefined;
  logger: StatusLogger | undefined;
}): Promise<StatusView> {
  const commandsUsedLast30Days = await readMetric(
    'commandsUsedLast30Days',
    options.metricReader?.countCommandsUsedLast30Days,
    options.logger,
  );
  const clans = await readMetric('clans', options.metricReader?.countClans, options.logger);
  const players = await readMetric('players', options.metricReader?.countPlayers, options.logger);
  const links = await readMetric('links', options.metricReader?.countLinks, options.logger);

  const metrics: StatusMetrics = {
    memoryUsedMb: process.memoryUsage().heapUsed / 1024 / 1024,
    freeMemoryMb: os.freemem() / 1024 / 1024,
    uptimeSeconds: process.uptime(),
    servers: options.client.guilds.cache.size,
    runtime: 'Single Discord gateway process',
    version: options.version,
  };

  if (typeof commandsUsedLast30Days === 'number') {
    metrics.commandsUsedLast30Days = commandsUsedLast30Days;
  }
  if (typeof clans === 'number') metrics.clans = clans;
  if (typeof players === 'number') metrics.players = players;
  if (typeof links === 'number') metrics.links = links;
  if (options.commitSha) metrics.commitSha = options.commitSha;
  if (options.repositoryUrl) metrics.repositoryUrl = options.repositoryUrl;

  const botAvatarUrl = options.client.user?.displayAvatarURL({ extension: 'png' });
  const color = options.guild.members.me?.displayColor || DEFAULT_STATUS_EMBED_COLOR;

  return {
    botName: options.client.user?.displayName ?? options.client.user?.username ?? 'ClashMate',
    ...(botAvatarUrl ? { botAvatarUrl } : {}),
    color,
    metrics,
  };
}

export function buildStatusEmbed(view: StatusView): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(view.color ?? DEFAULT_STATUS_EMBED_COLOR)
    .setAuthor(
      view.botAvatarUrl
        ? { name: view.botName, iconURL: view.botAvatarUrl }
        : { name: view.botName },
    );

  embed.addFields(
    {
      name: 'Memory Usage',
      value: formatMegabytes(view.metrics.memoryUsedMb),
      inline: false,
    },
    {
      name: 'Free Memory',
      value: formatMegabytes(view.metrics.freeMemoryMb),
      inline: false,
    },
    {
      name: 'Uptime',
      value: formatDuration(view.metrics.uptimeSeconds),
      inline: false,
    },
    {
      name: 'Servers',
      value: formatCount(view.metrics.servers),
      inline: false,
    },
    {
      name: 'Commands Used',
      value: `${formatOptionalCount(view.metrics.commandsUsedLast30Days)} (last 30d)`,
      inline: false,
    },
    {
      name: 'Clans',
      value: formatOptionalCount(view.metrics.clans),
      inline: false,
    },
    {
      name: 'Players',
      value: formatOptionalCount(view.metrics.players),
      inline: false,
    },
    {
      name: 'Links',
      value: formatOptionalCount(view.metrics.links),
      inline: false,
    },
    {
      name: 'Runtime',
      value: view.metrics.runtime,
      inline: false,
    },
    {
      name: 'Version',
      value: formatVersion(view.metrics),
      inline: false,
    },
  );

  return embed;
}

export function formatMegabytes(value: number): string {
  return `${value.toFixed(2)} MB`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatOptionalCount(value: number | undefined): string {
  return typeof value === 'number' ? formatCount(value) : 'Unavailable';
}

export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(safeSeconds / 86_400);
  const hours = Math.floor((safeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(', ');
}

export function formatVersion(
  metrics: Pick<StatusMetrics, 'version' | 'commitSha' | 'repositoryUrl'>,
): string {
  if (!metrics.commitSha || !metrics.repositoryUrl) return metrics.version;

  const repositoryUrl = metrics.repositoryUrl.replace(/\/$/, '');
  return `[${metrics.version}](${repositoryUrl}/commit/${metrics.commitSha})`;
}

export function loadBotPackageVersion(): string {
  const rawPackage = JSON.parse(
    readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
  ) as unknown;

  return isPackageJsonShape(rawPackage) ? rawPackage.version : '0.0.0';
}

function isPackageJsonShape(value: unknown): value is PackageJsonShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    typeof (value as { version?: unknown }).version === 'string'
  );
}

async function readMetric(
  name: string,
  reader: (() => Promise<number | undefined>) | undefined,
  logger: StatusLogger | undefined,
): Promise<number | undefined> {
  if (!reader) return undefined;

  try {
    return await reader();
  } catch (error) {
    logger?.warn({ error, metric: name }, 'Failed to read status metric');
    return undefined;
  }
}
