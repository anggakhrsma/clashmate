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
const SNAPSHOT_SOURCE_NOTE =
  'Uses the latest persisted ClashMate snapshots for linked clans only; Discord does not expose a live Clash API leaderboard source here.';
const SNAPSHOT_LIMITATION_NOTE =
  'Season and location options are accepted for command parity, but results are not historical global leaderboards.';
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

  try {
    const clans = await options.store.listClansForGuild(interaction.guildId);
    await interaction.respond(buildLocationChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
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
  const coverage = buildClanCoverage(clans.length, filteredClans.length, rows.length);

  const embed = baseEmbed('Linked Clan Leaderboard', 'clans', location, season);
  if (rows.length === 0) {
    const locationHadMatches = filteredClans.length > 0;
    return embed
      .setDescription(
        location?.trim() && !isAllLocations(location)
          ? locationHadMatches
            ? `Location filter matched stored linked-clan locations, but those current snapshots do not include usable clan trophy/member fields.\n${coverage}`
            : `Location filter accepted, but no stored linked-clan location matched it.\n${coverage}`
          : `No current linked-clan trophy/member snapshot data is available yet.\n${coverage}`,
      )
      .addFields({
        name: 'Next step',
        value:
          'Link/configure a clan and wait for clan polling to store current clan trophy snapshots; season selections do not backfill historical rows.',
      });
  }

  return embed
    .setDescription(
      `${coverage}\n\n${rows
        .slice(0, MAX_ROWS)
        .map(
          (row, index) =>
            `${index + 1}. ${formatClanLink(row.clan)} · ${formatNumber(row.points)} trophies · ${formatNumber(row.members)} members`,
        )
        .join('\n')}`,
    )
    .setFooter({
      text: formatRowsShownFooter(Math.min(rows.length, MAX_ROWS), rows.length, 'linked clans'),
    });
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

  const embed = baseEmbed('Linked Player Leaderboard', 'players', location, season);
  const linkedClansConsidered = shouldFilterByLocation ? linkedClanTags.size : linkedClans.length;
  const coverage = buildMemberCoverage(
    linkedClans.length,
    linkedClansConsidered,
    filteredSnapshots.reduce((total, snapshot) => total + snapshot.members.length, 0),
    rows.length,
    latestMemberSnapshotAt(filteredSnapshots),
  );
  if (rows.length === 0) {
    const filteredLocationHadSnapshots = !shouldFilterByLocation || filteredSnapshots.length > 0;
    return embed
      .setDescription(
        shouldFilterByLocation
          ? filteredLocationHadSnapshots
            ? `Location filter matched stored linked-clan locations, but their current member snapshots do not include usable trophy fields.\n${coverage}`
            : `Location filter accepted, but no stored linked-clan location matched it.\n${coverage}`
          : `No current member trophy snapshot data is available yet.\n${coverage}`,
      )
      .addFields({
        name: 'Next step',
        value:
          'Link/configure a clan and wait for clan polling to observe current members; season selections do not backfill historical player rows.',
      });
  }

  return embed
    .setDescription(
      `${coverage}\n\n${rows
        .slice(0, MAX_ROWS)
        .map(
          (row, index) =>
            `${index + 1}. **${escapeMarkdown(row.member.name)}** · ${formatNumber(row.member.trophies)} trophies · ${escapeMarkdown(labelForClan(row.clan))}`,
        )
        .join('\n')}`,
    )
    .setFooter({
      text: formatRowsShownFooter(Math.min(rows.length, MAX_ROWS), rows.length, 'members'),
    });
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
  const coverage = buildCapitalCoverage(clans.length, filteredClans.length, rows);

  const embed = baseEmbed('Linked Capital Leaderboard', 'capital', location, season);
  if (rows.length === 0) {
    const locationHadMatches = filteredClans.length > 0;
    return embed
      .setDescription(
        location?.trim() && !isAllLocations(location)
          ? locationHadMatches
            ? `Location filter matched stored linked-clan locations, but those current snapshots do not include usable capital hall/league/trophy fields.\n${coverage}`
            : `Location filter accepted, but no stored linked-clan location matched it.\n${coverage}`
          : `No persisted clan capital hall, league, or trophy fields are available for linked clans yet.\n${coverage}`,
      )
      .addFields({
        name: 'Next step',
        value:
          'Ensure clans are linked/configured and wait for clan polling to persist capital hall, capital league, or capital trophy fields; season selections do not backfill historical capital rows.',
      });
  }

  return embed
    .setDescription(
      `${coverage}\n\n${rows
        .slice(0, MAX_ROWS)
        .map(
          (row, index) =>
            `${index + 1}. ${formatClanLink(row.clan)} · ${formatCapitalRankContext(row)}`,
        )
        .join('\n')}`,
    )
    .setFooter({
      text: formatRowsShownFooter(Math.min(rows.length, MAX_ROWS), rows.length, 'linked clans'),
    });
}

function formatRowsShownFooter(rowsShown: number, totalRows: number, label: string): string {
  return `Showing ${rowsShown.toLocaleString('en-US')}/${totalRows.toLocaleString('en-US')} ${label} (limit ${MAX_ROWS.toLocaleString('en-US')})`;
}

function formatCapitalRankContext(row: {
  readonly hall: number | null;
  readonly league: string | null;
  readonly points: number | null;
}): string {
  const parts = [
    row.points === null ? null : `${formatNumber(row.points)} trophies`,
    row.hall === null ? null : `CH ${formatNumber(row.hall)}`,
    row.league === null ? null : escapeMarkdown(row.league),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : 'No capital fields';
}

function buildCapitalCoverage(
  totalLinkedClans: number,
  linkedClansConsidered: number,
  rows: readonly { hall: number | null; league: string | null; points: number | null }[],
): string {
  const hallCount = rows.filter((row) => row.hall !== null).length;
  const leagueCount = rows.filter((row) => row.league !== null).length;
  const trophyCount = rows.filter((row) => row.points !== null).length;
  const denominator = linkedClansConsidered.toLocaleString('en-US');
  return `${buildClanCoverage(totalLinkedClans, linkedClansConsidered, rows.length)} Capital fields after filters: hall ${hallCount.toLocaleString('en-US')}/${denominator} · league ${leagueCount.toLocaleString('en-US')}/${denominator} · trophies ${trophyCount.toLocaleString('en-US')}/${denominator}.`;
}

function buildClanCoverage(
  totalLinkedClans: number,
  linkedClansConsidered: number,
  usableRows: number,
): string {
  return `Coverage: ${totalLinkedClans.toLocaleString('en-US')} linked clan${totalLinkedClans === 1 ? '' : 's'} configured · ${linkedClansConsidered.toLocaleString('en-US')} considered after the current location filter · ${usableRows.toLocaleString('en-US')} row${usableRows === 1 ? '' : 's'} with usable current snapshot fields.`;
}

function buildMemberCoverage(
  totalLinkedClans: number,
  linkedClansConsidered: number,
  memberSnapshotsConsidered: number,
  usableRows: number,
  latestSnapshotAt: Date | null,
): string {
  return `${buildClanCoverage(totalLinkedClans, linkedClansConsidered, usableRows)} Current member snapshot rows considered: ${memberSnapshotsConsidered.toLocaleString('en-US')}. Latest member snapshot: ${formatSnapshotRecency(latestSnapshotAt)}.`;
}

function latestMemberSnapshotAt(snapshots: readonly LeaderboardClanSnapshots[]): Date | null {
  let latest: Date | null = null;
  for (const snapshot of snapshots) {
    for (const member of snapshot.members) {
      if (!latest || member.lastFetchedAt > latest) latest = member.lastFetchedAt;
    }
  }
  return latest;
}

function formatSnapshotRecency(snapshotAt: Date | null): string {
  if (!snapshotAt) return 'none stored';
  const elapsedMs = Date.now() - snapshotAt.getTime();
  if (!Number.isFinite(elapsedMs)) return snapshotAt.toISOString();
  if (elapsedMs < 60_000) return 'under 1 minute ago';
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 48) return `${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`;
}

function baseEmbed(
  title: string,
  subcommand: LeaderboardSubcommand,
  location: string | null,
  season: string | null,
): EmbedBuilder {
  const notes = [
    `Subcommand: /leaderboard ${subcommand}.`,
    SNAPSHOT_SOURCE_NOTE,
    SNAPSHOT_LIMITATION_NOTE,
  ];
  if (location?.trim() && !isAllLocations(location))
    notes.push(
      `Location filter: ${location.trim()} (matched against stored linked-clan location only).`,
    );
  if (isAllLocations(location)) notes.push('Location filter: all linked clans.');
  if (season?.trim())
    notes.push(
      `Season option: ${formatSeasonNote(season.trim())} (accepted for parity; current snapshots are still shown).`,
    );
  return new EmbedBuilder().setTitle(title).addFields({ name: 'Source', value: notes.join('\n') });
}

export function buildLocationChoices(
  clans: readonly LeaderboardLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  const locations = new Map<
    string,
    { names: Set<string>; values: Set<string>; countryCodes: Set<string>; count: number }
  >();

  for (const clan of clans) {
    const location = readSnapshotLocation(clan.snapshot);
    if (!location) continue;
    const key = location.name.toLowerCase();
    const existing = locations.get(key);
    if (existing) {
      existing.names.add(location.name);
      if (location.id) existing.values.add(location.id);
      if (location.countryCode) {
        existing.values.add(location.countryCode);
        existing.countryCodes.add(location.countryCode);
      }
      existing.values.add(location.name);
      existing.count += 1;
      continue;
    }
    locations.set(key, {
      names: new Set([location.name]),
      values: new Set([location.id, location.countryCode, location.name].filter(isNonEmptyString)),
      countryCodes: new Set(location.countryCode ? [location.countryCode] : []),
      count: 1,
    });
  }

  const choices = [...locations.values()]
    .map((location) => {
      const name = [...location.names].sort(compareCaseInsensitive)[0] ?? 'Unknown';
      const countryCode = [...location.countryCodes].sort(compareCaseInsensitive)[0];
      const searchText = [name, ...location.values].join(' ').toLowerCase();
      const suffix =
        countryCode && countryCode.toLowerCase() !== name.toLowerCase() ? ` (${countryCode})` : '';
      return {
        name: `${name}${suffix} · ${location.count} linked clan${location.count === 1 ? '' : 's'}`,
        value: name,
        searchText,
      };
    })
    .filter(
      (choice) =>
        choice.name.toLowerCase().includes(normalizedQuery) ||
        choice.searchText.includes(normalizedQuery),
    )
    .sort(
      (a, b) => compareCaseInsensitive(a.name, b.name) || compareCaseInsensitive(a.value, b.value),
    )
    .map(({ name, value }) => ({ name, value }));

  const allChoice = { name: 'All linked clans', value: 'all' };
  return [allChoice, ...choices].slice(0, 25);
}

function compareCaseInsensitive(a: string, b: string): number {
  return a.localeCompare(b, 'en-US', { sensitivity: 'base' }) || a.localeCompare(b, 'en-US');
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value?.trim());
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
