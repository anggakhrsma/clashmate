import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
} from 'discord.js';

export const LEADERBOARD_COMMAND_NAME = 'leaderboard';
export const LEADERBOARD_COMMAND_DESCRIPTION =
  'Show linked-clan leaderboards from stored snapshots.';

const MAX_ROWS = 25;
const LEADERBOARD_SEASON_CHOICE_COUNT = 18;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const leaderboardSeasonChoices = buildLeaderboardSeasonChoices(new Date());

export const leaderboardCommandData = new SlashCommandBuilder()
  .setName(LEADERBOARD_COMMAND_NAME)
  .setDescription(LEADERBOARD_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('clans')
      .setDescription('Show a clan leaderboard from linked-clan snapshots.')
      .addStringOption((option) =>
        option
          .setName('location')
          .setDescription('Location filter accepted for parity; linked snapshots are used.')
          .setRequired(false)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('season')
          .setDescription('Season accepted for parity; current linked snapshots are used.')
          .setRequired(false)
          .addChoices(...leaderboardSeasonChoices),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('players')
      .setDescription('Show a player leaderboard from current member snapshots.')
      .addStringOption((option) =>
        option
          .setName('location')
          .setDescription('Location filter accepted for parity; linked snapshots are used.')
          .setRequired(false)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('season')
          .setDescription('Season accepted for parity; current member snapshots are used.')
          .setRequired(false)
          .addChoices(...leaderboardSeasonChoices),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('capital')
      .setDescription('Show a capital leaderboard from linked-clan snapshots.')
      .addStringOption((option) =>
        option
          .setName('location')
          .setDescription('Location filter accepted for parity; linked snapshots are used.')
          .setRequired(false)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('season')
          .setDescription('Season accepted for parity; current linked snapshots are used.')
          .setRequired(false)
          .addChoices(...leaderboardSeasonChoices),
      ),
  );

export interface LeaderboardLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
  readonly categoryId: string | null;
  readonly sortOrder: number;
  readonly snapshot?: unknown;
}

export interface LeaderboardMemberSnapshotRow {
  readonly playerTag: string;
  readonly name: string;
  readonly trophies: number | null;
  readonly lastFetchedAt: Date;
}

export interface LeaderboardClanSnapshots {
  readonly clan: {
    readonly id: string;
    readonly clanTag: string;
    readonly name: string | null;
    readonly alias: string | null;
  };
  readonly members: readonly LeaderboardMemberSnapshotRow[];
}

export interface LeaderboardStore {
  readonly listClansForGuild: (guildId: string) => Promise<LeaderboardLinkedClan[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<LeaderboardClanSnapshots[]>;
}

export interface LeaderboardCommandOptions {
  readonly store: LeaderboardStore;
}

export type LeaderboardSubcommand = 'clans' | 'players' | 'capital';

export function createLeaderboardSlashCommand(
  options: LeaderboardCommandOptions,
): SlashCommandDefinition {
  return {
    name: LEADERBOARD_COMMAND_NAME,
    data: leaderboardCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== LEADERBOARD_COMMAND_NAME) return;
      await executeLeaderboard(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== LEADERBOARD_COMMAND_NAME) return;
      await autocompleteLeaderboard(interaction, options);
    },
  };
}

export async function autocompleteLeaderboard(
  interaction: AutocompleteInteraction,
  options: LeaderboardCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'location') {
    await interaction.respond([]);
    return;
  }

  const clans = await options.store.listClansForGuild(interaction.guildId);
  await interaction.respond(buildLocationChoices(clans, String(focused.value ?? '')));
}

export async function executeLeaderboard(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: LeaderboardCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/leaderboard` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const subcommand = interaction.options.getSubcommand() as LeaderboardSubcommand;
  const location = interaction.options.getString('location');
  const season = interaction.options.getString('season');

  if (subcommand === 'players') {
    const [clans, snapshots] = await Promise.all([
      options.store.listClansForGuild(interaction.guildId),
      options.store.listClanMemberSnapshotsForGuild({
        guildId: interaction.guildId,
      }),
    ]);
    await interaction.editReply({
      embeds: [buildPlayersLeaderboardEmbed(snapshots, location, season, clans)],
    });
    return;
  }

  const clans = await options.store.listClansForGuild(interaction.guildId);
  const embed =
    subcommand === 'capital'
      ? buildCapitalLeaderboardEmbed(clans, location, season)
      : buildClansLeaderboardEmbed(clans, location, season);
  await interaction.editReply({ embeds: [embed] });
}

export function buildClansLeaderboardEmbed(
  clans: readonly LeaderboardLinkedClan[],
  location: string | null,
  season: string | null,
): EmbedBuilder {
  const filteredClans = filterClansByLocation(clans, location);
  const rows = filteredClans
    .map((clan) => ({
      clan,
      points: readSnapshotNumber(clan.snapshot, 'clanPoints'),
      members: readSnapshotNumber(clan.snapshot, 'members'),
    }))
    .filter((row) => row.points !== null || row.members !== null)
    .sort((a, b) => (b.points ?? -1) - (a.points ?? -1) || (b.members ?? -1) - (a.members ?? -1));

  const embed = baseEmbed('Linked Clan Leaderboard', location, season);
  if (rows.length === 0) {
    return embed.setDescription(
      location?.trim() && !isAllLocations(location)
        ? 'No linked-clan snapshot data is available for that stored location. Autocomplete locations come from persisted linked-clan snapshots only.'
        : 'No linked-clan snapshot data is available yet. Link/configure a clan and wait for clan polling to store snapshots.',
    );
  }

  return embed
    .setDescription(
      rows
        .slice(0, MAX_ROWS)
        .map(
          (row, index) =>
            `${index + 1}. ${formatClanLink(row.clan)} · ${formatNumber(row.points)} trophies · ${formatNumber(row.members)} members`,
        )
        .join('\n'),
    )
    .setFooter({ text: `Showing ${Math.min(rows.length, MAX_ROWS)}/${rows.length} linked clans` });
}

export function buildPlayersLeaderboardEmbed(
  snapshots: readonly LeaderboardClanSnapshots[],
  location: string | null,
  season: string | null,
  linkedClans: readonly LeaderboardLinkedClan[] = [],
): EmbedBuilder {
  const linkedClanTags = new Set(
    filterClansByLocation(linkedClans, location).map((clan) => clan.clanTag),
  );
  const shouldFilterByLocation =
    Boolean(location?.trim()) && !isAllLocations(location) && linkedClans.length > 0;
  const filteredSnapshots = shouldFilterByLocation
    ? snapshots.filter((snapshot) => linkedClanTags.has(snapshot.clan.clanTag))
    : snapshots;
  const rows = filteredSnapshots
    .flatMap((snapshot) => snapshot.members.map((member) => ({ member, clan: snapshot.clan })))
    .filter((row) => row.member.trophies !== null)
    .sort(
      (a, b) =>
        (b.member.trophies ?? -1) - (a.member.trophies ?? -1) ||
        a.member.name.localeCompare(b.member.name),
    );

  const embed = baseEmbed('Linked Player Leaderboard', location, season);
  if (rows.length === 0) {
    return embed.setDescription(
      shouldFilterByLocation
        ? 'No current member snapshot trophies are available for linked clans with that stored location. Player rows are grouped by linked-clan snapshots only.'
        : 'No current member snapshot trophies are available yet. Link/configure a clan and wait for clan polling to observe members.',
    );
  }

  return embed
    .setDescription(
      rows
        .slice(0, MAX_ROWS)
        .map(
          (row, index) =>
            `${index + 1}. **${escapeMarkdown(row.member.name)}** · ${formatNumber(row.member.trophies)} trophies · ${escapeMarkdown(labelForClan(row.clan))}`,
        )
        .join('\n'),
    )
    .setFooter({ text: `Showing ${Math.min(rows.length, MAX_ROWS)}/${rows.length} members` });
}

export function buildCapitalLeaderboardEmbed(
  clans: readonly LeaderboardLinkedClan[],
  location: string | null,
  season: string | null,
): EmbedBuilder {
  const filteredClans = filterClansByLocation(clans, location);
  const rows = filteredClans
    .map((clan) => ({
      clan,
      hall: readNestedSnapshotNumber(clan.snapshot, ['clanCapital', 'capitalHallLevel']),
      league: readNestedSnapshotString(clan.snapshot, ['capitalLeague', 'name']),
      points: readSnapshotNumber(clan.snapshot, 'clanCapitalPoints'),
    }))
    .filter((row) => row.hall !== null || row.league !== null || row.points !== null)
    .sort((a, b) => (b.points ?? -1) - (a.points ?? -1) || (b.hall ?? -1) - (a.hall ?? -1));

  const embed = baseEmbed('Linked Capital Leaderboard', location, season);
  if (rows.length === 0) {
    return embed.setDescription(
      location?.trim() && !isAllLocations(location)
        ? 'No clan capital snapshot data is available for that stored location. Autocomplete locations come from persisted linked-clan snapshots only.'
        : 'No clan capital snapshot data is available for linked clans yet. Wait for clan polling to store capital hall or capital league data.',
    );
  }

  return embed
    .setDescription(
      rows
        .slice(0, MAX_ROWS)
        .map(
          (row, index) =>
            `${index + 1}. ${formatClanLink(row.clan)} · ${formatNumber(row.points)} capital trophies · Hall ${formatNumber(row.hall)} · ${escapeMarkdown(row.league ?? 'Unknown league')}`,
        )
        .join('\n'),
    )
    .setFooter({ text: `Showing ${Math.min(rows.length, MAX_ROWS)}/${rows.length} linked clans` });
}

function baseEmbed(title: string, location: string | null, season: string | null): EmbedBuilder {
  const notes = ['Uses linked-clan current persisted snapshots only.'];
  if (location?.trim() && !isAllLocations(location))
    notes.push(`Filtered by stored linked-clan location: ${location.trim()}.`);
  if (isAllLocations(location)) notes.push('Location: all linked clans.');
  if (season?.trim())
    notes.push(`Season option accepted but not filtered: ${formatSeasonNote(season.trim())}.`);
  return new EmbedBuilder().setTitle(title).addFields({ name: 'Source', value: notes.join('\n') });
}

export function buildLocationChoices(
  clans: readonly LeaderboardLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  const locations = new Map<string, { name: string; value: string; count: number }>();

  for (const clan of clans) {
    const location = readSnapshotLocation(clan.snapshot);
    if (!location) continue;
    const value = location.id ?? location.countryCode ?? location.name;
    const key = value.toLowerCase();
    const existing = locations.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const suffix =
      location.countryCode && location.countryCode !== location.name
        ? ` (${location.countryCode})`
        : '';
    locations.set(key, { name: `${location.name}${suffix}`, value, count: 1 });
  }

  const choices = [...locations.values()]
    .map((location) => ({
      name: `${location.name} · ${location.count} linked clan${location.count === 1 ? '' : 's'}`,
      value: location.value,
    }))
    .filter(
      (choice) =>
        choice.name.toLowerCase().includes(normalizedQuery) ||
        choice.value.toLowerCase().includes(normalizedQuery),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const allChoice = { name: 'All linked clans', value: 'all' };
  return [allChoice, ...choices].slice(0, 25);
}

export function buildLeaderboardSeasonChoices(
  now: Date,
): ApplicationCommandOptionChoiceData<string>[] {
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  return Array.from({ length: LEADERBOARD_SEASON_CHOICE_COUNT }, (_, index) => {
    const seasonDate = new Date(Date.UTC(currentYear, currentMonth - index, 1));
    const year = seasonDate.getUTCFullYear();
    const month = seasonDate.getUTCMonth();
    const seasonId = `${year}-${String(month + 1).padStart(2, '0')}`;

    return {
      name: `${MONTH_NAMES[month]} ${year}`,
      value: seasonId,
    };
  });
}

function filterClansByLocation(
  clans: readonly LeaderboardLinkedClan[],
  location: string | null,
): LeaderboardLinkedClan[] {
  if (!location?.trim() || isAllLocations(location)) return [...clans];
  const normalizedLocation = location.trim().toLowerCase();
  return clans.filter((clan) => {
    const snapshotLocation = readSnapshotLocation(clan.snapshot);
    if (!snapshotLocation) return false;
    return [snapshotLocation.id, snapshotLocation.countryCode, snapshotLocation.name]
      .filter((value): value is string => Boolean(value?.trim()))
      .some((value) => value.toLowerCase() === normalizedLocation);
  });
}

function isAllLocations(location: string | null): boolean {
  return location?.trim().toLowerCase() === 'all';
}

function formatSeasonNote(season: string): string {
  const seasonChoice = leaderboardSeasonChoices.find((choice) => choice.value === season);
  if (!seasonChoice) return season;
  return `${seasonChoice.name} (${seasonChoice.value})`;
}

function readSnapshotLocation(
  snapshot: unknown,
): { readonly id?: string; readonly name: string; readonly countryCode?: string } | null {
  if (!isRecord(snapshot)) return null;
  const location = getRecordValue(snapshot, 'location');
  if (!isRecord(location)) return null;
  const name = readString(getRecordValue(location, 'name'));
  if (!name) return null;
  const id = readString(getRecordValue(location, 'id'));
  const countryCode = readString(getRecordValue(location, 'countryCode'));
  return { name, ...(id ? { id } : {}), ...(countryCode ? { countryCode } : {}) };
}

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function formatClanLink(clan: LeaderboardLinkedClan): string {
  return `[${escapeMarkdown(labelForClan(clan))} (${clan.clanTag})](${clanProfileUrl(clan.clanTag)})`;
}

function labelForClan(clan: Pick<LeaderboardLinkedClan, 'alias' | 'name' | 'clanTag'>): string {
  return clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
}

function clanProfileUrl(clanTag: string): string {
  return `https://link.clashofclans.com/en?action=OpenClanProfile&tag=${encodeURIComponent(clanTag)}`;
}

function formatNumber(value: number | null): string {
  return value === null ? 'Unknown' : value.toLocaleString('en-US');
}

function readSnapshotNumber(snapshot: unknown, key: string): number | null {
  if (!isRecord(snapshot)) return null;
  const value = snapshot[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNestedSnapshotNumber(snapshot: unknown, path: readonly string[]): number | null {
  const value = readNestedSnapshotValue(snapshot, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNestedSnapshotString(snapshot: unknown, path: readonly string[]): string | null {
  const value = readNestedSnapshotValue(snapshot, path);
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNestedSnapshotValue(snapshot: unknown, path: readonly string[]): unknown {
  let value = snapshot;
  for (const key of path) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
}

function getRecordValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
