import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
  time,
} from 'discord.js';

export const SUMMARY_COMMAND_NAME = 'summary';
export const SUMMARY_COMMAND_DESCRIPTION = 'Show persisted summaries for linked clans.';

const SUMMARY_ROW_LIMIT = 10;
const EMBED_DESCRIPTION_LIMIT = 4096;
const SUMMARY_SEASON_CHOICES = buildRecentSeasonChoices(new Date(), 12);
const SUMMARY_RAID_WEEK_CHOICES = buildRecentRaidWeekChoices(new Date(), 6);
const SUMMARY_RAID_WEEK_LABELS = new Map(
  SUMMARY_RAID_WEEK_CHOICES.map((choice) => [choice.value, choice.name]),
);

interface SummaryCoverageContext {
  readonly linkedClanCount: number;
  readonly consideredClanCount: number;
  readonly usableRowCount: number;
  readonly displayedRowCount?: number;
  readonly rowLimit?: number;
  readonly latestAt?: Date;
  readonly filters?: readonly string[];
}

export const summaryCommandData = new SlashCommandBuilder()
  .setName(SUMMARY_COMMAND_NAME)
  .setDescription(SUMMARY_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    addOrderOption(
      addLimitOption(
        addSeasonOption(
          addClansOption(
            subcommand.setName('best').setDescription('Summarize best donation rows.'),
          ),
        ),
      ),
    ),
  )
  .addSubcommand((subcommand) =>
    addClansOption(subcommand.setName('wars').setDescription('Summarize stored war status.')),
  )
  .addSubcommand((subcommand) =>
    addClansOption(subcommand.setName('clans').setDescription('Summarize linked clan snapshots.')),
  )
  .addSubcommand((subcommand) =>
    addSeasonOption(
      addClansOption(
        subcommand.setName('donations').setDescription('Summarize donation snapshots.'),
      ),
    ),
  )
  .addSubcommand((subcommand) =>
    addSeasonOption(
      addClansOption(
        subcommand.setName('activity').setDescription('Summarize member activity snapshots.'),
      ),
    ),
  )
  .addSubcommand((subcommand) =>
    addSeasonOption(
      addClansOption(
        subcommand.setName('attacks').setDescription('Summarize stored war attack history.'),
      ),
    ),
  )
  .addSubcommand((subcommand) =>
    addClansOption(subcommand.setName('compo').setDescription('Summarize town hall composition.')),
  )
  .addSubcommand((subcommand) =>
    addSeasonOption(
      addClansOption(subcommand.setName('cwl-ranks').setDescription('Summarize stored CWL ranks.')),
    ),
  )
  .addSubcommand((subcommand) =>
    addClansOption(subcommand.setName('cwl-status').setDescription('Summarize stored CWL status.')),
  )
  .addSubcommand((subcommand) =>
    addClansOption(subcommand.setName('leagues').setDescription('Summarize linked clan leagues.')),
  )
  .addSubcommand((subcommand) =>
    addLimitOption(
      addClansOption(subcommand.setName('trophies').setDescription('Summarize member trophies.')),
    ),
  )
  .addSubcommand((subcommand) =>
    addSeasonOption(
      addClansOption(subcommand.setName('war-results').setDescription('Summarize war results.')),
    ),
  )
  .addSubcommand((subcommand) =>
    addSeasonOption(
      addWarTypeOption(
        addClansOption(subcommand.setName('missed-wars').setDescription('Summarize missed wars.')),
      ),
    ),
  )
  .addSubcommand((subcommand) =>
    addWeekOption(
      addClansOption(
        subcommand.setName('capital-raids').setDescription('Summarize capital raids.'),
      ),
    ),
  )
  .addSubcommand((subcommand) =>
    addWeekOption(
      addSeasonOption(
        addClansOption(
          subcommand
            .setName('capital-contribution')
            .setDescription('Summarize capital contribution.'),
        ),
      ),
    ),
  )
  .addSubcommand((subcommand) =>
    addSeasonOption(
      addClansOption(subcommand.setName('clan-games').setDescription('Summarize clan games.')),
    ),
  );

function addClansOption(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder.addStringOption((option) =>
    option
      .setName('clans')
      .setDescription('Clan tag or name or alias.')
      .setAutocomplete(true)
      .setRequired(false),
  );
}

function addSeasonOption(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder.addStringOption((option) =>
    option
      .setName('season')
      .setDescription('Season identifier.')
      .addChoices(...SUMMARY_SEASON_CHOICES)
      .setRequired(false),
  );
}

function addLimitOption(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder.addIntegerOption((option) =>
    option
      .setName('limit')
      .setDescription('Number of rows to show.')
      .setMinValue(3)
      .setMaxValue(10)
      .setRequired(false),
  );
}

function addOrderOption(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder.addStringOption((option) =>
    option
      .setName('order')
      .setDescription('Sort order.')
      .addChoices({ name: 'Descending', value: 'desc' }, { name: 'Ascending', value: 'asc' })
      .setRequired(false),
  );
}

function addWarTypeOption(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder.addStringOption((option) =>
    option
      .setName('war_type')
      .setDescription('Regular, CWL or Friendly Wars (defaults to Regular)')
      .addChoices(
        { name: 'Regular', value: 'regular' },
        { name: 'CWL', value: 'cwl' },
        { name: 'Friendly', value: 'friendly' },
        { name: 'Regular and CWL', value: 'regular-and-cwl' },
      )
      .setRequired(false),
  );
}

function addWeekOption(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder.addStringOption((option) =>
    option
      .setName('week')
      .setDescription('Raid weekend identifier.')
      .addChoices(...SUMMARY_RAID_WEEK_CHOICES)
      .setRequired(false),
  );
}

function buildRecentSeasonChoices(
  now: Date,
  count: number,
): ApplicationCommandOptionChoiceData<string>[] {
  const choices: ApplicationCommandOptionChoiceData<string>[] = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  while (choices.length < count) {
    const seasonId = `${year}-${String(month + 1).padStart(2, '0')}`;
    choices.push({ name: formatSeasonChoiceName(year, month), value: seasonId });
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return choices;
}

function buildRecentRaidWeekChoices(
  now: Date,
  count: number,
): ApplicationCommandOptionChoiceData<string>[] {
  const choices: ApplicationCommandOptionChoiceData<string>[] = [];
  const friday = utcFridayForCurrentMonthEnd(now);
  while (choices.length < count) {
    if (friday.getTime() < now.getTime()) {
      choices.push({ name: formatRaidWeekChoiceName(friday), value: formatDateId(friday) });
    }
    friday.setUTCDate(friday.getUTCDate() - 7);
  }
  return choices;
}

function utcFridayForCurrentMonthEnd(now: Date): Date {
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  monthEnd.setUTCDate(monthEnd.getUTCDate() + (5 - monthEnd.getUTCDay()));
  return monthEnd;
}

function formatSeasonChoiceName(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month, 1)))
    .replace(',', '');
}

function formatRaidWeekChoiceName(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(date)
    .replace(',', '');
}

function formatDateId(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export interface SummaryLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface SummaryClanListRow extends SummaryLinkedClan {
  readonly categoryId: string | null;
  readonly sortOrder: number;
  readonly snapshot?: unknown;
}

export interface SummaryMemberSnapshotRow {
  readonly playerTag: string;
  readonly name: string;
  readonly donations?: number | null;
  readonly donationsReceived?: number | null;
  readonly trophies?: number | null;
  readonly lastSeenAt?: Date;
  readonly lastFetchedAt?: Date;
  readonly capitalContribution?: number | null;
  readonly capitalGold?: number | null;
}

export interface SummaryClanMemberSnapshots {
  readonly clan: SummaryLinkedClan;
  readonly members: readonly SummaryMemberSnapshotRow[];
}

export interface SummaryWarAttackHistoryRow {
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

export interface SummaryMissedWarAttackRow {
  readonly playerTag: string;
  readonly playerName: string;
  readonly clanTag: string;
  readonly clanName: string | null;
  readonly clanAlias: string | null;
  readonly eventCount: number;
  readonly warCount: number;
  readonly missedAttackCount: number;
  readonly latestOccurredAt: Date;
}

export interface SummaryStore {
  readonly listLinkedClans: (guildId: string) => Promise<SummaryLinkedClan[]>;
  readonly listClansForGuild: (guildId: string) => Promise<SummaryClanListRow[]>;
  readonly listDonationSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<SummaryClanMemberSnapshots[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<SummaryClanMemberSnapshots[]>;
  readonly listWarAttackHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
  }) => Promise<SummaryWarAttackHistoryRow[]>;
  readonly listMissedWarAttackSummaryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
  }) => Promise<SummaryMissedWarAttackRow[]>;
}

export interface SummaryCommandOptions {
  readonly store: SummaryStore;
}

export function createSummarySlashCommand(options: SummaryCommandOptions): SlashCommandDefinition {
  return {
    name: SUMMARY_COMMAND_NAME,
    data: summaryCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== SUMMARY_COMMAND_NAME) return;
      await executeSummary(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== SUMMARY_COMMAND_NAME) return;
      await autocompleteSummary(interaction, options);
    },
  };
}

async function autocompleteSummary(
  interaction: AutocompleteInteraction,
  options: SummaryCommandOptions,
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
    await interaction.respond(filterSummaryClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterSummaryClanChoices(
  clans: readonly SummaryLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  const choices: ApplicationCommandOptionChoiceData<string>[] = [];
  const seenAcceptedValues = new Set<string>();
  const seenClanTags = new Set<string>();

  for (const clan of [...clans]
    .filter((candidate) => clanMatchesQuery(candidate, normalizedQuery))
    .sort(compareSummaryClanChoices)) {
    const acceptedValue = clan.alias ?? clan.clanTag;
    const acceptedValueKey = acceptedValue.trim().toLowerCase();
    const clanTagKey = clan.clanTag.trim().toLowerCase();
    if (seenAcceptedValues.has(acceptedValueKey) || seenClanTags.has(clanTagKey)) continue;

    seenAcceptedValues.add(acceptedValueKey);
    seenClanTags.add(clanTagKey);
    choices.push({ name: formatClanChoiceName(clan), value: acceptedValue });
    if (choices.length === 25) break;
  }

  return choices;
}

export async function executeSummary(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: SummaryCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/summary` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const subcommand = interaction.options.getSubcommand();
  const clans = await options.store.listLinkedClans(interaction.guildId);
  const clanOption = interaction.options.getString('clans');
  const clan = clanOption ? resolveSummaryClan(clans, clanOption) : undefined;
  if (clanOption && !clan) {
    await interaction.editReply({ content: 'No linked clan was found for that clans option.' });
    return;
  }

  const clanTag = clan?.clanTag;
  const baseFilters = collectSummaryFilters(interaction, clan);
  if (subcommand === 'best') {
    const snapshots = await options.store.listDonationSnapshotsForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTag } : {}),
    });
    const limit = interaction.options.getInteger('limit') ?? SUMMARY_ROW_LIMIT;
    const order = interaction.options.getString('order') === 'asc' ? 'asc' : 'desc';
    await interaction.editReply(
      buildSummaryBestPayload(
        snapshots,
        limit,
        order,
        withRowLimit(buildSnapshotCoverage(clans.length, snapshots, baseFilters), limit),
      ),
    );
    return;
  }
  if (subcommand === 'clans') {
    const rows = await options.store.listClansForGuild(interaction.guildId);
    await interaction.editReply(
      buildSummaryClansPayload(
        clanTag ? rows.filter((row) => row.clanTag === clanTag) : rows,
        buildClanRowsCoverage(
          clans.length,
          clanTag ? rows.filter((row) => row.clanTag === clanTag) : rows,
          baseFilters,
        ),
      ),
    );
    return;
  }
  if (subcommand === 'donations') {
    const snapshots = await options.store.listDonationSnapshotsForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTag } : {}),
    });
    await interaction.editReply(
      buildSummaryDonationsPayload(
        snapshots,
        buildSnapshotCoverage(clans.length, snapshots, baseFilters),
      ),
    );
    return;
  }
  if (subcommand === 'activity') {
    const snapshots = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTag } : {}),
    });
    await interaction.editReply(
      buildSummaryActivityPayload(
        snapshots,
        buildSnapshotCoverage(clans.length, snapshots, baseFilters),
      ),
    );
    return;
  }
  if (subcommand === 'attacks') {
    const rows = await options.store.listWarAttackHistoryForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTags: [clanTag] } : {}),
    });
    await interaction.editReply(
      buildSummaryAttacksPayload(
        rows,
        buildRowsCoverage(
          clans.length,
          clanTag ? 1 : clans.length,
          rows.length,
          latestWarAttackAt(rows),
          baseFilters,
        ),
      ),
    );
    return;
  }
  if (subcommand === 'missed-wars') {
    const rows = await options.store.listMissedWarAttackSummaryForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTags: [clanTag] } : {}),
    });
    await interaction.editReply(
      buildSummaryMissedWarsPayload(
        rows,
        buildRowsCoverage(
          clans.length,
          clanTag ? 1 : clans.length,
          rows.length,
          latestMissedWarAttackAt(rows),
          baseFilters,
        ),
      ),
    );
    return;
  }
  if (subcommand === 'compo') {
    const rows = await options.store.listClansForGuild(interaction.guildId);
    await interaction.editReply(
      buildSummaryCompoPayload(
        clanTag ? rows.filter((row) => row.clanTag === clanTag) : rows,
        buildClanRowsCoverage(
          clans.length,
          clanTag ? rows.filter((row) => row.clanTag === clanTag) : rows,
          baseFilters,
        ),
      ),
    );
    return;
  }
  if (subcommand === 'trophies') {
    const snapshots = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTag } : {}),
    });
    await interaction.editReply(
      buildSummaryTrophiesPayload(
        snapshots,
        interaction.options.getInteger('limit') ?? SUMMARY_ROW_LIMIT,
        withRowLimit(
          buildSnapshotCoverage(clans.length, snapshots, baseFilters),
          interaction.options.getInteger('limit') ?? SUMMARY_ROW_LIMIT,
        ),
      ),
    );
    return;
  }
  if (subcommand === 'leagues') {
    const rows = await options.store.listClansForGuild(interaction.guildId);
    await interaction.editReply(
      buildSummaryLeaguesPayload(
        clanTag ? rows.filter((row) => row.clanTag === clanTag) : rows,
        buildClanRowsCoverage(
          clans.length,
          clanTag ? rows.filter((row) => row.clanTag === clanTag) : rows,
          baseFilters,
        ),
      ),
    );
    return;
  }
  if (subcommand === 'capital-raids') {
    const rows = await options.store.listClansForGuild(interaction.guildId);
    await interaction.editReply(
      buildSummaryCapitalRaidsPayload(
        clanTag ? rows.filter((row) => row.clanTag === clanTag) : rows,
        interaction.options.getString('week'),
        buildClanRowsCoverage(
          clans.length,
          clanTag ? rows.filter((row) => row.clanTag === clanTag) : rows,
          baseFilters,
        ),
      ),
    );
    return;
  }
  if (subcommand === 'capital-contribution') {
    const snapshots = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTag } : {}),
    });
    await interaction.editReply(
      buildSummaryCapitalContributionPayload(
        snapshots,
        interaction.options.getString('week'),
        buildSnapshotCoverage(clans.length, snapshots, baseFilters),
      ),
    );
    return;
  }

  await interaction.editReply({ content: unavailableSummaryMessage(subcommand, baseFilters) });
}

export function buildSummaryMissedWarsPayload(
  rows: readonly SummaryMissedWarAttackRow[],
  coverage?: SummaryCoverageContext,
): { content?: string; embeds?: EmbedBuilder[] } {
  if (rows.length === 0)
    return {
      content: noDataMessage('missed war attack events', coverage),
    };
  const sorted = [...rows].sort(
    (a, b) =>
      b.missedAttackCount - a.missedAttackCount ||
      b.eventCount - a.eventCount ||
      a.playerName.localeCompare(b.playerName),
  );
  const totals = rows.reduce(
    (acc, row) => ({
      missed: acc.missed + row.missedAttackCount,
      events: acc.events + row.eventCount,
      wars: acc.wars + row.warCount,
    }),
    { missed: 0, events: 0, wars: 0 },
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Missed War Summary')
        .setDescription(truncate(formatMissedWarRows(sorted)))
        .addFields(
          {
            name: 'Totals',
            value: `${totals.missed} missed attacks · ${totals.events} missed-player events · ${totals.wars} player-war records · ${rows.length} player/clan rows`,
            inline: false,
          },
          sourceField(
            'Missed-war source: persisted missed_war_attack_events derived by the war poller. Season and war_type are accepted for parity but are not applied because stored missed-war events are not season- or type-scoped yet.',
          ),
          coverageField(coverage),
        )
        .setFooter({
          text: `Showing ${Math.min(rows.length, SUMMARY_ROW_LIMIT)}/${rows.length} player/clan rows`,
        }),
    ],
  };
}

export function buildSummaryClansPayload(
  clans: readonly SummaryClanListRow[],
  coverage?: SummaryCoverageContext,
): {
  content?: string;
  embeds?: EmbedBuilder[];
} {
  if (clans.length === 0)
    return {
      content: noDataMessage('linked clan snapshot data', coverage),
    };
  const totalMembers = clans.reduce(
    (sum, clan) => sum + (readNumber(clan.snapshot, 'members') ?? 0),
    0,
  );
  const description = clans
    .slice(0, SUMMARY_ROW_LIMIT)
    .map(
      (clan, index) =>
        `${index + 1}. **${escapeMarkdown(clan.alias ?? clan.name ?? clan.clanTag)}** (\`${clan.clanTag}\`) · ${readNumber(clan.snapshot, 'members') ?? '?'} members · level ${readNumber(clan.snapshot, 'clanLevel') ?? '?'}`,
    )
    .join('\n');
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Clan Summary')
        .setDescription(truncate(description))
        .addFields(
          {
            name: 'Totals',
            value: `${clans.length} linked clans · ${totalMembers} observed members`,
            inline: false,
          },
          sourceField('Current linked-clan rows with their latest persisted clan snapshots.'),
          coverageField(coverage),
        ),
    ],
  };
}

export function buildSummaryBestPayload(
  snapshots: readonly SummaryClanMemberSnapshots[],
  limit: number,
  order: 'asc' | 'desc',
  coverage?: SummaryCoverageContext,
): { content?: string; embeds?: EmbedBuilder[] } {
  const members = snapshots.flatMap((snapshot) =>
    snapshot.members.map((member) => ({ ...member, clan: snapshot.clan })),
  );
  if (members.length === 0)
    return {
      content: noDataMessage('donation snapshot rows', coverage),
    };
  const direction = order === 'asc' ? -1 : 1;
  const sorted = [...members].sort(
    (a, b) =>
      direction *
      ((b.donations ?? 0) - (a.donations ?? 0) ||
        (b.donationsReceived ?? 0) - (a.donationsReceived ?? 0)),
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(order === 'asc' ? 'Lowest Donation Summary' : 'Best Donation Summary')
        .setDescription(truncate(formatDonationRows(sorted, clampSummaryLimit(limit))))
        .addFields(
          sourceField(
            'Donation source: current persisted clan member snapshots. Season is accepted for parity but not applied because historical season donation snapshots are not stored yet.',
          ),
          coverageField(coverage),
        )
        .setFooter({
          text: `Showing ${Math.min(sorted.length, clampSummaryLimit(limit))}/${sorted.length} members`,
        }),
    ],
  };
}

export function buildSummaryDonationsPayload(
  snapshots: readonly SummaryClanMemberSnapshots[],
  coverage?: SummaryCoverageContext,
): {
  content?: string;
  embeds?: EmbedBuilder[];
} {
  const members = snapshots.flatMap((snapshot) =>
    snapshot.members.map((member) => ({ ...member, clan: snapshot.clan })),
  );
  if (members.length === 0)
    return {
      content: noDataMessage('donation snapshot rows', coverage),
    };
  const sorted = [...members].sort(
    (a, b) =>
      (b.donations ?? 0) - (a.donations ?? 0) ||
      (b.donationsReceived ?? 0) - (a.donationsReceived ?? 0),
  );
  const donated = members.reduce((sum, member) => sum + (member.donations ?? 0), 0);
  const received = members.reduce((sum, member) => sum + (member.donationsReceived ?? 0), 0);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Donation Summary')
        .setDescription(truncate(formatDonationRows(sorted, SUMMARY_ROW_LIMIT)))
        .addFields(
          {
            name: 'Totals',
            value: `${donated} donated · ${received} received · ${members.length} members`,
            inline: false,
          },
          sourceField(
            'Donation source: current persisted clan member snapshots. Season is accepted for parity but not applied because historical season donation snapshots are not stored yet.',
          ),
          coverageField(coverage),
        ),
    ],
  };
}

export function buildSummaryActivityPayload(
  snapshots: readonly SummaryClanMemberSnapshots[],
  coverage?: SummaryCoverageContext,
): {
  content?: string;
  embeds?: EmbedBuilder[];
} {
  const members = snapshots.flatMap((snapshot) =>
    snapshot.members.map((member) => ({ ...member, clan: snapshot.clan })),
  );
  if (members.length === 0)
    return {
      content: noDataMessage('activity snapshot rows', coverage),
    };
  const sorted = [...members].sort(
    (a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0),
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Activity Summary')
        .setDescription(truncate(formatActivityRows(sorted)))
        .addFields(
          {
            name: 'Totals',
            value: `${members.length} observed members across ${snapshots.length} clans`,
            inline: false,
          },
          sourceField(
            'Current persisted member activity snapshots; season is accepted for parity but per-season activity history is not stored yet.',
          ),
          coverageField(coverage),
        ),
    ],
  };
}

export function buildSummaryAttacksPayload(
  rows: readonly SummaryWarAttackHistoryRow[],
  coverage?: SummaryCoverageContext,
): {
  content?: string;
  embeds?: EmbedBuilder[];
} {
  if (rows.length === 0)
    return {
      content: noDataMessage('war attack history rows', coverage),
    };
  const sorted = [...rows].sort(
    (a, b) => b.attackCount - a.attackCount || b.averageStars - a.averageStars,
  );
  const totals = rows.reduce(
    (acc, row) => ({
      attacks: acc.attacks + row.attackCount,
      stars: acc.stars + row.totalStars,
      fresh: acc.fresh + row.freshAttackCount,
    }),
    { attacks: 0, stars: 0, fresh: 0 },
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('War Attack Summary')
        .setDescription(truncate(formatAttackRows(sorted)))
        .addFields(
          {
            name: 'Totals',
            value: `${totals.attacks} attacks · ${totals.stars} stars · ${totals.fresh} fresh hits · ${rows.length} attackers`,
            inline: false,
          },
          sourceField(
            'War source: persisted war attack history rows derived from tracked linked clans. Season is accepted for parity but only reflected when the stored history source is already season-scoped.',
          ),
          coverageField(coverage),
        ),
    ],
  };
}

export function buildSummaryTrophiesPayload(
  snapshots: readonly SummaryClanMemberSnapshots[],
  limit: number,
  coverage?: SummaryCoverageContext,
): { content?: string; embeds?: EmbedBuilder[] } {
  const rows = snapshots
    .flatMap((snapshot) => snapshot.members.map((member) => ({ member, clan: snapshot.clan })))
    .filter((row) => row.member.trophies !== null && row.member.trophies !== undefined)
    .sort(
      (a, b) =>
        (b.member.trophies ?? -1) - (a.member.trophies ?? -1) ||
        a.member.name.localeCompare(b.member.name),
    );
  if (rows.length === 0)
    return {
      content: noDataMessage('member snapshot trophy rows', coverage),
    };
  const rowLimit = clampSummaryLimit(limit);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Trophy Summary')
        .setDescription(
          truncate(
            rows
              .slice(0, rowLimit)
              .map(
                (row, index) =>
                  `${index + 1}. **${escapeMarkdown(row.member.name)}** · ${row.member.trophies?.toLocaleString()} trophies · ${escapeMarkdown(row.clan.alias ?? row.clan.name ?? row.clan.clanTag)}`,
              )
              .join('\n'),
          ),
        )
        .addFields(
          sourceField('Current persisted member snapshots; no live player lookup is performed.'),
          coverageField(coverage),
        )
        .setFooter({ text: `Showing ${Math.min(rows.length, rowLimit)}/${rows.length} members` }),
    ],
  };
}

export function buildSummaryLeaguesPayload(
  clans: readonly SummaryClanListRow[],
  coverage?: SummaryCoverageContext,
): {
  content?: string;
  embeds?: EmbedBuilder[];
} {
  const rows = clans
    .map((clan) => ({
      clan,
      clanLeague: readNestedString(clan.snapshot, ['league', 'name']),
      warLeague: readNestedString(clan.snapshot, ['warLeague', 'name']),
      capitalLeague: readNestedString(clan.snapshot, ['capitalLeague', 'name']),
    }))
    .filter(
      (row) => row.clanLeague !== null || row.warLeague !== null || row.capitalLeague !== null,
    );
  if (rows.length === 0)
    return {
      content: noDataMessage('league fields in persisted clan snapshots', coverage),
    };
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('League Summary')
        .setDescription(
          truncate(
            rows
              .slice(0, SUMMARY_ROW_LIMIT)
              .map(
                (row, index) =>
                  `${index + 1}. **${escapeMarkdown(row.clan.alias ?? row.clan.name ?? row.clan.clanTag)}** · Clan ${escapeMarkdown(row.clanLeague ?? 'Unknown')} · War ${escapeMarkdown(row.warLeague ?? 'Unknown')} · Capital ${escapeMarkdown(row.capitalLeague ?? 'Unknown')}`,
              )
              .join('\n'),
          ),
        )
        .addFields(
          sourceField('League fields from current persisted linked-clan snapshots.'),
          coverageField(coverage),
        )
        .setFooter({
          text: `Showing ${Math.min(rows.length, SUMMARY_ROW_LIMIT)}/${rows.length} clans`,
        }),
    ],
  };
}

export function buildSummaryCapitalRaidsPayload(
  clans: readonly SummaryClanListRow[],
  week: string | null,
  coverage?: SummaryCoverageContext,
): { content?: string; embeds?: EmbedBuilder[] } {
  const rows = clans
    .map((clan) => ({
      clan,
      hall: readNestedNumber(clan.snapshot, ['clanCapital', 'capitalHallLevel']),
      league: readNestedString(clan.snapshot, ['capitalLeague', 'name']),
      points: readNumber(clan.snapshot, 'clanCapitalPoints'),
      trophies: readNumber(clan.snapshot, 'clanCapitalTrophies'),
    }))
    .filter(
      (row) =>
        row.hall !== undefined ||
        row.league !== null ||
        row.points !== undefined ||
        row.trophies !== undefined,
    )
    .sort(
      (a, b) =>
        (b.trophies ?? b.points ?? -1) - (a.trophies ?? a.points ?? -1) ||
        (b.hall ?? -1) - (a.hall ?? -1),
    );

  if (rows.length === 0)
    return {
      content: noDataMessage(
        'clan capital snapshot fields; raid-week attack logs are not persisted yet',
        coverage,
      ),
    };

  const weekNote = week?.trim()
    ? `Week label accepted but not filtered: ${formatRaidWeekFilter(week)}. `
    : '';

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Capital Raid Snapshot Summary')
        .setDescription(
          truncate(
            rows
              .slice(0, SUMMARY_ROW_LIMIT)
              .map(
                (row, index) =>
                  `${index + 1}. **${escapeMarkdown(row.clan.alias ?? row.clan.name ?? row.clan.clanTag)}** (\`${row.clan.clanTag}\`) · ${formatNumber(row.trophies ?? row.points)} capital trophies/points · Hall ${formatNumber(row.hall)} · ${escapeMarkdown(row.league ?? 'Unknown league')}`,
              )
              .join('\n'),
          ),
        )
        .addFields(
          {
            name: 'Source',
            value: `${weekNote}Capital source: current persisted linked-clan capital snapshot fields. Raid-week attack logs are not persisted in ClashMate yet.`,
            inline: false,
          },
          coverageField(coverage),
        )
        .setFooter({
          text: `Showing ${Math.min(rows.length, SUMMARY_ROW_LIMIT)}/${rows.length} clans · ${clans.length} total linked clans considered`,
        }),
    ],
  };
}

export function buildSummaryCapitalContributionPayload(
  snapshots: readonly SummaryClanMemberSnapshots[],
  week: string | null,
  coverage?: SummaryCoverageContext,
): { content?: string; embeds?: EmbedBuilder[] } {
  const members = snapshots.flatMap((snapshot) =>
    snapshot.members.map((member) => ({ member, clan: snapshot.clan })),
  );
  if (members.length === 0)
    return {
      content: noDataMessage('current member snapshots', coverage),
    };

  const rows = members
    .map((row) => ({
      ...row,
      capitalContribution: readMemberCapitalNumber(row.member, 'capitalContribution'),
      capitalGold: readMemberCapitalNumber(row.member, 'capitalGold'),
    }))
    .map((row) => ({
      ...row,
      sortValue: row.capitalContribution ?? row.capitalGold,
    }))
    .filter((row) => row.sortValue !== undefined)
    .sort(
      (a, b) =>
        (b.sortValue ?? -1) - (a.sortValue ?? -1) ||
        (b.capitalGold ?? -1) - (a.capitalGold ?? -1) ||
        a.member.name.localeCompare(b.member.name),
    );

  const capitalContributionRows = members.filter(
    (row) => readMemberCapitalNumber(row.member, 'capitalContribution') !== undefined,
  ).length;
  const capitalGoldRows = members.filter(
    (row) => readMemberCapitalNumber(row.member, 'capitalGold') !== undefined,
  ).length;

  if (rows.length === 0)
    return {
      content: noDataMessage(
        'derived raw snapshot fields `capitalContribution` or `capitalGold` in current member snapshots',
        coverage,
      ),
    };

  const weekNote = week?.trim()
    ? `Week label accepted but not filtered: ${formatRaidWeekFilter(week)}. `
    : '';
  const capitalContributionTotal = rows.reduce(
    (sum, row) => sum + (row.capitalContribution ?? 0),
    0,
  );
  const capitalGoldTotal = rows.reduce((sum, row) => sum + (row.capitalGold ?? 0), 0);

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Capital Contribution Summary')
        .setDescription(
          truncate(
            rows
              .slice(0, SUMMARY_ROW_LIMIT)
              .map(
                (row, index) =>
                  `${index + 1}. **${escapeMarkdown(row.member.name)}** · ${formatCapitalContributionValues(row.capitalContribution, row.capitalGold)} · ${escapeMarkdown(row.clan.alias ?? row.clan.name ?? row.clan.clanTag)}`,
              )
              .join('\n'),
          ),
        )
        .addFields(
          {
            name: 'Totals',
            value: `capitalContribution ${formatNumber(capitalContributionTotal)} · capitalGold ${formatNumber(capitalGoldTotal)} · ${rows.length} members with capital data`,
            inline: false,
          },
          {
            name: 'Source',
            value: `${weekNote}Capital source: current persisted member snapshot fields. Shows \`capitalContribution\` and \`capitalGold\` separately when available. Field coverage: capitalContribution ${capitalContributionRows}/${members.length}, capitalGold ${capitalGoldRows}/${members.length}. Raid-week contribution history is not persisted in ClashMate yet.`,
            inline: false,
          },
          coverageField(coverage),
        )
        .setFooter({
          text: `Showing ${Math.min(rows.length, SUMMARY_ROW_LIMIT)}/${rows.length} members · ${members.length} current members considered`,
        }),
    ],
  };
}

export function buildSummaryCompoPayload(
  clans: readonly SummaryClanListRow[],
  coverage?: SummaryCoverageContext,
): {
  content?: string;
  embeds?: EmbedBuilder[];
} {
  if (clans.length === 0)
    return {
      content: noDataMessage('linked clan snapshot data', coverage),
    };
  const rows = collectComposition(clans);
  if (rows.length === 0)
    return {
      content: noDataMessage('town hall levels in persisted clan snapshots', coverage),
    };
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const average = rows.reduce((sum, row) => sum + row.townHallLevel * row.count, 0) / total;
  const description = rows.map((row) => `TH${row.townHallLevel}: **${row.count}**`).join('\n');
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Town Hall Composition Summary')
        .setDescription(description)
        .addFields(
          {
            name: 'Totals',
            value: `${total} members · ${average.toFixed(2)} average TH`,
            inline: false,
          },
          sourceField('Town hall levels from current persisted clan memberList snapshots.'),
          coverageField(coverage),
        ),
    ],
  };
}

function formatDonationRows(
  rows: readonly (SummaryMemberSnapshotRow & { clan: SummaryLinkedClan })[],
  limit: number,
): string {
  return rows
    .slice(0, limit)
    .map(
      (row, index) =>
        `${index + 1}. **${escapeMarkdown(row.name)}** · ${row.donations ?? 0} donated · ${row.donationsReceived ?? 0} received · ${escapeMarkdown(row.clan.alias ?? row.clan.name ?? row.clan.clanTag)}`,
    )
    .join('\n');
}

function collectSummaryFilters(
  interaction: ChatInputCommandInteraction,
  clan: SummaryLinkedClan | undefined,
): readonly string[] {
  const filters: string[] = [];
  if (clan) filters.push(`clans: ${clan.alias ?? clan.name ?? clan.clanTag} (${clan.clanTag})`);
  const season = interaction.options.getString('season');
  if (season) filters.push(`season: ${season}`);
  const week = interaction.options.getString('week');
  if (week) filters.push(`week: ${formatRaidWeekFilter(week)}`);
  const warType = interaction.options.getString('war_type');
  if (warType) filters.push(`war_type: ${warType}`);
  const order = interaction.options.getString('order');
  if (order) filters.push(`order: ${order}`);
  const limit = interaction.options.getInteger('limit');
  if (limit !== null) filters.push(`limit: ${clampSummaryLimit(limit)}`);
  return filters;
}

function buildSnapshotCoverage(
  linkedClanCount: number,
  snapshots: readonly SummaryClanMemberSnapshots[],
  filters: readonly string[],
): SummaryCoverageContext {
  const members = snapshots.flatMap((snapshot) => snapshot.members);
  return buildRowsCoverage(
    linkedClanCount,
    snapshots.length,
    members.length,
    latestMemberSnapshotAt(members),
    filters,
  );
}

function buildClanRowsCoverage(
  linkedClanCount: number,
  clans: readonly SummaryClanListRow[],
  filters: readonly string[],
): SummaryCoverageContext {
  return buildRowsCoverage(
    linkedClanCount,
    clans.length,
    clans.filter((clan) => clan.snapshot !== undefined && clan.snapshot !== null).length,
    latestClanSnapshotAt(clans),
    filters,
  );
}

function buildRowsCoverage(
  linkedClanCount: number,
  consideredClanCount: number,
  usableRowCount: number,
  latestAt: Date | undefined,
  filters: readonly string[],
): SummaryCoverageContext {
  return {
    linkedClanCount,
    consideredClanCount,
    usableRowCount,
    ...(latestAt ? { latestAt } : {}),
    filters,
  };
}

function withRowLimit(
  coverage: SummaryCoverageContext,
  requestedLimit: number,
): SummaryCoverageContext {
  const rowLimit = clampSummaryLimit(requestedLimit);
  return {
    ...coverage,
    rowLimit,
    displayedRowCount: Math.min(coverage.usableRowCount, rowLimit),
  };
}

function coverageField(coverage: SummaryCoverageContext | undefined): {
  name: string;
  value: string;
  inline: false;
} {
  if (!coverage) {
    return {
      name: 'Coverage',
      value:
        'Source freshness unknown · accepted filters: none · visible/hidden rows depend on persisted snapshots/events only; no live Clash API lookup or polling enrollment.',
      inline: false,
    };
  }
  const rowLimit = coverage.rowLimit ?? SUMMARY_ROW_LIMIT;
  const displayedRowCount =
    coverage.displayedRowCount ?? Math.min(coverage.usableRowCount, rowLimit);
  const hiddenRowCount = Math.max(coverage.usableRowCount - displayedRowCount, 0);
  const parts = [
    `accepted filters: ${coverage.filters?.length ? coverage.filters.join('; ') : 'none'}`,
    `linked clans considered ${coverage.consideredClanCount}/${coverage.linkedClanCount}`,
    `visible rows ${displayedRowCount}/${coverage.usableRowCount}`,
    `hidden rows ${hiddenRowCount} by limit ${rowLimit}`,
    `freshest persisted row ${coverage.latestAt ? time(coverage.latestAt, 'R') : 'unknown'}`,
    'persisted-only; no live Clash API lookup or polling enrollment',
  ];
  return { name: 'Coverage', value: parts.join(' · '), inline: false };
}

function sourceField(value: string): { name: string; value: string; inline: false } {
  return { name: 'Source', value, inline: false };
}

function noDataMessage(subject: string, coverage: SummaryCoverageContext | undefined): string {
  const field = coverageField(coverage).value;
  return `No ${subject} are available for the accepted filters. ${field}. Guidance: link/configure clans with \`/setup clan\`, keep the relevant poller enabled, and wait for matching snapshots/events to be persisted.`;
}

function latestMemberSnapshotAt(members: readonly SummaryMemberSnapshotRow[]): Date | undefined {
  return latestDate(members.flatMap((member) => [member.lastFetchedAt, member.lastSeenAt]));
}

function latestWarAttackAt(rows: readonly SummaryWarAttackHistoryRow[]): Date | undefined {
  return latestDate(rows.map((row) => row.lastAttackedAt));
}

function latestMissedWarAttackAt(rows: readonly SummaryMissedWarAttackRow[]): Date | undefined {
  return latestDate(rows.map((row) => row.latestOccurredAt));
}

function latestClanSnapshotAt(clans: readonly SummaryClanListRow[]): Date | undefined {
  return latestDate(clans.flatMap((clan) => datesFromUnknown(clan.snapshot)));
}

function latestDate(dates: readonly (Date | undefined)[]): Date | undefined {
  return dates.reduce<Date | undefined>((latest, date) => {
    if (!date) return latest;
    if (!latest || date.getTime() > latest.getTime()) return date;
    return latest;
  }, undefined);
}

function datesFromUnknown(value: unknown): Date[] {
  if (!isRecord(value)) return [];
  return ['lastFetchedAt', 'fetchedAt', 'lastSeenAt', 'updatedAt']
    .map((key) => readDate(value[key]))
    .filter((date): date is Date => date !== undefined);
}

function readDate(value: unknown): Date | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function formatActivityRows(
  rows: readonly (SummaryMemberSnapshotRow & { clan: SummaryLinkedClan })[],
): string {
  return rows
    .slice(0, SUMMARY_ROW_LIMIT)
    .map(
      (row, index) =>
        `${index + 1}. **${escapeMarkdown(row.name)}** · ${row.lastSeenAt ? time(row.lastSeenAt, 'R') : 'unknown'} · ${escapeMarkdown(row.clan.alias ?? row.clan.name ?? row.clan.clanTag)}`,
    )
    .join('\n');
}

function formatAttackRows(rows: readonly SummaryWarAttackHistoryRow[]): string {
  return rows
    .slice(0, SUMMARY_ROW_LIMIT)
    .map(
      (row, index) =>
        `${index + 1}. **${escapeMarkdown(row.attackerName ?? row.attackerTag)}** · ${row.attackCount} attacks · ${row.averageStars.toFixed(2)} avg ⭐ · ${row.averageDestruction.toFixed(2)}% avg`,
    )
    .join('\n');
}

function formatMissedWarRows(rows: readonly SummaryMissedWarAttackRow[]): string {
  return rows
    .slice(0, SUMMARY_ROW_LIMIT)
    .map(
      (row, index) =>
        `${index + 1}. **${escapeMarkdown(row.playerName)}** · ${row.missedAttackCount} missed attacks · ${row.warCount} wars · ${escapeMarkdown(row.clanAlias ?? row.clanName ?? row.clanTag)} · latest ${time(row.latestOccurredAt, 'R')}`,
    )
    .join('\n');
}

function collectComposition(
  clans: readonly SummaryClanListRow[],
): Array<{ townHallLevel: number; count: number }> {
  const counts = new Map<number, number>();
  for (const clan of clans) {
    const memberList = readArray(clan.snapshot, 'memberList');
    for (const member of memberList) {
      const townHallLevel = readNumber(member, 'townHallLevel');
      if (typeof townHallLevel !== 'number' || !Number.isInteger(townHallLevel)) continue;
      counts.set(townHallLevel, (counts.get(townHallLevel) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([townHallLevel, count]) => ({ townHallLevel, count }))
    .sort((a, b) => b.townHallLevel - a.townHallLevel);
}

export function resolveSummaryClan(
  clans: readonly SummaryLinkedClan[],
  query: string,
): SummaryLinkedClan | undefined {
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

function clanMatchesQuery(clan: SummaryLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function compareSummaryClanChoices(a: SummaryLinkedClan, b: SummaryLinkedClan): number {
  return (
    formatClanChoiceName(a).localeCompare(formatClanChoiceName(b), 'en-US', {
      sensitivity: 'base',
      numeric: true,
    }) || a.clanTag.localeCompare(b.clanTag, 'en-US')
  );
}

function formatClanChoiceName(clan: SummaryLinkedClan): string {
  const name = clan.name?.trim();
  const alias = clan.alias?.trim();
  const primary = alias || name || clan.clanTag;
  const context = alias && name && alias.toLowerCase() !== name.toLowerCase() ? ` — ${name}` : '';
  return `${primary}${context} (${clan.clanTag})`.slice(0, 100);
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[key];
  return typeof candidate === 'number' ? candidate : undefined;
}

function readArray(value: unknown, key: string): readonly unknown[] {
  if (!isRecord(value)) return [];
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : [];
}

function readNestedNumber(value: unknown, path: readonly string[]): number | undefined {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : undefined;
}

function readNestedString(value: unknown, path: readonly string[]): string | null {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === 'string' && current.trim() ? current : null;
}

function formatRaidWeekFilter(week: string): string {
  const trimmed = week.trim();
  const label = SUMMARY_RAID_WEEK_LABELS.get(trimmed);
  return label ? `${label} (${trimmed})` : trimmed;
}

function readMemberCapitalNumber(
  member: SummaryMemberSnapshotRow,
  key: 'capitalContribution' | 'capitalGold',
): number | undefined {
  const value = member[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatCapitalContributionValues(
  capitalContribution: number | undefined,
  capitalGold: number | undefined,
): string {
  return [
    capitalContribution === undefined
      ? undefined
      : `capitalContribution ${formatNumber(capitalContribution)}`,
    capitalGold === undefined ? undefined : `capitalGold ${formatNumber(capitalGold)}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? 'Unknown' : value.toLocaleString('en-US');
}

function clampSummaryLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 3), SUMMARY_ROW_LIMIT);
}

function unavailableSummaryMessage(subcommand: string, filters: readonly string[]): string {
  const filterText = filters.length ? filters.join('; ') : 'none';
  return `Stored data for \`/summary ${subcommand}\` is not available for the accepted filters (${filterText}) yet. This command only uses persisted ClashMate snapshots/events, will not call the Clash API live, and will not invent historical season, raid-week, or capital data. Link/configure clans and wait for the matching poller history before retrying.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function truncate(text: string): string {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…`;
}
