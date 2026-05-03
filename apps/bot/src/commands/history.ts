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

export const HISTORY_COMMAND_NAME = 'history';
export const HISTORY_COMMAND_DESCRIPTION = 'Show tracked historical activity.';
export const HISTORY_NO_DONATION_EVENTS_MESSAGE =
  'No donation history is available yet. Link/configure a clan and wait for donation events to be detected.';
export const HISTORY_NO_WAR_ATTACK_EVENTS_MESSAGE =
  'No war attack history is available yet. Link/configure a clan and wait for war attacks to be detected.';
export const HISTORY_NO_JOIN_LEAVE_EVENTS_MESSAGE =
  'No join/leave history is available yet. Link/configure a clan and wait for clan member events to be detected.';
export const HISTORY_NO_CLAN_GAMES_EVENTS_MESSAGE =
  'No Clan Games history is available yet. Link/configure a clan and wait for Clan Games snapshots to be stored.';

const HISTORY_OPTIONS = ['donations', 'war-attacks', 'join-leave', 'clan-games'] as const;
type HistoryOption = (typeof HISTORY_OPTIONS)[number];
const MAX_HISTORY_ROWS = 15;
const EMBED_DESCRIPTION_LIMIT = 4096;

export const historyCommandData = new SlashCommandBuilder()
  .setName(HISTORY_COMMAND_NAME)
  .setDescription(HISTORY_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('option')
      .setDescription('Select a historical activity view.')
      .setRequired(true)
      .addChoices(
        { name: 'Donations', value: 'donations' },
        { name: 'War Attacks', value: 'war-attacks' },
        { name: 'Join/Leave', value: 'join-leave' },
        { name: 'Clan Games', value: 'clan-games' },
      ),
  )
  .addStringOption((option) =>
    option
      .setName('clans')
      .setDescription('Clan tag, name, or alias filter.')
      .setAutocomplete(true)
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('player')
      .setDescription('Player tag to filter.')
      .setAutocomplete(true)
      .setRequired(false),
  )
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('Discord user whose linked players should be matched.')
      .setRequired(false),
  );

export interface HistoryLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface DonationHistoryRow {
  readonly playerTag: string;
  readonly playerName: string;
  readonly donated: number;
  readonly received: number;
  readonly eventCount: number;
  readonly lastDetectedAt: Date;
}

export interface WarAttackHistoryRow {
  readonly attackerTag: string;
  readonly attackerName: string | null;
  readonly attackCount: number;
  readonly totalStars: number;
  readonly averageStars: number;
  readonly totalDestruction: number;
  readonly averageDestruction: number;
  readonly freshAttackCount: number;
  readonly lastAttackedAt: Date;
}

export interface JoinLeaveHistoryRow {
  readonly playerTag: string;
  readonly playerName: string;
  readonly clanTag: string;
  readonly clanName: string | null;
  readonly eventType: 'joined' | 'left';
  readonly occurredAt: Date;
  readonly detectedAt: Date;
}

export interface ClanGamesHistoryRow {
  readonly playerTag: string;
  readonly playerName: string;
  readonly seasonCount: number;
  readonly totalPoints: number;
  readonly averagePoints: number;
  readonly bestPoints: number;
  readonly latestSeasonId: string;
  readonly latestClanTag: string;
  readonly latestClanName: string | null;
  readonly latestUpdatedAt: Date;
}

export interface HistoryStore {
  readonly listLinkedClans: (guildId: string) => Promise<HistoryLinkedClan[]>;
  readonly listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
  readonly listDonationHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    playerTags?: readonly string[];
    since?: Date;
  }) => Promise<DonationHistoryRow[]>;
  readonly listWarAttackHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    attackerTags?: readonly string[];
    since?: Date;
  }) => Promise<WarAttackHistoryRow[]>;
  readonly listClanMemberJoinLeaveHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    playerTags?: readonly string[];
    since?: Date;
  }) => Promise<JoinLeaveHistoryRow[]>;
  readonly listClanGamesHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    playerTags?: readonly string[];
    since?: Date;
  }) => Promise<ClanGamesHistoryRow[]>;
}

export interface HistoryCommandOptions {
  readonly store: HistoryStore;
}

export function createHistorySlashCommand(options: HistoryCommandOptions): SlashCommandDefinition {
  return {
    name: HISTORY_COMMAND_NAME,
    data: historyCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== HISTORY_COMMAND_NAME) return;
      await executeHistory(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== HISTORY_COMMAND_NAME) return;
      await autocompleteHistory(interaction, options);
    },
  };
}

async function autocompleteHistory(
  interaction: AutocompleteInteraction,
  options: HistoryCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'clans') {
    await interaction.respond([]);
    return;
  }
  try {
    const clans = await options.store.listLinkedClans(interaction.guildId);
    await interaction.respond(filterHistoryClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterHistoryClanChoices(
  clans: readonly HistoryLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export async function executeHistory(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: HistoryCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/history` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const option = interaction.options.getString('option', true);
  if (!isHistoryOption(option)) {
    await interaction.editReply({
      content:
        'Only donation, war attack, join/leave, and Clan Games history are available right now.',
    });
    return;
  }

  const clanOption = interaction.options.getString('clans');
  const playerOption = interaction.options.getString('player');
  const userOption = interaction.options.getUser('user');
  const clans = await options.store.listLinkedClans(interaction.guildId);

  let clanTags: string[] | undefined;
  let clanLabel: string | undefined;
  if (clanOption) {
    const clan = resolveHistoryClan(clans, clanOption);
    if (!clan) {
      await interaction.editReply({ content: 'No linked clan was found for that clan option.' });
      return;
    }
    clanTags = [clan.clanTag];
    clanLabel = `${clan.alias ?? clan.name ?? 'Linked Clan'} (${clan.clanTag})`;
  }

  let playerTags: string[] | undefined;
  if (playerOption) {
    try {
      playerTags = [normalizeClashTag(playerOption)];
    } catch {
      await interaction.editReply({ content: 'That player tag is not valid.' });
      return;
    }
  } else if (userOption) {
    playerTags = await options.store.listPlayerTagsForUser(interaction.guildId, userOption.id);
    if (playerTags.length === 0) {
      await interaction.editReply({ content: formatNoLinkedPlayersMessage(userOption) });
      return;
    }
  }

  if (option === 'war-attacks') {
    const rows = await options.store.listWarAttackHistoryForGuild({
      guildId: interaction.guildId,
      ...(clanTags ? { clanTags } : {}),
      ...(playerTags ? { attackerTags: playerTags } : {}),
    });

    if (rows.length === 0) {
      await interaction.editReply({ content: HISTORY_NO_WAR_ATTACK_EVENTS_MESSAGE });
      return;
    }

    await interaction.editReply({
      embeds: [buildWarAttackHistoryEmbed(rows, clanLabel, userOption)],
    });
    return;
  }

  if (option === 'join-leave') {
    const rows = await options.store.listClanMemberJoinLeaveHistoryForGuild({
      guildId: interaction.guildId,
      ...(clanTags ? { clanTags } : {}),
      ...(playerTags ? { playerTags } : {}),
    });

    if (rows.length === 0) {
      await interaction.editReply({ content: HISTORY_NO_JOIN_LEAVE_EVENTS_MESSAGE });
      return;
    }

    await interaction.editReply({
      embeds: [buildJoinLeaveHistoryEmbed(rows, clanLabel, userOption)],
    });
    return;
  }

  if (option === 'clan-games') {
    const rows = await options.store.listClanGamesHistoryForGuild({
      guildId: interaction.guildId,
      ...(clanTags ? { clanTags } : {}),
      ...(playerTags ? { playerTags } : {}),
    });

    if (rows.length === 0) {
      await interaction.editReply({ content: HISTORY_NO_CLAN_GAMES_EVENTS_MESSAGE });
      return;
    }

    await interaction.editReply({
      embeds: [buildClanGamesHistoryEmbed(rows, clanLabel, userOption)],
    });
    return;
  }

  const rows = await options.store.listDonationHistoryForGuild({
    guildId: interaction.guildId,
    ...(clanTags ? { clanTags } : {}),
    ...(playerTags ? { playerTags } : {}),
  });

  if (rows.length === 0) {
    await interaction.editReply({ content: HISTORY_NO_DONATION_EVENTS_MESSAGE });
    return;
  }

  await interaction.editReply({ embeds: [buildDonationHistoryEmbed(rows, clanLabel, userOption)] });
}

export function buildClanGamesHistoryEmbed(
  rows: readonly ClanGamesHistoryRow[],
  clanLabel: string | undefined,
  user: User | null,
): EmbedBuilder {
  const selectedRows = rows.slice(0, MAX_HISTORY_ROWS);
  const totals = rows.reduce(
    (acc, row) => ({
      seasons: acc.seasons + row.seasonCount,
      points: acc.points + row.totalPoints,
    }),
    { seasons: 0, points: 0 },
  );
  const average = totals.seasons > 0 ? totals.points / totals.seasons : 0;
  const embed = new EmbedBuilder()
    .setTitle('Clan Games History')
    .setDescription(truncateEmbedDescription(formatClanGamesHistoryRows(selectedRows)))
    .addFields(
      {
        name: 'Totals',
        value: `${totals.seasons} seasons · ${totals.points.toLocaleString()} points · ${average.toFixed(1)} avg points`,
        inline: false,
      },
      {
        name: 'Source',
        value: 'Values are based on stored Clan Games snapshots over the recent history window.',
        inline: false,
      },
    )
    .setFooter({
      text: `Showing ${selectedRows.length}/${rows.length} players from stored snapshots`,
    });

  if (clanLabel) embed.addFields({ name: 'Clan filter', value: clanLabel, inline: false });
  if (user) embed.setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() });
  return embed;
}

function formatClanGamesHistoryRows(rows: readonly ClanGamesHistoryRow[]): string {
  return rows
    .map((row, index) => {
      const clanLabel = row.latestClanName?.trim() || row.latestClanTag;
      return `${index + 1}. **${escapeMarkdown(row.playerName)}** (\`${row.playerTag}\`) · ${row.seasonCount} seasons · ${row.totalPoints.toLocaleString()} points · ${row.averagePoints.toFixed(1)} avg · ${row.bestPoints.toLocaleString()} best · latest ${escapeMarkdown(row.latestSeasonId)} / ${escapeMarkdown(clanLabel)} (\`${row.latestClanTag}\`) · ${time(row.latestUpdatedAt, 'R')}`;
    })
    .join('\n');
}

export function buildJoinLeaveHistoryEmbed(
  rows: readonly JoinLeaveHistoryRow[],
  clanLabel: string | undefined,
  user: User | null,
): EmbedBuilder {
  const selectedRows = rows.slice(0, MAX_HISTORY_ROWS);
  const totals = rows.reduce(
    (acc, row) => ({
      joined: acc.joined + (row.eventType === 'joined' ? 1 : 0),
      left: acc.left + (row.eventType === 'left' ? 1 : 0),
    }),
    { joined: 0, left: 0 },
  );
  const embed = new EmbedBuilder()
    .setTitle('Join/Leave History')
    .setDescription(truncateEmbedDescription(formatJoinLeaveHistoryRows(selectedRows)))
    .addFields(
      {
        name: 'Totals',
        value: `${totals.joined} joined · ${totals.left} left`,
        inline: false,
      },
      {
        name: 'Source',
        value: 'Values are based on detected clan member events over the recent history window.',
        inline: false,
      },
    )
    .setFooter({
      text: `Showing ${selectedRows.length}/${rows.length} events from stored events`,
    });

  if (clanLabel) embed.addFields({ name: 'Clan filter', value: clanLabel, inline: false });
  if (user) embed.setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() });
  return embed;
}

function formatJoinLeaveHistoryRows(rows: readonly JoinLeaveHistoryRow[]): string {
  return rows
    .map((row, index) => {
      const clanLabel = row.clanName?.trim() || row.clanTag;
      const eventLabel = row.eventType === 'joined' ? 'joined' : 'left';
      return `${index + 1}. **${escapeMarkdown(row.playerName)}** (\`${row.playerTag}\`) · ${eventLabel} · ${escapeMarkdown(clanLabel)} (\`${row.clanTag}\`) · ${time(row.occurredAt, 'R')}`;
    })
    .join('\n');
}

export function buildWarAttackHistoryEmbed(
  rows: readonly WarAttackHistoryRow[],
  clanLabel: string | undefined,
  user: User | null,
): EmbedBuilder {
  const selectedRows = rows.slice(0, MAX_HISTORY_ROWS);
  const totals = rows.reduce(
    (acc, row) => ({
      attacks: acc.attacks + row.attackCount,
      stars: acc.stars + row.totalStars,
      destruction: acc.destruction + row.totalDestruction,
      fresh: acc.fresh + row.freshAttackCount,
    }),
    { attacks: 0, stars: 0, destruction: 0, fresh: 0 },
  );
  const averageStars = totals.attacks > 0 ? totals.stars / totals.attacks : 0;
  const averageDestruction = totals.attacks > 0 ? totals.destruction / totals.attacks : 0;
  const embed = new EmbedBuilder()
    .setTitle('War Attack History')
    .setDescription(truncateEmbedDescription(formatWarAttackHistoryRows(selectedRows)))
    .addFields(
      {
        name: 'Totals',
        value: `${totals.attacks} attacks · ${totals.stars} stars · ${averageStars.toFixed(
          2,
        )} avg stars · ${averageDestruction.toFixed(2)}% avg destruction · ${totals.fresh} fresh hits`,
        inline: false,
      },
      {
        name: 'Source',
        value: 'Values are based on detected war attack events over the recent history window.',
        inline: false,
      },
    )
    .setFooter({
      text: `Showing ${selectedRows.length}/${rows.length} attackers from stored events`,
    });

  if (clanLabel) embed.addFields({ name: 'Clan filter', value: clanLabel, inline: false });
  if (user) embed.setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() });
  return embed;
}

function formatWarAttackHistoryRows(rows: readonly WarAttackHistoryRow[]): string {
  return rows
    .map((row, index) => {
      const label = row.attackerName?.trim() || row.attackerTag;
      return `${index + 1}. **${escapeMarkdown(label)}** (\`${row.attackerTag}\`) · ${row.attackCount} attacks · ${row.totalStars} stars · ${row.averageStars.toFixed(2)} avg stars · ${row.averageDestruction.toFixed(2)}% avg destruction · ${row.freshAttackCount} fresh · ${time(row.lastAttackedAt, 'R')}`;
    })
    .join('\n');
}

function isHistoryOption(value: string): value is HistoryOption {
  return HISTORY_OPTIONS.includes(value as HistoryOption);
}

function formatNoLinkedPlayersMessage(user: User): string {
  return `**${escapeMarkdown(user.displayName)}** does not have linked player accounts. Use \`/link create\` first.`;
}

export function resolveHistoryClan(
  clans: readonly HistoryLinkedClan[],
  query: string,
): HistoryLinkedClan | undefined {
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

export function buildDonationHistoryEmbed(
  rows: readonly DonationHistoryRow[],
  clanLabel: string | undefined,
  user: User | null,
): EmbedBuilder {
  const selectedRows = rows.slice(0, MAX_HISTORY_ROWS);
  const totals = rows.reduce(
    (acc, row) => ({ donated: acc.donated + row.donated, received: acc.received + row.received }),
    { donated: 0, received: 0 },
  );
  const embed = new EmbedBuilder()
    .setTitle('Donation History')
    .setDescription(truncateEmbedDescription(formatDonationHistoryRows(selectedRows)))
    .addFields(
      {
        name: 'Totals',
        value: `${totals.donated} donated · ${totals.received} received · ${formatDifference(
          totals.donated - totals.received,
        )} difference`,
        inline: false,
      },
      {
        name: 'Source',
        value: 'Values are based on detected donation delta events over the recent history window.',
        inline: false,
      },
    )
    .setFooter({
      text: `Showing ${selectedRows.length}/${rows.length} players from stored events`,
    });

  if (clanLabel) embed.addFields({ name: 'Clan filter', value: clanLabel, inline: false });
  if (user) embed.setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() });
  return embed;
}

function formatDonationHistoryRows(rows: readonly DonationHistoryRow[]): string {
  return rows
    .map((row, index) => {
      const diff = row.donated - row.received;
      return `${index + 1}. **${escapeMarkdown(row.playerName)}** (\`${row.playerTag}\`) · ${row.donated} donated · ${row.received} received · ${formatDifference(diff)} diff · ${row.eventCount} events · ${time(row.lastDetectedAt, 'R')}`;
    })
    .join('\n');
}

function clanMatchesQuery(clan: HistoryLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: HistoryLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function truncateEmbedDescription(text: string): string {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…`;
}

function formatDifference(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
