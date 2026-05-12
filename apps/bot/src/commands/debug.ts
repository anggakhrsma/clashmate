import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type APIAllowedMentions,
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

const SAFE_ALLOWED_MENTIONS: APIAllowedMentions = {
  parse: [],
  roles: [],
  users: [],
  replied_user: false,
};

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

export type DebugReconciliationFeature = 'autorole' | 'nickname';

export interface DebugReconciliationPlanningOutcome {
  feature: DebugReconciliationFeature;
  enabled: boolean;
  shouldRun: boolean;
  reason: string;
  snapshotClanCount: number;
  snapshotMemberCount: number;
  candidateActionCount: number;
  plannedAt: Date;
}

export interface DebugDataReader {
  listTrackedClansForGuild?: (guildId: string) => Promise<readonly DebugTrackedClan[]>;
  getClanStatus?: (clanTag: string) => Promise<DebugClanStatus | undefined>;
  getPollerDiagnostics?: () => Promise<DebugPollerDiagnostics | undefined>;
  getConfigDiagnostics?: (guildId: string) => Promise<DebugConfigDiagnostics | undefined>;
  listRecentReconciliationPlanningOutcomes?: (input: {
    guildId: string;
    limit?: number;
  }) => Promise<readonly DebugReconciliationPlanningOutcome[]>;
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
  readerAvailable: boolean;
  permissions: readonly DebugPermissionResult[];
  webhookCount: number | 'Unavailable';
  pollers: DebugPollerDiagnostics | undefined;
  config: DebugConfigDiagnostics | undefined;
  reconciliation?: readonly DebugReconciliationPlanningOutcome[] | undefined;
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

  const chunks = labelDiscordMessageChunks(splitDiscordMessage(renderDebugText(view)));
  await interaction.editReply({ content: chunks[0] ?? '', allowedMentions: SAFE_ALLOWED_MENTIONS });

  for (const chunk of chunks.slice(1)) {
    if (
      interaction.channel?.isSendable() &&
      interaction.appPermissions?.has(PermissionFlagsBits.SendMessages)
    ) {
      await interaction.channel.send({ content: chunk, allowedMentions: SAFE_ALLOWED_MENTIONS });
    } else {
      await interaction.followUp({ content: chunk, allowedMentions: SAFE_ALLOWED_MENTIONS });
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
  const config = await readConfigDiagnostics(options.guildId, options.dataReader, options.logger);

  return {
    botName: options.botName,
    guildId: options.guildId,
    channelId: options.channelId,
    readerAvailable: Boolean(options.dataReader),
    permissions,
    webhookCount: await countWebhooks(options.channel, options.botUserId),
    pollers: await readPollerDiagnostics(options.dataReader, options.logger),
    config,
    reconciliation:
      config?.diagnosticsEnabled === true
        ? await readReconciliationPlanningOutcomes(
            options.guildId,
            options.dataReader,
            options.logger,
          )
        : undefined,
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
  const clanSummary = summarizeClans(view.clans);
  const clanRows = view.clans.length
    ? view.clans.map(renderClanRow).join('\n')
    : view.readerAvailable
      ? 'No clans configured.'
      : 'No tracked clan data available (debug reader missing).';

  return [
    `**${view.botName} Debug Menu**`,
    '',
    '**Server ID**',
    view.guildId,
    '**Channel**',
    `<#${view.channelId}> (${view.channelId})`,
    '',
    '**Summary**',
    renderSummary(view, clanSummary),
    '',
    '**Channel Permissions**',
    renderPermissionCoverage(view.permissions),
    view.permissions
      .map((permission) => `${permission.granted ? '☑️' : '❌'} ${permission.name}`)
      .join('\n'),
    '',
    '**Webhooks**',
    renderWebhookDiagnostics(view),
    '',
    '**Worker/Poller Diagnostics**',
    renderPollerDiagnostics(view.pollers),
    '',
    '**Config Diagnostics**',
    renderConfigDiagnostics(view.config, view.readerAvailable),
    '',
    '**Reconciliation Planning**',
    renderReconciliationPlanning(view.reconciliation, view.readerAvailable),
    '',
    '**Configured Clans**',
    renderClanSummary(clanSummary),
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

export function labelDiscordMessageChunks(chunks: readonly string[]): string[] {
  if (chunks.length <= 1) return [...chunks];
  return chunks.map(
    (chunk, index) => `**Debug diagnostics chunk ${index + 1}/${chunks.length}**\n${chunk}`,
  );
}

interface ClanSummary {
  total: number;
  active: number;
  inactive: number;
  publicWarLogs: number;
  privateWarLogs: number;
  unknownWarLogs: number;
}

function summarizeClans(clans: readonly DebugClanRow[]): ClanSummary {
  return clans.reduce<ClanSummary>(
    (summary, clan) => {
      summary.total += 1;
      if (clan.active) summary.active += 1;
      else summary.inactive += 1;

      if (clan.warLog === 'Public') summary.publicWarLogs += 1;
      else if (clan.warLog === 'Private') summary.privateWarLogs += 1;
      else summary.unknownWarLogs += 1;

      return summary;
    },
    {
      total: 0,
      active: 0,
      inactive: 0,
      publicWarLogs: 0,
      privateWarLogs: 0,
      unknownWarLogs: 0,
    },
  );
}

function renderSummary(view: DebugView, clanSummary: ClanSummary): string {
  return [
    `Permissions: ${countPassedPermissions(view.permissions)}/${view.permissions.length} covered`,
    `Webhooks: ${renderWebhookCoverageSummary(view.webhookCount)}`,
    `Clans: ${clanSummary.total} configured (${clanSummary.active} active, ${clanSummary.inactive} inactive)`,
    `Freshness: ${renderFreshnessSummary(view.clans)}`,
    `Pollers: ${renderPollerSummary(view.pollers)}`,
    `Config: ${renderConfigSummary(view.config, view.readerAvailable)}`,
    `Reconciliation: ${renderReconciliationSummary(view.reconciliation, view.readerAvailable)}`,
  ].join('\n');
}

function renderClanSummary(summary: ClanSummary): string {
  return `Summary: ${summary.total} configured; ${summary.active} active, ${summary.inactive} inactive; war logs ${summary.publicWarLogs} public, ${summary.privateWarLogs} private, ${summary.unknownWarLogs} unknown.`;
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

async function readReconciliationPlanningOutcomes(
  guildId: string,
  dataReader: DebugDataReader | undefined,
  logger: DebugLogger | undefined,
): Promise<readonly DebugReconciliationPlanningOutcome[] | undefined> {
  try {
    return await dataReader?.listRecentReconciliationPlanningOutcomes?.({ guildId, limit: 20 });
  } catch (error) {
    logger?.warn(
      { error, guildId },
      'Failed to read reconciliation planning outcomes for debug command',
    );
    return undefined;
  }
}

function renderPollerDiagnostics(pollers: DebugPollerDiagnostics | undefined): string {
  if (!pollers) return 'Unavailable';
  const totalLeases = countTotalLeases(pollers);
  const activeLeases = Math.max(0, totalLeases - pollers.dueLeases);

  return [
    `Total leases: ${totalLeases}`,
    `Coverage: ${pollers.clanLeases} clan, ${pollers.playerLeases} player, ${pollers.warLeases} war`,
    `Due leases: ${pollers.dueLeases}/${totalLeases} due (${activeLeases} not due)`,
  ].join('\n');
}

function renderPollerSummary(pollers: DebugPollerDiagnostics | undefined): string {
  if (!pollers) return 'unavailable';
  const totalLeases = countTotalLeases(pollers);
  return `${pollers.dueLeases} due / ${totalLeases} leased (${pollers.clanLeases} clan, ${pollers.playerLeases} player, ${pollers.warLeases} war)`;
}

function countTotalLeases(pollers: DebugPollerDiagnostics): number {
  return pollers.clanLeases + pollers.playerLeases + pollers.warLeases;
}

function renderConfigDiagnostics(
  config: DebugConfigDiagnostics | undefined,
  readerAvailable: boolean,
): string {
  if (!config) return readerAvailable ? 'Unavailable' : 'Unavailable (debug reader missing)';

  return `Diagnostics enabled: ${formatBooleanDiagnostic(config.diagnosticsEnabled)}`;
}

function renderConfigSummary(
  config: DebugConfigDiagnostics | undefined,
  readerAvailable: boolean,
): string {
  if (!config) return readerAvailable ? 'unavailable' : 'unavailable (reader missing)';
  return `diagnostics ${formatBooleanDiagnostic(config.diagnosticsEnabled).toLowerCase()}`;
}

function renderReconciliationPlanning(
  outcomes: readonly DebugReconciliationPlanningOutcome[] | undefined,
  readerAvailable: boolean,
): string {
  if (!outcomes) return readerAvailable ? 'Unavailable' : 'Unavailable (debug reader missing)';
  if (outcomes.length === 0) return 'No recent planning outcomes.';

  const latest = outcomes.reduce((current, row) =>
    row.plannedAt.getTime() > current.plannedAt.getTime() ? row : current,
  );
  const candidateActionCount = outcomes.reduce(
    (total, outcome) => total + outcome.candidateActionCount,
    0,
  );
  const shouldRunCount = outcomes.filter((outcome) => outcome.shouldRun).length;
  const featureLines = (['autorole', 'nickname'] as const).map((feature) =>
    renderReconciliationFeature(feature, outcomes),
  );

  return [
    `Latest planning: ${formatPlanningAge(latest.plannedAt)} (${latest.feature})`,
    `Candidate actions: ${candidateActionCount} across ${outcomes.length} outcomes; runnable ${shouldRunCount}/${outcomes.length}`,
    ...featureLines,
  ].join('\n');
}

function renderReconciliationFeature(
  feature: DebugReconciliationFeature,
  outcomes: readonly DebugReconciliationPlanningOutcome[],
): string {
  const rows = outcomes.filter((outcome) => outcome.feature === feature);
  if (rows.length === 0) return `${feature}: no recent outcomes`;

  const latest = rows.reduce((current, row) =>
    row.plannedAt.getTime() > current.plannedAt.getTime() ? row : current,
  );
  const shouldRunCount = rows.filter((row) => row.shouldRun).length;
  const skipReasons = summarizeSkipReasons(rows);
  const latestStatus = latest.shouldRun ? 'run' : `skip:${latest.reason}`;

  const candidateActionCount = rows.reduce((total, row) => total + row.candidateActionCount, 0);

  return `${feature}: latest ${latest.plannedAt.toISOString()} (${formatPlanningAge(
    latest.plannedAt,
  )}) ${latestStatus}; should_run ${shouldRunCount}/${rows.length}; candidate actions ${candidateActionCount} total/${latest.candidateActionCount} latest; skips ${skipReasons}; latest snapshots ${latest.snapshotClanCount} clans/${latest.snapshotMemberCount} members`;
}

function formatPlanningAge(plannedAt: Date): string {
  const ageMs = Date.now() - plannedAt.getTime();
  const age = formatDurationMs(ageMs);
  if (age === '...') return 'just now, fresh';
  if (ageMs <= 15 * 60_000) return `${age} ago, fresh`;
  if (ageMs <= 60 * 60_000) return `${age} ago, recent`;
  return `${age} ago, stale`;
}

function summarizeSkipReasons(outcomes: readonly DebugReconciliationPlanningOutcome[]): string {
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.shouldRun) continue;
    counts.set(outcome.reason, (counts.get(outcome.reason) ?? 0) + 1);
  }
  if (counts.size === 0) return 'none';

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => `${reason}:${count}`)
    .join(', ');
}

function renderReconciliationSummary(
  outcomes: readonly DebugReconciliationPlanningOutcome[] | undefined,
  readerAvailable: boolean,
): string {
  if (!outcomes) return readerAvailable ? 'unavailable' : 'unavailable (reader missing)';
  if (outcomes.length === 0) return '0 recent outcomes';

  const runnable = outcomes.filter((outcome) => outcome.shouldRun).length;
  const latest = outcomes.reduce((current, row) =>
    row.plannedAt.getTime() > current.plannedAt.getTime() ? row : current,
  );
  return `${outcomes.length} recent, ${runnable} runnable, latest ${formatPlanningAge(latest.plannedAt)} (${latest.feature})`;
}

function countPassedPermissions(permissions: readonly DebugPermissionResult[]): number {
  return permissions.filter((permission) => permission.granted).length;
}

function renderPermissionCoverage(permissions: readonly DebugPermissionResult[]): string {
  const passed = countPassedPermissions(permissions);
  const failed = permissions.length - passed;
  return `${passed}/${permissions.length} covered (${failed} missing)`;
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

function renderWebhookDiagnostics(view: DebugView): string {
  if (view.webhookCount === 'Unavailable') {
    return 'Unavailable (needs View Channel + Manage Webhooks)';
  }

  return `${view.webhookCount} available`;
}

function renderWebhookCoverageSummary(webhookCount: number | 'Unavailable'): string {
  if (webhookCount === 'Unavailable') return 'unavailable';
  return `${webhookCount} available`;
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

function renderFreshnessSummary(clans: readonly DebugClanRow[]): string {
  if (clans.length === 0) return 'none';

  const counts = { fresh: 0, stale: 0, unknown: 0 };
  for (const clan of clans) {
    if (!clan.lastSync) {
      counts.unknown += 1;
      continue;
    }

    const ageMs = Date.now() - clan.lastSync.getTime();
    if (ageMs <= 15 * 60_000) counts.fresh += 1;
    else counts.stale += 1;
  }

  return `${counts.fresh} fresh, ${counts.stale} stale, ${counts.unknown} unknown`;
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
