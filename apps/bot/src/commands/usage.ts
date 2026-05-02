import {
  type CommandContext,
  isOwner,
  type MessageCommandDefinition,
  type SlashCommandDefinition,
} from '@clashmate/discord';
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
  totalUses: number;
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

export function createUsageMessageCommand(options: UsageCommandOptions): MessageCommandDefinition {
  return {
    name: USAGE_COMMAND_NAME,
    ownerOnly: true,
    execute: async (message, context) => {
      if (!isOwner(message.author.id, context.ownerIds)) {
        await message.reply('Only bot owners can use `usage`.');
        return;
      }

      if (!message.channel.isSendable()) {
        await message.reply('I cannot send messages in this channel.');
        return;
      }

      const request = parseUsageMessageRequest(message.content);
      if (request.limitError) {
        await message.channel.send(request.limitError);
        return;
      }

      if (request.showChart) {
        await message.channel.send(await buildUsageChartReply(request.limit, options));
        return;
      }

      const view = await collectUsageView(message, context, options);
      await message.channel.send({ embeds: [buildUsageEmbed(view)] });
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
      content: 'I need the **Embed Links** permission to show `/usage`.',
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
  const dailyUsage =
    (await safeRead(
      'dailyUsage',
      metricReader ? () => metricReader.listRecentDailyUsage(15) : undefined,
      options.logger,
    )) ?? [];
  const loadedCommandNames = new Set(options.loadedCommandNames ?? []);
  const commandTotals = (
    (await safeRead(
      'commandTotals',
      metricReader ? () => metricReader.listCommandTotals() : undefined,
      options.logger,
    )) ?? []
  )
    .filter((record) => loadedCommandNames.size === 0 || loadedCommandNames.has(record.commandName))
    .sort((left, right) => right.uses - left.uses)
    .slice(0, 50);
  const totalUses = commandTotals.reduce((sum, record) => sum + record.uses, 0);
  const botAvatarUrl = context.client.user?.displayAvatarURL({ extension: 'png' });

  return {
    botName: context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate',
    ...(botAvatarUrl ? { botAvatarUrl } : {}),
    color: source.guild?.members.me?.displayColor || DEFAULT_USAGE_EMBED_COLOR,
    dailyUsage: dailyUsage.slice(0, 15),
    commandTotals,
    totalUses,
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
  view: Pick<UsageView, 'dailyUsage' | 'commandTotals'>,
): string {
  const dailyRows = view.dailyUsage.length
    ? view.dailyUsage.map(
        (record) => `${formatUsageDate(record.date).padEnd(8)} ${formatCount(record.uses)}`,
      )
    : ['No daily usage recorded yet.'];
  const commandRows = view.commandTotals.length
    ? view.commandTotals.map(
        (record, index) =>
          `${String(index + 1).padStart(2)} ${formatCount(record.uses).padStart(8)} /${record.commandName}`,
      )
    : ['No command usage recorded yet.'];

  return [
    '```',
    'Date     Uses',
    ...dailyRows,
    '',
    '#      Uses Command',
    ...commandRows,
    '```',
  ].join('\n');
}

async function buildUsageChartReply(limit: number, options: UsageCommandOptions): Promise<string> {
  if (!options.metricReader) return 'Usage metrics are not configured.';
  if (!options.chartRenderer) return 'Growth chart rendering is not configured.';

  const metricReader = options.metricReader;
  const records = await safeRead(
    'growth',
    metricReader ? () => metricReader.listRecentGrowth(limit) : undefined,
    options.logger,
  );
  if (!records?.length) return 'No bot growth data has been recorded yet.';

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

  return url ?? 'I could not render the growth chart right now.';
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

function parseUsageMessageRequest(content: string): {
  showChart: boolean;
  limit: number;
  limitError?: string;
} {
  const [, mode, limitToken] = content.trim().split(/\s+/, 3);
  const showChart = mode?.toLowerCase() === 'chart';
  const parsedLimit = showChart && limitToken ? Number.parseInt(limitToken, 10) : undefined;
  const limit = parsedLimit ?? DEFAULT_USAGE_CHART_LIMIT;

  if (
    showChart &&
    limitToken &&
    (!Number.isInteger(parsedLimit) || String(parsedLimit) !== limitToken)
  ) {
    return {
      showChart,
      limit,
      limitError: `The chart limit must be between ${MIN_USAGE_CHART_LIMIT} and ${MAX_USAGE_CHART_LIMIT}.`,
    };
  }

  if (showChart && (limit < MIN_USAGE_CHART_LIMIT || limit > MAX_USAGE_CHART_LIMIT)) {
    return {
      showChart,
      limit,
      limitError: `The chart limit must be between ${MIN_USAGE_CHART_LIMIT} and ${MAX_USAGE_CHART_LIMIT}.`,
    };
  }

  return { showChart, limit };
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
