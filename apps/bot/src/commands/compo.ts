import type { ClashClan } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
} from 'discord.js';

export const COMPO_COMMAND_NAME = 'compo';
export const COMPO_COMMAND_DESCRIPTION = 'Show town hall composition for a linked clan.';
export const COMPO_NO_LINKED_CLANS_MESSAGE =
  'No clans are linked to this server yet. Use `/setup clan` to link one.';
export const COMPO_NO_DATA_MESSAGE =
  'The current Clash API clan response does not include member town hall levels for this clan.';

export const compoCommandData = new SlashCommandBuilder()
  .setName(COMPO_COMMAND_NAME)
  .setDescription(COMPO_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('clan')
      .setDescription('Clan tag or name or alias.')
      .setAutocomplete(true)
      .setRequired(false),
  )
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('Discord user whose linked clan should be shown when available.')
      .setRequired(false),
  );

export interface CompoLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface CompoStore {
  readonly listLinkedClans: (guildId: string) => Promise<CompoLinkedClan[]>;
}

export interface CompoCocApi {
  readonly getClan: (clanTag: string) => Promise<ClashClan>;
}

export interface CompoCommandOptions {
  readonly store: CompoStore;
  readonly coc: CompoCocApi;
}

export interface TownHallCompositionRow {
  readonly townHallLevel: number;
  readonly count: number;
}

export function createCompoSlashCommand(options: CompoCommandOptions): SlashCommandDefinition {
  return {
    name: COMPO_COMMAND_NAME,
    data: compoCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== COMPO_COMMAND_NAME) return;
      await executeCompo(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== COMPO_COMMAND_NAME) return;
      await autocompleteCompo(interaction, options);
    },
  };
}

async function autocompleteCompo(
  interaction: AutocompleteInteraction,
  options: CompoCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'clan') {
    await interaction.respond([]);
    return;
  }

  try {
    const clans = await options.store.listLinkedClans(interaction.guildId);
    await interaction.respond(filterCompoClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterCompoClanChoices(
  clans: readonly CompoLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export async function executeCompo(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: CompoCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: '`/compo` can only be used in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const clans = await options.store.listLinkedClans(interaction.guildId);
  if (clans.length === 0) {
    await interaction.editReply({ content: COMPO_NO_LINKED_CLANS_MESSAGE });
    return;
  }

  const clanOption = interaction.options.getString('clan');
  const clan = clanOption ? resolveCompoClan(clans, clanOption) : clans[0];
  if (!clan) {
    await interaction.editReply({ content: 'No linked clan was found for that clan option.' });
    return;
  }

  let clashClan: ClashClan;
  try {
    clashClan = await options.coc.getClan(clan.clanTag);
  } catch {
    await interaction.editReply({ content: 'This clan tag is not valid or was not found.' });
    return;
  }

  const composition = collectTownHallComposition(clashClan.data);
  if (composition.length === 0) {
    await interaction.editReply({ content: COMPO_NO_DATA_MESSAGE });
    return;
  }

  await interaction.editReply({ embeds: [buildCompoEmbed(clashClan, composition)] });
}

export function collectTownHallComposition(data: unknown): TownHallCompositionRow[] {
  if (!isRecord(data)) return [];
  const memberList = readValue(data, 'memberList');
  if (!Array.isArray(memberList)) return [];

  const counts = new Map<number, number>();
  for (const member of memberList) {
    if (!isRecord(member)) continue;
    const townHallLevel = readValue(member, 'townHallLevel');
    if (typeof townHallLevel !== 'number' || !Number.isInteger(townHallLevel)) continue;
    counts.set(townHallLevel, (counts.get(townHallLevel) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([townHallLevel, count]) => ({ townHallLevel, count }))
    .sort((left, right) => right.townHallLevel - left.townHallLevel);
}

export function buildCompoEmbed(
  clan: Pick<ClashClan, 'name' | 'tag' | 'data'>,
  composition: readonly TownHallCompositionRow[],
): EmbedBuilder {
  const totalMembers = composition.reduce((total, row) => total + row.count, 0);
  const averageTownHall = totalMembers
    ? composition.reduce((total, row) => total + row.townHallLevel * row.count, 0) / totalMembers
    : 0;
  const badgeUrl = readBadgeUrl(clan.data);

  const embed = new EmbedBuilder()
    .setAuthor({ name: `${clan.name} (${clan.tag})`, ...(badgeUrl ? { iconURL: badgeUrl } : {}) })
    .setTitle('Town Hall Composition')
    .setDescription(
      composition
        .map((row) => `**TH${row.townHallLevel}** — ${row.count.toLocaleString('en-US')}`)
        .join('\n'),
    )
    .setFooter({ text: `Avg: ${averageTownHall.toFixed(2)} • Total: ${totalMembers}` });

  if (badgeUrl) embed.setThumbnail(badgeUrl);
  return embed;
}

export function resolveCompoClan(
  clans: readonly CompoLinkedClan[],
  query: string,
): CompoLinkedClan | undefined {
  const normalizedQuery = query.trim().toLowerCase();
  let normalizedTag: string | undefined;
  try {
    normalizedTag = normalizeClashTag(query).toLowerCase();
  } catch {
    normalizedTag = undefined;
  }
  return clans.find(
    (clan) =>
      clan.clanTag.toLowerCase() === normalizedTag ||
      clan.clanTag.replace(/^#/, '').toLowerCase() === normalizedQuery.replace(/^#/, '') ||
      clan.alias?.trim().toLowerCase() === normalizedQuery ||
      clan.name?.trim().toLowerCase() === normalizedQuery,
  );
}

function clanMatchesQuery(clan: CompoLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: CompoLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${escapeMarkdown(label)} (${clan.clanTag})`.slice(0, 100);
}

function readBadgeUrl(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const badgeUrls = readValue(data, 'badgeUrls');
  if (!isRecord(badgeUrls)) return undefined;
  const small = readValue(badgeUrls, 'small');
  const medium = readValue(badgeUrls, 'medium');
  if (typeof small === 'string') return small;
  if (typeof medium === 'string') return medium;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}
