import { type CommandContext, isOwner, type SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const USAGE_COMMAND_NAME = 'usage';
export const USAGE_COMMAND_DESCRIPTION = "You can't use it anyway, so why explain?";
export const DEFAULT_USAGE_EMBED_COLOR = 0x5865f2;
export const DEFAULT_USAGE_CHART_LIMIT = 15;
export const MIN_USAGE_CHART_LIMIT = 1;
export const MAX_USAGE_CHART_LIMIT = 90;
const USAGE_GROWTH_BAR_WIDTH = 8;
const UNUSED_COMMAND_SAMPLE_LIMIT = 8;

export const usageCommandData = new SlashCommandBuilder()
  .setName(USAGE_COMMAND_NAME)
  .setDescription(USAGE_COMMAND_DESCRIPTION)
  .setDMPermission(true)
  .setDefaultMemberPermissions(0)
  .addBooleanOption((option) =>
    option
      .setName('chart')
      .setDescription('Show a bot server-growth chart instead of command usage.')
      .setRequired(false),
  )
  .addIntegerOption((option) =>
    option
      .setName('limit')
      .setDescription('Number of days to include in the growth chart.')
      .setMinValue(MIN_USAGE_CHART_LIMIT)
      .setMaxValue(MAX_USAGE_CHART_LIMIT)
      .setRequired(false),
  );

export interface UsageDailyRecord {
  date: Date | string;
  uses: number;
}

export interface UsageCommandTotalRecord {
  commandName: string;
  uses: number;
}

export interface BotGrowthDailyRecord {
  date: Date | string;
  guildAdditions: number;
  guildDeletions: number;
}

export interface UsageMetricReader {
  listRecentDailyUsage: (limit: number) => Promise<UsageDailyRecord[]>;
  listCommandTotals: () => Promise<UsageCommandTotalRecord[]>;
  listRecentGrowth: (limit: number) => Promise<BotGrowthDailyRecord[]>;
}

export interface UsageChartRenderer {
  renderGrowthChart: (input: UsageGrowthChartInput) => Promise<string | undefined>;
}

export interface UsageGrowthChartInput {
  records: UsageGrowthDailyView[];
  limit: number;
  totalNetGrowth: number;
  today: UsageGrowthSummary;
}

export interface UsageGrowthDailyView extends UsageGrowthSummary {
  label: string;
}

export interface UsageGrowthSummary {
  additions: number;
  deletions: number;
  net: number;
}

export interface UsageLogger {
  warn: (bindings: Record<string, unknown>, message: string) => void;
}

export interface UsageCommandOptions {
  metricReader?: UsageMetricReader;
  chartRenderer?: UsageChartRenderer;
  loadedCommandNames?: readonly string[];
  logger?: UsageLogger;
}

export interface UsageView {
  botName: string;
  botAvatarUrl?: string;
  color?: ColorResolvable;
  dailyUsage: UsageDailyRecord[];
  commandTotals: UsageCommandTotalRecord[];
  loadedCommandCoverage?: UsageLoadedCommandCoverage;
  recentTrend?: UsageRecentTrend;
  totalUses: number;
  visibleCommandCount?: number;
  totalCommandCount?: number;
  hiddenCommandCount?: number;
  metricSource?: string;
  usageOwnerLimitNote?: string;
}

export interface UsageLoadedCommandCoverage {
  loadedCount: number;
  withUsageCount: number;
  withoutUsageCount: number;
  coveragePercent: number;
  unusedSample: string[];
  recordedCommandCount: number;
  staleUsageCount: number;
}

export interface UsageRecentTrend {
  recentDays: number;
  recentUses: number;
  previousDays: number;
  previousUses: number;
  change: number;
  changePercent?: number;
}

export function createUsageSlashCommand(options: UsageCommandOptions): SlashCommandDefinition {
  return {
    name: USAGE_COMMAND_NAME,
    data: usageCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      await executeUsageInteraction(interaction, context, options);
    },
  };
}

export async function executeUsageInteraction(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  options: UsageCommandOptions,
): Promise<void> {
  if (!isOwner(interaction.user.id, context.ownerIds)) {
    await interaction.reply({ content: 'Only bot owners can use `/usage`.', ephemeral: true });
    return;
  }

  if (
    interaction.inGuild() &&
    interaction.appPermissions &&
    !interaction.appPermissions.has(PermissionFlagsBits.EmbedLinks)
  ) {
    await interaction.reply({
      content:
        'I need the **Embed Links** permission in this channel to show `/usage`. Grant it to the bot role or run the command where embeds are allowed.',
      ephemeral: true,
    });
    return;
  }

  const showChart = interaction.options.getBoolean('chart') ?? false;
  const limit = interaction.options.getInteger('limit') ?? DEFAULT_USAGE_CHART_LIMIT;

  if (limit < MIN_USAGE_CHART_LIMIT || limit > MAX_USAGE_CHART_LIMIT) {
    await interaction.reply({
      content: `The chart limit must be between ${MIN_USAGE_CHART_LIMIT} and ${MAX_USAGE_CHART_LIMIT}.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  if (showChart) {
    await interaction.editReply(await buildUsageChartReply(limit, options));
    return;
  }

  const view = await collectUsageView(interaction, context, options);
  await interaction.editReply({ embeds: [buildUsageEmbed(view)] });
}

export async function collectUsageView(
  source: Pick<ChatInputCommandInteraction, 'guild'>,
  context: CommandContext,
  options: UsageCommandOptions,
): Promise<UsageView> {
  const metricReader = options.metricReader;
  const loadedCommandNames = [...new Set(options.loadedCommandNames ?? [])].sort((left, right) =>
    left.localeCompare(right),
  );
  const loadedCommandNameSet = new Set(loadedCommandNames);
  const dailyUsage =
    (await safeRead(
      'dailyUsage',
      metricReader ? () => metricReader.listRecentDailyUsage(15) : undefined,
      options.logger,
    )) ?? [];
  const rawCommandTotals =
    (await safeRead(
      'commandTotals',
      metricReader ? () => metricReader.listCommandTotals() : undefined,
      options.logger,
    )) ?? [];
  const loadedCommandTotals = rawCommandTotals
    .filter(
      (record) => loadedCommandNameSet.size === 0 || loadedCommandNameSet.has(record.commandName),
    )
    .sort((left, right) => right.uses - left.uses);
  const commandTotals = loadedCommandTotals.slice(0, 50);
  const staleUsageCount = loadedCommandNameSet.size
    ? rawCommandTotals.filter((record) => !loadedCommandNameSet.has(record.commandName)).length
    : 0;
  const commandsWithUsage = new Set(
    loadedCommandTotals.filter((record) => record.uses > 0).map((record) => record.commandName),
  );
  const unusedLoadedCommandNames = loadedCommandNames.filter(
    (name) => !commandsWithUsage.has(name),
  );
  const totalUses = loadedCommandTotals.reduce((sum, record) => sum + record.uses, 0);
  const botAvatarUrl = context.client.user?.displayAvatarURL({ extension: 'png' });
  const recentTrend = buildRecentUsageTrend(dailyUsage);

  return {
    botName: context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate',
    ...(botAvatarUrl ? { botAvatarUrl } : {}),
    color: source.guild?.members.me?.displayColor || DEFAULT_USAGE_EMBED_COLOR,
    dailyUsage: dailyUsage.slice(0, 15),
    commandTotals,
    visibleCommandCount: commandTotals.length,
    totalCommandCount: loadedCommandTotals.length,
    hiddenCommandCount: Math.max(0, loadedCommandTotals.length - commandTotals.length),
    ...(loadedCommandNames.length
      ? {
          loadedCommandCoverage: {
            loadedCount: loadedCommandNames.length,
            withUsageCount: commandsWithUsage.size,
            withoutUsageCount: unusedLoadedCommandNames.length,
            coveragePercent: Math.round((commandsWithUsage.size / loadedCommandNames.length) * 100),
            unusedSample: unusedLoadedCommandNames.slice(0, UNUSED_COMMAND_SAMPLE_LIMIT),
            recordedCommandCount: rawCommandTotals.length,
            staleUsageCount,
          },
        }
      : {}),
    ...(recentTrend ? { recentTrend } : {}),
    totalUses,
    metricSource: metricReader
      ? 'Persisted PostgreSQL aggregates via UsageMetricReader.'
      : 'Unavailable; inject UsageMetricReader to enable persisted usage metrics.',
    usageOwnerLimitNote:
      'Owner-only diagnostic: use it for operator troubleshooting only; no public usage endpoint or server-admin access is exposed.',
  };
}

export function buildUsageEmbed(view: UsageView): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(view.color ?? DEFAULT_USAGE_EMBED_COLOR)
    .setTitle('Usage')
    .setFooter({ text: `${formatCount(view.totalUses)}x Total • Since launch` })
    .setDescription(formatUsageDescription(view))
    .setAuthor(
      view.botAvatarUrl
        ? { name: view.botName, iconURL: view.botAvatarUrl }
        : { name: view.botName },
    );

  return embed;
}

export function formatUsageDescription(
  view: Pick<
    UsageView,
    | 'dailyUsage'
    | 'commandTotals'
    | 'loadedCommandCoverage'
    | 'recentTrend'
    | 'visibleCommandCount'
    | 'totalCommandCount'
    | 'hiddenCommandCount'
    | 'metricSource'
    | 'usageOwnerLimitNote'
  >,
): string {
  const dailyRows = view.dailyUsage.length
    ? view.dailyUsage.map(
        (record) => `${formatUsageDate(record.date).padEnd(8)} ${formatCount(record.uses)}`,
      )
    : ['No daily usage recorded yet. Metrics start after command instrumentation writes data.'];
  const commandRows = view.commandTotals.length
    ? view.commandTotals.map(
        (record, index) =>
          `${String(index + 1).padStart(2)} ${formatCount(record.uses).padStart(8)} /${record.commandName}`,
      )
    : ['No command usage recorded yet. Check that the metric reader is configured.'];

  return [
    '```',
    'Date     Uses',
    ...dailyRows,
    '',
    '#      Uses Command',
    ...commandRows,
    '```',
    formatCommandCoverageContext(view),
    formatRecentUsageTrend(view.recentTrend),
    formatLoadedCommandCoverage(view.loadedCommandCoverage),
    view.usageOwnerLimitNote,
    view.metricSource ? `Metrics source: ${view.metricSource}` : undefined,
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n');
}

function formatCommandCoverageContext(
  view: Pick<
    UsageView,
    'commandTotals' | 'visibleCommandCount' | 'totalCommandCount' | 'hiddenCommandCount'
  >,
): string {
  const visibleCommandCount = view.visibleCommandCount ?? view.commandTotals.length;
  const totalCommandCount = view.totalCommandCount ?? view.commandTotals.length;
  const hiddenCommandCount =
    view.hiddenCommandCount ?? Math.max(0, totalCommandCount - visibleCommandCount);

  if (totalCommandCount === 0) {
    return 'Command coverage: no command totals are available from the metric source yet.';
  }

  const hidden = hiddenCommandCount
    ? `; ${formatCount(hiddenCommandCount)} lower-usage commands are hidden by the top-50 display limit`
    : '';
  return `Command coverage: showing ${formatCount(visibleCommandCount)}/${formatCount(totalCommandCount)} commands with recorded usage${hidden}.`;
}

function formatLoadedCommandCoverage(coverage: UsageLoadedCommandCoverage | undefined): string {
  if (!coverage)
    return 'Loaded command coverage: not available (loaded command names not injected).';

  const sample = coverage.unusedSample.length
    ? ` Unused loaded commands: ${coverage.unusedSample.map((name) => `/${name}`).join(', ')}`
    : ' No loaded commands are currently unused.';

  const stale = coverage.staleUsageCount
    ? ` ${formatCount(coverage.staleUsageCount)} recorded command totals are not currently loaded and are excluded.`
    : '';

  return `Loaded vs usage coverage: ${formatCount(coverage.withUsageCount)}/${formatCount(coverage.loadedCount)} loaded commands have usage (${coverage.coveragePercent}%); ${formatCount(coverage.withoutUsageCount)} loaded commands have no usage.${stale}${sample}`;
}

function formatRecentUsageTrend(trend: UsageRecentTrend | undefined): string | undefined {
  if (!trend) return undefined;

  const percent =
    trend.changePercent === undefined ? '' : ` (${formatSignedPercent(trend.changePercent)})`;
  const comparison = trend.previousDays
    ? ` vs previous ${trend.previousDays}d ${formatSignedCount(trend.change)}${percent}`
    : '';
  return `Recent usage trend: last ${trend.recentDays}d ${formatCount(trend.recentUses)} uses${comparison}.`;
}

function buildRecentUsageTrend(records: readonly UsageDailyRecord[]): UsageRecentTrend | undefined {
  if (!records.length) return undefined;

  const recentRecords = records.slice(0, 7);
  const previousRecords = records.slice(7, 14);
  const recentUses = recentRecords.reduce((sum, record) => sum + record.uses, 0);
  const previousUses = previousRecords.reduce((sum, record) => sum + record.uses, 0);

  return {
    recentDays: recentRecords.length,
    recentUses,
    previousDays: previousRecords.length,
    previousUses,
    change: recentUses - previousUses,
    ...(previousUses > 0
      ? { changePercent: ((recentUses - previousUses) / previousUses) * 100 }
      : {}),
  };
}

async function buildUsageChartReply(limit: number, options: UsageCommandOptions): Promise<string> {
  if (!options.metricReader) {
    return 'Usage metrics are not configured. Inject a UsageMetricReader backed by persisted bot-growth metrics.';
  }

  const metricReader = options.metricReader;
  const records = await safeRead(
    'growth',
    metricReader ? () => metricReader.listRecentGrowth(limit) : undefined,
    options.logger,
  );
  if (!records?.length) {
    return 'No bot growth data has been recorded yet. Growth charts require persisted guild add/remove metrics.';
  }

  const views = records
    .slice(0, limit)
    .reverse()
    .map((record) => ({
      label: formatUsageDate(record.date),
      additions: record.guildAdditions,
      deletions: record.guildDeletions,
      net: record.guildAdditions - record.guildDeletions,
    }));
  const latest = views.at(-1) ?? { additions: 0, deletions: 0, net: 0 };
  const chartRenderer = options.chartRenderer;
  const url = await safeRead(
    'chart',
    chartRenderer
      ? () =>
          chartRenderer.renderGrowthChart({
            records: views,
            limit,
            totalNetGrowth: views.reduce((sum, record) => sum + record.net, 0),
            today: latest,
          })
      : undefined,
    options.logger,
  );

  if (url) return url;

  return [
    formatUsageGrowthTextChart(views),
    formatUsageGrowthContext(limit, records.length, views.length),
    `Chart limits: limit must be ${MIN_USAGE_CHART_LIMIT}-${MAX_USAGE_CHART_LIMIT} days; default is ${DEFAULT_USAGE_CHART_LIMIT}.`,
    'Metrics source: persisted PostgreSQL growth aggregates via UsageMetricReader.',
  ].join('\n');
}

export function formatUsageGrowthTextChart(records: readonly UsageGrowthDailyView[]): string {
  const totalAdds = records.reduce((sum, record) => sum + record.additions, 0);
  const totalDels = records.reduce((sum, record) => sum + record.deletions, 0);
  const totalNet = totalAdds - totalDels;
  const maxMagnitude = Math.max(
    1,
    ...records.map((record) => Math.abs(record.net)),
    ...records.map((record) => record.additions),
    ...records.map((record) => record.deletions),
  );
  const rows = records.map((record) => {
    const bar = formatUsageGrowthBar(record, maxMagnitude);
    return `${record.label.padEnd(6)} +${formatCompactCount(record.additions).padStart(3)} -${formatCompactCount(record.deletions).padStart(3)} ${formatSignedCount(record.net).padStart(4)} ${bar}`;
  });

  return [
    'Bot growth',
    '```',
    'Date   Add Del  Net Trend',
    ...rows,
    `Total  +${formatCompactCount(totalAdds)} -${formatCompactCount(totalDels)} ${formatSignedCount(totalNet)}`,
    '```',
  ].join('\n');
}

function formatUsageGrowthBar(record: UsageGrowthSummary, maxMagnitude: number): string {
  if (record.net === 0) return '.'.repeat(Math.min(USAGE_GROWTH_BAR_WIDTH, 3));
  const width = Math.max(
    1,
    Math.round((Math.abs(record.net) / maxMagnitude) * USAGE_GROWTH_BAR_WIDTH),
  );
  return (record.net > 0 ? '+' : '-').repeat(width);
}

function formatUsageGrowthContext(
  requestedLimit: number,
  availableCount: number,
  renderedCount: number,
): string {
  const coverage = `${formatCount(renderedCount)}/${formatCount(Math.min(requestedLimit, availableCount))}`;
  const requested =
    requestedLimit === renderedCount ? '' : ` Requested ${formatCount(requestedLimit)}.`;
  return `Growth chart coverage: ${coverage} days rendered from ${formatCount(availableCount)} available growth records.${requested}`;
}

function formatSignedCount(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatCompactCount(value)}`;
}

function formatSignedPercent(value: number): string {
  const formatted = `${Math.abs(value).toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
  return `${value >= 0 ? '+' : '-'}${formatted}`;
}

function formatCompactCount(value: number): string {
  const absolute = Math.abs(value);
  if (absolute < 1000) return String(value);
  if (absolute < 1_000_000) return `${formatCompactDecimal(value / 1000)}k`;
  return `${formatCompactDecimal(value / 1_000_000)}m`;
}

function formatCompactDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatUsageDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    .format(date)
    .replace(',', '');
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

async function safeRead<T>(
  name: string,
  reader: (() => Promise<T | undefined>) | undefined,
  logger: UsageLogger | undefined,
): Promise<T | undefined> {
  if (!reader) return undefined;

  try {
    return await reader();
  } catch (error) {
    logger?.warn({ error, metric: name }, 'Failed to read usage metric');
    return undefined;
  }
}
