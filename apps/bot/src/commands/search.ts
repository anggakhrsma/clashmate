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
  'No clans found. Try `/search name:<clan name>` with a more specific clan name.';
const SEARCH_RESULT_LIMIT = 10;

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
    await interaction.reply({ content: SEARCH_NO_RESULTS_MESSAGE, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  let result: ClashClanSearchResult;
  try {
    result = await options.coc.getClans({ name, limit: 100 });
  } catch {
    await interaction.editReply({ content: SEARCH_NO_RESULTS_MESSAGE });
    return;
  }

  if (result.items.length === 0) {
    await interaction.editReply({ content: SEARCH_NO_RESULTS_MESSAGE });
    return;
  }

  await interaction.editReply({ embeds: [buildSearchEmbed(name, result.items)] });
}

export function buildSearchEmbed(name: string, clans: readonly ClashClan[]): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Search results for ${escapeMarkdown(name)}`)
    .setDescription(clans.slice(0, SEARCH_RESULT_LIMIT).map(formatSearchResultLine).join('\n\n'))
    .setFooter({
      text: `Showing ${Math.min(clans.length, SEARCH_RESULT_LIMIT)} of ${clans.length}`,
    });
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
      `${formatNumber(data.requiredTrophies)} required`,
      data.locationName ? escapeMarkdown(data.locationName) : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(', '),
  ].join('\n');
}

interface SearchClanDataView {
  readonly clanLevel: number | null;
  readonly members: number | null;
  readonly clanPoints: number | null;
  readonly type: string | null;
  readonly requiredTrophies: number | null;
  readonly locationName: string | null;
}

function readSearchClanData(clan: ClashClan): SearchClanDataView {
  const data = isRecord(clan.data) ? clan.data : {};
  const location = readRecord(readValue(data, 'location'));

  return {
    clanLevel: readNumber(readValue(data, 'clanLevel')),
    members: readNumber(readValue(data, 'members')),
    clanPoints: readNumber(readValue(data, 'clanPoints')),
    type: readString(readValue(data, 'type')),
    requiredTrophies: readNumber(readValue(data, 'requiredTrophies')),
    locationName: readString(location ? readValue(location, 'name') : undefined),
  };
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
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
