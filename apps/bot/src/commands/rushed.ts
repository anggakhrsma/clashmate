import type { ClashPlayer } from '@clashmate/coc';
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
import {
  filterPlayerTagAutocompleteChoices,
  formatNoLinkedPlayerMessage,
  PLAYER_NOT_FOUND_MESSAGE,
  type PlayerCocApi,
  type PlayerLinkStore,
  resolvePlayerTag,
} from './player.js';

export const RUSHED_COMMAND_NAME = 'rushed';
export const RUSHED_COMMAND_DESCRIPTION = 'Show likely rushed or incomplete player units.';

const EMBED_FIELD_VALUE_LIMIT = 1024;
const EMBED_MAX_FIELDS = 25;
const EMBED_DESCRIPTION_LIMIT = 4096;
const RUSHED_CLAN_LOOKUP_LIMIT = 15;
const RUSHED_CLAN_ROW_LIMIT = 10;
const RUSHED_HEURISTIC_NOTE =
  'Heuristic note: ClashMate currently compares public API unit levels to API maxLevel values. This is a conservative incomplete-units view, not the legacy previous-town-hall rushed table yet.';
const RUSHED_NO_DATA_GUIDANCE =
  'If this looks empty or outdated, make sure the player is public, the clan is linked in this server, and the clan/player pollers have had time to refresh stored member snapshots.';

export const rushedCommandData = new SlashCommandBuilder()
  .setName(RUSHED_COMMAND_NAME)
  .setDescription(RUSHED_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('player').setDescription('Player tag to look up.').setAutocomplete(true),
  )
  .addUserOption((option) =>
    option.setName('user').setDescription('Discord user whose linked account to show.'),
  )
  .addStringOption((option) =>
    option.setName('clan').setDescription('Clan tag or name or alias.').setAutocomplete(true),
  );

export interface RushedLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface RushedSnapshotRow {
  readonly playerTag: string;
  readonly name: string;
  readonly lastFetchedAt?: Date;
}

export interface RushedClanSnapshots {
  readonly clan: RushedLinkedClan;
  readonly members: readonly RushedSnapshotRow[];
}

export interface RushedCommandOptions {
  readonly coc: PlayerCocApi;
  readonly links: Pick<PlayerLinkStore, 'listPlayerTagsForUser'>;
  readonly clans: {
    readonly listLinkedClans: (guildId: string) => Promise<RushedLinkedClan[]>;
    readonly listClanMemberSnapshotsForGuild: (input: {
      guildId: string;
      clanTag?: string;
    }) => Promise<RushedClanSnapshots[]>;
  };
}

export interface RushedUnit {
  readonly name: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly village: string | null;
}

export interface RushedUnitGroups {
  readonly troops: readonly RushedUnit[];
  readonly spells: readonly RushedUnit[];
  readonly heroes: readonly RushedUnit[];
  readonly heroEquipment: readonly RushedUnit[];
  readonly builderBase: readonly RushedUnit[];
}

export interface RushedSummary {
  readonly incompleteLevels: number;
  readonly maxLevels: number;
  readonly incompleteUnits: number;
  readonly totalUnits: number;
}

export function createRushedSlashCommand(options: RushedCommandOptions): SlashCommandDefinition {
  return {
    name: RUSHED_COMMAND_NAME,
    data: rushedCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== RUSHED_COMMAND_NAME) return;
      await executeRushed(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== RUSHED_COMMAND_NAME) return;
      await autocompleteRushed(interaction, options);
    },
  };
}

export async function autocompleteRushed(
  interaction: AutocompleteInteraction,
  options: Pick<RushedCommandOptions, 'links' | 'clans'>,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  try {
    if (focused.name === 'player') {
      const tags = await options.links.listPlayerTagsForUser(
        interaction.guildId,
        interaction.user.id,
      );
      await interaction.respond(
        filterPlayerTagAutocompleteChoices(tags, String(focused.value ?? '')),
      );
      return;
    }

    if (focused.name === 'clan') {
      const clans = await options.clans.listLinkedClans(interaction.guildId);
      await interaction.respond(filterRushedClanChoices(clans, String(focused.value ?? '')));
      return;
    }

    await interaction.respond([]);
  } catch {
    await interaction.respond([]);
  }
}

export async function executeRushed(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: RushedCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/rushed` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const clanOption = interaction.options.getString('clan');
  const playerOption = interaction.options.getString('player');
  const userOption = interaction.options.getUser('user');

  if (clanOption && !playerOption && !userOption) {
    await executeRushedClanMode(interaction, options, interaction.guildId, clanOption);
    return;
  }

  const resolution = await resolvePlayerTag({
    guildId: interaction.guildId,
    invokingUser: interaction.user,
    tagOption: playerOption,
    userOption,
    links: options.links,
  });

  if (resolution.status === 'invalid_tag') {
    await interaction.reply({ content: PLAYER_NOT_FOUND_MESSAGE, ephemeral: true });
    return;
  }

  if (resolution.status === 'no_link') {
    const target = userOption ? 'That Discord user' : 'You';
    await interaction.reply({
      content: `${formatNoLinkedPlayerMessage(resolution)}\n${target} must have a linked Clash account before \`/rushed user:\` can choose an account automatically, or provide the \`player\` tag option directly.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  let player: ClashPlayer;
  try {
    player = await options.coc.getPlayer(resolution.playerTag);
  } catch {
    await interaction.editReply(
      `${PLAYER_NOT_FOUND_MESSAGE}\nCould not fetch live player data for ${resolution.playerTag}. Try again later or use a different linked/player tag.`,
    );
    return;
  }

  await interaction.editReply({ embeds: [buildRushedEmbed(player, resolution.source)] });
}

export function filterRushedClanChoices(
  clans: readonly RushedLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  const seenAcceptedValues = new Set<string>();
  const seenClanTags = new Set<string>();
  const choices: ApplicationCommandOptionChoiceData<string>[] = [];

  for (const clan of [...clans]
    .filter((candidate) => clanMatchesQuery(candidate, normalizedQuery))
    .sort(compareRushedClanChoices)) {
    const value = clan.alias ?? clan.clanTag;
    const acceptedValueKey = value.trim().toLowerCase();
    const clanTagKey = clan.clanTag.trim().toLowerCase();
    if (seenAcceptedValues.has(acceptedValueKey) || seenClanTags.has(clanTagKey)) continue;

    seenAcceptedValues.add(acceptedValueKey);
    seenClanTags.add(clanTagKey);
    choices.push({ name: formatClanChoiceName(clan), value });
    if (choices.length >= 25) break;
  }

  return choices;
}

async function executeRushedClanMode(
  interaction: ChatInputCommandInteraction,
  options: RushedCommandOptions,
  guildId: string,
  clanOption: string,
): Promise<void> {
  await interaction.deferReply();

  const clans = await options.clans.listLinkedClans(guildId);
  const clan = resolveRushedClan(clans, clanOption);
  if (!clan) {
    await interaction.editReply({
      content:
        "No linked clan was found for that clan option. Choose one of this server's linked clans from autocomplete, or link the clan before using clan mode.",
    });
    return;
  }

  const [snapshots] = await options.clans.listClanMemberSnapshotsForGuild({
    guildId,
    clanTag: clan.clanTag,
  });
  if (!snapshots || snapshots.members.length === 0) {
    await interaction.editReply({
      content: formatRushedNoSnapshotMessage(clan, snapshots),
    });
    return;
  }

  const players: ClashPlayer[] = [];
  let failedLookups = 0;
  for (const member of snapshots.members.slice(0, RUSHED_CLAN_LOOKUP_LIMIT)) {
    try {
      players.push(await options.coc.getPlayer(member.playerTag));
    } catch {
      failedLookups += 1;
      // Keep clan mode best-effort and avoid failing the whole summary for one member lookup.
    }
  }

  if (players.length === 0) {
    await interaction.editReply({
      content: `No analyzable live player data could be fetched for the selected clan snapshot (${clan.clanTag}). Analyzed 0/${Math.min(snapshots.members.length, RUSHED_CLAN_LOOKUP_LIMIT)} current members; skipped ${countSkippedRushedMembers(snapshots.members.length)} over the live lookup cap; failed ${failedLookups}. Latest snapshot: ${formatLatestRushedSnapshotLabel(snapshots.members)}. ${RUSHED_NO_DATA_GUIDANCE}`,
    });
    return;
  }

  await interaction.editReply({
    embeds: [buildRushedClanEmbed(clan, snapshots.members, players, failedLookups)],
  });
}

export function buildRushedClanEmbed(
  clan: RushedLinkedClan,
  snapshotMembersOrCount: readonly RushedSnapshotRow[] | number,
  players: readonly ClashPlayer[],
  failedLookups = 0,
): EmbedBuilder {
  const snapshotMemberCount =
    typeof snapshotMembersOrCount === 'number'
      ? snapshotMembersOrCount
      : snapshotMembersOrCount.length;
  const latestSnapshotLabel =
    typeof snapshotMembersOrCount === 'number'
      ? 'unavailable'
      : formatLatestRushedSnapshotLabel(snapshotMembersOrCount);
  const analyzedCap = Math.min(snapshotMemberCount, RUSHED_CLAN_LOOKUP_LIMIT);
  const skippedLookups = countSkippedRushedMembers(snapshotMemberCount);
  const rows = players
    .map((player) => ({ player, summary: summarizeRushedGroups(collectRushedUnits(player)) }))
    .filter((row) => row.summary.totalUnits > 0)
    .sort(
      (left, right) =>
        right.summary.incompleteLevels - left.summary.incompleteLevels ||
        right.summary.incompleteUnits - left.summary.incompleteUnits ||
        left.player.name.localeCompare(right.player.name),
    );
  const clanName = clan.alias ?? clan.name ?? 'Linked Clan';
  return new EmbedBuilder()
    .setTitle(`Rushed Clan Summary: ${escapeMarkdown(clanName)} (${clan.clanTag})`)
    .setDescription(
      rows.length
        ? rows
            .slice(0, RUSHED_CLAN_ROW_LIMIT)
            .map((row, index) => formatRushedClanRow(row, index))
            .join('\n')
        : `No incomplete units found in fetched member data. Analyzed ${players.length}/${analyzedCap} current members; skipped ${skippedLookups}; failed ${failedLookups}. ${RUSHED_NO_DATA_GUIDANCE}`,
    )
    .setFooter({
      text: `Source: clan snapshot + current live player lookups; analyzed ${players.length}/${analyzedCap}; skipped ${skippedLookups}; failed ${failedLookups}; stored members ${snapshotMemberCount}; latest snapshot ${latestSnapshotLabel}. No polling enrollment or persisted rushed history.`,
    });
}

function formatRushedClanRow(
  row: { readonly player: ClashPlayer; readonly summary: RushedSummary },
  index: number,
): string {
  const percent = calculateIncompletePercent(row.summary);
  return `${index + 1}. **${escapeMarkdown(row.player.name)}** (${row.player.tag}) · ${row.summary.incompleteUnits}/${row.summary.totalUnits} incomplete · ${percent}% short`;
}

function formatRushedNoSnapshotMessage(
  clan: RushedLinkedClan,
  snapshots: RushedClanSnapshots | undefined,
): string {
  const storedMembers = snapshots?.members.length ?? 0;
  return [
    `No current member snapshot is available for the selected linked clan (${clan.clanTag}).`,
    `Source: clan snapshot; analyzed 0 current members; skipped 0; failed 0; stored members ${storedMembers}; latest snapshot ${formatLatestRushedSnapshotLabel(snapshots?.members ?? [])}.`,
    "Clan mode uses this server's linked-clan member snapshot plus current live player lookups, not a free-form clan search.",
    'Action: verify the clan is linked in this server, keep the worker running, and wait for clan polling to observe members. Search-only lookups do not enroll polling, and /rushed does not persist history.',
  ].join('\n');
}

function countSkippedRushedMembers(snapshotMemberCount: number): number {
  return Math.max(0, snapshotMemberCount - RUSHED_CLAN_LOOKUP_LIMIT);
}

function formatLatestRushedSnapshotLabel(members: readonly RushedSnapshotRow[]): string {
  const latestFetchedAt = members
    .flatMap((member) => (member.lastFetchedAt ? [member.lastFetchedAt] : []))
    .sort((left, right) => right.getTime() - left.getTime())[0];
  if (!latestFetchedAt) return 'none available';
  return `${time(latestFetchedAt, 'R')} (${formatRushedSnapshotAge(latestFetchedAt, new Date())} old)`;
}

function formatRushedSnapshotAge(snapshotAt: Date, now: Date): string {
  const ageMs = Math.max(0, now.getTime() - snapshotAt.getTime());
  const totalMinutes = Math.floor(ageMs / 60_000);
  if (totalMinutes < 1) return 'less than 1m';
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    ...(days > 0 ? [`${days}d`] : []),
    ...(hours > 0 ? [`${hours}h`] : []),
    ...(days === 0 && minutes > 0 ? [`${minutes}m`] : []),
  ];
  return parts.join(' ');
}

function formatRushedPlayerSource(source: 'explicit_tag' | 'stored_user_link'): string {
  return source === 'stored_user_link'
    ? 'stored player link live lookup'
    : 'selected player tag live lookup';
}

export function resolveRushedClan(
  clans: readonly RushedLinkedClan[],
  query: string,
): RushedLinkedClan | undefined {
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

function clanMatchesQuery(clan: RushedLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function compareRushedClanChoices(left: RushedLinkedClan, right: RushedLinkedClan): number {
  return (
    compareChoiceText(left.alias, right.alias) ||
    compareChoiceText(left.name, right.name) ||
    left.clanTag.localeCompare(right.clanTag) ||
    left.id.localeCompare(right.id)
  );
}

function compareChoiceText(left: string | null, right: string | null): number {
  const leftText = left?.trim() ?? '';
  const rightText = right?.trim() ?? '';
  if (!leftText && !rightText) return 0;
  if (!leftText) return 1;
  if (!rightText) return -1;
  return leftText.localeCompare(rightText);
}

function formatClanChoiceName(clan: RushedLinkedClan): string {
  const alias = clan.alias?.trim();
  const name = clan.name?.trim();
  const context = alias && name ? `${alias} — ${name}` : (alias ?? name ?? 'Linked Clan');
  return `${context} (${clan.clanTag})`.slice(0, 100);
}

export function buildRushedEmbed(
  player: ClashPlayer,
  source: 'explicit_tag' | 'stored_user_link' = 'explicit_tag',
): EmbedBuilder {
  const groups = collectRushedUnits(player);
  const summary = summarizeRushedGroups(groups);
  const data = readRecord(player.data) ?? {};
  const townHall = readNumber(readValue(data, 'townHallLevel'));
  const builderHall = readNumber(readValue(data, 'builderHallLevel'));
  const incompletePercent = calculateIncompletePercent(summary);

  const embed = new EmbedBuilder()
    .setTitle(`Rushed Units: ${escapeMarkdown(player.name)} (${player.tag})`)
    .setURL(
      `https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${encodeURIComponent(player.tag)}`,
    )
    .setDescription(
      truncateEmbedText(
        [
          `Likely rushed or incomplete units${townHall ? ` for TH ${townHall}` : ''}${builderHall ? ` / BH ${builderHall}` : ''}.`,
          RUSHED_HEURISTIC_NOTE,
          'This may include upgrades above the current hall level and should be treated as guidance, not a definitive rushed score.',
          `Incomplete: **${summary.incompleteUnits.toLocaleString('en-US')}/${summary.totalUnits.toLocaleString('en-US')}** units • **${incompletePercent}%** of API max levels remaining.`,
        ].join('\n'),
        EMBED_DESCRIPTION_LIMIT,
        'Likely rushed or incomplete units from public API maxLevel values.',
      ),
    );

  for (const field of buildRushedFields(groups)) embed.addFields(field);
  if (summary.incompleteUnits === 0) {
    embed.addFields({
      name: 'Rushed Units',
      value: `No incomplete units found from API maxLevel values. Source: ${formatRushedPlayerSource(source)}; analyzed 1 player; failed 0. Current-only live lookup; no polling enrollment or persisted rushed history.`,
      inline: false,
    });
  }

  embed.setFooter({
    text: `Source: ${formatRushedPlayerSource(source)}; analyzed 1 player; failed 0. Current-only live lookup; no polling enrollment or persisted rushed history.`,
  });

  return embed;
}

export function collectRushedUnits(player: ClashPlayer): RushedUnitGroups {
  const data = readRecord(player.data) ?? {};
  const troops = readRushedUnits(readValue(data, 'troops'));

  return {
    troops: troops.filter((unit) => unit.village !== 'builderBase'),
    spells: readRushedUnits(readValue(data, 'spells')),
    heroes: readRushedUnits(readValue(data, 'heroes')),
    heroEquipment: readRushedUnits(readValue(data, 'heroEquipment')),
    builderBase: troops.filter((unit) => unit.village === 'builderBase'),
  };
}

export function summarizeRushedGroups(groups: RushedUnitGroups): RushedSummary {
  const units = Object.values(groups).flat();
  return units.reduce<RushedSummary>(
    (summary, unit) => ({
      incompleteLevels: summary.incompleteLevels + Math.max(0, unit.maxLevel - unit.level),
      maxLevels: summary.maxLevels + unit.maxLevel,
      incompleteUnits: summary.incompleteUnits + 1,
      totalUnits: summary.totalUnits + 1,
    }),
    { incompleteLevels: 0, maxLevels: 0, incompleteUnits: 0, totalUnits: 0 },
  );
}

export function calculateIncompletePercent(summary: RushedSummary): string {
  if (summary.maxLevels === 0) return '0.00';
  return ((summary.incompleteLevels * 100) / summary.maxLevels).toFixed(2);
}

function buildRushedFields(
  groups: RushedUnitGroups,
): Array<{ name: string; value: string; inline: false }> {
  const definitions = [
    ['Troops', groups.troops],
    ['Spells', groups.spells],
    ['Heroes', groups.heroes],
    ['Hero Equipment', groups.heroEquipment],
    ['Builder Base', groups.builderBase],
  ] as const;
  const fields: Array<{ name: string; value: string; inline: false }> = [];

  for (const [name, units] of definitions) {
    if (!units.length || fields.length >= EMBED_MAX_FIELDS) continue;
    for (const value of chunkUnitRows(units)) {
      if (fields.length >= EMBED_MAX_FIELDS) break;
      fields.push({
        name: fields.some((field) => field.name === name) ? `${name} (continued)` : name,
        value,
        inline: false,
      });
    }
  }

  return fields;
}

function chunkUnitRows(units: readonly RushedUnit[]): string[] {
  const chunks: string[] = [];
  let rows: string[] = [];
  let length = 0;

  for (const row of units.map(formatRushedUnit)) {
    const nextLength = length === 0 ? row.length : length + 1 + row.length;
    if (rows.length && nextLength > EMBED_FIELD_VALUE_LIMIT) {
      chunks.push(rows.join('\n'));
      rows = [];
      length = 0;
    }
    rows.push(row);
    length = length === 0 ? row.length : length + 1 + row.length;
  }

  if (rows.length) chunks.push(rows.join('\n'));
  return chunks;
}

function formatRushedUnit(unit: RushedUnit): string {
  const remaining = Math.max(0, unit.maxLevel - unit.level);
  return `**${escapeMarkdown(unit.name)}** ${unit.level}/${unit.maxLevel} (${remaining} short)`;
}

function readRushedUnits(value: unknown): RushedUnit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = readString(readValue(item, 'name'));
    const level = readNumber(readValue(item, 'level'));
    const maxLevel = readNumber(readValue(item, 'maxLevel'));
    const village = readString(readValue(item, 'village'));
    if (!name || level === null || maxLevel === null || level >= maxLevel) return [];
    return [{ name, level, maxLevel, village }];
  });
}

function truncateEmbedText(value: string, limit: number, fallback: string): string {
  const text = value.trim() || fallback;
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
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
