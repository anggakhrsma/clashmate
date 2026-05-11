import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { escapeMarkdown, SlashCommandBuilder, TimestampStyles, time } from 'discord.js';

export const CALLER_COMMAND_NAME = 'caller';
export const CALLER_COMMAND_DESCRIPTION =
  'Assign or clear persisted war base calls from latest snapshots.';
const MAX_CALLER_EXPIRY_HOURS = 720;
const CALLER_PARITY_CONTEXT =
  "Supported subcommands: `assign` and `clear`; accepted targets come from the latest persisted current-war roster snapshot for this server's linked clans. Calls are saved by war/base until cleared or expired, so they survive bot restarts but are not pushed to Clash of Clans; `/caller` never performs live Clash API lookups.";
const CALLER_POLLING_PREREQUISITE =
  'Link a clan and keep the war poller running until it stores a fresh current-war snapshot before using `/caller`.';
const CALLER_FILTER_CONTEXT =
  '`/caller` is scoped to this Discord server, uses only configured linked clans, and has no player, Discord-user, or ad-hoc clan filter options.';
const CALLER_NO_LIVE_FALLBACK =
  'If this looks stale, wait for the next war poll or relink/fix the clan configuration; the command will not fetch live Clash API data on demand.';

export interface CallerWarSnapshotRecord {
  readonly clanTag: string;
  readonly warKey?: string;
  readonly state: string;
  readonly snapshot: unknown;
  readonly fetchedAt: Date;
  readonly trackedClan?: {
    readonly clanTag: string;
    readonly name: string | null;
    readonly alias: string | null;
  };
}

export interface CallerStore {
  readonly getLatestWarSnapshotsForGuild: (guildId: string) => Promise<CallerWarSnapshotRecord[]>;
  readonly assignCallerBase: (input: CallerAssignmentInput) => Promise<void>;
  readonly clearCallerBase: (input: CallerClearInput) => Promise<boolean>;
}

export interface CallerAssignmentInput {
  readonly guildId: string;
  readonly guildName: string | null;
  readonly clanTag: string;
  readonly warKey: string;
  readonly defenseMapPosition: number;
  readonly offenseMapPosition: number;
  readonly defenseTag: string | null;
  readonly defenseName: string | null;
  readonly offenseTag: string | null;
  readonly offenseName: string | null;
  readonly note: string | null;
  readonly expiresAt: Date | null;
  readonly actorDiscordUserId: string;
}

export interface CallerClearInput {
  readonly guildId: string;
  readonly guildName: string | null;
  readonly clanTag: string;
  readonly warKey: string;
  readonly defenseMapPosition: number;
  readonly actorDiscordUserId: string;
}

export interface CallerCommandOptions {
  readonly store: CallerStore;
}

interface WarMember {
  readonly tag?: string;
  readonly name?: string;
  readonly mapPosition?: number;
}

interface WarClan {
  readonly tag?: string;
  readonly name?: string;
  readonly members?: readonly WarMember[];
}

interface WarData {
  readonly state?: string;
  readonly clan?: WarClan;
  readonly opponent?: WarClan;
  readonly preparationStartTime?: string;
}

export const callerCommandData = new SlashCommandBuilder()
  .setName(CALLER_COMMAND_NAME)
  .setDescription(CALLER_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('assign')
      .setDescription('Assign an offensive base to a defensive target.')
      .addIntegerOption((option) =>
        option
          .setName('defense_target')
          .setDescription('Opponent defensive map position.')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(50),
      )
      .addIntegerOption((option) =>
        option
          .setName('offense_target')
          .setDescription('Friendly offensive map position.')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(50),
      )
      .addStringOption((option) =>
        option.setName('notes').setDescription('Optional notes for this call.').setRequired(false),
      )
      .addNumberOption((option) =>
        option
          .setName('hours')
          .setDescription('Optional hours until this call expires.')
          .setMinValue(0.1),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('clear')
      .setDescription('Clear a defensive target call.')
      .addIntegerOption((option) =>
        option
          .setName('defense_target')
          .setDescription('Opponent defensive map position to clear.')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(50),
      ),
  );

export function createCallerSlashCommand(options: CallerCommandOptions): SlashCommandDefinition {
  return {
    name: CALLER_COMMAND_NAME,
    data: callerCommandData,
    execute: async (interaction, _context: CommandContext) => {
      if (!interaction.isChatInputCommand() || interaction.commandName !== CALLER_COMMAND_NAME)
        return;
      if (!interaction.inCachedGuild()) {
        await interaction.reply({
          content: '`/caller` can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const snapshots = await options.store.getLatestWarSnapshotsForGuild(interaction.guildId);
      const entries = snapshots.map(toWarEntry).filter((item): item is WarEntry => item !== null);
      const entry = entries[0];
      if (!entry) {
        await interaction.reply({
          content: formatNoWarSnapshotFeedback(snapshots),
          ephemeral: true,
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand(true);
      const defenseMapPosition = interaction.options.getInteger('defense_target', true);
      const defense = memberAt(entry.defenseMembers, defenseMapPosition);
      if (!defense) {
        await interaction.reply({
          content: `Invalid defensive target #${defenseMapPosition}. Accepted defensive targets from the persisted current-war snapshot: ${formatAcceptedTargets(entry.defenseMembers)}. ${formatWarContext(entry, snapshots.length, entries.length)}`,
          ephemeral: true,
        });
        return;
      }

      if (subcommand === 'clear') {
        const cleared = await options.store.clearCallerBase({
          guildId: interaction.guildId,
          guildName: interaction.guild.name,
          clanTag: entry.clanTag,
          warKey: entry.warKey,
          defenseMapPosition,
          actorDiscordUserId: interaction.user.id,
        });
        await interaction.reply({
          content: cleared
            ? `Cleared persisted caller base for **#${defenseMapPosition} ${formatName(defense)}**. The saved call is removed from ClashMate storage for this war/base only. ${formatWarContext(entry, snapshots.length, entries.length)}`
            : `No persisted caller base existed for **#${defenseMapPosition} ${formatName(defense)}** in ClashMate storage for this war/base. Assign one with \`/caller assign\` if this base should be reserved. ${formatWarContext(entry, snapshots.length, entries.length)}`,
          ephemeral: true,
        });
        return;
      }

      const offenseMapPosition = interaction.options.getInteger('offense_target', true);
      const offense = memberAt(entry.offenseMembers, offenseMapPosition);
      if (!offense) {
        await interaction.reply({
          content: `Invalid offensive target #${offenseMapPosition}. Accepted offensive targets from the persisted current-war snapshot: ${formatAcceptedTargets(entry.offenseMembers)}. ${formatWarContext(entry, snapshots.length, entries.length)}`,
          ephemeral: true,
        });
        return;
      }
      const hours = interaction.options.getNumber('hours');
      if (
        hours !== null &&
        (!Number.isFinite(hours) || hours <= 0 || hours > MAX_CALLER_EXPIRY_HOURS)
      ) {
        await interaction.reply({
          content: `Invalid expiry. \`hours\` must be a positive number up to ${MAX_CALLER_EXPIRY_HOURS} hours (30 days).`,
          ephemeral: true,
        });
        return;
      }
      const note = interaction.options.getString('notes')?.trim() || null;
      const expiresAt = hours !== null ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;
      await options.store.assignCallerBase({
        guildId: interaction.guildId,
        guildName: interaction.guild.name,
        clanTag: entry.clanTag,
        warKey: entry.warKey,
        defenseMapPosition,
        offenseMapPosition,
        defenseTag: defense.tag ?? null,
        defenseName: defense.name ?? null,
        offenseTag: offense.tag ?? null,
        offenseName: offense.name ?? null,
        note,
        expiresAt,
        actorDiscordUserId: interaction.user.id,
      });
      await interaction.reply({
        content: `Persisted caller base in ClashMate storage: **#${offenseMapPosition} ${formatName(offense)}** to **#${defenseMapPosition} ${formatName(defense)}**. ${formatExpiryFeedback(expiresAt)} This reserves the target for this persisted war/base until cleared or expired. ${formatWarContext(entry, snapshots.length, entries.length)}`,
        ephemeral: true,
      });
    },
  };
}

interface WarEntry {
  readonly clanTag: string;
  readonly clanLabel: string;
  readonly warKey: string;
  readonly state: string;
  readonly fetchedAt: Date | null;
  readonly offenseMembers: readonly WarMember[];
  readonly defenseMembers: readonly WarMember[];
}

function toWarEntry(snapshot: CallerWarSnapshotRecord): WarEntry | null {
  const war = readWar(snapshot.snapshot);
  const state = (war.state ?? snapshot.state).toLowerCase().replace(/_/g, '');
  if (
    !war.clan?.members?.length ||
    !war.opponent?.members?.length ||
    state === 'notinwar' ||
    state === 'warended'
  )
    return null;
  const clanTag = snapshot.trackedClan?.clanTag ?? snapshot.clanTag;
  const clanName = snapshot.trackedClan?.alias ?? snapshot.trackedClan?.name;
  return {
    clanTag,
    clanLabel: clanName ? `${clanName} (${clanTag})` : clanTag,
    warKey: snapshot.warKey ?? createWarKey(war, clanTag),
    state: war.state ?? snapshot.state,
    fetchedAt: snapshot.fetchedAt instanceof Date ? snapshot.fetchedAt : null,
    offenseMembers: sortMembers(war.clan.members),
    defenseMembers: sortMembers(war.opponent.members),
  };
}

function readWar(value: unknown): WarData {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as WarData) : {};
}

function sortMembers(members: readonly WarMember[]): readonly WarMember[] {
  return [...members].sort((a, b) => (a.mapPosition ?? 999) - (b.mapPosition ?? 999));
}

function memberAt(members: readonly WarMember[], mapPosition: number): WarMember | null {
  return members.find((member, index) => (member.mapPosition ?? index + 1) === mapPosition) ?? null;
}

function createWarKey(war: WarData, fallbackClanTag: string): string {
  const start = war.preparationStartTime?.slice(0, 16) || 'latest';
  const tags = [war.clan?.tag ?? fallbackClanTag, war.opponent?.tag ?? 'opponent'].sort();
  return `${start}-${tags.join('-')}`.toLowerCase();
}

function formatName(member: WarMember): string {
  return escapeMarkdown(member.name ?? member.tag ?? 'Unknown');
}

function formatExpiryFeedback(expiresAt: Date | null): string {
  if (!expiresAt) return 'This call has no expiry.';
  return `Expires ${time(expiresAt, TimestampStyles.RelativeTime)} (${time(
    expiresAt,
    TimestampStyles.ShortDateTime,
  )}).`;
}

function formatAcceptedTargets(members: readonly WarMember[]): string {
  if (!members.length) return 'none';
  const positions = members
    .map((member, index) => member.mapPosition ?? index + 1)
    .sort((a, b) => a - b);
  const min = positions[0];
  const max = positions[positions.length - 1];
  return min === 1 && max === positions.length
    ? `#1-${max}`
    : positions.map((position) => `#${position}`).join(', ');
}

function formatNoWarSnapshotFeedback(snapshots: readonly CallerWarSnapshotRecord[]): string {
  if (!snapshots.length) {
    return [
      'No linked clan current-war snapshots were found for this server (snapshot count: 0).',
      'Action: configure at least one linked clan, then wait for the worker war poller to persist its current-war snapshot.',
      CALLER_POLLING_PREREQUISITE,
      CALLER_FILTER_CONTEXT,
      CALLER_NO_LIVE_FALLBACK,
      CALLER_PARITY_CONTEXT,
    ].join(' ');
  }

  const coverage = snapshots.slice(0, 5).map(formatSnapshotCoverage).join('; ');
  const suffix = snapshots.length > 5 ? `; +${snapshots.length - 5} more` : '';
  const latestFetched = formatLatestFetchedContext(snapshots);
  return [
    'Linked clan snapshots exist, but none contain an active current-war roster that `/caller` can use.',
    `Snapshot count: ${snapshots.length}; usable current-war snapshots: 0; latest fetch: ${latestFetched}.`,
    `Coverage: ${coverage}${suffix}.`,
    'Action: confirm a linked clan is currently in war and wait for the worker war poller to refresh it.',
    'Ended wars, not-in-war states, stale pre-war-only data, and snapshots without both friendly and opponent map positions are ignored.',
    CALLER_POLLING_PREREQUISITE,
    CALLER_FILTER_CONTEXT,
    CALLER_NO_LIVE_FALLBACK,
    CALLER_PARITY_CONTEXT,
  ].join(' ');
}

function formatLatestFetchedContext(snapshots: readonly CallerWarSnapshotRecord[]): string {
  const latest = snapshots
    .map((snapshot) => snapshot.fetchedAt)
    .filter((fetchedAt): fetchedAt is Date => fetchedAt instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return latest ? time(latest, TimestampStyles.RelativeTime) : 'unknown';
}

function formatSnapshotCoverage(snapshot: CallerWarSnapshotRecord): string {
  const clan = snapshot.trackedClan?.alias ?? snapshot.trackedClan?.name ?? snapshot.clanTag;
  const war = readWar(snapshot.snapshot);
  const state = war.state ?? snapshot.state;
  const offenseCount = war.clan?.members?.length ?? 0;
  const defenseCount = war.opponent?.members?.length ?? 0;
  const fetched =
    snapshot.fetchedAt instanceof Date
      ? `, fetched ${time(snapshot.fetchedAt, TimestampStyles.RelativeTime)}`
      : '';
  return `${escapeMarkdown(clan)} (${escapeMarkdown(snapshot.clanTag)}): ${escapeMarkdown(state)}, ${offenseCount}/${defenseCount} roster${fetched}`;
}

function formatWarContext(
  entry: WarEntry,
  snapshotCount: number,
  usableSnapshotCount: number,
): string {
  const fetched = entry.fetchedAt
    ? ` Snapshot fetched ${time(entry.fetchedAt, TimestampStyles.RelativeTime)}.`
    : '';
  return `Context: ${escapeMarkdown(entry.clanLabel)}; snapshots ${usableSnapshotCount}/${snapshotCount} usable current-war; source latest persisted linked-clan war polling snapshot, not live API; war ${escapeMarkdown(entry.warKey)} (${escapeMarkdown(entry.state)}); roster ${entry.offenseMembers.length} offense / ${entry.defenseMembers.length} defense; accepted defense ${formatAcceptedTargets(entry.defenseMembers)}, offense ${formatAcceptedTargets(entry.offenseMembers)}.${fetched} ${CALLER_FILTER_CONTEXT} ${CALLER_NO_LIVE_FALLBACK} ${CALLER_PARITY_CONTEXT}`;
}
