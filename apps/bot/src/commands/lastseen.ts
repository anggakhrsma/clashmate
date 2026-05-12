import type { DatabaseUserTimezonePreferenceStore } from '@clashmate/database';
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
  type User,
} from 'discord.js';

export const LASTSEEN_COMMAND_NAME = 'lastseen';
export const LASTSEEN_COMMAND_DESCRIPTION =
  'Show when linked players were last seen in tracked clans.';
export const LASTSEEN_NO_DATA_MESSAGE =
  'No last-seen data is available yet. Link/configure a clan, keep it linked, then wait for clan polling to store member snapshots and join/leave events.';
const LASTSEEN_PERSISTED_SNAPSHOT_NOTE =
  'Results come from stored linked-clan member snapshots plus stored join/leave events; `/lastseen` does not perform a live Clash API lookup.';
const LASTSEEN_POLLING_PREREQUISITE_NOTE =
  'To appear here, a player must belong to a linked clan snapshot or have join/leave history recorded after the clan was linked to this server.';
const LASTSEEN_NO_LIVE_FALLBACK_NOTE =
  'There is no live lookup or historical backfill; coverage starts after clans are linked and polled.';

export const lastSeenCommandData = new SlashCommandBuilder()
  .setName(LASTSEEN_COMMAND_NAME)
  .setDescription(LASTSEEN_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('clan').setDescription('Linked clan to check.').setAutocomplete(true),
  )
  .addStringOption((option) =>
    option.setName('player').setDescription('Player tag to check.').setAutocomplete(true),
  )
  .addUserOption((option) =>
    option.setName('user').setDescription('Discord user whose linked players to check.'),
  );

export interface LastSeenSnapshotRecord {
  readonly playerTag: string;
  readonly playerName: string;
  readonly clanTag: string;
  readonly clanName: string | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly lastFetchedAt: Date;
}

export interface LastSeenLinkedClan {
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface LastSeenClanMemberSnapshots {
  readonly clan: LastSeenLinkedClan;
  readonly members: readonly { readonly playerTag: string; readonly name?: string }[];
}

export interface LastSeenStore {
  readonly listLinkedClans: (guildId: string) => Promise<LastSeenLinkedClan[]>;
  readonly listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
  readonly listLastSeenSnapshots: (
    guildId: string,
    playerTags: readonly string[],
  ) => Promise<LastSeenSnapshotRecord[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<LastSeenClanMemberSnapshots[]>;
}

export interface LastSeenCommandOptions {
  readonly store: LastSeenStore;
  readonly timezones?: Pick<DatabaseUserTimezonePreferenceStore, 'getUserTimezonePreference'>;
}

type LastSeenResolution =
  | {
      readonly status: 'resolved';
      readonly playerTags: readonly string[];
      readonly targetUser: User | null;
      readonly clan: LastSeenLinkedClan | null;
      readonly source: LastSeenResolutionSource;
      readonly coverage: LastSeenResolvedCoverage;
    }
  | { readonly status: 'invalid_tag' }
  | { readonly status: 'unknown_clan' }
  | {
      readonly status: 'no_clan_snapshot';
      readonly clan: LastSeenLinkedClan;
      readonly coverage: LastSeenResolvedCoverage;
    }
  | { readonly status: 'no_link'; readonly targetUser: User; readonly isSelf: boolean };

type LastSeenResolutionSource = 'player_filter' | 'user_links' | 'linked_clan_snapshot';

interface LastSeenResolvedCoverage {
  readonly linkedClanCount: number;
  readonly snapshotClanCount: number;
  readonly snapshotMemberRows: number;
}

export function createLastSeenSlashCommand(
  options: LastSeenCommandOptions,
): SlashCommandDefinition {
  return {
    name: LASTSEEN_COMMAND_NAME,
    data: lastSeenCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== LASTSEEN_COMMAND_NAME) return;
      await executeLastSeen(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== LASTSEEN_COMMAND_NAME) return;
      await autocompleteLastSeen(interaction, options);
    },
  };
}

async function autocompleteLastSeen(
  interaction: AutocompleteInteraction,
  options: LastSeenCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  try {
    if (focused.name === 'player') {
      const tags = await listLastSeenAutocompletePlayerTags(
        options.store,
        interaction.guildId,
        interaction.user.id,
      );
      await interaction.respond(filterLastSeenPlayerChoices(tags, String(focused.value ?? '')));
      return;
    }
    if (focused.name === 'clan') {
      const clans = await options.store.listLinkedClans(interaction.guildId);
      await interaction.respond(filterLastSeenClanChoices(clans, String(focused.value ?? '')));
      return;
    }
    await interaction.respond([]);
  } catch {
    await interaction.respond([]);
  }
}

async function listLastSeenAutocompletePlayerTags(
  store: Pick<LastSeenStore, 'listPlayerTagsForUser' | 'listClanMemberSnapshotsForGuild'>,
  guildId: string,
  userId: string,
): Promise<string[]> {
  const [linkedTags, snapshots] = await Promise.all([
    readLastSeenAutocompleteLinkedTags(store, guildId, userId),
    readLastSeenAutocompleteSnapshotTags(store, guildId),
  ]);

  return dedupeLastSeenPlayerTags([...linkedTags, ...snapshots]);
}

async function readLastSeenAutocompleteLinkedTags(
  store: Pick<LastSeenStore, 'listPlayerTagsForUser'>,
  guildId: string,
  userId: string,
): Promise<string[]> {
  try {
    return await store.listPlayerTagsForUser(guildId, userId);
  } catch {
    return [];
  }
}

async function readLastSeenAutocompleteSnapshotTags(
  store: Pick<LastSeenStore, 'listClanMemberSnapshotsForGuild'>,
  guildId: string,
): Promise<string[]> {
  try {
    const snapshots = await store.listClanMemberSnapshotsForGuild({ guildId });
    return snapshots.flatMap((snapshot) => snapshot.members.map((member) => member.playerTag));
  } catch {
    return [];
  }
}

export function filterLastSeenClanChoices(
  clans: readonly LastSeenLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return dedupeLastSeenClanChoices(clans)
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export function filterLastSeenPlayerChoices(
  tags: readonly string[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toUpperCase();
  const queryWithoutHash = normalizedQuery.startsWith('#')
    ? normalizedQuery.slice(1)
    : normalizedQuery;

  return dedupeLastSeenPlayerTags(tags)
    .sort(compareLastSeenPlayerTags)
    .filter((tag) => {
      const normalizedTag = tag.toUpperCase();
      const tagWithoutHash = normalizedTag.startsWith('#') ? normalizedTag.slice(1) : normalizedTag;
      return (
        normalizedTag.includes(normalizedQuery) ||
        tagWithoutHash.includes(queryWithoutHash) ||
        `#${tagWithoutHash}`.includes(normalizedQuery)
      );
    })
    .slice(0, 25)
    .map((tag) => ({ name: tag, value: tag }));
}

function dedupeLastSeenPlayerTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const normalized = normalizeLastSeenChoiceTag(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(trimmed);
  }
  return deduped;
}

function dedupeLastSeenClanChoices(clans: readonly LastSeenLinkedClan[]): LastSeenLinkedClan[] {
  const seenValues = new Set<string>();
  const seenTags = new Set<string>();
  const deduped: LastSeenLinkedClan[] = [];
  for (const clan of [...clans].sort(compareLastSeenClanChoices)) {
    const value = clan.alias ?? clan.clanTag;
    const valueKey = value.trim().toLowerCase();
    const tagKey = normalizeLastSeenChoiceTag(clan.clanTag);
    if (seenValues.has(valueKey) || seenTags.has(tagKey)) continue;
    seenValues.add(valueKey);
    seenTags.add(tagKey);
    deduped.push(clan);
  }
  return deduped;
}

function compareLastSeenClanChoices(left: LastSeenLinkedClan, right: LastSeenLinkedClan): number {
  const leftValue = left.alias ?? left.clanTag;
  const rightValue = right.alias ?? right.clanTag;
  return (
    leftValue.localeCompare(rightValue, 'en', { sensitivity: 'base' }) ||
    normalizeLastSeenChoiceTag(left.clanTag).localeCompare(
      normalizeLastSeenChoiceTag(right.clanTag),
    ) ||
    formatClanChoiceName(left).localeCompare(formatClanChoiceName(right), 'en', {
      sensitivity: 'base',
    })
  );
}

function compareLastSeenPlayerTags(left: string, right: string): number {
  return (
    normalizeLastSeenChoiceTag(left).localeCompare(normalizeLastSeenChoiceTag(right)) ||
    left.localeCompare(right, 'en', { sensitivity: 'base' })
  );
}

function normalizeLastSeenChoiceTag(tag: string): string {
  const trimmed = tag.trim().toUpperCase();
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  return `#${withoutHash}`;
}

export async function executeLastSeen(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: LastSeenCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/lastseen` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const resolution = await resolveLastSeenPlayers({
    guildId: interaction.guildId,
    invokingUser: interaction.user,
    clanOption: interaction.options.getString('clan'),
    playerOption: interaction.options.getString('player'),
    userOption: interaction.options.getUser('user'),
    store: options.store,
  });

  if (resolution.status === 'invalid_tag') {
    await interaction.reply({ content: 'That player tag is not valid.', ephemeral: true });
    return;
  }

  if (resolution.status === 'unknown_clan') {
    await interaction.reply({
      content: 'No linked clan was found for that clan option.',
      ephemeral: true,
    });
    return;
  }

  if (resolution.status === 'no_clan_snapshot') {
    const snapshotContext = collectLastSeenSnapshotContext(0, [], resolution.coverage);
    await interaction.reply({
      content: `Clan filter accepted for ${formatClanChoiceName(resolution.clan)}, but that linked clan has no stored member snapshot yet. ${formatLastSeenCoverageContext('linked_clan_snapshot', snapshotContext)} ${formatLastSeenNoDataAction()} ${LASTSEEN_PERSISTED_SNAPSHOT_NOTE}`,
      ephemeral: true,
    });
    return;
  }

  if (resolution.status === 'no_link') {
    await interaction.reply({
      content: formatNoLinkedLastSeenMessage(resolution),
      ephemeral: true,
    });
    return;
  }

  const snapshots = await options.store.listLastSeenSnapshots(
    interaction.guildId,
    resolution.playerTags,
  );
  const snapshotContext = collectLastSeenSnapshotContext(
    resolution.playerTags.length,
    snapshots,
    resolution.coverage,
  );
  const latestRows = selectLatestLastSeenRows(resolution.playerTags, snapshots).filter(
    (row) => !resolution.clan || tagsEqual(row.clanTag, resolution.clan.clanTag),
  );

  if (latestRows.length === 0) {
    await interaction.reply({
      content: resolution.clan
        ? `No last-seen data is available yet for ${formatClanChoiceName(resolution.clan)} with those filters. ${formatLastSeenCoverageContext(resolution.source, snapshotContext)} ${formatLastSeenNoDataAction()} ${LASTSEEN_PERSISTED_SNAPSHOT_NOTE}`
        : `${LASTSEEN_NO_DATA_MESSAGE} ${formatLastSeenCoverageContext(resolution.source, snapshotContext)} ${LASTSEEN_NO_LIVE_FALLBACK_NOTE} ${LASTSEEN_PERSISTED_SNAPSHOT_NOTE}`,
      ephemeral: true,
    });
    return;
  }

  const timezone = await resolveLastSeenTimezone({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    ...(options.timezones ? { preferences: options.timezones } : {}),
  });

  await interaction.reply({
    embeds: [
      buildLastSeenEmbed(latestRows, resolution.targetUser, timezone, {
        snapshotContext,
        source: resolution.source,
      }),
    ],
  });
}

interface LastSeenSnapshotContext {
  readonly requestedMembers: number;
  readonly snapshotRows: number;
  readonly latestSnapshotAt: Date | null;
  readonly latestObservationAt: Date | null;
  readonly linkedClanCount: number;
  readonly snapshotClanCount: number;
  readonly snapshotMemberRows: number;
}

function collectLastSeenSnapshotContext(
  requestedMembers: number,
  snapshots: readonly LastSeenSnapshotRecord[],
  coverage: LastSeenResolvedCoverage = {
    linkedClanCount: 0,
    snapshotClanCount: 0,
    snapshotMemberRows: requestedMembers,
  },
): LastSeenSnapshotContext {
  const latestSnapshotAt = snapshots.reduce<Date | null>((latest, snapshot) => {
    if (!latest || snapshot.lastFetchedAt.getTime() > latest.getTime())
      return snapshot.lastFetchedAt;
    return latest;
  }, null);

  const latestObservationAt = snapshots.reduce<Date | null>((latest, snapshot) => {
    const observedAt =
      snapshot.lastSeenAt.getTime() > snapshot.lastFetchedAt.getTime()
        ? snapshot.lastSeenAt
        : snapshot.lastFetchedAt;
    if (!latest || observedAt.getTime() > latest.getTime()) return observedAt;
    return latest;
  }, null);

  return {
    requestedMembers,
    snapshotRows: snapshots.length,
    latestSnapshotAt,
    latestObservationAt,
    ...coverage,
  };
}

interface LastSeenResolvedTimezone {
  readonly timezone?: string;
  readonly source?: 'preference';
}

async function resolveLastSeenTimezone(input: {
  readonly guildId: string;
  readonly userId: string;
  readonly preferences?: Pick<DatabaseUserTimezonePreferenceStore, 'getUserTimezonePreference'>;
}): Promise<LastSeenResolvedTimezone> {
  if (!input.preferences) return {};

  try {
    const preference = await input.preferences.getUserTimezonePreference(
      input.guildId,
      input.userId,
    );
    const timezone = preference?.timezone.trim();
    if (!timezone || !isValidTimeZone(timezone)) return {};
    return { timezone, source: 'preference' };
  } catch {
    return {};
  }
}

async function resolveLastSeenPlayers(input: {
  readonly guildId: string;
  readonly invokingUser: User;
  readonly clanOption: string | null;
  readonly playerOption: string | null;
  readonly userOption: User | null;
  readonly store: Pick<
    LastSeenStore,
    'listLinkedClans' | 'listPlayerTagsForUser' | 'listClanMemberSnapshotsForGuild'
  >;
}): Promise<LastSeenResolution> {
  const linkedClans = await input.store.listLinkedClans(input.guildId);
  const guildSnapshots = await input.store.listClanMemberSnapshotsForGuild({
    guildId: input.guildId,
  });
  const coverage = collectResolvedCoverage(linkedClans.length, guildSnapshots);
  let clan: LastSeenLinkedClan | null = null;
  if (input.clanOption) {
    const resolvedClan = resolveLastSeenClan(linkedClans, input.clanOption);
    if (!resolvedClan) return { status: 'unknown_clan' };
    clan = resolvedClan;
  }

  if (input.playerOption) {
    try {
      return {
        status: 'resolved',
        playerTags: [normalizeClashTag(input.playerOption)],
        targetUser: input.userOption,
        clan,
        source: 'player_filter',
        coverage,
      };
    } catch {
      return { status: 'invalid_tag' };
    }
  }

  const targetUser = input.userOption ?? input.invokingUser;
  const playerTags = await input.store.listPlayerTagsForUser(input.guildId, targetUser.id);
  if (input.userOption && playerTags.length === 0) {
    return { status: 'no_link', targetUser, isSelf: targetUser.id === input.invokingUser.id };
  }

  if (clan) {
    const snapshot = guildSnapshots.find((row) => tagsEqual(row.clan.clanTag, clan.clanTag));
    const clanMemberTags = snapshot?.members.map((member) => member.playerTag) ?? [];
    if (clanMemberTags.length === 0) return { status: 'no_clan_snapshot', clan, coverage };
    const scopedTags = input.userOption
      ? playerTags.filter((tag) => clanMemberTags.some((memberTag) => tagsEqual(memberTag, tag)))
      : clanMemberTags;
    return {
      status: 'resolved',
      playerTags: scopedTags,
      targetUser: input.userOption,
      clan,
      source: 'linked_clan_snapshot',
      coverage,
    };
  }

  if (playerTags.length === 0) {
    return { status: 'no_link', targetUser, isSelf: targetUser.id === input.invokingUser.id };
  }

  return { status: 'resolved', playerTags, targetUser, clan, source: 'user_links', coverage };
}

function collectResolvedCoverage(
  linkedClanCount: number,
  snapshots: readonly LastSeenClanMemberSnapshots[],
): LastSeenResolvedCoverage {
  return {
    linkedClanCount,
    snapshotClanCount: snapshots.length,
    snapshotMemberRows: snapshots.reduce((total, snapshot) => total + snapshot.members.length, 0),
  };
}

export function resolveLastSeenClan(
  clans: readonly LastSeenLinkedClan[],
  query: string,
): LastSeenLinkedClan | undefined {
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

function formatNoLinkedLastSeenMessage(
  result: Extract<LastSeenResolution, { status: 'no_link' }>,
): string {
  if (result.isSelf) return 'You do not have linked player accounts. Use `/link create` first.';
  return `**${escapeMarkdown(result.targetUser.displayName)}** does not have linked player accounts.`;
}

export function selectLatestLastSeenRows(
  requestedTags: readonly string[],
  snapshots: readonly LastSeenSnapshotRecord[],
): LastSeenSnapshotRecord[] {
  const byTag = new Map<string, LastSeenSnapshotRecord>();
  for (const snapshot of snapshots) {
    const tag = snapshot.playerTag.trim().toUpperCase();
    const current = byTag.get(tag);
    if (!current || compareLastSeen(snapshot, current) > 0) byTag.set(tag, snapshot);
  }

  return requestedTags
    .map((tag) => byTag.get(tag.trim().toUpperCase()))
    .filter((row): row is LastSeenSnapshotRecord => Boolean(row));
}

function compareLastSeen(left: LastSeenSnapshotRecord, right: LastSeenSnapshotRecord): number {
  const lastSeenDiff = left.lastSeenAt.getTime() - right.lastSeenAt.getTime();
  if (lastSeenDiff !== 0) return lastSeenDiff;
  return left.lastFetchedAt.getTime() - right.lastFetchedAt.getTime();
}

export function buildLastSeenEmbed(
  rows: readonly LastSeenSnapshotRecord[],
  targetUser: User | null,
  timezone: LastSeenResolvedTimezone = {},
  coverage: {
    readonly snapshotContext: LastSeenSnapshotContext;
    readonly source: LastSeenResolutionSource;
  } = { snapshotContext: collectLastSeenSnapshotContext(rows.length, rows), source: 'user_links' },
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('Last Seen')
    .setDescription(formatLastSeenDescription(timezone, coverage));

  if (targetUser) {
    embed.setAuthor({ name: targetUser.displayName, iconURL: targetUser.displayAvatarURL() });
  }

  embed.addFields(
    rows.slice(0, 25).map((row) => ({
      name: `${escapeMarkdown(row.playerName)} (${row.playerTag})`,
      value: [
        `**Clan:** ${escapeMarkdown(row.clanName ?? 'Unknown Clan')} (${row.clanTag})`,
        `**First seen:** ${formatLastSeenTimestamp(row.firstSeenAt, 'F', timezone.timezone)}`,
        `**Last seen:** ${formatLastSeenTimestamp(row.lastSeenAt, 'R', timezone.timezone)}`,
        `**Last observed:** ${formatLastSeenTimestamp(row.lastFetchedAt, 'R', timezone.timezone)}`,
      ].join('\n'),
      inline: false,
    })),
  );

  if (timezone.timezone) {
    embed.setFooter({ text: `Display timezone: ${timezone.timezone} (saved preference)` });
  } else {
    embed.setFooter({
      text: 'Times use Discord timestamps; set /timezone for local absolute times.',
    });
  }

  return embed;
}

function formatLastSeenDescription(
  timezone: LastSeenResolvedTimezone,
  coverage: {
    readonly snapshotContext: LastSeenSnapshotContext;
    readonly source: LastSeenResolutionSource;
  },
): string {
  const base = [
    LASTSEEN_PERSISTED_SNAPSHOT_NOTE,
    formatLastSeenCoverageContext(coverage.source, coverage.snapshotContext),
    LASTSEEN_POLLING_PREREQUISITE_NOTE,
    LASTSEEN_NO_LIVE_FALLBACK_NOTE,
  ].join('\n');
  if (!timezone.timezone) {
    return `${base}\nNo saved /timezone preference was found, so absolute times fall back to Discord timestamps.`;
  }
  return `${base}\nAbsolute times use your saved /timezone preference (${timezone.timezone}).`;
}

function formatLastSeenCoverageContext(
  source: LastSeenResolutionSource,
  context: LastSeenSnapshotContext,
): string {
  return `${formatLastSeenSource(source)} ${formatLastSeenSnapshotContext(context)}`;
}

function formatLastSeenSource(source: LastSeenResolutionSource): string {
  if (source === 'player_filter') {
    return 'Source: player filter. Checking only the explicit player tag; matches require stored observations from any linked clan.';
  }
  if (source === 'linked_clan_snapshot') {
    return 'Source: linked clan snapshot. Checking players from stored linked-clan members; last-seen times may also be extended by stored join/leave events.';
  }
  return 'Source: Discord user links. Checking linked player accounts for the selected Discord user only.';
}

function formatLastSeenSnapshotContext(context: LastSeenSnapshotContext): string {
  const latest = context.latestSnapshotAt ? time(context.latestSnapshotAt, 'R') : 'none';
  const latestObservation = context.latestObservationAt
    ? time(context.latestObservationAt, 'R')
    : 'none';
  return `Context: ${context.linkedClanCount} linked clan${context.linkedClanCount === 1 ? '' : 's'}, ${context.snapshotClanCount} snapshot clan${context.snapshotClanCount === 1 ? '' : 's'}, ${context.snapshotMemberRows} member row${context.snapshotMemberRows === 1 ? '' : 's'} available; considered ${context.requestedMembers} member${context.requestedMembers === 1 ? '' : 's'} / ${context.snapshotRows} observation row${context.snapshotRows === 1 ? '' : 's'}; latest snapshot ${latest}, latest observation ${latestObservation}.`;
}

function formatLastSeenNoDataAction(): string {
  return `${LASTSEEN_POLLING_PREREQUISITE_NOTE} If the link is new, try again after the next polling cycle; otherwise verify the clan link and player filters. ${LASTSEEN_NO_LIVE_FALLBACK_NOTE}`;
}

function formatLastSeenTimestamp(
  date: Date,
  discordStyle: 'F' | 'R',
  timezone: string | undefined,
): string {
  const discordTimestamp = time(date, discordStyle);
  if (!timezone) return discordTimestamp;
  return `${formatZonedDateTime(date, timezone)} (${discordTimestamp})`;
}

function formatZonedDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date);
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function clanMatchesQuery(clan: LastSeenLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: LastSeenLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function tagsEqual(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}
