import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
} from 'discord.js';

export const LEGEND_COMMAND_NAME = 'legend';
export const LEGEND_COMMAND_DESCRIPTION = 'Show persisted Legend League views for linked clans.';

const LEGEND_TROPHY_FLOOR = 5000;
const NEAR_LEGEND_TROPHY_FLOOR = 4900;
const LEGEND_SEASON_CHOICE_MONTHS = 18;
const LEGEND_SNAPSHOT_SOURCE_NOTE =
  'Uses persisted player/member snapshots from clans linked to this server.';
const LEGEND_HISTORY_UNAVAILABLE_NOTE =
  'ClashMate does not store Legend attack or day history yet, so attacks, defenses, day totals, trophy deltas, season archives, and end-of-day ranks are unavailable.';
const LEGEND_NO_LIVE_SOURCE_NOTE =
  'No live Clash API Legend lookup, external feed, export, auto-updating board, or polling enrollment is performed by this command.';
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

export const legendSeasonChoices = buildLegendSeasonChoices();

export const legendCommandData = new SlashCommandBuilder()
  .setName(LEGEND_COMMAND_NAME)
  .setDescription(LEGEND_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('attacks')
      .setDescription('Show snapshot-backed Legend attack diagnostics when available.')
      .addStringOption((option) =>
        option
          .setName('clans')
          .setDescription('Linked clan tag, name, or alias.')
          .setAutocomplete(true)
          .setRequired(false),
      )
      .addUserOption((option) =>
        option.setName('user').setDescription('Discord user to filter by.').setRequired(false),
      )
      .addNumberOption((option) =>
        option
          .setName('day')
          .setDescription(
            'Legend day number accepted for parity; stored attacks are not available yet.',
          )
          .setMinValue(1)
          .setMaxValue(35)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('days')
      .setDescription('Show snapshot-backed Legend day diagnostics when available.')
      .addStringOption((option) =>
        option
          .setName('player')
          .setDescription('Player tag or name from current linked-clan snapshots.')
          .setAutocomplete(true)
          .setRequired(false),
      )
      .addUserOption((option) =>
        option.setName('user').setDescription('Discord user to filter by.').setRequired(false),
      )
      .addNumberOption((option) =>
        option
          .setName('day')
          .setDescription(
            'Legend day number accepted for parity; stored days are not available yet.',
          )
          .setMinValue(1)
          .setMaxValue(35)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('leaderboard')
      .setDescription('Show a Legend leaderboard from current linked-clan member snapshots.')
      .addStringOption((option) =>
        option
          .setName('clans')
          .setDescription('Linked clan tag, name, or alias.')
          .setAutocomplete(true)
          .setRequired(false),
      )
      .addNumberOption((option) =>
        option
          .setName('limit')
          .setDescription('Number of players to show.')
          .setMinValue(3)
          .setMaxValue(100)
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('season')
          .setDescription('Season accepted for parity; current persisted snapshots are used.')
          .addChoices(...legendSeasonChoices)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('stats')
      .setDescription('Show a persisted Legend snapshot summary.')
      .addStringOption((option) =>
        option
          .setName('reference_date')
          .setDescription('Date accepted for parity; current persisted snapshots are used.')
          .setRequired(false),
      ),
  );

export interface LegendLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface LegendMemberSnapshotRow {
  readonly playerTag: string;
  readonly name: string;
  readonly leagueId: number | null;
  readonly leagueName: string | null;
  readonly trophies: number | null;
  readonly lastFetchedAt: Date;
}

export interface LegendClanSnapshots {
  readonly clan: LegendLinkedClan;
  readonly members: readonly LegendMemberSnapshotRow[];
}

export interface LegendStore {
  readonly listLinkedClans: (guildId: string) => Promise<LegendLinkedClan[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<LegendClanSnapshots[]>;
}

export interface LegendCommandOptions {
  readonly store: LegendStore;
}

type LegendSubcommand = 'attacks' | 'days' | 'leaderboard' | 'stats';

export function createLegendSlashCommand(options: LegendCommandOptions): SlashCommandDefinition {
  return {
    name: LEGEND_COMMAND_NAME,
    data: legendCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== LEGEND_COMMAND_NAME) return;
      await executeLegend(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== LEGEND_COMMAND_NAME) return;
      await autocompleteLegend(interaction, options);
    },
  };
}

async function autocompleteLegend(
  interaction: AutocompleteInteraction,
  options: LegendCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  try {
    if (focused.name === 'clans') {
      const clans = await options.store.listLinkedClans(interaction.guildId);
      await interaction.respond(filterLegendClanChoices(clans, String(focused.value ?? '')));
      return;
    }

    if (focused.name === 'player') {
      const snapshots = await options.store.listClanMemberSnapshotsForGuild({
        guildId: interaction.guildId,
      });
      await interaction.respond(filterLegendPlayerChoices(snapshots, String(focused.value ?? '')));
      return;
    }
  } catch {
    await interaction.respond([]);
    return;
  }

  await interaction.respond([]);
}

export async function executeLegend(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: LegendCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/legend` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const subcommand = interaction.options.getSubcommand() as LegendSubcommand;
  if (subcommand === 'attacks') {
    const clanOption = interaction.options.getString('clans');
    const clan = await resolveLegendClan(interaction.guildId, clanOption, options.store);
    if (clanOption && !clan) {
      await interaction.editReply({
        content:
          'I could not resolve that clan from linked clans in this server. Pick a linked clan from autocomplete or use its exact tag, name, or alias.',
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        buildLegendUnsupportedEmbed('Legend Attacks', {
          clan,
          userMention: interaction.options.getUser('user')?.toString() ?? null,
          day: interaction.options.getNumber('day'),
        }),
      ],
    });
    return;
  }
  if (subcommand === 'days') {
    const snapshots = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
    });
    const playerOption = interaction.options.getString('player');
    const player = resolveLegendPlayerSnapshot(snapshots, playerOption);
    if (playerOption && !player) {
      await interaction.editReply({
        content:
          'I could not resolve that player from current linked-clan member snapshots in this server. Pick a stored player from autocomplete or use its exact tag or name.',
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        buildLegendUnsupportedEmbed('Legend Days', {
          player,
          userMention: interaction.options.getUser('user')?.toString() ?? null,
          day: interaction.options.getNumber('day'),
        }),
      ],
    });
    return;
  }

  const clanOption = subcommand === 'leaderboard' ? interaction.options.getString('clans') : null;
  const clan = await resolveLegendClan(interaction.guildId, clanOption, options.store);
  if (clanOption && !clan) {
    await interaction.editReply({
      content:
        'I could not resolve that clan from linked clans in this server. Pick a linked clan from autocomplete or use its exact tag, name, or alias.',
    });
    return;
  }
  const snapshots = await options.store.listClanMemberSnapshotsForGuild({
    guildId: interaction.guildId,
    ...(clan ? { clanTag: clan.clanTag } : {}),
  });

  if (subcommand === 'stats') {
    const referenceDate = parseLegendReferenceDate(interaction.options.getString('reference_date'));
    await interaction.editReply({ embeds: [buildLegendStatsEmbed(snapshots, referenceDate)] });
    return;
  }

  const limit = Math.min(
    Math.max(Math.trunc(interaction.options.getNumber('limit') ?? 25), 3),
    100,
  );
  const season = interaction.options.getString('season');
  await interaction.editReply({
    embeds: [buildLegendLeaderboardEmbed(snapshots, limit, season, clan)],
  });
}

export function buildLegendLeaderboardEmbed(
  snapshots: readonly LegendClanSnapshots[],
  limit: number,
  season: string | null,
  clanFilter?: LegendLinkedClan | undefined,
): EmbedBuilder {
  const snapshotCoverage = summarizeLegendSnapshotCoverage(snapshots);
  const freshnessNote = formatLegendSnapshotFreshnessDetail(snapshotCoverage.latestFetchedAt);
  const rows = collectLegendRows(snapshots)
    .filter(
      (row) => row.member.trophies !== null && row.member.trophies >= NEAR_LEGEND_TROPHY_FLOOR,
    )
    .sort(
      (a, b) =>
        (b.member.trophies ?? -1) - (a.member.trophies ?? -1) ||
        a.member.name.localeCompare(b.member.name),
    );

  const embed = new EmbedBuilder()
    .setTitle('Legend Leaderboard')
    .setDescription(
      'Current snapshot leaderboard for linked-clan players at or near Legend League. This view is limited to persisted member snapshots only.',
    );

  embed.addFields({
    name: 'Data source',
    value: `${LEGEND_SNAPSHOT_SOURCE_NOTE} ${LEGEND_NO_LIVE_SOURCE_NOTE}`,
    inline: false,
  });

  embed.addFields({
    name: 'Rows considered',
    value: formatLegendSnapshotCoverage(snapshotCoverage),
    inline: false,
  });

  embed.addFields({
    name: 'Snapshot freshness',
    value: freshnessNote,
    inline: false,
  });

  embed.addFields({
    name: 'Accepted filters',
    value: formatLegendSnapshotFilterClarity(clanFilter),
    inline: false,
  });

  if (season)
    embed.addFields({
      name: 'Season',
      value: `${formatLegendSeasonSelection(season)} is accepted for command parity, but ClashMate currently shows the latest stored snapshots instead of a historical season board.`,
      inline: false,
    });

  embed.addFields({
    name: 'Snapshot scope',
    value:
      'Leaderboard output is limited to current linked-clan member snapshots that are at or near Legend League; live leaderboard, season history, and auto-updating views are unavailable.',
    inline: false,
  });

  embed.addFields({
    name: 'No live feed',
    value: LEGEND_NO_LIVE_SOURCE_NOTE,
    inline: false,
  });

  if (rows.length === 0) {
    return embed.addFields({
      name: 'No data',
      value:
        'No stored member snapshots at or near Legend League are available yet. Link/configure clans, wait for clan polling to store member trophies and league names, and try again after the next snapshot update.',
      inline: false,
    });
  }

  const coverage = countRowsWithStoredLeagueNames(rows);

  return embed
    .addFields({
      name: 'League coverage',
      value: `${coverage.toLocaleString()}/${rows.length.toLocaleString()} shown-candidate snapshots include stored league names; numeric league IDs are only shown when names are unavailable.`,
      inline: false,
    })
    .addFields({
      name: 'Players',
      value: rows
        .slice(0, limit)
        .map(
          (row, index) =>
            `${index + 1}. **${escapeMarkdown(row.member.name)}** (${row.member.playerTag}) · ${row.member.trophies?.toLocaleString()} trophies · ${escapeMarkdown(formatLegendLeague(row.member))} · ${escapeMarkdown(labelForLegendClan(row.clan))}`,
        )
        .join('\n'),
      inline: false,
    })
    .setFooter({ text: `Showing ${Math.min(rows.length, limit)}/${rows.length} snapshot players` });
}

interface LegendReferenceDateSelection {
  readonly raw: string | null;
  readonly parsed: Date | null;
}

export function buildLegendStatsEmbed(
  snapshots: readonly LegendClanSnapshots[],
  referenceDate: LegendReferenceDateSelection = { raw: null, parsed: null },
): EmbedBuilder {
  const snapshotCoverage = summarizeLegendSnapshotCoverage(snapshots);
  const freshnessNote = formatLegendSnapshotFreshnessDetail(snapshotCoverage.latestFetchedAt);
  const rows = collectLegendRows(snapshots).filter((row) => row.member.trophies !== null);
  const legendCount = rows.filter(
    (row) => (row.member.trophies ?? 0) >= LEGEND_TROPHY_FLOOR,
  ).length;
  const nearLegendCount = rows.filter(
    (row) =>
      (row.member.trophies ?? 0) >= NEAR_LEGEND_TROPHY_FLOOR &&
      (row.member.trophies ?? 0) < LEGEND_TROPHY_FLOOR,
  ).length;
  const leagueNameCoverage = countRowsWithStoredLeagueNames(rows);
  const top = [...rows].sort((a, b) => (b.member.trophies ?? -1) - (a.member.trophies ?? -1))[0];

  const embed = new EmbedBuilder()
    .setTitle('Legend Snapshot Stats')
    .setDescription('Summary of currently persisted linked-clan player/member snapshots.');

  embed.addFields({
    name: 'Data source',
    value: `${LEGEND_SNAPSHOT_SOURCE_NOTE} ${LEGEND_NO_LIVE_SOURCE_NOTE}`,
    inline: false,
  });

  embed.addFields({
    name: 'Rows considered',
    value: formatLegendSnapshotCoverage(snapshotCoverage),
    inline: false,
  });

  embed.addFields({
    name: 'Snapshot freshness',
    value: freshnessNote,
    inline: false,
  });

  embed.addFields({
    name: 'Reference date',
    value: formatLegendReferenceDate(referenceDate),
    inline: false,
  });

  embed.addFields({
    name: 'Snapshot scope',
    value:
      'Stats are limited to persisted current snapshots: trophy counts, legend thresholds, league labels, and freshness can be summarized, but day-by-day or end-of-season history is unavailable.',
    inline: false,
  });

  embed.addFields({
    name: 'No live feed',
    value: LEGEND_NO_LIVE_SOURCE_NOTE,
    inline: false,
  });

  if (rows.length === 0) {
    return embed.addFields({
      name: 'No data',
      value:
        'No stored member trophy snapshots are available yet. Link/configure clans, wait for clan polling to observe member trophies and league names, and retry after the next snapshot is stored.',
      inline: false,
    });
  }

  embed.addFields(
    { name: 'Snapshot players', value: rows.length.toLocaleString(), inline: true },
    { name: 'Legend League (≥ 5,000)', value: legendCount.toLocaleString(), inline: true },
    { name: 'Near Legend (4,900–4,999)', value: nearLegendCount.toLocaleString(), inline: true },
    {
      name: 'Stored league names',
      value: `${leagueNameCoverage.toLocaleString()}/${rows.length.toLocaleString()}`,
      inline: true,
    },
    {
      name: 'Current thresholds',
      value:
        'Counts use persisted snapshot trophies with Legend ≥ 5,000 and Near Legend 4,900–4,999; league labels prefer stored names over numeric IDs.',
      inline: false,
    },
  );

  if (top) {
    embed.addFields({
      name: 'Top stored player',
      value: `**${escapeMarkdown(top.member.name)}** (${top.member.playerTag}) · ${top.member.trophies?.toLocaleString()} trophies · ${escapeMarkdown(formatLegendLeague(top.member))} · ${escapeMarkdown(labelForLegendClan(top.clan))}`,
      inline: false,
    });
  }

  return embed;
}

interface LegendUnsupportedFilterContext {
  readonly clan?: LegendLinkedClan | undefined;
  readonly player?: LegendMemberSnapshotRow | undefined;
  readonly userMention?: string | null;
  readonly day?: number | null;
}

export function buildLegendUnsupportedEmbed(
  title: string,
  filterContext: LegendUnsupportedFilterContext = {},
): EmbedBuilder {
  const filterLines = formatLegendUnsupportedFilterLines(filterContext);
  const coverageLines = formatLegendUnsupportedCoverageLines(filterContext);
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      'This view is snapshot-backed only; ClashMate does not store Legend attack or day history yet.',
    );

  embed.addFields({
    name: 'Data source',
    value: `${LEGEND_SNAPSHOT_SOURCE_NOTE} Current snapshots are only used to resolve clan/player filters. ${LEGEND_NO_LIVE_SOURCE_NOTE}`,
    inline: false,
  });

  embed.addFields({
    name: 'Resolved filters',
    value: coverageLines.join('\n'),
    inline: false,
  });

  embed.addFields({
    name: 'Persisted history',
    value: LEGEND_HISTORY_UNAVAILABLE_NOTE,
    inline: false,
  });

  if (filterLines.length > 0) {
    embed.addFields({ name: 'Accepted filters', value: filterLines.join('\n'), inline: false });
  }

  return embed;
}

export function filterLegendClanChoices(
  clans: readonly LegendLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  const seen = new Set<string>();
  const choices: ApplicationCommandOptionChoiceData<string>[] = [];

  for (const clan of [...clans]
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .sort(compareLegendClanChoiceRows)) {
    const value = clan.alias ?? clan.clanTag;
    const dedupeKeys = [clan.clanTag.toLowerCase(), value.toLowerCase()];
    if (dedupeKeys.some((key) => seen.has(key))) continue;

    for (const key of dedupeKeys) seen.add(key);
    choices.push({ name: formatLegendClanChoiceName(clan), value });
    if (choices.length >= 25) break;
  }

  return choices;
}

export function filterLegendPlayerChoices(
  snapshots: readonly LegendClanSnapshots[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  const seen = new Set<string>();
  const choices: ApplicationCommandOptionChoiceData<string>[] = [];

  for (const row of collectLegendRows(snapshots)
    .filter((row) => {
      if (!normalizedQuery) return true;
      return (
        row.member.name.toLowerCase().includes(normalizedQuery) ||
        row.member.playerTag.toLowerCase().includes(normalizedQuery)
      );
    })
    .sort(compareLegendPlayerChoiceRows)) {
    const value = row.member.playerTag;
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    choices.push({
      name: `${row.member.name} (${row.member.playerTag})`,
      value,
    });
    if (choices.length >= 25) break;
  }

  return choices;
}

function compareLegendClanChoiceRows(a: LegendLinkedClan, b: LegendLinkedClan): number {
  return (
    labelForLegendClan(a).localeCompare(labelForLegendClan(b)) ||
    (a.alias ?? a.clanTag).localeCompare(b.alias ?? b.clanTag) ||
    a.clanTag.localeCompare(b.clanTag) ||
    a.id.localeCompare(b.id)
  );
}

function compareLegendPlayerChoiceRows(
  a: { readonly member: LegendMemberSnapshotRow; readonly clan: LegendLinkedClan },
  b: { readonly member: LegendMemberSnapshotRow; readonly clan: LegendLinkedClan },
): number {
  return (
    (b.member.trophies ?? -1) - (a.member.trophies ?? -1) ||
    a.member.name.localeCompare(b.member.name) ||
    a.member.playerTag.localeCompare(b.member.playerTag) ||
    a.clan.clanTag.localeCompare(b.clan.clanTag) ||
    a.clan.id.localeCompare(b.clan.id)
  );
}

async function resolveLegendClan(
  guildId: string,
  clanOption: string | null,
  store: LegendStore,
): Promise<LegendLinkedClan | undefined> {
  if (!clanOption) return undefined;
  const clans = await store.listLinkedClans(guildId);
  const normalizedOption = clanOption.trim().toLowerCase();
  const normalizedTag = tryNormalizeLegendTag(clanOption);
  return clans.find(
    (clan) =>
      (normalizedTag !== null && clan.clanTag === normalizedTag) ||
      clan.alias?.toLowerCase() === normalizedOption ||
      clan.name?.toLowerCase() === normalizedOption,
  );
}

function resolveLegendPlayerSnapshot(
  snapshots: readonly LegendClanSnapshots[],
  playerOption: string | null,
): LegendMemberSnapshotRow | undefined {
  if (!playerOption) return undefined;
  const normalizedOption = playerOption.trim().toLowerCase();
  const normalizedTag = tryNormalizeLegendTag(playerOption);
  return collectLegendRows(snapshots).find(
    (row) =>
      (normalizedTag !== null && row.member.playerTag === normalizedTag) ||
      row.member.name.toLowerCase() === normalizedOption,
  )?.member;
}

function tryNormalizeLegendTag(value: string): string | null {
  try {
    return normalizeClashTag(value);
  } catch {
    return null;
  }
}

function formatLegendUnsupportedFilterLines(
  filterContext: LegendUnsupportedFilterContext,
): string[] {
  const lines: string[] = [];
  if (filterContext.clan) {
    lines.push(
      `Clan: ${escapeMarkdown(labelForLegendClan(filterContext.clan))} (${filterContext.clan.clanTag})`,
    );
  }
  if (filterContext.player) {
    lines.push(
      `Player: ${escapeMarkdown(filterContext.player.name)} (${filterContext.player.playerTag}) · ${escapeMarkdown(formatLegendLeague(filterContext.player))}`,
    );
  }
  if (filterContext.userMention) lines.push(`User: ${filterContext.userMention}`);
  if (filterContext.day !== null && filterContext.day !== undefined) {
    lines.push(`Day: ${Math.trunc(filterContext.day).toLocaleString()}`);
  }
  return lines;
}

function collectLegendRows(snapshots: readonly LegendClanSnapshots[]) {
  return snapshots.flatMap((snapshot) =>
    snapshot.members.map((member) => ({ member, clan: snapshot.clan })),
  );
}

function countRowsWithStoredLeagueNames(
  rows: readonly { readonly member: LegendMemberSnapshotRow }[],
): number {
  return rows.filter((row) => hasStoredLeagueName(row.member)).length;
}

interface LegendSnapshotCoverage {
  readonly clans: number;
  readonly total: number;
  readonly withTrophies: number;
  readonly legend: number;
  readonly nearLegend: number;
  readonly latestFetchedAt: Date | null;
}

function summarizeLegendSnapshotCoverage(
  snapshots: readonly LegendClanSnapshots[],
): LegendSnapshotCoverage {
  const rows = collectLegendRows(snapshots);
  let withTrophies = 0;
  let legend = 0;
  let nearLegend = 0;
  let latestFetchedAt: Date | null = null;

  for (const row of rows) {
    const { trophies, lastFetchedAt } = row.member;
    if (latestFetchedAt === null || lastFetchedAt > latestFetchedAt)
      latestFetchedAt = lastFetchedAt;
    if (trophies === null) continue;
    withTrophies += 1;
    if (trophies >= LEGEND_TROPHY_FLOOR) legend += 1;
    if (trophies >= NEAR_LEGEND_TROPHY_FLOOR) nearLegend += 1;
  }

  return {
    clans: snapshots.length,
    total: rows.length,
    withTrophies,
    legend,
    nearLegend,
    latestFetchedAt,
  };
}

function formatLegendSnapshotCoverage(coverage: LegendSnapshotCoverage): string {
  const parts = [
    `${coverage.clans.toLocaleString()} linked clan${coverage.clans === 1 ? '' : 's'} considered`,
    `${coverage.total.toLocaleString()} member snapshots`,
    `${coverage.withTrophies.toLocaleString()} with trophies`,
    `${coverage.legend.toLocaleString()} Legend (≥ 5,000)`,
    `${coverage.nearLegend.toLocaleString()} near-Legend+ (≥ 4,900)`,
  ];

  if (coverage.latestFetchedAt) {
    parts.push(`latest ${formatLegendSnapshotFreshness(coverage.latestFetchedAt)}`);
  }

  return parts.join(' · ');
}

function formatLegendSnapshotFreshnessDetail(latestFetchedAt: Date | null): string {
  if (!latestFetchedAt) return 'No persisted snapshots are available yet.';
  return `Latest stored snapshot: ${formatLegendSnapshotFreshness(latestFetchedAt)}.`;
}

function formatLegendSnapshotFilterClarity(clanFilter?: LegendLinkedClan | undefined): string {
  if (!clanFilter) {
    return 'No clan filter provided; all currently linked clans with stored member snapshots for this server are considered.';
  }

  return `Clan filter: ${escapeMarkdown(labelForLegendClan(clanFilter))} (${clanFilter.clanTag}); only stored member snapshots for this linked clan are considered.`;
}

function formatLegendUnsupportedCoverageLines(
  filterContext: LegendUnsupportedFilterContext,
): string[] {
  const lines: string[] = [];
  if (filterContext.clan) {
    lines.push(
      `Clan filter resolved to ${escapeMarkdown(labelForLegendClan(filterContext.clan))} (${filterContext.clan.clanTag}).`,
    );
  } else {
    lines.push('Clan filter: none resolved from stored snapshots.');
  }

  if (filterContext.player) {
    lines.push(
      `Player filter resolved to ${escapeMarkdown(filterContext.player.name)} (${filterContext.player.playerTag}) · ${escapeMarkdown(formatLegendLeague(filterContext.player))}.`,
    );
  } else {
    lines.push('Player filter: none resolved from stored snapshots.');
  }

  if (filterContext.userMention) {
    lines.push(
      `User filter: ${filterContext.userMention}; no stored Legend history links Discord users to historical attacks or day totals.`,
    );
  }

  if (filterContext.day !== null && filterContext.day !== undefined) {
    lines.push(`Day filter: ${Math.trunc(filterContext.day).toLocaleString()} (parity-only).`);
  }

  return lines;
}

function formatLegendSnapshotFreshness(date: Date): string {
  const ageMs = Date.now() - date.getTime();
  const ageLabel = ageMs >= 0 ? ` (${formatLegendSnapshotAge(ageMs)} old)` : '';
  return `${date.toISOString()}${ageLabel}`;
}

function formatLegendSnapshotAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'less than 1m';
  if (minutes < 60) return `${minutes.toLocaleString()}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours.toLocaleString()}h`;
  return `${Math.floor(hours / 24).toLocaleString()}d`;
}

function hasStoredLeagueName(member: LegendMemberSnapshotRow): boolean {
  return (member.leagueName?.trim().length ?? 0) > 0;
}

function formatLegendLeague(member: LegendMemberSnapshotRow): string {
  const leagueName = member.leagueName?.trim();
  if (leagueName) return leagueName;
  if (member.leagueId !== null) return `League ID ${member.leagueId.toLocaleString()}`;
  return 'League unknown';
}

function clanMatchesQuery(clan: LegendLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.name, clan.alias].some((value) =>
    value?.toLowerCase().includes(normalizedQuery),
  );
}

function formatLegendClanChoiceName(clan: LegendLinkedClan): string {
  const label = labelForLegendClan(clan);
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function labelForLegendClan(clan: LegendLinkedClan): string {
  return clan.alias ?? clan.name ?? clan.clanTag;
}

export function buildLegendSeasonChoices(
  referenceDate = new Date(),
): ApplicationCommandOptionChoiceData<string>[] {
  const choices: ApplicationCommandOptionChoiceData<string>[] = [];
  const monthIndex = referenceDate.getUTCMonth();
  const year = referenceDate.getUTCFullYear();

  for (let offset = 0; offset < LEGEND_SEASON_CHOICE_MONTHS; offset += 1) {
    const date = new Date(Date.UTC(year, monthIndex - offset, 1));
    const seasonId = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    choices.push({
      name: `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      value: seasonId,
    });
  }

  return choices;
}

function formatLegendSeasonSelection(season: string): string {
  const choice = legendSeasonChoices.find((item) => item.value === season);
  if (!choice) return season;
  return `${choice.name} (${season})`;
}

function parseLegendReferenceDate(rawReferenceDate: string | null): LegendReferenceDateSelection {
  const raw = rawReferenceDate?.trim() ?? '';
  if (!raw) return { raw: null, parsed: null };

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return { raw, parsed: null };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return { raw, parsed: null };
  }

  return { raw, parsed };
}

function formatLegendReferenceDate(referenceDate: LegendReferenceDateSelection): string {
  const parityNote =
    'accepted for command parity; latest persisted member snapshots are used instead of historical end-of-day thresholds.';
  if (!referenceDate.raw) return `Not provided; ${parityNote}`;
  if (!referenceDate.parsed) {
    return `Unparsed label: ${escapeMarkdown(referenceDate.raw)}; ${parityNote}`;
  }

  return `${referenceDate.parsed.toISOString().slice(0, 10)} UTC; ${parityNote}`;
}
