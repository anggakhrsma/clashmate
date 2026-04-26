import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  type PermissionResolvable,
  SlashCommandBuilder,
} from 'discord.js';

export const DEBUG_COMMAND_NAME = 'debug';
export const DEBUG_COMMAND_DESCRIPTION = 'Displays some basic debug information.';

const DIAGNOSED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageWebhooks,
] as const;

const PERMISSION_NAMES = new Map<bigint, string>([
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
  [PermissionFlagsBits.AttachFiles, 'Attach Files'],
  [PermissionFlagsBits.UseExternalEmojis, 'Use External Emojis'],
  [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
  [PermissionFlagsBits.ManageWebhooks, 'Manage Webhooks'],
]);

export const debugCommandData = new SlashCommandBuilder()
  .setName(DEBUG_COMMAND_NAME)
  .setDescription(DEBUG_COMMAND_DESCRIPTION)
  .setDMPermission(false);

export interface DebugTrackedClan {
  clanTag: string;
  name: string | null;
  isActive: boolean;
  lastSeenAt: Date | null;
}

export interface DebugClanStatus {
  tag: string;
  isWarLogPublic: boolean | undefined;
}

export interface DebugPollerDiagnostics {
  clanLeases: number;
  playerLeases: number;
  warLeases: number;
  dueLeases: number;
}

export interface DebugConfigDiagnostics {
  diagnosticsEnabled: boolean | 'Unknown';
}

export interface DebugDataReader {
  listTrackedClansForGuild?: (guildId: string) => Promise<readonly DebugTrackedClan[]>;
  getClanStatus?: (clanTag: string) => Promise<DebugClanStatus | undefined>;
  getPollerDiagnostics?: () => Promise<DebugPollerDiagnostics | undefined>;
  getConfigDiagnostics?: (guildId: string) => Promise<DebugConfigDiagnostics | undefined>;
}

export interface DebugLogger {
  warn: (bindings: Record<string, unknown>, message: string) => void;
}

export interface DebugCommandOptions {
  dataReader?: DebugDataReader;
  logger?: DebugLogger;
}

export interface DebugPermissionResult {
  name: string;
  granted: boolean;
}

export interface DebugClanRow {
  name: string;
  active: boolean;
  lastSync: Date | null;
  warLog: 'Public' | 'Private' | 'Unknown';
}

export interface DebugView {
  botName: string;
  guildId: string;
  channelId: string;
  permissions: readonly DebugPermissionResult[];
  webhookCount: number | 'Unavailable';
  pollers: DebugPollerDiagnostics | undefined;
  config: DebugConfigDiagnostics | undefined;
  clans: readonly DebugClanRow[];
}

export function createDebugSlashCommand(options: DebugCommandOptions = {}): SlashCommandDefinition {
  return {
    name: DEBUG_COMMAND_NAME,
    data: debugCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      await executeDebugInteraction(interaction, context, options);
    },
  };
}

export async function executeDebugInteraction(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  options: DebugCommandOptions = {},
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) {
    await interaction.reply({
      content: '`/debug` can only be used in a server channel.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: false });

  const view = await collectDebugView({
    botName: context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate',
    guildId: interaction.guild.id,
    botUserId: interaction.guild.members.me?.id,
    channelId: interaction.channelId,
    channel: interaction.channel,
    dataReader: options.dataReader,
    logger: options.logger,
  });

  const chunks = splitDiscordMessage(renderDebugText(view));
  await interaction.editReply({ content: chunks[0] ?? '', allowedMentions: { roles: [] } });

  for (const chunk of chunks.slice(1)) {
    if (
      interaction.channel?.isSendable() &&
      interaction.appPermissions?.has(PermissionFlagsBits.SendMessages)
    ) {
      await interaction.channel.send({ content: chunk, allowedMentions: { roles: [] } });
    } else {
      await interaction.followUp({ content: chunk, allowedMentions: { roles: [] } });
    }
  }
}

export async function collectDebugView(options: {
  botName: string;
  guildId: string;
  botUserId: string | undefined;
  channelId: string;
  channel: NonNullable<ChatInputCommandInteraction['channel']>;
  dataReader: DebugDataReader | undefined;
  logger: DebugLogger | undefined;
}): Promise<DebugView> {
  const permissions = collectPermissionResults(options.channel, options.botUserId);
  const clans = await collectClanRows(options.guildId, options.dataReader, options.logger);

  return {
    botName: options.botName,
    guildId: options.guildId,
    channelId: options.channelId,
    permissions,
    webhookCount: await countWebhooks(options.channel, options.botUserId),
    pollers: await readPollerDiagnostics(options.dataReader, options.logger),
    config: await readConfigDiagnostics(options.guildId, options.dataReader, options.logger),
    clans,
  };
}

export function collectPermissionResults(
  channel: NonNullable<ChatInputCommandInteraction['channel']>,
  botUserId: string | undefined,
): DebugPermissionResult[] {
  return DIAGNOSED_PERMISSIONS.map((permission) => ({
    name: PERMISSION_NAMES.get(permission) ?? permission.toString(),
    granted:
      botUserId && 'permissionsFor' in channel
        ? (channel.permissionsFor(botUserId)?.has(permission as PermissionResolvable) ?? false)
        : false,
  }));
}

export async function collectClanRows(
  guildId: string,
  dataReader: DebugDataReader | undefined,
  logger: DebugLogger | undefined,
): Promise<DebugClanRow[]> {
  const trackedClans = (await dataReader?.listTrackedClansForGuild?.(guildId)) ?? [];

  return Promise.all(
    trackedClans.map(async (clan) => {
      const status = await readClanStatus(clan.clanTag, dataReader, logger);
      const warLog =
        typeof status?.isWarLogPublic === 'boolean'
          ? status.isWarLogPublic
            ? 'Public'
            : 'Private'
          : 'Unknown';

      return {
        name: clan.name ?? clan.clanTag,
        active: clan.isActive,
        lastSync: clan.lastSeenAt,
        warLog,
      };
    }),
  );
}

export function renderDebugText(view: DebugView): string {
  const clanRows = view.clans.length
    ? view.clans.map(renderClanRow).join('\n')
    : 'No clans configured.';

  return [
    `**${view.botName} Debug Menu**`,
    '',
    '**Server ID**',
    view.guildId,
    '**Channel**',
    `<#${view.channelId}> (${view.channelId})`,
    '',
    '**Channel Permissions**',
    view.permissions
      .map((permission) => `${permission.granted ? '☑️' : '❌'} ${permission.name}`)
      .join('\n'),
    '',
    '**Webhooks**',
    `${view.webhookCount}`,
    '',
    '**Worker/Poller Diagnostics**',
    renderPollerDiagnostics(view.pollers),
    '',
    '**Config Diagnostics**',
    renderConfigDiagnostics(view.config),
    '',
    '**Configured Clans**',
    '*The war log must be made publicly accessible for the bot to function properly.*',
    `⬛ \`‎${'CLAN NAME'.padEnd(15, ' ')} ${'SYNC'} ​ ${'WAR LOG'} ‏\``,
    clanRows,
  ].join('\n');
}

export function splitDiscordMessage(content: string, maxLength = 1_900): string[] {
  if (content.length <= maxLength) return [content];

  const chunks: string[] = [];
  let current = '';
  for (const line of content.split('\n')) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength) {
      if (current) chunks.push(current);
      current = line.length > maxLength ? line.slice(0, maxLength) : line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function readClanStatus(
  clanTag: string,
  dataReader: DebugDataReader | undefined,
  logger: DebugLogger | undefined,
): Promise<DebugClanStatus | undefined> {
  try {
    return await dataReader?.getClanStatus?.(clanTag);
  } catch (error) {
    logger?.warn({ error, clanTag }, 'Failed to read clan status for debug command');
    return undefined;
  }
}

async function readPollerDiagnostics(
  dataReader: DebugDataReader | undefined,
  logger: DebugLogger | undefined,
): Promise<DebugPollerDiagnostics | undefined> {
  try {
    return await dataReader?.getPollerDiagnostics?.();
  } catch (error) {
    logger?.warn({ error }, 'Failed to read poller diagnostics for debug command');
    return undefined;
  }
}

async function readConfigDiagnostics(
  guildId: string,
  dataReader: DebugDataReader | undefined,
  logger: DebugLogger | undefined,
): Promise<DebugConfigDiagnostics | undefined> {
  try {
    return await dataReader?.getConfigDiagnostics?.(guildId);
  } catch (error) {
    logger?.warn({ error, guildId }, 'Failed to read config diagnostics for debug command');
    return undefined;
  }
}

function renderPollerDiagnostics(pollers: DebugPollerDiagnostics | undefined): string {
  if (!pollers) return 'Unavailable';

  return [
    `Clan leases: ${pollers.clanLeases}`,
    `Player leases: ${pollers.playerLeases}`,
    `War leases: ${pollers.warLeases}`,
    `Due leases: ${pollers.dueLeases}`,
  ].join('\n');
}

function renderConfigDiagnostics(config: DebugConfigDiagnostics | undefined): string {
  if (!config) return 'Unavailable';

  return `Diagnostics enabled: ${formatBooleanDiagnostic(config.diagnosticsEnabled)}`;
}

function formatBooleanDiagnostic(value: boolean | 'Unknown'): string {
  if (value === 'Unknown') return value;
  return value ? 'Yes' : 'No';
}

async function countWebhooks(
  channel: NonNullable<ChatInputCommandInteraction['channel']>,
  botUserId: string | undefined,
): Promise<number | 'Unavailable'> {
  if (!('fetchWebhooks' in channel) || !botUserId) return 'Unavailable';
  const permissions = channel.permissionsFor(botUserId);
  if (!permissions?.has([PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ViewChannel]))
    return 0;

  try {
    const webhooks = await channel.fetchWebhooks();
    return webhooks.size;
  } catch {
    return 'Unavailable';
  }
}

function renderClanRow(row: DebugClanRow): string {
  const healthy = row.active && row.warLog === 'Public';
  return `${healthy ? '☑️' : '❌'} \`‎${truncate(row.name, 15).padEnd(15, ' ')} ${formatElapsed(
    row.lastSync,
  ).padStart(4, ' ')} ​ ${row.warLog.padEnd(7, ' ')} ‏\``;
}

function formatElapsed(value: Date | null): string {
  if (!value) return '...';
  return formatDurationMs(Date.now() - value.getTime());
}

export function formatDurationMs(value: number | undefined): string {
  if (!value || value <= 0) return '...';
  const seconds = Math.max(1, Math.round(value / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function truncate(value: string, length: number): string {
  return value.length > length ? value.slice(0, length) : value;
}
