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
  const clans = await options.store.listLinkedClans(interaction.guildId);
  await interaction.respond(filterLineupClanChoices(clans, String(focused.value ?? '')));
}

export function filterLineupClanChoices(
  clans: readonly LineupTrackedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalized = query.trim().toLowerCase();
  return clans
    .filter((clan) => {
      if (!normalized) return true;
      return [clan.clanTag, clan.name, clan.alias]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalized));
    })
    .slice(0, 25)
    .map((clan) => ({
      name: `${clan.name ?? clan.clanTag} (${clan.clanTag})`,
      value: clan.clanTag,
    }));
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
  const clan = clanOption
    ? await resolveLineupClan(interaction.guildId, clanOption, options.store)
    : null;
  if (clanOption && !clan) {
    await interaction.editReply('No linked clan was found for that clan option.');
    return;
  }

  const playerTags = user
    ? await options.store.getLinkedPlayerTags(interaction.guildId, user.id)
    : [];
  if (user && playerTags.length === 0) {
    await interaction.editReply(
      'No linked player tags were found for that user. Use `/link create` to link a Clash account first.',
    );
    return;
  }

  const snapshots = await loadLineupSnapshots(interaction.guildId, options.store, clan);
  if (snapshots.length === 0) {
    await interaction.editReply(
      'No current war snapshot is available yet. Link/configure a clan and wait for war polling to run.',
    );
    return;
  }

  const entries = snapshots
    .map((snapshot) => ({ snapshot, war: extractLineupWarData(snapshot.snapshot) }))
    .filter((entry): entry is LineupEntry => Boolean(entry.war))
    .filter((entry) => playerTags.length === 0 || warIncludesPlayer(entry.war, playerTags));

  if (user && entries.length === 0) {
    await interaction.editReply('No readable war snapshot includes linked players for that user.');
    return;
  }

  const entry = chooseLineupEntry(entries);
  if (!entry) {
    await interaction.editReply(
      'No readable war snapshot is available yet. Please try again after the next war poll.',
    );
    return;
  }

  const rows = buildLineupRows(
    entry.war,
    entry.snapshot.trackedClan?.clanTag ?? entry.snapshot.clanTag,
  );
  if (
    normalizeWarState(entry.war.state ?? entry.snapshot.state) === 'notinwar' ||
    rows.length === 0
  ) {
    await interaction.editReply('No member lineup is available for the latest war snapshot.');
    return;
  }

  await interaction.editReply({ embeds: [buildLineupEmbed(entry, rows)] });
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

async function resolveLineupClan(
  guildId: string,
  clanOption: string,
  store: LineupStore,
): Promise<LineupTrackedClan | null> {
  const clans = await store.listLinkedClans(guildId);
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
  const tags = new Set(playerTags.map((tag) => tag.trim().toUpperCase()));
  return [war.clan, war.opponent].some((clan) =>
    clan?.members?.some((member) => member.tag && tags.has(member.tag.trim().toUpperCase())),
  );
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

export function buildLineupEmbed(entry: LineupEntry, rows: readonly LineupRow[]): EmbedBuilder {
  const trackedTag = entry.snapshot.trackedClan?.clanTag ?? entry.snapshot.clanTag;
  const clan = choosePerspectiveClan(entry.war, trackedTag);
  const opponent = clan === entry.war.clan ? entry.war.opponent : entry.war.clan;
  const embed = new EmbedBuilder().setAuthor(buildWarAuthor(clan, entry.snapshot.trackedClan));
  const description = [
    '**War Against**',
    `**${opponent?.name ?? 'Unknown Clan'} (${opponent?.tag ?? 'unknown'})**`,
    '',
    '**War State**',
    formatWarState(normalizeWarState(entry.war.state ?? entry.snapshot.state)),
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
