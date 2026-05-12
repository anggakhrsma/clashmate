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

export const STATS_COMMAND_NAME = 'stats';
export const STATS_COMMAND_DESCRIPTION = 'Show war attack stats from stored history.';
export const STATS_NO_ATTACK_EVENTS_MESSAGE =
  'No war attack stats matched the current `/stats attacks` filters.';
export const STATS_NO_DEFENSE_EVENTS_MESSAGE =
  'No war defense stats matched the current `/stats defense` filters.';

const MAX_STATS_ROWS = 15;
const EMBED_DESCRIPTION_LIMIT = 4096;
const STARS_OPTIONS = ['==3', '==2', '>=2', '==1', '>=1'] as const;
const WAR_TYPE_OPTIONS = ['regular', 'cwl', 'friendly', 'noFriendly', 'noCWL', 'all'] as const;
type StarsOption = (typeof STARS_OPTIONS)[number];
type AttemptOption = 'fresh' | 'cleanup';
type WarTypeOption = (typeof WAR_TYPE_OPTIONS)[number];

interface StatsParityFilters {
  readonly season: string | null;
  readonly type: WarTypeOption | null;
  readonly wars: number | null;
  readonly filterLootHits: boolean | null;
  readonly filterFarmHits: boolean | null;
  readonly clanOnly: boolean | null;
}

export const statsCommandData = new SlashCommandBuilder()
  .setName(STATS_COMMAND_NAME)
  .setDescription(STATS_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('attacks')
      .setDescription('Show attacker rankings from stored war attack history.')
      .addStringOption((option) =>
        option
          .setName('clan')
          .setDescription('Clan tag, name, or alias filter.')
          .setAutocomplete(true)
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('Discord user whose linked players should be matched.')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('stars')
          .setDescription('Star result filter label.')
          .setRequired(false)
          .addChoices(
            { name: '3', value: '==3' },
            { name: '2', value: '==2' },
            { name: '>= 2', value: '>=2' },
            { name: '1', value: '==1' },
            { name: '>= 1', value: '>=1' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('type')
          .setDescription('War type filter label.')
          .setRequired(false)
          .addChoices(
            { name: 'Regular', value: 'regular' },
            { name: 'CWL', value: 'cwl' },
            { name: 'Friendly', value: 'friendly' },
            { name: 'Regular and CWL', value: 'noFriendly' },
            { name: 'No CWL', value: 'noCWL' },
            { name: 'All', value: 'all' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('season')
          .setDescription('Season since filter label.')
          .setRequired(false)
          .addChoices(...getSeasonSinceChoices()),
      )
      .addIntegerOption((option) =>
        option
          .setName('days')
          .setDescription('Limit to attacks detected in the last N days.')
          .setMinValue(1)
          .setMaxValue(180)
          .setRequired(false),
      )
      .addIntegerOption((option) =>
        option
          .setName('wars')
          .setDescription('War count filter label.')
          .setMinValue(10)
          .setMaxValue(300)
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('attempt')
          .setDescription('Show fresh or cleanup hit context where stored aggregates allow it.')
          .setRequired(false)
          .addChoices({ name: 'Fresh', value: 'fresh' }, { name: 'Cleanup', value: 'cleanup' }),
      )
      .addBooleanOption((option) =>
        option
          .setName('filter_loot_hits')
          .setDescription('Accept loot-hit filter label without changing stored stats behavior.')
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('filter_farm_hits')
          .setDescription('Accept farm-hit filter label without changing stored stats behavior.')
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('clan_only')
          .setDescription('Accept clan-only filter label without changing stored stats behavior.')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('defense')
      .setDescription('Show defense stats from stored history.')
      .addStringOption((option) =>
        option
          .setName('clan')
          .setDescription('Clan tag, name, or alias filter.')
          .setAutocomplete(true)
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('Discord user whose linked players should be matched.')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('stars')
          .setDescription('Star result filter label.')
          .setRequired(false)
          .addChoices(
            { name: '3', value: '==3' },
            { name: '2', value: '==2' },
            { name: '>= 2', value: '>=2' },
            { name: '1', value: '==1' },
            { name: '>= 1', value: '>=1' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('type')
          .setDescription('War type filter label.')
          .setRequired(false)
          .addChoices(
            { name: 'Regular', value: 'regular' },
            { name: 'CWL', value: 'cwl' },
            { name: 'Friendly', value: 'friendly' },
            { name: 'Regular and CWL', value: 'noFriendly' },
            { name: 'No CWL', value: 'noCWL' },
            { name: 'All', value: 'all' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('season')
          .setDescription('Season since filter label.')
          .setRequired(false)
          .addChoices(...getSeasonSinceChoices()),
      )
      .addIntegerOption((option) =>
        option
          .setName('days')
          .setDescription('Limit to defenses detected in the last N days.')
          .setMinValue(1)
          .setMaxValue(180)
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('attempt')
          .setDescription('Show fresh or cleanup hit context where stored aggregates allow it.')
          .setRequired(false)
          .addChoices({ name: 'Fresh', value: 'fresh' }, { name: 'Cleanup', value: 'cleanup' }),
      )
      .addBooleanOption((option) =>
        option
          .setName('clan_only')
          .setDescription('Accept clan-only filter label without changing stored stats behavior.')
          .setRequired(false),
      ),
  );

export interface StatsLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface StatsWarAttackHistoryRow {
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

export interface StatsWarDefenseHistoryRow {
  readonly defenderTag: string;
  readonly defenderName: string | null;
  readonly defenseCount: number;
  readonly starsAllowed: number;
  readonly averageStarsAllowed: number;
  readonly destructionAllowed: number;
  readonly averageDestructionAllowed: number;
  readonly freshDefenseCount: number;
  readonly lastDefendedAt: Date;
}

export interface StatsStore {
  readonly listLinkedClans: (guildId: string) => Promise<StatsLinkedClan[]>;
  readonly listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
  readonly listWarAttackHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    attackerTags?: readonly string[];
    warKeyPrefix?: string;
    excludeWarKeyPrefix?: string;
    since?: Date;
  }) => Promise<StatsWarAttackHistoryRow[]>;
  readonly listWarDefenseHistoryForGuild?: (input: {
    guildId: string;
    clanTags?: readonly string[];
    defenderTags?: readonly string[];
    warKeyPrefix?: string;
    excludeWarKeyPrefix?: string;
    stars?: StarsOption | null;
    attempt?: AttemptOption | null;
    since?: Date;
  }) => Promise<StatsWarDefenseHistoryRow[]>;
}

export interface StatsCommandOptions {
  readonly store: StatsStore;
}

export function createStatsSlashCommand(options: StatsCommandOptions): SlashCommandDefinition {
  return {
    name: STATS_COMMAND_NAME,
    data: statsCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== STATS_COMMAND_NAME) return;
      await executeStats(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== STATS_COMMAND_NAME) return;
      await autocompleteStats(interaction, options);
    },
  };
}

async function autocompleteStats(
  interaction: AutocompleteInteraction,
  options: StatsCommandOptions,
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
    await interaction.respond(filterStatsClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterStatsClanChoices(
  clans: readonly StatsLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .map((clan) => ({ clan, name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }))
    .sort((a, b) => compareStatsClanChoices(a, b, normalizedQuery))
    .filter((choice, index, choices) => isFirstStatsClanChoice(choice, index, choices))
    .slice(0, 25)
    .map(({ name, value }) => ({ name, value }));
}

export async function executeStats(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: StatsCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: '`/stats` can only be used in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'defense') {
    await replyWithStatsDefenseEmbed(interaction, options);
    return;
  }
  if (subcommand !== 'attacks') {
    await interaction.editReply({ content: 'Only `/stats attacks` is available right now.' });
    return;
  }

  const clans = await options.store.listLinkedClans(interaction.guildId);
  const clanOption = interaction.options.getString('clan');
  const userOption = interaction.options.getUser('user');
  const starsOption = readStarsOption(interaction.options.getString('stars'));
  const attemptOption = readAttemptOption(interaction.options.getString('attempt'));
  const days = interaction.options.getInteger('days');
  const parityFilters = readStatsParityFilters(interaction);
  const seasonSince = parseSeasonSince(parityFilters.season);
  const historySince = getStatsHistorySince(days, seasonSince);

  let clanTags: string[] | undefined;
  let clanLabel: string | undefined;
  if (clanOption) {
    const clan = resolveStatsClan(clans, clanOption);
    if (!clan) {
      await interaction.editReply({ content: 'No linked clan was found for that clan option.' });
      return;
    }
    clanTags = [clan.clanTag];
    clanLabel = `${clan.alias ?? clan.name ?? 'Linked Clan'} (${clan.clanTag})`;
  }

  let playerTags: string[] | undefined;
  if (userOption) {
    playerTags = await options.store.listPlayerTagsForUser(interaction.guildId, userOption.id);
    if (playerTags.length === 0) {
      await interaction.editReply({ content: formatNoLinkedPlayersMessage(userOption) });
      return;
    }
  }

  const warKeyFilters = getStatsWarKeyFilters(parityFilters.type);
  const rows = await options.store.listWarAttackHistoryForGuild({
    guildId: interaction.guildId,
    ...(clanTags ? { clanTags } : {}),
    ...(playerTags ? { attackerTags: playerTags } : {}),
    ...warKeyFilters,
    ...(historySince ? { since: historySince } : {}),
  });
  const rankedRows = rankStatsRows(filterRowsByAttempt(rows, attemptOption));

  if (rankedRows.length === 0) {
    await interaction.editReply({
      content: buildStatsNoAttackEventsMessage({
        clanLabel,
        user: userOption,
        playerTagCount: playerTags?.length ?? 0,
        rowsConsidered: rows.length,
        starsOption,
        attemptOption,
        days,
        season: seasonSince,
        parityFilters,
        linkedClanCount: clans.length,
        latestAttackAt: getLatestAttackAt(rows),
      }),
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      buildStatsAttacksEmbed(rankedRows, {
        clanLabel,
        user: userOption,
        playerTagCount: playerTags?.length ?? 0,
        starsOption,
        attemptOption,
        days,
        season: seasonSince,
        parityFilters,
        linkedClanCount: clans.length,
        rowsConsidered: rows.length,
        latestAttackAt: getLatestAttackAt(rows),
      }),
    ],
  });
}

async function replyWithStatsDefenseEmbed(
  interaction: ChatInputCommandInteraction<'cached'>,
  options: StatsCommandOptions,
): Promise<void> {
  const clans = await options.store.listLinkedClans(interaction.guildId);
  const clanOption = interaction.options.getString('clan');
  const userOption = interaction.options.getUser('user');
  const starsOption = readStarsOption(interaction.options.getString('stars'));
  const attemptOption = readAttemptOption(interaction.options.getString('attempt'));
  const days = interaction.options.getInteger('days');
  const parityFilters = readStatsParityFilters(interaction);
  const seasonSince = parseSeasonSince(parityFilters.season);
  const historySince = getStatsHistorySince(days, seasonSince);

  let clanTags: string[] | undefined;
  let clanLabel: string | undefined;
  if (clanOption) {
    const clan = resolveStatsClan(clans, clanOption);
    if (!clan) {
      await interaction.editReply({ content: 'No linked clan was found for that clan option.' });
      return;
    }
    clanTags = [clan.clanTag];
    clanLabel = `${clan.alias ?? clan.name ?? 'Linked Clan'} (${clan.clanTag})`;
  }

  let playerTags: string[] | undefined;
  if (userOption) {
    playerTags = await options.store.listPlayerTagsForUser(interaction.guildId, userOption.id);
    if (playerTags.length === 0) {
      await interaction.editReply({ content: formatNoLinkedPlayersMessage(userOption) });
      return;
    }
  }

  if (!options.store.listWarDefenseHistoryForGuild) {
    await interaction.editReply({
      content:
        'Persisted defense history reader is not wired for this bot process yet. No live Clash API lookup, backfill, or on-demand polling was performed.',
    });
    return;
  }

  const warKeyFilters = getStatsWarKeyFilters(parityFilters.type);
  const rows = await options.store.listWarDefenseHistoryForGuild({
    guildId: interaction.guildId,
    ...(clanTags ? { clanTags } : {}),
    ...(playerTags ? { defenderTags: playerTags } : {}),
    ...warKeyFilters,
    ...(starsOption ? { stars: starsOption } : {}),
    ...(attemptOption ? { attempt: attemptOption } : {}),
    ...(historySince ? { since: historySince } : {}),
  });
  const rankedRows = rankDefenseStatsRows(rows);

  if (rankedRows.length === 0) {
    await interaction.editReply({
      content: buildStatsNoDefenseEventsMessage({
        clanLabel,
        user: userOption,
        playerTagCount: playerTags?.length ?? 0,
        starsOption,
        attemptOption,
        days,
        season: seasonSince,
        parityFilters,
        linkedClanCount: clans.length,
        rowsConsidered: rows.length,
        latestDefenseAt: getLatestDefenseAt(rows),
      }),
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      buildStatsDefenseEmbed(rankedRows, {
        clanLabel,
        user: userOption,
        playerTagCount: playerTags?.length ?? 0,
        starsOption,
        attemptOption,
        days,
        season: seasonSince,
        parityFilters,
        linkedClanCount: clans.length,
        rowsConsidered: rows.length,
        latestDefenseAt: getLatestDefenseAt(rows),
      }),
    ],
  });
}

export function filterRowsByAttempt(
  rows: readonly StatsWarAttackHistoryRow[],
  attempt: AttemptOption | null,
): StatsWarAttackHistoryRow[] {
  if (attempt === 'fresh') return rows.filter((row) => row.freshAttackCount > 0);
  if (attempt === 'cleanup') return rows.filter((row) => row.attackCount > row.freshAttackCount);
  return [...rows];
}

export function rankStatsRows(
  rows: readonly StatsWarAttackHistoryRow[],
): StatsWarAttackHistoryRow[] {
  return [...rows].sort(
    (a, b) =>
      b.attackCount - a.attackCount ||
      b.averageStars - a.averageStars ||
      b.averageDestruction - a.averageDestruction ||
      b.freshAttackCount - a.freshAttackCount ||
      b.lastAttackedAt.getTime() - a.lastAttackedAt.getTime(),
  );
}

export function buildStatsAttacksEmbed(
  rows: readonly StatsWarAttackHistoryRow[],
  input: {
    readonly clanLabel: string | undefined;
    readonly user: User | null;
    readonly playerTagCount: number;
    readonly starsOption: StarsOption | null;
    readonly attemptOption: AttemptOption | null;
    readonly days: number | null;
    readonly season: Date | null;
    readonly parityFilters: StatsParityFilters;
    readonly linkedClanCount?: number;
    readonly rowsConsidered: number;
    readonly latestAttackAt: Date | null;
  },
): EmbedBuilder {
  const selectedRows = rows.slice(0, MAX_STATS_ROWS);
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
    .setTitle('War Attack Stats')
    .setDescription(truncateEmbedDescription(formatStatsRows(selectedRows)))
    .addFields(
      {
        name: 'Totals',
        value: `${totals.attacks} attacks · ${totals.stars} stars · ${averageStars.toFixed(2)} avg stars · ${averageDestruction.toFixed(2)}% avg destruction · ${totals.fresh} fresh hits`,
        inline: false,
      },
      {
        name: 'Coverage',
        value: buildStatsCoverageNote({
          rowsConsidered: input.rowsConsidered,
          rowsVisible: selectedRows.length,
          rowsMatched: rows.length,
          rowLabel: 'attacker rows',
          latestEventAt: input.latestAttackAt,
        }),
        inline: false,
      },
      {
        name: 'Selection diagnostics',
        value: buildStatsSelectionDiagnostics({
          selectedSource: 'attacker history',
          linkedClanCount: input.linkedClanCount ?? 0,
          hasClanFilter: Boolean(input.clanLabel),
          hasUserFilter: Boolean(input.user),
          playerTagCount: input.playerTagCount,
          rowsConsidered: input.rowsConsidered,
          rowsMatched: rows.length,
          latestEventAt: input.latestAttackAt,
        }),
        inline: false,
      },
      {
        name: 'Source & limitations',
        value: buildSourceNote({
          hasClanFilter: Boolean(input.clanLabel),
          hasUserFilter: Boolean(input.user),
          stars: input.starsOption,
          attempt: input.attemptOption,
        }),
        inline: false,
      },
      {
        name: 'Polling prerequisites',
        value:
          'War attack stats appear after a clan is linked/configured in this server, the war poller observes wars for that clan, and persisted war attack events exist for the selected filters. One-off `/stats` lookups do not enroll clans or players for polling.',
        inline: false,
      },
    )
    .setFooter({
      text: buildStatsFooter(selectedRows.length, rows.length, input.days, input.season),
    });

  if (input.clanLabel)
    embed.addFields({ name: 'Clan filter', value: input.clanLabel, inline: false });
  if (input.starsOption)
    embed.addFields({
      name: 'Stars filter',
      value: formatStarsOption(input.starsOption),
      inline: true,
    });
  if (input.attemptOption)
    embed.addFields({
      name: 'Attempt filter',
      value: formatAttemptOption(input.attemptOption),
      inline: true,
    });
  if (input.season)
    embed.addFields({
      name: 'Season filter',
      value: `Since ${formatSeasonLabel(formatSeasonValue(input.season))}`,
      inline: true,
    });
  const parityLabels = formatStatsParityFilters(input.parityFilters);
  const activeLabels = formatStatsAppliedFilterLabels(input);
  if (activeLabels.length > 0) {
    embed.addFields({
      name: 'Active filters',
      value: activeLabels.join('\n').slice(0, 1024),
      inline: false,
    });
  }
  if (parityLabels.length > 0) {
    embed.addFields({
      name: 'Accepted parity filters',
      value: `${parityLabels.join(' · ')}\nCWL/No CWL type filters use persisted war keys when selected. Friendly, loot, farm, and clan-only labels are accepted for reference parity only.`,
      inline: false,
    });
  }
  if (input.user)
    embed.setAuthor({ name: input.user.displayName, iconURL: input.user.displayAvatarURL() });
  return embed;
}

export function rankDefenseStatsRows(
  rows: readonly StatsWarDefenseHistoryRow[],
): StatsWarDefenseHistoryRow[] {
  return [...rows].sort(
    (a, b) =>
      b.defenseCount - a.defenseCount ||
      a.averageStarsAllowed - b.averageStarsAllowed ||
      a.averageDestructionAllowed - b.averageDestructionAllowed ||
      b.freshDefenseCount - a.freshDefenseCount ||
      b.lastDefendedAt.getTime() - a.lastDefendedAt.getTime(),
  );
}

export function buildStatsDefenseEmbed(
  rows: readonly StatsWarDefenseHistoryRow[],
  input: {
    readonly clanLabel: string | undefined;
    readonly user: User | null;
    readonly playerTagCount: number;
    readonly starsOption: StarsOption | null;
    readonly attemptOption: AttemptOption | null;
    readonly days: number | null;
    readonly season: Date | null;
    readonly parityFilters: StatsParityFilters;
    readonly linkedClanCount?: number;
    readonly rowsConsidered: number;
    readonly latestDefenseAt: Date | null;
  },
): EmbedBuilder {
  const selectedRows = rows.slice(0, MAX_STATS_ROWS);
  const totals = rows.reduce(
    (acc, row) => ({
      defenses: acc.defenses + row.defenseCount,
      stars: acc.stars + row.starsAllowed,
      destruction: acc.destruction + row.destructionAllowed,
      fresh: acc.fresh + row.freshDefenseCount,
    }),
    { defenses: 0, stars: 0, destruction: 0, fresh: 0 },
  );
  const averageStars = totals.defenses > 0 ? totals.stars / totals.defenses : 0;
  const averageDestruction = totals.defenses > 0 ? totals.destruction / totals.defenses : 0;
  const embed = new EmbedBuilder()
    .setTitle('War Defense Stats')
    .setDescription(truncateEmbedDescription(formatDefenseStatsRows(selectedRows)))
    .addFields(
      {
        name: 'Totals',
        value: `${totals.defenses} defenses · ${totals.stars} stars allowed · ${averageStars.toFixed(2)} avg stars allowed · ${averageDestruction.toFixed(2)}% avg destruction allowed · ${totals.fresh} fresh defenses`,
        inline: false,
      },
      {
        name: 'Coverage',
        value: buildStatsCoverageNote({
          rowsConsidered: input.rowsConsidered,
          rowsVisible: selectedRows.length,
          rowsMatched: rows.length,
          rowLabel: 'defender rows',
          latestEventAt: input.latestDefenseAt,
        }),
        inline: false,
      },
      {
        name: 'Selection diagnostics',
        value: buildStatsSelectionDiagnostics({
          selectedSource: 'defender history',
          linkedClanCount: input.linkedClanCount ?? 0,
          hasClanFilter: Boolean(input.clanLabel),
          hasUserFilter: Boolean(input.user),
          playerTagCount: input.playerTagCount,
          rowsConsidered: input.rowsConsidered,
          rowsMatched: rows.length,
          latestEventAt: input.latestDefenseAt,
        }),
        inline: false,
      },
      {
        name: 'Source & limitations',
        value:
          'Data source: persisted war attack events already observed by ClashMate for linked/configured clans in this server, grouped by defender tag; no live Clash API lookup or backfill is performed. CWL/No CWL type filters use persisted war keys when selected; friendly, loot, farm, and clan-only parity labels remain display-only.',
        inline: false,
      },
    )
    .setFooter({
      text: buildStatsFooter(selectedRows.length, rows.length, input.days, input.season).replace(
        'attackers',
        'defenders',
      ),
    });

  if (input.clanLabel)
    embed.addFields({ name: 'Clan filter', value: input.clanLabel, inline: false });
  const activeLabels = formatStatsAppliedFilterLabels(input).map((label) =>
    label.replace('attacker tags', 'defender tags'),
  );
  if (activeLabels.length > 0) {
    embed.addFields({
      name: 'Active filters',
      value: activeLabels.join('\n').slice(0, 1024),
      inline: false,
    });
  }
  const parityLabels = formatStatsParityFilters(input.parityFilters);
  if (parityLabels.length > 0) {
    embed.addFields({
      name: 'Accepted parity filters',
      value: `${parityLabels.join(' · ')}\nCWL/No CWL type filters use persisted war keys when selected. Friendly, loot, farm, and clan-only labels are accepted for reference parity only; star and fresh/cleanup filters are applied from stored attack-event fields.`,
      inline: false,
    });
  }
  if (input.user)
    embed.setAuthor({ name: input.user.displayName, iconURL: input.user.displayAvatarURL() });
  return embed;
}

function buildStatsNoDefenseEventsMessage(input: {
  readonly clanLabel: string | undefined;
  readonly user: User | null;
  readonly playerTagCount: number;
  readonly starsOption: StarsOption | null;
  readonly attemptOption: AttemptOption | null;
  readonly days: number | null;
  readonly season: Date | null;
  readonly parityFilters: StatsParityFilters;
  readonly linkedClanCount?: number;
  readonly rowsConsidered: number;
  readonly latestDefenseAt: Date | null;
}): string {
  const filters = [
    ...formatStatsAppliedFilterLabels(input).map((label) =>
      label.replace('attacker tags', 'defender tags'),
    ),
    ...formatStatsParityFilters(input.parityFilters),
  ];
  if (input.user) filters.push(`Linked player tags checked: ${input.playerTagCount}`);
  filters.push(`Linked clans in server: ${input.linkedClanCount ?? 0}`);
  const filterText = filters.length > 0 ? ` Active filters: ${filters.join(' · ')}.` : '';
  return `${STATS_NO_DEFENSE_EVENTS_MESSAGE} Source: persisted war attack events grouped by defender tag for linked/configured clans only; no live Clash API lookup, search, historical backfill, or on-demand polling is performed. Rows considered: ${input.rowsConsidered}; latest stored defense: ${formatLatestEventAge(input.latestDefenseAt)}.${filterText} Try removing the user/clan/time/star/attempt filters or choose a wider season/days window.`;
}

function formatDefenseStatsRows(rows: readonly StatsWarDefenseHistoryRow[]): string {
  return rows
    .map((row, index) => {
      const label = row.defenderName?.trim() || row.defenderTag;
      return `${index + 1}. **${escapeMarkdown(label)}** (\`${row.defenderTag}\`) · ${row.defenseCount} defenses · ${row.averageStarsAllowed.toFixed(2)} avg ⭐ allowed · ${row.averageDestructionAllowed.toFixed(2)}% avg allowed · ${row.freshDefenseCount} fresh · ${time(row.lastDefendedAt, 'R')}`;
    })
    .join('\n');
}

function formatStatsRows(rows: readonly StatsWarAttackHistoryRow[]): string {
  return rows
    .map((row, index) => {
      const label = row.attackerName?.trim() || row.attackerTag;
      return `${index + 1}. **${escapeMarkdown(label)}** (\`${row.attackerTag}\`) · ${row.attackCount} attacks · ${row.averageStars.toFixed(2)} avg ⭐ · ${row.averageDestruction.toFixed(2)}% avg · ${row.freshAttackCount} fresh · ${time(row.lastAttackedAt, 'R')}`;
    })
    .join('\n');
}

function buildSourceNote(input: {
  readonly stars: StarsOption | null;
  readonly attempt: AttemptOption | null;
  readonly hasClanFilter: boolean;
  readonly hasUserFilter: boolean;
}): string {
  const notes = [
    'Data source: persisted war attack events already observed by ClashMate for linked/configured clans in this server; no live Clash API lookup or backfill is performed by this command.',
  ];
  if (input.hasClanFilter) {
    notes.push(
      'Clan filters match linked clan tags, names, or aliases before reading stored events.',
    );
  }
  if (input.hasUserFilter) {
    notes.push(
      'User filters expand to linked player tags in this server and match those tags against stored attacker tags.',
    );
  }
  if (input.stars) {
    notes.push(
      'Star filtering is shown as a label only because stored rows are attacker aggregates, not exact per-hit star buckets.',
    );
  }
  if (input.attempt) {
    notes.push(
      'Attempt filtering uses aggregate fresh-hit counts conservatively; displayed averages still come from stored attacker totals.',
    );
  }
  return notes.join(' ');
}

function buildStatsCoverageNote(input: {
  readonly rowsConsidered: number;
  readonly rowsMatched: number;
  readonly rowsVisible: number;
  readonly rowLabel: string;
  readonly latestEventAt: Date | null;
}): string {
  return `${input.rowsConsidered} stored ${input.rowLabel} considered · ${input.rowsMatched} matched aggregate filters · ${input.rowsVisible} visible in this embed · latest stored event ${formatLatestEventAge(input.latestEventAt)}.`;
}

function buildStatsSelectionDiagnostics(input: {
  readonly selectedSource: string;
  readonly linkedClanCount: number;
  readonly hasClanFilter: boolean;
  readonly hasUserFilter: boolean;
  readonly playerTagCount: number;
  readonly rowsConsidered: number;
  readonly rowsMatched: number;
  readonly latestEventAt: Date | null;
}): string {
  const clanScope = input.hasClanFilter
    ? `1 selected linked clan out of ${input.linkedClanCount}`
    : `${input.linkedClanCount} linked clans in server`;
  const playerScope = input.hasUserFilter
    ? `${input.playerTagCount} linked player tags selected`
    : 'all stored player tags in selected clan scope';

  return [
    `Selected source: persisted ${input.selectedSource}.`,
    `Clan scope: ${clanScope}.`,
    `Player scope: ${playerScope}.`,
    `Rows: ${input.rowsConsidered} read · ${input.rowsMatched} after aggregate filters.`,
    `Latest timestamp: ${formatLatestEventAge(input.latestEventAt)}.`,
    'Persisted-only: no live Clash API lookup, search, backfill, or polling enrollment happens from `/stats`.',
  ].join('\n');
}

function formatStatsAppliedFilterLabels(input: {
  readonly clanLabel: string | undefined;
  readonly user: User | null;
  readonly playerTagCount: number;
  readonly starsOption: StarsOption | null;
  readonly attemptOption: AttemptOption | null;
  readonly days: number | null;
  readonly season: Date | null;
}): string[] {
  const labels: string[] = [];
  if (input.clanLabel) labels.push(`Clan: ${input.clanLabel}`);
  if (input.user) {
    labels.push(
      `User: ${escapeMarkdown(input.user.displayName)} (${input.playerTagCount} linked players matched as attacker tags)`,
    );
  }
  if (input.days) labels.push(`Detected since: last ${input.days} days`);
  if (input.season)
    labels.push(`Season boundary: since ${formatSeasonLabel(formatSeasonValue(input.season))}`);
  if (input.starsOption) labels.push(`Stars label: ${formatStarsOption(input.starsOption)}`);
  if (input.attemptOption) labels.push(`Attempt: ${formatAttemptOption(input.attemptOption)}`);
  return labels;
}

function buildStatsNoAttackEventsMessage(input: {
  readonly clanLabel: string | undefined;
  readonly user: User | null;
  readonly playerTagCount: number;
  readonly rowsConsidered: number;
  readonly starsOption: StarsOption | null;
  readonly attemptOption: AttemptOption | null;
  readonly days: number | null;
  readonly season: Date | null;
  readonly parityFilters: StatsParityFilters;
  readonly linkedClanCount?: number;
  readonly latestAttackAt: Date | null;
}): string {
  const filters = [
    ...formatStatsAppliedFilterLabels(input),
    ...formatStatsParityFilters(input.parityFilters),
  ];
  if (input.user) filters.push(`Linked player tags checked: ${input.playerTagCount}`);
  filters.push(`Linked clans in server: ${input.linkedClanCount ?? 0}`);
  const filterText = filters.length > 0 ? ` Active filters: ${filters.join(' · ')}.` : '';
  const nextHint =
    input.rowsConsidered > 0
      ? 'Try removing the user/clan/time/type/attempt filters or choose a wider season/days window; friendly, loot, farm, and clan-only parity labels are echoed but cannot narrow aggregate rows yet.'
      : 'Link/configure a clan in this server, make sure the user has linked players when using the user filter, let the war poller observe wars for the linked clan, and wait for war attack events to be persisted.';
  return `${STATS_NO_ATTACK_EVENTS_MESSAGE} Source: persisted war attack events for linked/configured clans only; no live Clash API lookup, search, historical backfill, or on-demand polling is performed. Rows considered: ${input.rowsConsidered}; latest stored attack: ${formatLatestEventAge(input.latestAttackAt)}.${filterText} ${nextHint}`;
}

function getLatestAttackAt(rows: readonly StatsWarAttackHistoryRow[]): Date | null {
  return rows.reduce<Date | null>((latest, row) => {
    if (!latest || row.lastAttackedAt.getTime() > latest.getTime()) return row.lastAttackedAt;
    return latest;
  }, null);
}

function getLatestDefenseAt(rows: readonly StatsWarDefenseHistoryRow[]): Date | null {
  return rows.reduce<Date | null>((latest, row) => {
    if (!latest || row.lastDefendedAt.getTime() > latest.getTime()) return row.lastDefendedAt;
    return latest;
  }, null);
}

function formatLatestEventAge(value: Date | null): string {
  return value ? time(value, 'R') : 'none available';
}

function buildStatsFooter(
  shown: number,
  total: number,
  days: number | null,
  season: Date | null,
): string {
  const filters = [
    ...(days ? [`last ${days} days`] : []),
    ...(season ? [`since ${formatSeasonLabel(formatSeasonValue(season))}`] : []),
  ];
  const window = filters.length > 0 ? ` filtered by ${filters.join(' and ')}` : '';
  return `Showing ${shown}/${total} attackers${window} from stored events`;
}

function readStarsOption(value: string | null): StarsOption | null {
  return value && STARS_OPTIONS.includes(value as StarsOption) ? (value as StarsOption) : null;
}

function readAttemptOption(value: string | null): AttemptOption | null {
  return value === 'fresh' || value === 'cleanup' ? value : null;
}

function readWarTypeOption(value: string | null): WarTypeOption | null {
  return value && WAR_TYPE_OPTIONS.includes(value as WarTypeOption)
    ? (value as WarTypeOption)
    : null;
}

function getStatsWarKeyFilters(value: WarTypeOption | null): {
  readonly warKeyPrefix?: string;
  readonly excludeWarKeyPrefix?: string;
} {
  if (value === 'cwl') return { warKeyPrefix: 'cwl:' };
  if (value === 'regular' || value === 'noCWL') return { excludeWarKeyPrefix: 'cwl:' };
  return {};
}

function readStatsParityFilters(interaction: ChatInputCommandInteraction): StatsParityFilters {
  return {
    season: readSeasonOption(interaction.options.getString('season')),
    type: readWarTypeOption(interaction.options.getString('type')),
    wars: interaction.options.getInteger('wars'),
    filterLootHits: interaction.options.getBoolean('filter_loot_hits'),
    filterFarmHits: interaction.options.getBoolean('filter_farm_hits'),
    clanOnly: interaction.options.getBoolean('clan_only'),
  };
}

function readSeasonOption(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  return value;
}

function parseSeasonSince(value: string | null): Date | null {
  if (!value) return null;
  const [yearText, monthText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

function getStatsHistorySince(days: number | null, season: Date | null): Date | undefined {
  const daysSince = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
  if (daysSince && season) return daysSince > season ? daysSince : season;
  return daysSince ?? season ?? undefined;
}

function formatStarsOption(value: StarsOption): string {
  return value.replace('==', '').replace('>=', '>= ');
}

function formatAttemptOption(value: AttemptOption): string {
  return value === 'fresh' ? 'Fresh' : 'Cleanup';
}

function formatWarTypeOption(value: WarTypeOption): string {
  const labels: Record<WarTypeOption, string> = {
    regular: 'Regular',
    cwl: 'CWL',
    friendly: 'Friendly',
    noFriendly: 'Regular and CWL',
    noCWL: 'No CWL',
    all: 'All',
  };
  return labels[value];
}

function formatStatsParityFilters(filters: StatsParityFilters): string[] {
  const labels: string[] = [];
  if (filters.type) labels.push(`Type: ${formatWarTypeOption(filters.type)}`);
  if (filters.wars) labels.push(`Wars: ${filters.wars}`);
  if (filters.filterLootHits !== null)
    labels.push(`Filter loot hits: ${formatBoolean(filters.filterLootHits)}`);
  if (filters.filterFarmHits !== null)
    labels.push(`Filter farm hits: ${formatBoolean(filters.filterFarmHits)}`);
  if (filters.clanOnly !== null) labels.push(`Clan only: ${formatBoolean(filters.clanOnly)}`);
  return labels;
}

function formatSeasonValue(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatBoolean(value: boolean): string {
  return value ? 'Yes' : 'No';
}

function getSeasonSinceChoices(): ApplicationCommandOptionChoiceData<string>[] {
  const choices: ApplicationCommandOptionChoiceData<string>[] = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  for (let index = 0; index < 12; index += 1) {
    const value = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    choices.push({ name: `Since ${formatSeasonLabel(value)}`, value });
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return choices;
}

function formatSeasonLabel(value: string): string {
  const [year, month] = value.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatNoLinkedPlayersMessage(user: User): string {
  return `**${escapeMarkdown(user.displayName)}** does not have linked player accounts. Use \`/link create\` first.`;
}

export function resolveStatsClan(
  clans: readonly StatsLinkedClan[],
  query: string,
): StatsLinkedClan | undefined {
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

function clanMatchesQuery(clan: StatsLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: StatsLinkedClan): string {
  const alias = clan.alias?.trim();
  const name = clan.name?.trim();
  const label = alias && name ? `${alias} — ${name}` : alias || name || 'Linked Clan';
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function compareStatsClanChoices(
  a: { readonly clan: StatsLinkedClan; readonly name: string; readonly value: string },
  b: { readonly clan: StatsLinkedClan; readonly name: string; readonly value: string },
  normalizedQuery: string,
): number {
  return (
    getClanChoiceMatchRank(a.clan, normalizedQuery) -
      getClanChoiceMatchRank(b.clan, normalizedQuery) ||
    a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }) ||
    a.clan.clanTag.localeCompare(b.clan.clanTag, 'en-US', { sensitivity: 'base' }) ||
    a.value.localeCompare(b.value, 'en-US', { sensitivity: 'base' }) ||
    a.clan.id.localeCompare(b.clan.id, 'en-US', { sensitivity: 'base' })
  );
}

function getClanChoiceMatchRank(clan: StatsLinkedClan, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const tag = clan.clanTag.toLowerCase();
  const tagWithoutHash = tag.replace(/^#/, '');
  const alias = clan.alias?.trim().toLowerCase() ?? '';
  const name = clan.name?.trim().toLowerCase() ?? '';
  if (alias === normalizedQuery || name === normalizedQuery || tag === normalizedQuery) return 0;
  if (tagWithoutHash === normalizedQuery.replace(/^#/, '')) return 0;
  if (alias.startsWith(normalizedQuery) || name.startsWith(normalizedQuery)) return 1;
  if (
    tag.startsWith(normalizedQuery) ||
    tagWithoutHash.startsWith(normalizedQuery.replace(/^#/, ''))
  ) {
    return 1;
  }
  return 2;
}

function isFirstStatsClanChoice(
  choice: { readonly clan: StatsLinkedClan; readonly value: string },
  index: number,
  choices: readonly { readonly clan: StatsLinkedClan; readonly value: string }[],
): boolean {
  const normalizedTag = choice.clan.clanTag.toLowerCase();
  const normalizedValue = choice.value.trim().toLowerCase();
  return (
    choices.findIndex(
      (candidate) =>
        candidate.clan.clanTag.toLowerCase() === normalizedTag ||
        candidate.value.trim().toLowerCase() === normalizedValue,
    ) === index
  );
}

function truncateEmbedDescription(text: string): string {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…`;
}
