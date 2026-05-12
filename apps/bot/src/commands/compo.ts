import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  time,
} from 'discord.js';

export const COMPO_COMMAND_NAME = 'compo';
export const COMPO_COMMAND_DESCRIPTION = 'Show town hall composition for a linked clan.';
export const COMPO_NO_LINKED_CLANS_MESSAGE =
  'No clans are linked to this server yet. Use `/setup clan` to link one.';
export const COMPO_NO_DATA_MESSAGE =
  'No town hall composition could be derived from persisted linked-clan member snapshots. `/compo` does not query Clash live or start polling; link/configure the clan with `/setup clan`, wait for clan polling to store member snapshots with town hall levels, or choose another linked clan with `clan:`.';
export const COMPO_NO_LINKED_PLAYERS_MESSAGE =
  'That Discord user does not have any linked Clash accounts in this server. `/compo user:` only filters by Clash accounts linked in this server; use `/link create` first.';
export const COMPO_NO_MATCHING_LINKED_CLAN_MESSAGE =
  "None of that Discord user's linked Clash accounts were found in this server's persisted linked-clan member snapshots. User filtering checks linked player tags against stored snapshot rows and does not query Clash live or enroll new clans for polling.";

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

export interface CompoSnapshotMember {
  readonly playerTag?: string;
  readonly tag?: string;
  readonly townHallLevel?: number | null;
  readonly lastFetchedAt?: Date;
}

export interface CompoClanSnapshots {
  readonly clan: CompoLinkedClan;
  readonly members: readonly CompoSnapshotMember[];
}

export interface CompoStore {
  readonly listLinkedClans: (guildId: string) => Promise<CompoLinkedClan[]>;
  readonly listPlayerTagsForUser: (guildId: string, userId: string) => Promise<string[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<CompoClanSnapshots[]>;
}

export interface CompoCommandOptions {
  readonly store: CompoStore;
}

export interface TownHallCompositionRow {
  readonly townHallLevel: number;
  readonly count: number;
}

interface CompoDiagnostics {
  readonly clan: CompoLinkedClan;
  readonly linkedClanCount: number;
  readonly linkedClanWithRowsCount: number;
  readonly storedMemberRowCount: number;
  readonly latestSnapshotAt: Date | null;
  readonly filter: string;
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
    const [snapshot] = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
      clanTag: clan.clanTag,
    });
    await replyWithCompo(
      interaction,
      snapshot,
      buildCompoDiagnostics(clans, snapshot ? [snapshot] : [], {
        clan,
        filter: `clan:${clanOption} resolved to ${formatLinkedClanDiagnosticLabel(clan)}`,
      }),
    );
    return;
  }

  if (clanOption) {
    await interaction.editReply({
      content:
        'No linked clan was found for that clan option. `/compo` only searches clans already linked to this server; use `/setup clan` before requesting composition. Persisted snapshots only; no live Clash API lookup is performed.',
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

    const snapshots = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
    });
    const userClan = findClanForLinkedPlayerTags(snapshots, linkedPlayerTags);
    if (!userClan) {
      await interaction.editReply({ content: COMPO_NO_MATCHING_LINKED_CLAN_MESSAGE });
      return;
    }

    await replyWithCompo(
      interaction,
      userClan,
      buildCompoDiagnostics(clans, snapshots, {
        clan: userClan.clan,
        filter: `${userOption.toString()} (${linkedPlayerTags.length} linked tag${linkedPlayerTags.length === 1 ? '' : 's'}) matched stored member snapshot rows`,
      }),
    );
    return;
  }

  const defaultClan = clans[0];
  if (!defaultClan) {
    await interaction.editReply({ content: COMPO_NO_LINKED_CLANS_MESSAGE });
    return;
  }

  const [snapshot] = await options.store.listClanMemberSnapshotsForGuild({
    guildId: interaction.guildId,
    clanTag: defaultClan.clanTag,
  });
  await replyWithCompo(
    interaction,
    snapshot,
    buildCompoDiagnostics(clans, snapshot ? [snapshot] : [], {
      clan: defaultClan,
      filter: 'none; defaulted to first linked clan',
    }),
  );
}

async function replyWithCompo(
  interaction: ChatInputCommandInteraction,
  snapshot: CompoClanSnapshots | undefined,
  context: CompoDiagnostics,
): Promise<void> {
  const composition = collectTownHallComposition(snapshot?.members ?? []);
  if (composition.length === 0) {
    await interaction.editReply({
      content: `${COMPO_NO_DATA_MESSAGE}\n${formatCompoNoDataDiagnostics(context)}`,
    });
    return;
  }

  await interaction.editReply({ embeds: [buildCompoEmbed(snapshot, composition, context)] });
}

function findClanForLinkedPlayerTags(
  snapshots: readonly CompoClanSnapshots[],
  linkedPlayerTags: readonly string[],
): CompoClanSnapshots | undefined {
  const normalizedPlayerTags = new Set(linkedPlayerTags.map((tag) => normalizeClashTag(tag)));
  return snapshots.find((snapshot) =>
    snapshot.members.some((member) => {
      const tag = member.playerTag ?? member.tag;
      return typeof tag === 'string' && normalizedPlayerTags.has(normalizeClashTag(tag));
    }),
  );
}

export function collectTownHallComposition(memberList: unknown): TownHallCompositionRow[] {
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
  snapshot: CompoClanSnapshots | undefined,
  composition: readonly TownHallCompositionRow[],
  context: CompoDiagnostics,
): EmbedBuilder {
  const totalMembers = composition.reduce((total, row) => total + row.count, 0);
  const averageTownHall = totalMembers
    ? composition.reduce((total, row) => total + row.townHallLevel * row.count, 0) / totalMembers
    : 0;
  const storedRows = snapshot?.members.length ?? 0;
  const coverageLabel = formatCoverageLabel(totalMembers, storedRows, storedRows);
  const townHallLevels = composition.map((row) => row.townHallLevel);
  const highestTownHall = Math.max(...townHallLevels);
  const lowestTownHall = Math.min(...townHallLevels);

  return new EmbedBuilder()
    .setAuthor({ name: `${context.clan.name ?? 'Linked Clan'} (${context.clan.clanTag})` })
    .setTitle('Town Hall Composition')
    .setDescription(
      [
        '**Source**',
        'Persisted clan-poller member snapshots only; no live Clash API lookup, manual refresh, or polling enrollment is performed by `/compo`.',
        `Linked clans: ${context.linkedClanCount}; with stored rows: ${context.linkedClanWithRowsCount}; stored rows scanned: ${context.storedMemberRowCount}.`,
        `Filter: ${context.filter}`,
        `Snapshot freshness: ${formatLatestCompoSnapshot(context.latestSnapshotAt)}`,
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
      text: `Persisted only • ${totalMembers} member${totalMembers === 1 ? '' : 's'} with TH data`,
    });
}

function formatCoverageLabel(
  townHallCount: number,
  reportedMemberCount: number | undefined,
  memberListCount: number | undefined,
): string {
  const memberScope = reportedMemberCount ?? memberListCount;
  if (memberScope === undefined) {
    return `${townHallCount} member${townHallCount === 1 ? '' : 's'} with town hall data; the persisted snapshot did not include a separate clan member total.`;
  }

  const percent = memberScope > 0 ? ` (${Math.round((townHallCount / memberScope) * 100)}%)` : '';
  return `${townHallCount}/${memberScope} member${memberScope === 1 ? '' : 's'} with town hall data${percent}.`;
}

function buildCompoDiagnostics(
  clans: readonly CompoLinkedClan[],
  snapshots: readonly CompoClanSnapshots[],
  input: { readonly clan: CompoLinkedClan; readonly filter: string },
): CompoDiagnostics {
  return {
    clan: input.clan,
    filter: input.filter,
    linkedClanCount: clans.length,
    linkedClanWithRowsCount: snapshots.filter((snapshot) => snapshot.members.length > 0).length,
    storedMemberRowCount: snapshots.reduce((total, snapshot) => total + snapshot.members.length, 0),
    latestSnapshotAt: getLatestCompoSnapshotTime(snapshots),
  };
}

function getLatestCompoSnapshotTime(snapshots: readonly CompoClanSnapshots[]): Date | null {
  const latest = snapshots.reduce<number | null>((value, snapshot) => {
    for (const member of snapshot.members) {
      const fetchedAt = member.lastFetchedAt;
      if (!(fetchedAt instanceof Date)) continue;
      const timeValue = fetchedAt.getTime();
      if (!Number.isFinite(timeValue)) continue;
      if (value === null || timeValue > value) return timeValue;
    }
    return value;
  }, null);
  return latest === null ? null : new Date(latest);
}

function formatLatestCompoSnapshot(latest: Date | null): string {
  return latest
    ? `${time(latest, 'R')} (${time(latest, 'f')})`
    : 'no stored member snapshot timestamp';
}

function formatCompoNoDataDiagnostics(context: CompoDiagnostics): string {
  return `Diagnostics: linked clans ${context.linkedClanCount}; with stored rows ${context.linkedClanWithRowsCount}; stored rows scanned ${context.storedMemberRowCount}; filter ${context.filter}; latest snapshot ${formatLatestCompoSnapshot(context.latestSnapshotAt)}.`;
}

function formatLinkedClanDiagnosticLabel(clan: CompoLinkedClan): string {
  return `${clan.alias ?? clan.name ?? clan.clanTag} (${clan.clanTag})`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}
