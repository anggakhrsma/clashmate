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
  'No town hall composition could be derived from the current Clash API clan response. `/compo` only uses the selected linked clan’s live member list; make sure the clan has visible members with town hall levels, or choose another linked clan with `clan:`.';
export const COMPO_NO_LINKED_PLAYERS_MESSAGE =
  'That Discord user does not have any linked Clash accounts in this server. `/compo user:` only filters by Clash accounts linked in this server; use `/link create` first.';
export const COMPO_NO_MATCHING_LINKED_CLAN_MESSAGE =
  "None of that Discord user's linked Clash accounts were found in this server's linked clans. User filtering checks linked player tags against the selected server's linked-clan member lists and does not enroll new clans for polling.";

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
  readonly listPlayerTagsForUser: (guildId: string, userId: string) => Promise<string[]>;
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
  const seenTags = new Set<string>();
  const seenValues = new Set<string>();

  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .sort((left, right) => compareCompoClanChoices(left, right, normalizedQuery))
    .filter((clan) => {
      const tagKey = normalizeChoiceKey(clan.clanTag.replace(/^#/, ''));
      const valueKey = normalizeChoiceKey(clan.alias ?? clan.clanTag);
      if (seenTags.has(tagKey) || seenValues.has(valueKey)) return false;
      seenTags.add(tagKey);
      seenValues.add(valueKey);
      return true;
    })
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
  const userOption = interaction.options.getUser('user');
  const clan = clanOption ? resolveCompoClan(clans, clanOption) : undefined;
  if (clan) {
    await replyWithSelectedClan(interaction, clan, options.coc, {
      source:
        'Selected by the `clan:` option from this server’s linked clans and read from the current Clash API clan response.',
      filter: `Clan option: ${clanOption}`,
    });
    return;
  }

  if (clanOption) {
    await interaction.editReply({
      content:
        'No linked clan was found for that clan option. `/compo` only searches clans already linked to this server; use `/setup clan` before requesting composition.',
    });
    return;
  }

  if (userOption) {
    const linkedPlayerTags = await options.store.listPlayerTagsForUser(
      interaction.guildId,
      userOption.id,
    );
    if (linkedPlayerTags.length === 0) {
      await interaction.editReply({ content: COMPO_NO_LINKED_PLAYERS_MESSAGE });
      return;
    }

    const userClan = await findClanForLinkedPlayerTags(clans, linkedPlayerTags, options.coc);
    if (!userClan) {
      await interaction.editReply({ content: COMPO_NO_MATCHING_LINKED_CLAN_MESSAGE });
      return;
    }

    await replyWithCompo(interaction, userClan.clashClan, {
      source:
        'Matched from this server’s linked Discord user accounts and linked-clan member lists, then read from the current Clash API clan response.',
      filter: `${userOption.toString()} (${linkedPlayerTags.length} linked tag${linkedPlayerTags.length === 1 ? '' : 's'})`,
    });
    return;
  }

  const defaultClan = clans[0];
  if (!defaultClan) {
    await interaction.editReply({ content: COMPO_NO_LINKED_CLANS_MESSAGE });
    return;
  }

  await replyWithSelectedClan(interaction, defaultClan, options.coc, {
    source:
      'Defaulted to the first linked clan for this server and read from the current Clash API clan response.',
    filter: 'None; showing the default linked clan.',
  });
}

async function replyWithSelectedClan(
  interaction: ChatInputCommandInteraction,
  clan: CompoLinkedClan,
  coc: CompoCocApi,
  context?: { readonly source?: string; readonly filter?: string },
): Promise<void> {
  let clashClan: ClashClan;
  try {
    clashClan = await coc.getClan(clan.clanTag);
  } catch {
    await interaction.editReply({ content: 'This clan tag is not valid or was not found.' });
    return;
  }

  await replyWithCompo(interaction, clashClan, context);
}

async function replyWithCompo(
  interaction: ChatInputCommandInteraction,
  clashClan: ClashClan,
  context?: { readonly source?: string; readonly filter?: string },
): Promise<void> {
  const composition = collectTownHallComposition(clashClan.data);
  if (composition.length === 0) {
    await interaction.editReply({ content: COMPO_NO_DATA_MESSAGE });
    return;
  }

  await interaction.editReply({ embeds: [buildCompoEmbed(clashClan, composition, context)] });
}

async function findClanForLinkedPlayerTags(
  clans: readonly CompoLinkedClan[],
  linkedPlayerTags: readonly string[],
  coc: CompoCocApi,
): Promise<{ readonly clan: CompoLinkedClan; readonly clashClan: ClashClan } | undefined> {
  const normalizedPlayerTags = new Set(linkedPlayerTags.map((tag) => normalizeClashTag(tag)));

  for (const clan of clans) {
    let clashClan: ClashClan;
    try {
      clashClan = await coc.getClan(clan.clanTag);
    } catch {
      continue;
    }

    if (clanHasAnyMemberTag(clashClan.data, normalizedPlayerTags)) return { clan, clashClan };
  }

  return undefined;
}

function clanHasAnyMemberTag(data: unknown, playerTags: ReadonlySet<string>): boolean {
  if (!isRecord(data)) return false;
  const memberList = readValue(data, 'memberList');
  if (!Array.isArray(memberList)) return false;

  return memberList.some((member) => {
    if (!isRecord(member)) return false;
    const tag = readValue(member, 'tag');
    return typeof tag === 'string' && playerTags.has(normalizeClashTag(tag));
  });
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
  context?: { readonly source?: string; readonly filter?: string },
): EmbedBuilder {
  const totalMembers = composition.reduce((total, row) => total + row.count, 0);
  const averageTownHall = totalMembers
    ? composition.reduce((total, row) => total + row.townHallLevel * row.count, 0) / totalMembers
    : 0;
  const reportedMemberCount = readReportedMemberCount(clan.data);
  const memberListCount = readMemberListCount(clan.data);
  const coverageLabel = formatCoverageLabel(totalMembers, reportedMemberCount, memberListCount);
  const townHallLevels = composition.map((row) => row.townHallLevel);
  const highestTownHall = Math.max(...townHallLevels);
  const lowestTownHall = Math.min(...townHallLevels);
  const source =
    context?.source ??
    'Defaulted to the first linked clan for this server and read from the current Clash API clan response.';
  const filter = context?.filter ?? 'None; showing the selected linked clan.';
  const badgeUrl = readBadgeUrl(clan.data);

  const embed = new EmbedBuilder()
    .setAuthor({ name: `${clan.name} (${clan.tag})`, ...(badgeUrl ? { iconURL: badgeUrl } : {}) })
    .setTitle('Town Hall Composition')
    .setDescription(
      [
        '**Source**',
        source,
        'No persistent polling snapshot or manual refresh is created by `/compo`.',
        `Filter: ${filter}`,
        '',
        '**Coverage**',
        coverageLabel,
        `Average TH: ${averageTownHall.toFixed(2)} • Range: TH${lowestTownHall}–TH${highestTownHall}`,
        '',
        '**Composition**',
        ...composition.map(
          (row) => `**TH${row.townHallLevel}** — ${row.count.toLocaleString('en-US')}`,
        ),
      ].join('\n'),
    )
    .setFooter({
      text: `Derived from live clan response • ${totalMembers} member${totalMembers === 1 ? '' : 's'} with TH data`,
    });

  if (badgeUrl) embed.setThumbnail(badgeUrl);
  return embed;
}

function readReportedMemberCount(data: unknown): number | undefined {
  if (!isRecord(data)) return undefined;
  const members = readValue(data, 'members');
  if (typeof members === 'number' && Number.isInteger(members) && members >= 0) return members;
  return undefined;
}

function readMemberListCount(data: unknown): number | undefined {
  if (!isRecord(data)) return undefined;
  const memberList = readValue(data, 'memberList');
  return Array.isArray(memberList) ? memberList.length : undefined;
}

function formatCoverageLabel(
  townHallCount: number,
  reportedMemberCount: number | undefined,
  memberListCount: number | undefined,
): string {
  const memberScope = reportedMemberCount ?? memberListCount;
  if (memberScope === undefined) {
    return `${townHallCount} member${townHallCount === 1 ? '' : 's'} with town hall data; the live response did not include a separate clan member total.`;
  }

  const percent = memberScope > 0 ? ` (${Math.round((townHallCount / memberScope) * 100)}%)` : '';
  const listNote =
    memberListCount !== undefined && memberListCount !== memberScope
      ? `; ${memberListCount} returned in member list`
      : '';
  return `${townHallCount}/${memberScope} member${memberScope === 1 ? '' : 's'} with town hall data${percent}${listNote}.`;
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

function compareCompoClanChoices(
  left: CompoLinkedClan,
  right: CompoLinkedClan,
  normalizedQuery: string,
): number {
  const leftRank = getCompoClanChoiceRank(left, normalizedQuery);
  const rightRank = getCompoClanChoiceRank(right, normalizedQuery);
  if (leftRank !== rightRank) return leftRank - rightRank;

  return formatClanChoiceSortKey(left).localeCompare(formatClanChoiceSortKey(right), 'en-US', {
    numeric: true,
    sensitivity: 'base',
  });
}

function getCompoClanChoiceRank(clan: CompoLinkedClan, normalizedQuery: string): number {
  if (!normalizedQuery) return 3;

  const values = [clan.alias ?? '', clan.name ?? '', clan.clanTag, clan.clanTag.replace(/^#/, '')]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (values.some((value) => value === normalizedQuery)) return 0;
  if (values.some((value) => value.startsWith(normalizedQuery))) return 1;
  if (values.some((value) => value.includes(normalizedQuery))) return 2;
  return 3;
}

function formatClanChoiceName(clan: CompoLinkedClan): string {
  const alias = clan.alias?.trim();
  const name = clan.name?.trim();
  const labelParts = [
    alias ? `Alias: ${alias}` : undefined,
    name ? `Name: ${name}` : undefined,
    `Tag: ${clan.clanTag}`,
  ].filter((part): part is string => Boolean(part));
  return escapeMarkdown(labelParts.join(' • ')).slice(0, 100);
}

function formatClanChoiceSortKey(clan: CompoLinkedClan): string {
  return [clan.alias?.trim() ?? '', clan.name?.trim() ?? '', clan.clanTag].join('\u0000');
}

function normalizeChoiceKey(value: string): string {
  return value.trim().toLowerCase();
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
