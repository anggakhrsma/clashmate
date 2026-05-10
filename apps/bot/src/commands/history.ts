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
  'No persisted donation delta events match the selected filters yet. Link/configure the clan for this server and wait for the clan poller to detect donation changes before retrying.';
export const HISTORY_NO_WAR_ATTACK_EVENTS_MESSAGE =
  'No persisted war attack events match the selected filters yet. Link/configure the clan for this server and wait for the war poller to record attacks before retrying.';
export const HISTORY_NO_JOIN_LEAVE_EVENTS_MESSAGE =
  'No persisted clan member join/leave events match the selected filters yet. Link/configure the clan for this server and wait for the clan poller to detect membership changes before retrying.';
export const HISTORY_NO_CLAN_GAMES_EVENTS_MESSAGE =
  'No persisted Clan Games snapshots match the selected filters yet. Link/configure the clan for this server and wait for Clan Games polling snapshots before retrying.';
export const HISTORY_NO_CAPITAL_RAIDS_EVENTS_MESSAGE =
  'Capital raid history is not available yet because raid-week attack logs are not persisted. This command only reads stored history and does not query the Clash API live.';
export const HISTORY_NO_CAPITAL_CONTRIBUTION_EVENTS_MESSAGE =
  'Capital contribution history is not available yet because contribution snapshots are not persisted. This command only reads stored history and does not query the Clash API live.';
export const HISTORY_NO_ATTACKS_EVENTS_MESSAGE =
  'Multiplayer attack/defense history is not available yet because seasonal attack-win snapshots are not persisted. Use `war-attacks` for stored war attack history.';
export const HISTORY_NO_LOOT_EVENTS_MESSAGE =
  'Loot history is not available yet because loot snapshots are not persisted. This command only reads stored history and does not query the Clash API live.';
export const HISTORY_NO_LEGEND_ATTACKS_EVENTS_MESSAGE =
  'Legend attack history is not available yet because Legend attack/day data is not persisted. This command only reads stored history and does not query the Clash API live.';
export const HISTORY_NO_EOS_TROPHIES_EVENTS_MESSAGE =
  'End-of-season trophy history is not available yet because EOS trophy snapshots are not persisted. This command only reads stored history and does not query the Clash API live.';

const HISTORY_FILTER_HELP =
  'Accepted filters: `clans` (linked clan tag/name/alias), `player` (player tag), and `user` (linked Discord user). Date and season filters are not exposed on `/history` yet; use command-specific history views where available for date/season filtering.';
const HISTORY_STORED_ONLY_HELP =
  'This command reads persisted ClashMate history only. It does not perform live Clash API lookups, backfill missing rows, or enroll search-only clan/player filters into polling.';

const HISTORY_OPTIONS = [
  'donations',
  'war-attacks',
  'join-leave',
  'clan-games',
  'capital-raids',
  'capital-contribution',
  'cwl-attacks',
  'attacks',
  'loot',
  'legend-attacks',
  'eos-trophies',
] as const;
export type HistoryOption = (typeof HISTORY_OPTIONS)[number];
const MAX_HISTORY_ROWS = 15;
const EMBED_DESCRIPTION_LIMIT = 4096;

interface HistoryFilterContext {
  readonly clanLabel?: string;
  readonly playerTag?: string;
  readonly user: User | null;
}

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
        { name: 'Clan Games', value: 'clan-games' },
        { name: 'Capital Raids', value: 'capital-raids' },
        { name: 'Capital Contribution', value: 'capital-contribution' },
        { name: 'CWL Attacks', value: 'cwl-attacks' },
        { name: 'War Attacks', value: 'war-attacks' },
        { name: 'Donations', value: 'donations' },
        { name: 'Attacks', value: 'attacks' },
        { name: 'Loot', value: 'loot' },
        { name: 'Join/Leave', value: 'join-leave' },
        { name: 'Legend Attacks', value: 'legend-attacks' },
        { name: 'EOS Trophies', value: 'eos-trophies' },
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
      content: `Only stored history options are available. ${HISTORY_FILTER_HELP} ${HISTORY_STORED_ONLY_HELP}`,
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
      await interaction.editReply({
        content: `No linked clan was found for that clan option. ${HISTORY_FILTER_HELP} ${HISTORY_STORED_ONLY_HELP}`,
      });
      return;
    }
    clanTags = [clan.clanTag];
    clanLabel = `${clan.alias ?? clan.name ?? 'Linked Clan'} (${clan.clanTag})`;
  }

  let playerTags: string[] | undefined;
  let playerTagLabel: string | undefined;
  if (playerOption) {
    try {
      const normalizedPlayerTag = normalizeClashTag(playerOption);
      playerTagLabel = normalizedPlayerTag;
      playerTags = [normalizedPlayerTag];
    } catch {
      await interaction.editReply({
        content: `That player tag is not valid. ${HISTORY_FILTER_HELP} ${HISTORY_STORED_ONLY_HELP}`,
      });
      return;
    }
  } else if (userOption) {
    playerTags = await options.store.listPlayerTagsForUser(interaction.guildId, userOption.id);
    if (playerTags.length === 0) {
      await interaction.editReply({ content: formatNoLinkedPlayersMessage(userOption) });
      return;
    }
  }

  const filterContext: HistoryFilterContext = {
    ...(clanLabel ? { clanLabel } : {}),
    ...(playerTagLabel ? { playerTag: playerTagLabel } : {}),
    user: userOption,
  };

  if (option === 'cwl-attacks' || option === 'war-attacks') {
    const rows = await options.store.listWarAttackHistoryForGuild({
      guildId: interaction.guildId,
      ...(clanTags ? { clanTags } : {}),
      ...(playerTags ? { attackerTags: playerTags } : {}),
    });

    if (rows.length === 0) {
      await interaction.editReply({
        embeds: [buildNoHistoryEmbed(option, HISTORY_NO_WAR_ATTACK_EVENTS_MESSAGE, filterContext)],
      });
      return;
    }

    await interaction.editReply({
      embeds: [buildWarAttackHistoryEmbed(rows, filterContext, option)],
    });
    return;
  }

  const unavailableMessage = getUnavailableHistoryMessage(option);
  if (unavailableMessage) {
    await interaction.editReply({
      embeds: [buildUnavailableHistoryEmbed(option, unavailableMessage, filterContext)],
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
      await interaction.editReply({
        embeds: [buildNoHistoryEmbed(option, HISTORY_NO_JOIN_LEAVE_EVENTS_MESSAGE, filterContext)],
      });
      return;
    }

    await interaction.editReply({
      embeds: [buildJoinLeaveHistoryEmbed(rows, filterContext)],
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
      await interaction.editReply({
        embeds: [buildNoHistoryEmbed(option, HISTORY_NO_CLAN_GAMES_EVENTS_MESSAGE, filterContext)],
      });
      return;
    }

    await interaction.editReply({
      embeds: [buildClanGamesHistoryEmbed(rows, filterContext)],
    });
    return;
  }

  const rows = await options.store.listDonationHistoryForGuild({
    guildId: interaction.guildId,
    ...(clanTags ? { clanTags } : {}),
    ...(playerTags ? { playerTags } : {}),
  });

  if (rows.length === 0) {
    await interaction.editReply({
      embeds: [buildNoHistoryEmbed('donations', HISTORY_NO_DONATION_EVENTS_MESSAGE, filterContext)],
    });
    return;
  }

  await interaction.editReply({ embeds: [buildDonationHistoryEmbed(rows, filterContext)] });
}

export function buildClanGamesHistoryEmbed(
  rows: readonly ClanGamesHistoryRow[],
  filters: HistoryFilterContext,
): EmbedBuilder {
  const selectedRows = rows.slice(0, MAX_HISTORY_ROWS);
  const latestFetchedAt = getLatestDate(rows, (row) => row.latestUpdatedAt);
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
        value: formatHistorySourceContext({
          rowsConsidered: rows.length,
          rowsVisible: selectedRows.length,
          latestLabel: 'Latest fetched',
          latestAt: latestFetchedAt,
          filters,
          note: 'Persisted Clan Games snapshots only; no live Clash API lookup or polling enrollment.',
        }),
        inline: false,
      },
    )
    .setFooter({
      text: `Showing ${selectedRows.length}/${rows.length} players from stored snapshots`,
    });

  if (filters.user)
    embed.setAuthor({ name: filters.user.displayName, iconURL: filters.user.displayAvatarURL() });
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
  filters: HistoryFilterContext,
): EmbedBuilder {
  const selectedRows = rows.slice(0, MAX_HISTORY_ROWS);
  const latestDetectedAt = getLatestDate(rows, (row) => row.detectedAt);
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
        value: formatHistorySourceContext({
          rowsConsidered: rows.length,
          rowsVisible: selectedRows.length,
          latestLabel: 'Latest detected',
          latestAt: latestDetectedAt,
          filters,
          note: 'Persisted clan member events only; no live Clash API lookup or polling enrollment.',
        }),
        inline: false,
      },
    )
    .setFooter({
      text: `Showing ${selectedRows.length}/${rows.length} events from stored events`,
    });

  if (filters.user)
    embed.setAuthor({ name: filters.user.displayName, iconURL: filters.user.displayAvatarURL() });
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
  filters: HistoryFilterContext,
  option: 'war-attacks' | 'cwl-attacks' = 'war-attacks',
): EmbedBuilder {
  const selectedRows = rows.slice(0, MAX_HISTORY_ROWS);
  const latestDetectedAt = getLatestDate(rows, (row) => row.lastAttackedAt);
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
  const isCwlApproximation = option === 'cwl-attacks';
  const embed = new EmbedBuilder()
    .setTitle(isCwlApproximation ? 'CWL Attack History' : 'War Attack History')
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
        value: formatHistorySourceContext({
          rowsConsidered: rows.length,
          rowsVisible: selectedRows.length,
          latestLabel: 'Latest detected',
          latestAt: latestDetectedAt,
          filters,
          note: isCwlApproximation
            ? 'Persisted war attack events only; CWL-only classification is approximate because CWL metadata is not stored separately yet. No live Clash API lookup or polling enrollment.'
            : 'Persisted war attack events only; no live Clash API lookup or polling enrollment.',
        }),
        inline: false,
      },
    )
    .setFooter({
      text: `Showing ${selectedRows.length}/${rows.length} attackers from stored events`,
    });

  if (filters.user)
    embed.setAuthor({ name: filters.user.displayName, iconURL: filters.user.displayAvatarURL() });
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

function getUnavailableHistoryMessage(option: HistoryOption): string | undefined {
  switch (option) {
    case 'capital-raids':
      return HISTORY_NO_CAPITAL_RAIDS_EVENTS_MESSAGE;
    case 'capital-contribution':
      return HISTORY_NO_CAPITAL_CONTRIBUTION_EVENTS_MESSAGE;
    case 'attacks':
      return HISTORY_NO_ATTACKS_EVENTS_MESSAGE;
    case 'loot':
      return HISTORY_NO_LOOT_EVENTS_MESSAGE;
    case 'legend-attacks':
      return HISTORY_NO_LEGEND_ATTACKS_EVENTS_MESSAGE;
    case 'eos-trophies':
      return HISTORY_NO_EOS_TROPHIES_EVENTS_MESSAGE;
    default:
      return undefined;
  }
}

export function buildUnavailableHistoryEmbed(
  option: HistoryOption,
  message: string,
  filters: HistoryFilterContext,
): EmbedBuilder {
  const filterText = formatAcceptedHistoryFilters(filters);
  return new EmbedBuilder()
    .setTitle(`${formatHistoryOptionTitle(option)} History Unavailable`)
    .setDescription(`${message}\n\n${HISTORY_STORED_ONLY_HELP}`)
    .addFields(
      { name: 'Accepted filters', value: filterText, inline: false },
      {
        name: 'Available stored-history categories',
        value:
          '`donations` (donation deltas), `war-attacks`/`cwl-attacks` (stored war attack events), `join-leave` (clan member events), and `clan-games` (Clan Games snapshots).',
        inline: false,
      },
    );
}

export function buildNoHistoryEmbed(
  option: Extract<
    HistoryOption,
    'donations' | 'war-attacks' | 'cwl-attacks' | 'join-leave' | 'clan-games'
  >,
  message: string,
  filters: HistoryFilterContext,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`No ${formatHistoryOptionTitle(option)} History`)
    .setDescription(message)
    .addFields(
      { name: 'Accepted filters', value: formatAcceptedHistoryFilters(filters), inline: false },
      { name: 'Source coverage', value: formatHistoryCoverage(option), inline: false },
      {
        name: 'Polling prerequisites',
        value:
          'History appears after a clan is linked/configured for this server and the worker has detected matching events from persisted polling snapshots. Check the selected linked clan, player tag, or Discord user links; then wait for the matching clan/war polling source to capture new activity. This command reads stored data only; it does not query the Clash API live, backfill older activity, or start polling for search-only filters.',
        inline: false,
      },
    );
}

function formatHistoryCoverage(
  option: Extract<
    HistoryOption,
    'donations' | 'war-attacks' | 'cwl-attacks' | 'join-leave' | 'clan-games'
  >,
): string {
  switch (option) {
    case 'donations':
      return 'Stored donation delta events derived from clan polling for players seen in linked/configured clans.';
    case 'war-attacks':
      return 'Stored regular war attack events derived from war polling for linked/configured clans.';
    case 'cwl-attacks':
      return 'Stored war attack events derived from war polling for linked/configured clans; CWL-only classification is approximate until separate CWL metadata is persisted.';
    case 'join-leave':
      return 'Stored clan member join/leave events derived from clan polling for linked/configured clans.';
    case 'clan-games':
      return 'Stored Clan Games player snapshots derived from clan polling for linked/configured clans.';
  }
}

function formatAcceptedHistoryFilters(filters: HistoryFilterContext): string {
  const activeFilters = [
    filters.clanLabel ? `Clan: ${filters.clanLabel}` : undefined,
    filters.playerTag ? `Player: \`${filters.playerTag}\`` : undefined,
    filters.user ? `User: <@${filters.user.id}>` : undefined,
  ].filter((value): value is string => Boolean(value));

  return activeFilters.length > 0
    ? `${activeFilters.join('\n')}\n${HISTORY_FILTER_HELP}`
    : HISTORY_FILTER_HELP;
}

function formatHistoryOptionTitle(option: HistoryOption): string {
  switch (option) {
    case 'capital-raids':
      return 'Capital Raids';
    case 'capital-contribution':
      return 'Capital Contribution';
    case 'attacks':
      return 'Attacks';
    case 'loot':
      return 'Loot';
    case 'legend-attacks':
      return 'Legend Attacks';
    case 'eos-trophies':
      return 'EOS Trophies';
    case 'clan-games':
      return 'Clan Games';
    case 'cwl-attacks':
      return 'CWL Attacks';
    case 'war-attacks':
      return 'War Attacks';
    case 'donations':
      return 'Donations';
    case 'join-leave':
      return 'Join/Leave';
  }
}

function formatNoLinkedPlayersMessage(user: User): string {
  return `**${escapeMarkdown(user.displayName)}** does not have linked player accounts. Use \`/link create\` first. ${HISTORY_FILTER_HELP} ${HISTORY_STORED_ONLY_HELP}`;
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
  filters: HistoryFilterContext,
): EmbedBuilder {
  const selectedRows = rows.slice(0, MAX_HISTORY_ROWS);
  const latestDetectedAt = getLatestDate(rows, (row) => row.lastDetectedAt);
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
        value: formatHistorySourceContext({
          rowsConsidered: rows.length,
          rowsVisible: selectedRows.length,
          latestLabel: 'Latest detected',
          latestAt: latestDetectedAt,
          filters,
          note: 'Persisted donation delta events only; no live Clash API lookup or polling enrollment.',
        }),
        inline: false,
      },
    )
    .setFooter({
      text: `Showing ${selectedRows.length}/${rows.length} players from stored events`,
    });

  if (filters.user)
    embed.setAuthor({ name: filters.user.displayName, iconURL: filters.user.displayAvatarURL() });
  return embed;
}

function formatHistorySourceContext(input: {
  readonly rowsConsidered: number;
  readonly rowsVisible: number;
  readonly latestLabel: string;
  readonly latestAt: Date | undefined;
  readonly filters: HistoryFilterContext;
  readonly note: string;
}): string {
  return [
    `Rows: ${input.rowsConsidered} considered · ${input.rowsVisible} visible.`,
    `${input.latestLabel}: ${input.latestAt ? time(input.latestAt, 'f') : 'none'}.`,
    `Active filters: ${formatActiveHistoryFilters(input.filters)}.`,
    input.note,
  ].join('\n');
}

function formatActiveHistoryFilters(filters: HistoryFilterContext): string {
  const values = [
    filters.clanLabel ? `clan ${filters.clanLabel}` : undefined,
    filters.playerTag ? `player \`${filters.playerTag}\`` : undefined,
    filters.user ? `user <@${filters.user.id}>` : undefined,
  ].filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join(', ') : 'none';
}

function getLatestDate<T>(rows: readonly T[], selector: (row: T) => Date): Date | undefined {
  return rows.reduce<Date | undefined>((latest, row) => {
    const value = selector(row);
    return !latest || value.getTime() > latest.getTime() ? value : latest;
  }, undefined);
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
