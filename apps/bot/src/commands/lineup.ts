import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';

export const LINEUP_COMMAND_NAME = 'lineup';
export const LINEUP_COMMAND_DESCRIPTION = 'Show current war lineup for a linked clan.';

export const lineupCommandData = new SlashCommandBuilder()
  .setName(LINEUP_COMMAND_NAME)
  .setDescription(LINEUP_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('clan').setDescription('Clan tag or name or alias.').setAutocomplete(true),
  )
  .addUserOption((option) =>
    option.setName('user').setDescription('Discord user whose linked players should be matched.'),
  );

export interface LineupTrackedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface LineupWarSnapshot {
  readonly clanTag: string;
  readonly state: string;
  readonly snapshot: unknown;
  readonly fetchedAt: Date;
  readonly trackedClan?: LineupTrackedClan;
}

export interface LineupStore {
  readonly listLinkedClans: (guildId: string) => Promise<LineupTrackedClan[]>;
  readonly getLatestWarSnapshot: (clanTag: string) => Promise<LineupWarSnapshot | null>;
  readonly getLatestWarSnapshotsForGuild: (guildId: string) => Promise<LineupWarSnapshot[]>;
  readonly getLinkedPlayerTags: (guildId: string, discordUserId: string) => Promise<string[]>;
}

export interface LineupCommandOptions {
  readonly store: LineupStore;
}

interface WarClan {
  readonly tag?: string;
  readonly name?: string;
  readonly badgeUrls?: {
    readonly small?: string;
    readonly medium?: string;
    readonly large?: string;
  };
  readonly members?: readonly WarMember[];
}

interface WarMember {
  readonly tag?: string;
  readonly name?: string;
  readonly townhallLevel?: number;
  readonly townHallLevel?: number;
  readonly mapPosition?: number;
}

interface WarData {
  readonly state?: string;
  readonly clan?: WarClan;
  readonly opponent?: WarClan;
}

interface LineupEntry {
  readonly snapshot: LineupWarSnapshot;
  readonly war: WarData;
}

interface LineupOutputContext {
  readonly linkedClanCount: number;
  readonly clanFilter: string;
  readonly userFilter: string;
  readonly userFilterResolution: string;
  readonly rowsConsidered: number;
  readonly rowsVisible: number;
  readonly snapshotsConsidered: number;
  readonly readableSnapshots: number;
  readonly pairedRows: number;
}

export interface LineupRow {
  readonly mapPosition: number;
  readonly clanMember: WarMember | null;
  readonly opponentMember: WarMember | null;
}

export function createLineupSlashCommand(options: LineupCommandOptions): SlashCommandDefinition {
  return {
    name: LINEUP_COMMAND_NAME,
    data: lineupCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== LINEUP_COMMAND_NAME) return;
      await executeLineup(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== LINEUP_COMMAND_NAME) return;
      await autocompleteLineup(interaction, options);
    },
  };
}

async function autocompleteLineup(
  interaction: AutocompleteInteraction,
  options: LineupCommandOptions,
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
    await interaction.respond(filterLineupClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterLineupClanChoices(
  clans: readonly LineupTrackedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalized = query.trim().toLowerCase();
  const choices = clans
    .filter((clan) => {
      if (!normalized) return true;
      return [clan.clanTag, clan.name, clan.alias]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalized));
    })
    .map((clan) => ({ clan, valueKey: normalizeLineupChoiceValue(clan.clanTag) }))
    .sort((a, b) => compareLineupChoiceClans(a.clan, b.clan));

  const seen = new Set<string>();
  const deduplicated: ApplicationCommandOptionChoiceData<string>[] = [];
  for (const choice of choices) {
    if (seen.has(choice.valueKey)) continue;
    seen.add(choice.valueKey);
    deduplicated.push({
      name: formatLineupChoiceName(choice.clan),
      value: choice.clan.clanTag,
    });
    if (deduplicated.length >= 25) break;
  }
  return deduplicated;
}

function compareLineupChoiceClans(a: LineupTrackedClan, b: LineupTrackedClan): number {
  return (
    compareNullableText(a.alias, b.alias) ||
    compareNullableText(a.name, b.name) ||
    a.clanTag.localeCompare(b.clanTag)
  );
}

function compareNullableText(a: string | null, b: string | null): number {
  return (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' });
}

function normalizeLineupChoiceValue(value: string): string {
  return safeNormalizeClashTag(value) ?? value.trim().toUpperCase();
}

function formatLineupChoiceName(clan: LineupTrackedClan): string {
  const parts = [clan.alias, clan.name]
    .filter((value): value is string => Boolean(value?.trim()))
    .filter(
      (value, index, values) => values.findIndex((other) => sameText(other, value)) === index,
    );
  const label = parts.length > 0 ? `${parts.join(' — ')} (${clan.clanTag})` : clan.clanTag;
  return label.length <= 100 ? label : `${label.slice(0, 99)}…`;
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function executeLineup(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: LineupCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/lineup` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();
  const clanOption = interaction.options.getString('clan');
  const user = interaction.options.getUser('user');
  const linkedClans = await options.store.listLinkedClans(interaction.guildId);
  const clan = clanOption ? resolveLineupClan(clanOption, linkedClans) : null;
  if (clanOption && !clan) {
    await interaction.editReply(
      `No linked clan matched ${formatCode(clanOption.trim())}. This server has ${formatCount(linkedClans.length)} linked clan${linkedClans.length === 1 ? '' : 's'} available to ${formatCode('/lineup')}. The command only reads persisted snapshots for linked clans and does not perform a live Clash API lookup.`,
    );
    return;
  }

  const playerTags = user
    ? await options.store.getLinkedPlayerTags(interaction.guildId, user.id)
    : [];
  if (user && playerTags.length === 0) {
    await interaction.editReply(
      `No linked player tags were found for ${user.toString()}. ${formatCode('/lineup user:')} only filters persisted war snapshots by already linked player tags; use ${formatCode('/link create')} to link a Clash account first. User filter resolution: 0 linked tags, so no snapshot rows can match.`,
    );
    return;
  }

  const snapshots = await loadLineupSnapshots(interaction.guildId, options.store, clan);
  if (snapshots.length === 0) {
    await interaction.editReply(
      `No persisted current-war snapshot is available${clan ? ` for ${formatTrackedClanName(clan)}` : ' for this server'}. Linked clans available: ${formatCount(linkedClans.length)}. Link/configure a clan with ${formatCode('/setup clan')} and wait for the war poller to store a current-war snapshot; ${formatCode('/lineup')} does not perform a live Clash API lookup or refresh.`,
    );
    return;
  }

  const parsedEntries = snapshots
    .map((snapshot) => ({ snapshot, war: extractLineupWarData(snapshot.snapshot) }))
    .filter((entry): entry is LineupEntry => Boolean(entry.war));
  const entries = parsedEntries.filter(
    (entry) => playerTags.length === 0 || warIncludesPlayer(entry.war, playerTags),
  );

  if (user && entries.length === 0) {
    await interaction.editReply(
      `No readable persisted current-war snapshot includes linked player tags for ${user.toString()}${clan ? ` in ${formatTrackedClanName(clan)}` : ''}. Considered ${formatCount(snapshots.length)} persisted snapshot${snapshots.length === 1 ? '' : 's'} (${formatCount(parsedEntries.length)} readable) and ${formatCount(playerTags.length)} linked player tag${playerTags.length === 1 ? '' : 's'}. User filter resolution: stored war members did not match any linked player tag, so no rows are visible.`,
    );
    return;
  }

  const entry = chooseLineupEntry(entries);
  if (!entry) {
    await interaction.editReply(
      `No readable persisted current-war snapshot is available${clan ? ` for ${formatTrackedClanName(clan)}` : ' for this server'} yet. Linked clans available: ${formatCount(linkedClans.length)}. Please try again after the next war poll; no live Clash API lookup or refresh is performed.`,
    );
    return;
  }

  const rows = buildLineupRows(
    entry.war,
    entry.snapshot.trackedClan?.clanTag ?? entry.snapshot.clanTag,
  );
  const visibleRows = rows.slice(0, 50);
  if (
    normalizeWarState(entry.war.state ?? entry.snapshot.state) === 'notinwar' ||
    rows.length === 0
  ) {
    await interaction.editReply(
      `No member lineup is available in the latest persisted current-war snapshot${clan ? ` for ${formatTrackedClanName(clan)}` : ''}. War state: ${formatWarState(normalizeWarState(entry.war.state ?? entry.snapshot.state))}. Linked clans available: ${formatCount(linkedClans.length)}. Make sure war polling is enabled for a linked clan and wait for the next poll if war just started.`,
    );
    return;
  }

  await interaction.editReply({
    embeds: [
      buildLineupEmbed(entry, visibleRows, {
        linkedClanCount: linkedClans.length,
        clanFilter: clan
          ? `Selected ${formatTrackedClanName(clan)}`
          : 'Not applied; scanned persisted snapshots for this server',
        userFilter: user
          ? `Applied to ${user.toString()} (${playerTags.length} linked tag${playerTags.length === 1 ? '' : 's'})`
          : 'Not applied',
        userFilterResolution: user
          ? `Matched stored war members by linked player tag; no Discord roster or live Clash lookup was used.`
          : 'Skipped; no Discord user filter was supplied.',
        rowsConsidered: rows.length,
        rowsVisible: visibleRows.length,
        snapshotsConsidered: snapshots.length,
        readableSnapshots: parsedEntries.length,
        pairedRows: rows.filter((row) => row.clanMember && row.opponentMember).length,
      }),
    ],
  });
}

async function loadLineupSnapshots(
  guildId: string,
  store: LineupStore,
  clan: LineupTrackedClan | null,
): Promise<LineupWarSnapshot[]> {
  if (clan) {
    const snapshot = await store.getLatestWarSnapshot(clan.clanTag);
    return snapshot ? [{ ...snapshot, trackedClan: clan }] : [];
  }
  return store.getLatestWarSnapshotsForGuild(guildId);
}

function resolveLineupClan(
  clanOption: string,
  clans: readonly LineupTrackedClan[],
): LineupTrackedClan | null {
  let normalizedTag: string | null = null;
  try {
    normalizedTag = normalizeClashTag(clanOption);
  } catch {
    normalizedTag = null;
  }
  const query = clanOption.trim().toLowerCase();
  return (
    clans.find((clan) => clan.clanTag === normalizedTag) ??
    clans.find(
      (clan) => clan.alias?.toLowerCase() === query || clan.name?.toLowerCase() === query,
    ) ??
    null
  );
}

function chooseLineupEntry(entries: readonly LineupEntry[]): LineupEntry | null {
  return (
    entries.find(
      (entry) => normalizeWarState(entry.war.state ?? entry.snapshot.state) !== 'notinwar',
    ) ??
    entries[0] ??
    null
  );
}

export function extractLineupWarData(snapshot: unknown): WarData | null {
  const unwrapped = unwrapSnapshot(snapshot);
  if (!unwrapped) return null;
  const clan = readWarClan(unwrapped.clan);
  const opponent = readWarClan(unwrapped.opponent);
  if (!clan || !opponent) return null;
  const state = readNonBlankString(unwrapped.state);
  return { ...(state ? { state } : {}), clan, opponent };
}

function unwrapSnapshot(snapshot: unknown): WarSnapshotPayload | null {
  if (!isRecord(snapshot)) return null;
  const record = snapshot as { readonly data?: unknown; readonly snapshot?: unknown };
  if (isRecord(record.data)) return record.data as WarSnapshotPayload;
  if (isRecord(record.snapshot)) return unwrapSnapshot(record.snapshot);
  return snapshot as WarSnapshotPayload;
}

interface WarSnapshotPayload {
  readonly state?: unknown;
  readonly clan?: unknown;
  readonly opponent?: unknown;
}

function readWarClan(value: unknown): WarClan | null {
  if (!isRecord(value)) return null;
  const record = value as {
    readonly tag?: unknown;
    readonly name?: unknown;
    readonly badgeUrls?: unknown;
    readonly members?: unknown;
  };
  const tag = readNonBlankString(record.tag);
  const name = readNonBlankString(record.name);
  const badgeUrls = readBadgeUrls(record.badgeUrls);
  const members = readWarMembers(record.members);
  return {
    ...(tag ? { tag } : {}),
    ...(name ? { name } : {}),
    ...(badgeUrls ? { badgeUrls } : {}),
    ...(members.length > 0 ? { members } : {}),
  };
}

function readBadgeUrls(value: unknown): WarClan['badgeUrls'] | null {
  if (!isRecord(value)) return null;
  const record = value as {
    readonly small?: unknown;
    readonly medium?: unknown;
    readonly large?: unknown;
  };
  const small = readNonBlankString(record.small);
  const medium = readNonBlankString(record.medium);
  const large = readNonBlankString(record.large);
  return small || medium || large
    ? { ...(small ? { small } : {}), ...(medium ? { medium } : {}), ...(large ? { large } : {}) }
    : null;
}

function readWarMembers(value: unknown): readonly WarMember[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((member) => {
    if (!isRecord(member)) return [];
    const record = member as {
      readonly tag?: unknown;
      readonly name?: unknown;
      readonly townhallLevel?: unknown;
      readonly townHallLevel?: unknown;
      readonly mapPosition?: unknown;
    };
    const tag = readNonBlankString(record.tag);
    const name = readNonBlankString(record.name);
    const townhallLevel = readFiniteNumber(record.townhallLevel);
    const townHallLevel = readFiniteNumber(record.townHallLevel);
    const mapPosition = readFiniteNumber(record.mapPosition);
    return tag || name || mapPosition !== null
      ? [
          {
            ...(tag ? { tag } : {}),
            ...(name ? { name } : {}),
            ...(townhallLevel !== null ? { townhallLevel } : {}),
            ...(townHallLevel !== null ? { townHallLevel } : {}),
            ...(mapPosition !== null ? { mapPosition } : {}),
          },
        ]
      : [];
  });
}

function warIncludesPlayer(war: WarData, playerTags: readonly string[]): boolean {
  const tags = new Set(
    playerTags
      .map((tag) => safeNormalizeClashTag(tag))
      .filter((tag): tag is string => tag !== null),
  );
  return [war.clan, war.opponent].some((clan) =>
    clan?.members?.some((member) => {
      if (!member.tag) return false;
      const normalizedTag = safeNormalizeClashTag(member.tag);
      return normalizedTag ? tags.has(normalizedTag) : false;
    }),
  );
}

function safeNormalizeClashTag(tag: string): string | null {
  try {
    return normalizeClashTag(tag);
  } catch {
    return null;
  }
}

export function buildLineupRows(war: WarData, perspectiveClanTag: string): LineupRow[] {
  const clan = choosePerspectiveClan(war, perspectiveClanTag);
  const opponent = clan === war.clan ? war.opponent : war.clan;
  if (!clan?.members?.length || !opponent?.members?.length) return [];
  const clanByPosition = new Map(
    clan.members.map((member, index) => [member.mapPosition ?? index + 1, member]),
  );
  const opponentByPosition = new Map(
    opponent.members.map((member, index) => [member.mapPosition ?? index + 1, member]),
  );
  const positions = [...new Set([...clanByPosition.keys(), ...opponentByPosition.keys()])].sort(
    (a, b) => a - b,
  );
  return positions.map((mapPosition) => ({
    mapPosition,
    clanMember: clanByPosition.get(mapPosition) ?? null,
    opponentMember: opponentByPosition.get(mapPosition) ?? null,
  }));
}

export function buildLineupEmbed(
  entry: LineupEntry,
  rows: readonly LineupRow[],
  context?: LineupOutputContext,
): EmbedBuilder {
  const trackedTag = entry.snapshot.trackedClan?.clanTag ?? entry.snapshot.clanTag;
  const clan = choosePerspectiveClan(entry.war, trackedTag);
  const opponent = clan === entry.war.clan ? entry.war.opponent : entry.war.clan;
  const warState = normalizeWarState(entry.war.state ?? entry.snapshot.state);
  const rowsConsidered = context?.rowsConsidered ?? rows.length;
  const rowsVisible = context?.rowsVisible ?? rows.length;
  const pairedRows =
    context?.pairedRows ?? rows.filter((row) => row.clanMember && row.opponentMember).length;
  const embed = new EmbedBuilder().setAuthor(buildWarAuthor(clan, entry.snapshot.trackedClan));
  const description = [
    '**War Against**',
    `**${opponent?.name ?? 'Unknown Clan'} (${opponent?.tag ?? 'unknown'})**`,
    '',
    '**Source**',
    `Persisted current-war snapshot for ${formatCode(trackedTag)} fetched ${formatDiscordTimestamp(entry.snapshot.fetchedAt)} (${formatSnapshotFreshness(entry.snapshot.fetchedAt)}).`,
    'Snapshot freshness is derived from the stored fetch time only; no live refresh is performed.',
    `Linked clans in this server: ${formatCount(context?.linkedClanCount ?? 0)}. Snapshots are produced by the war poller for linked/configured clans.`,
    'Persisted-only: no live Clash API lookup, manual refresh, or polling enrollment is performed by `/lineup`.',
    `Snapshots considered: ${formatCount(context?.snapshotsConsidered ?? 1)}; readable: ${formatCount(context?.readableSnapshots ?? 1)}.`,
    '',
    '**War State**',
    formatWarState(warState),
    '',
    '**Filters**',
    `Clan filter: ${context?.clanFilter ?? 'Not applied'}.`,
    `User filter: ${context?.userFilter ?? 'Not applied'}.`,
    context?.userFilterResolution ??
      'User filter resolution: skipped; no Discord user filter was supplied.',
    '',
    '**Coverage**',
    `Member rows considered: ${formatCount(rowsConsidered)}. Visible: ${formatCount(rowsVisible)}.`,
    `Readable lineup pairs: ${formatCount(pairedRows)}/${formatCount(rowsConsidered)}; missing sides are shown as ${formatCode('—')}.`,
    rowsVisible < rowsConsidered
      ? `Showing the first ${formatCount(rowsVisible)} map position${rowsVisible === 1 ? '' : 's'} to keep the Discord embed concise.`
      : 'All available map positions are visible.',
    'If this looks stale or empty, wait for the next war poll after linking/configuring the clan. If no rows appear, the stored snapshot may still be in preparation or not-in-war state.',
    '',
    '**Lineup**',
    ...rows.map(formatLineupRow),
  ];
  const thumbnail = clan?.badgeUrls?.large ?? clan?.badgeUrls?.medium ?? clan?.badgeUrls?.small;
  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed.setDescription(description.join('\n'));
}

function choosePerspectiveClan(war: WarData, clanTag: string): WarClan | undefined {
  const normalized = clanTag.trim().toUpperCase();
  if (war.clan?.tag?.trim().toUpperCase() === normalized) return war.clan;
  if (war.opponent?.tag?.trim().toUpperCase() === normalized) return war.opponent;
  return war.clan;
}

function buildWarAuthor(
  clan: WarClan | undefined,
  trackedClan: LineupTrackedClan | undefined,
): { name: string; iconURL?: string } {
  const name = `${clan?.name ?? trackedClan?.name ?? trackedClan?.clanTag ?? 'Unknown Clan'} (${clan?.tag ?? trackedClan?.clanTag ?? 'unknown'})`;
  const iconURL = clan?.badgeUrls?.medium ?? clan?.badgeUrls?.small ?? clan?.badgeUrls?.large;
  return iconURL ? { name, iconURL } : { name };
}

function formatLineupRow(row: LineupRow): string {
  return `\`${String(row.mapPosition).padStart(2, ' ')}\` ${formatMember(row.clanMember)} vs ${formatMember(row.opponentMember)}`;
}

function formatTrackedClanName(clan: LineupTrackedClan): string {
  return formatCode(`${clan.name ?? clan.alias ?? clan.clanTag} (${clan.clanTag})`);
}

function formatCode(value: string): string {
  return `\`${value.replaceAll('`', '')}\``;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDiscordTimestamp(date: Date): string {
  const seconds = Math.floor(date.getTime() / 1000);
  return Number.isFinite(seconds) ? `<t:${seconds}:R> (<t:${seconds}:f>)` : 'at an unknown time';
}

function formatSnapshotFreshness(date: Date): string {
  const ageMs = Date.now() - date.getTime();
  if (!Number.isFinite(ageMs)) return 'freshness unknown';
  if (ageMs < 0) return 'future timestamp; check poller clock';
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'fresh just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} old`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} old`;
}

function formatMember(member: WarMember | null): string {
  if (!member) return '—';
  const townHall = member.townHallLevel ?? member.townhallLevel;
  const name = member.name ?? 'Unknown';
  const tag = member.tag ? ` (${member.tag})` : '';
  const th = typeof townHall === 'number' ? ` TH${townHall}` : '';
  return `${name}${tag}${th}`;
}

function formatWarState(state: string): string {
  if (state === 'preparation') return 'Preparation';
  if (state === 'inwar') return 'Battle Day';
  if (state === 'warended') return 'War Ended';
  return state || 'Unknown';
}

function normalizeWarState(state: string | undefined): string {
  return (state ?? '').trim().toLowerCase().replaceAll('_', '');
}

function readNonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
