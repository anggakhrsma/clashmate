import type { ClashClan, ClashClanSearchResult } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
} from 'discord.js';

export const SEARCH_COMMAND_NAME = 'search';
export const SEARCH_COMMAND_DESCRIPTION = 'Search for Clash of Clans clans by name.';
export const SEARCH_NO_RESULTS_MESSAGE =
  'No clans found from the live Clash API for this query. `/search` accepts only the `name` filter; try a more specific clan name, alternate spelling, or fewer words. This one-off lookup does not link clans or enroll polling.';
export const SEARCH_API_ERROR_MESSAGE =
  'Could not search clans from the live Clash API right now. This is usually temporary; try again shortly, then check the clan name and Clash API availability if it keeps failing. No clans were linked or enrolled for polling.';
const SEARCH_RESULT_LIMIT = 10;
const SEARCH_API_LIMIT = 100;

export const searchCommandData = new SlashCommandBuilder()
  .setName(SEARCH_COMMAND_NAME)
  .setDescription(SEARCH_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('name').setDescription('Clan name to search for.').setRequired(false),
  );

export interface SearchCocApi {
  getClans: (input: { name: string; limit?: number }) => Promise<ClashClanSearchResult>;
}

export interface SearchCommandOptions {
  readonly coc: SearchCocApi;
}

export function createSearchSlashCommand(options: SearchCommandOptions): SlashCommandDefinition {
  return {
    name: SEARCH_COMMAND_NAME,
    data: searchCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== SEARCH_COMMAND_NAME) return;
      await executeSearch(interaction, context, options);
    },
  };
}

export async function executeSearch(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: SearchCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/search` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const name = interaction.options.getString('name')?.trim() ?? '';
  if (!name) {
    await interaction.reply({ content: buildSearchNoResultsMessage(name), ephemeral: true });
    return;
  }

  await interaction.deferReply();

  let result: ClashClanSearchResult;
  try {
    result = await options.coc.getClans({ name, limit: SEARCH_API_LIMIT });
  } catch {
    await interaction.editReply({ content: buildSearchApiErrorMessage(name) });
    return;
  }

  if (result.items.length === 0) {
    await interaction.editReply({ content: buildSearchNoResultsMessage(name) });
    return;
  }

  await interaction.editReply({ embeds: [buildSearchEmbed(name, result.items)] });
}

export function buildSearchEmbed(name: string, clans: readonly ClashClan[]): EmbedBuilder {
  const shownCount = Math.min(clans.length, SEARCH_RESULT_LIMIT);

  return new EmbedBuilder()
    .setTitle(`Clan search results for ${escapeMarkdown(name)}`)
    .setDescription(
      [
        `Live Clash API one-off lookup for \`${escapeInlineCode(name)}\`. Returned ${clans.length} of up to ${SEARCH_API_LIMIT}; showing ${shownCount}. No clan linking, polling enrollment, or long-term tracking is created.`,
        clans.slice(0, SEARCH_RESULT_LIMIT).map(formatSearchResultLine).join('\n\n'),
      ].join('\n\n'),
    )
    .addFields(
      {
        name: 'Accepted filters',
        value: '`name` only. Use setup/link commands for persisted guild tracking.',
        inline: false,
      },
      {
        name: 'Result coverage',
        value: `Query: \`${escapeInlineCode(name)}\` • Returned: ${clans.length}/${SEARCH_API_LIMIT} • Visible: ${shownCount}/${SEARCH_RESULT_LIMIT}. Results depend on the live API search index and may change over time.`,
        inline: false,
      },
    )
    .setFooter({
      text: `Showing ${shownCount} of ${clans.length} returned clans • Source: live Clash API`,
    });
}

export function buildSearchNoResultsMessage(name: string): string {
  const query = name.trim();
  const queryText = query ? ` for \`${escapeInlineCode(query)}\`` : '';

  return [
    `No clans found from the live Clash API${queryText}.`,
    `Returned 0 of up to ${SEARCH_API_LIMIT}; visible results 0/${SEARCH_RESULT_LIMIT}.`,
    '`/search` accepts only the `name` filter. Try a more specific clan name, alternate spelling, or fewer words.',
    'This one-off lookup does not link clans or enroll polling.',
  ].join(' ');
}

export function buildSearchApiErrorMessage(name: string): string {
  const query = name.trim();
  const queryText = query ? ` for \`${escapeInlineCode(query)}\`` : '';

  return [
    `Could not search clans from the live Clash API${queryText}.`,
    `Requested up to ${SEARCH_API_LIMIT}; visible results 0/${SEARCH_RESULT_LIMIT}.`,
    'This is usually temporary: try again shortly, then check the clan name and Clash API availability if it keeps failing.',
    'No clans were linked or enrolled for polling.',
  ].join(' ');
}

export function formatSearchResultLine(clan: ClashClan): string {
  const data = readSearchClanData(clan);
  return [
    `**[${escapeMarkdown(clan.name)} (${clan.tag})](${clashOfStatsClanUrl(clan.tag)})**`,
    [
      `${formatNumber(data.clanLevel)} level`,
      `${formatNumber(data.members)} ${data.members === 1 ? 'member' : 'members'}`,
      `${formatNumber(data.clanPoints)} points`,
    ].join(', '),
    [
      formatClanType(data.type),
      `${formatNumber(data.requiredTrophies)} trophies required`,
      `TH ${formatNumber(data.requiredTownHallLevel)} required`,
      data.locationName ? escapeMarkdown(data.locationName) : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(', '),
    formatOptionalDetails(data),
  ]
    .filter((value) => value.length > 0)
    .join('\n');
}

interface SearchClanDataView {
  readonly clanLevel: number | null;
  readonly members: number | null;
  readonly clanPoints: number | null;
  readonly type: string | null;
  readonly requiredTrophies: number | null;
  readonly requiredTownHallLevel: number | null;
  readonly locationName: string | null;
  readonly warLeagueName: string | null;
  readonly capitalLeagueName: string | null;
  readonly capitalHallLevel: number | null;
  readonly labels: readonly string[];
}

function readSearchClanData(clan: ClashClan): SearchClanDataView {
  const data = isRecord(clan.data) ? clan.data : {};
  const location = readRecord(readValue(data, 'location'));
  const warLeague = readRecord(readValue(data, 'warLeague'));
  const capitalLeague = readRecord(readValue(data, 'capitalLeague'));
  const clanCapital = readRecord(readValue(data, 'clanCapital'));

  return {
    clanLevel: readNumber(readValue(data, 'clanLevel')),
    members: readNumber(readValue(data, 'members')),
    clanPoints: readNumber(readValue(data, 'clanPoints')),
    type: readString(readValue(data, 'type')),
    requiredTrophies: readNumber(readValue(data, 'requiredTrophies')),
    requiredTownHallLevel: readNumber(readValue(data, 'requiredTownhallLevel')),
    locationName: readString(location ? readValue(location, 'name') : undefined),
    warLeagueName: readString(warLeague ? readValue(warLeague, 'name') : undefined),
    capitalLeagueName: readString(capitalLeague ? readValue(capitalLeague, 'name') : undefined),
    capitalHallLevel: readNumber(
      clanCapital ? readValue(clanCapital, 'capitalHallLevel') : undefined,
    ),
    labels: readLabels(readValue(data, 'labels')),
  };
}

function formatOptionalDetails(data: SearchClanDataView): string {
  const labels = formatLabels(data.labels);
  const details = [
    data.warLeagueName ? `CWL ${escapeMarkdown(data.warLeagueName)}` : 'CWL Unknown',
    data.capitalLeagueName
      ? `Capital ${escapeMarkdown(data.capitalLeagueName)}`
      : 'Capital Unknown',
    `CH ${formatNumber(data.capitalHallLevel)}`,
    labels ? `Labels ${labels}` : null,
  ].filter((value): value is string => Boolean(value));

  return details.join(', ');
}

function formatLabels(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;

  const shownLabels = labels.slice(0, 2).map((label) => escapeMarkdown(label));
  const remainingLabels = labels.length - shownLabels.length;
  return remainingLabels > 0
    ? `${shownLabels.join(', ')} +${remainingLabels}`
    : shownLabels.join(', ');
}

function formatClanType(type: string | null): string {
  switch (type) {
    case 'inviteOnly':
      return 'Invite Only';
    case 'closed':
      return 'Closed';
    case 'open':
      return 'Open';
    default:
      return 'Unknown';
  }
}

function formatNumber(value: number | null): string {
  return value === null ? 'Unknown' : value.toLocaleString('en-US');
}

function clashOfStatsClanUrl(tag: string): string {
  return `https://www.clashofstats.com/clans/${encodeURIComponent(tag.replace(/^#/, ''))}`;
}

function escapeInlineCode(value: string): string {
  return value.replaceAll('`', '\\`');
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readLabels(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((label) => readRecord(label))
    .map((label) => (label ? readString(readValue(label, 'name')) : null))
    .filter((label): label is string => label !== null);
}
