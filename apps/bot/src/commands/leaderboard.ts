import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
} from 'discord.js';

export const LEADERBOARD_COMMAND_NAME = 'leaderboard';
export const LEADERBOARD_COMMAND_DESCRIPTION =
  'Show linked-clan leaderboards from stored snapshots.';

const MAX_ROWS = 25;

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
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('season')
          .setDescription('Season accepted for parity; current linked snapshots are used.')
          .setRequired(false),
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
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('season')
          .setDescription('Season accepted for parity; current member snapshots are used.')
          .setRequired(false),
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
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('season')
          .setDescription('Season accepted for parity; current linked snapshots are used.')
          .setRequired(false),
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
  };
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
    const snapshots = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
    });
    await interaction.editReply({
      embeds: [buildPlayersLeaderboardEmbed(snapshots, location, season)],
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
  const rows = clans
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
      'No linked-clan snapshot data is available yet. Link/configure a clan and wait for clan polling to store snapshots.',
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
): EmbedBuilder {
  const rows = snapshots
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
      'No current member snapshot trophies are available yet. Link/configure a clan and wait for clan polling to observe members.',
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
  const rows = clans
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
      'No clan capital snapshot data is available for linked clans yet. Wait for clan polling to store capital hall or capital league data.',
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
  if (location?.trim())
    notes.push(`Location option accepted but not filtered: ${location.trim()}.`);
  if (season?.trim()) notes.push(`Season option accepted but not filtered: ${season.trim()}.`);
  return new EmbedBuilder().setTitle(title).addFields({ name: 'Source', value: notes.join('\n') });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
