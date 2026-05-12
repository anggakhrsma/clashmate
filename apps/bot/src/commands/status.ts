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
  listRecentReconciliationPlanningOutcomes?: (input: {
    guildId: string;
    limit?: number;
  }) => Promise<readonly StatusReconciliationPlanningOutcome[]>;
}

export type StatusReconciliationFeature = 'autorole' | 'nickname';

export interface StatusReconciliationPlanningOutcome {
  feature: StatusReconciliationFeature;
  shouldRun: boolean;
  reason: string;
  plannedAt: Date;
}

export interface StatusReconciliationPlanningSummary {
  totalRecentOutcomes: number;
  latestPlannedAt?: Date;
  plannedToRunCounts: Partial<Record<StatusReconciliationFeature, number>>;
  featureTotals: Partial<Record<StatusReconciliationFeature, number>>;
  topSkipReasons: Array<{ reason: string; count: number }>;
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
  clientReady?: boolean;
  clientReadyAt?: Date;
  cachedGuilds?: number;
  cachedUsers?: number;
  cachedChannels?: number;
  websocketLatencyMs?: number;
  commandsUsedLast30Days?: number;
  clans?: number;
  players?: number;
  links?: number;
  reconciliationPlanning?: StatusReconciliationPlanningSummary;
  runtime: string;
  cacheSource?: string;
  metricSource?: string;
  missingMetricReaders?: string[];
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
      content:
        'I need the **Embed Links** permission in this channel to show `/status`. Grant it to the bot role or run the command where embeds are allowed.',
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
  const reconciliationOutcomes = await readReconciliationPlanningOutcomes(
    options.guild.id,
    options.metricReader?.listRecentReconciliationPlanningOutcomes,
    options.logger,
  );

  const metrics: StatusMetrics = {
    memoryUsedMb: process.memoryUsage().heapUsed / 1024 / 1024,
    freeMemoryMb: os.freemem() / 1024 / 1024,
    uptimeSeconds: process.uptime(),
    servers: options.client.guilds.cache.size,
    clientReady: options.client.isReady(),
    cachedGuilds: options.client.guilds.cache.size,
    cachedUsers: options.client.users.cache.size,
    cachedChannels: options.client.channels.cache.size,
    runtime:
      'Single Discord gateway process; multi-process gateway metrics are intentionally not collected.',
    cacheSource: 'Discord client in-memory caches for live readiness and cache health.',
    metricSource: options.metricReader
      ? 'PostgreSQL aggregate metric reader for persisted bot metrics.'
      : 'No metric reader configured; persisted counts are unavailable.',
    missingMetricReaders: getMissingMetricReaders(options.metricReader),
    version: options.version,
  };
  if (Number.isFinite(options.client.ws.ping)) {
    metrics.websocketLatencyMs = options.client.ws.ping;
  }
  if (options.client.readyAt) metrics.clientReadyAt = options.client.readyAt;

  if (typeof commandsUsedLast30Days === 'number') {
    metrics.commandsUsedLast30Days = commandsUsedLast30Days;
  }
  if (typeof clans === 'number') metrics.clans = clans;
  if (typeof players === 'number') metrics.players = players;
  if (typeof links === 'number') metrics.links = links;
  if (reconciliationOutcomes) {
    metrics.reconciliationPlanning = summarizeReconciliationPlanning(reconciliationOutcomes);
  }
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
      name: 'Cache Health',
      value: formatCacheHealth(view.metrics),
      inline: false,
    },
    {
      name: 'Metric Coverage',
      value: formatMetricCoverage(view.metrics),
      inline: false,
    },
    {
      name: 'Ready / Live',
      value: formatReadyLiveCheck(view.metrics),
      inline: false,
    },
    ...(view.metrics.reconciliationPlanning
      ? [
          {
            name: 'Reconciliation Planning',
            value: formatReconciliationPlanning(view.metrics.reconciliationPlanning),
            inline: false,
          },
        ]
      : []),
    {
      name: 'Runtime',
      value: view.metrics.runtime,
      inline: false,
    },
    {
      name: 'Build Metadata',
      value: formatBuildMetadata(view.metrics),
      inline: false,
    },
    {
      name: 'Version',
      value: formatVersion(view.metrics),
      inline: false,
    },
  );

  embed.setDescription(formatStatusDiagnostics(view.metrics));

  return embed;
}

export function summarizeReconciliationPlanning(
  outcomes: readonly StatusReconciliationPlanningOutcome[],
): StatusReconciliationPlanningSummary {
  const plannedToRunCounts: StatusReconciliationPlanningSummary['plannedToRunCounts'] = {};
  const featureTotals: StatusReconciliationPlanningSummary['featureTotals'] = {};
  const skipReasons = new Map<string, number>();
  let latestPlannedAt: Date | undefined;

  for (const outcome of outcomes) {
    featureTotals[outcome.feature] = (featureTotals[outcome.feature] ?? 0) + 1;
    if (outcome.shouldRun) {
      plannedToRunCounts[outcome.feature] = (plannedToRunCounts[outcome.feature] ?? 0) + 1;
    } else {
      skipReasons.set(outcome.reason, (skipReasons.get(outcome.reason) ?? 0) + 1);
    }
    if (!latestPlannedAt || outcome.plannedAt.getTime() > latestPlannedAt.getTime()) {
      latestPlannedAt = outcome.plannedAt;
    }
  }

  const topSkipReasons = [...skipReasons.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([reason, count]) => ({ reason, count }));

  return {
    totalRecentOutcomes: outcomes.length,
    ...(latestPlannedAt ? { latestPlannedAt } : {}),
    plannedToRunCounts,
    featureTotals,
    topSkipReasons,
  };
}

export function formatReconciliationPlanning(summary: StatusReconciliationPlanningSummary): string {
  if (summary.totalRecentOutcomes === 0) return 'No recent planning outcomes.';

  const features = (['autorole', 'nickname'] as const)
    .map((feature) => {
      const planned = summary.plannedToRunCounts[feature] ?? 0;
      const total = summary.featureTotals[feature] ?? 0;
      return `${feature} ${planned}/${total}`;
    })
    .join(', ');
  const topSkips =
    summary.topSkipReasons.length > 0
      ? summary.topSkipReasons.map(({ reason, count }) => `${reason}:${count}`).join(', ')
      : 'none';
  const latest = summary.latestPlannedAt?.toISOString() ?? 'Unavailable';

  return `Recent ${formatCount(summary.totalRecentOutcomes)} outcomes; latest ${latest}; planned ${features}; top skips ${topSkips}.`;
}

export function formatClientHealth(
  metrics: Pick<
    StatusMetrics,
    'clientReady' | 'clientReadyAt' | 'cachedGuilds' | 'cachedUsers' | 'cachedChannels'
  >,
): string {
  const readyAt = metrics.clientReadyAt?.toISOString() ?? 'Unavailable';
  const cachedGuilds = metrics.cachedGuilds ?? 0;
  const cachedUsers = metrics.cachedUsers ?? 0;
  const cachedChannels = metrics.cachedChannels ?? 0;

  return `Ready ${metrics.clientReady ? 'yes' : 'no'} (at ${readyAt}); cached guilds ${formatCount(cachedGuilds)}, users ${formatCount(cachedUsers)}, channels ${formatCount(cachedChannels)}.`;
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

export function formatLatency(value: number | undefined): string {
  return typeof value === 'number' && value >= 0 ? `${Math.round(value)} ms` : 'Unavailable';
}

export function formatMetricSource(
  metrics: Pick<StatusMetrics, 'metricSource' | 'missingMetricReaders'>,
): string {
  const missingMetricReaders = metrics.missingMetricReaders ?? [];
  const metricSource = metrics.metricSource ?? 'No metric reader configured.';
  const availableReaders = 4 - missingMetricReaders.length;
  const availability = `Metric readers: ${availableReaders}/4 available`;
  if (missingMetricReaders.length === 0) return `${metricSource}; ${availability}.`;

  return `${metricSource}; ${availability}. Missing: ${missingMetricReaders.join(', ')}.`;
}

export function formatStatusDiagnostics(
  metrics: Pick<
    StatusMetrics,
    | 'websocketLatencyMs'
    | 'clientReady'
    | 'clientReadyAt'
    | 'cachedGuilds'
    | 'cachedUsers'
    | 'cachedChannels'
    | 'servers'
    | 'cacheSource'
    | 'metricSource'
    | 'missingMetricReaders'
    | 'version'
    | 'commitSha'
    | 'repositoryUrl'
  >,
): string {
  return [
    `Ready/live: ${formatReadyLiveCheck(metrics)}.`,
    `Cache health: ${formatCacheHealth(metrics)}.`,
    `Metric coverage: ${formatMetricCoverage(metrics)}.`,
    `Build metadata: ${formatBuildMetadata(metrics)}.`,
  ].join('\n');
}

export function formatCacheHealth(
  metrics: Pick<
    StatusMetrics,
    'servers' | 'cachedGuilds' | 'cachedUsers' | 'cachedChannels' | 'cacheSource'
  >,
): string {
  const cachedGuilds = metrics.cachedGuilds ?? 0;
  const cachedUsers = metrics.cachedUsers ?? 0;
  const cachedChannels = metrics.cachedChannels ?? 0;
  const guildCoverage =
    metrics.servers > 0
      ? `${Math.min(cachedGuilds, metrics.servers)}/${formatCount(metrics.servers)} guilds`
      : `${formatCount(cachedGuilds)} guilds`;

  return `${guildCoverage}; users ${formatCount(cachedUsers)}; channels ${formatCount(cachedChannels)}; source ${metrics.cacheSource ?? 'Discord client cache'}`;
}

export function formatMetricCoverage(
  metrics: Pick<StatusMetrics, 'metricSource' | 'missingMetricReaders'>,
): string {
  const missingMetricReaders = metrics.missingMetricReaders ?? [];
  const availableReaders = 4 - missingMetricReaders.length;
  const base = `${availableReaders}/4 readers available`;

  if (missingMetricReaders.length === 0) {
    return `${base}; ${metrics.metricSource ?? 'metric source unavailable'}`;
  }

  return `${base}; missing ${missingMetricReaders.join(', ')}; ${metrics.metricSource ?? 'metric source unavailable'}`;
}

export function formatReadyLiveCheck(
  metrics: Pick<StatusMetrics, 'clientReady' | 'clientReadyAt' | 'websocketLatencyMs'>,
): string {
  const readyState = metrics.clientReady ? 'ready' : 'not ready';
  const readyAt = metrics.clientReadyAt?.toISOString() ?? 'Unavailable';

  return `${readyState}; live latency ${formatLatency(metrics.websocketLatencyMs)}; ready at ${readyAt}`;
}

export function formatBuildMetadata(
  metrics: Pick<StatusMetrics, 'version' | 'commitSha' | 'repositoryUrl'>,
): string {
  const hasCommit = Boolean(metrics.commitSha);
  const hasRepository = Boolean(metrics.repositoryUrl);

  if (hasCommit && hasRepository) {
    return `present (${formatVersion(metrics)})`;
  }

  if (hasCommit || hasRepository) {
    return `partial (commit ${hasCommit ? 'present' : 'missing'}, repository ${hasRepository ? 'present' : 'missing'})`;
  }

  return `absent (${metrics.version})`;
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

async function readReconciliationPlanningOutcomes(
  guildId: string,
  reader:
    | ((input: {
        guildId: string;
        limit?: number;
      }) => Promise<readonly StatusReconciliationPlanningOutcome[]>)
    | undefined,
  logger: StatusLogger | undefined,
): Promise<readonly StatusReconciliationPlanningOutcome[] | undefined> {
  if (!reader) return undefined;

  try {
    return await reader({ guildId, limit: 50 });
  } catch (error) {
    logger?.warn({ error, metric: 'reconciliationPlanning' }, 'Failed to read status metric');
    return undefined;
  }
}

function getMissingMetricReaders(metricReader: StatusMetricReader | undefined): string[] {
  return [
    ['commandsUsedLast30Days', metricReader?.countCommandsUsedLast30Days],
    ['clans', metricReader?.countClans],
    ['players', metricReader?.countPlayers],
    ['links', metricReader?.countLinks],
  ]
    .filter((entry): entry is [string, undefined] => typeof entry[1] === 'undefined')
    .map(([name]) => name);
}
