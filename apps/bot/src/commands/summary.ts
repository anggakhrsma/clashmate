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

function getSummarySeasonRange(
  season: string | null,
): { readonly start: Date; readonly end: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(season?.trim() ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { start, end };
}

function getSummaryWarKeyFilters(warType: string | null): {
  readonly warKeyPrefix?: string;
  readonly excludeWarKeyPrefix?: string;
} {
  if (warType === 'cwl') return { warKeyPrefix: 'cwl:' };
  if (warType === 'regular') return { excludeWarKeyPrefix: 'cwl:' };
  return {};
}

function getSummaryRaidWeekRange(
  week: string | null,
): { readonly start: Date; readonly end: Date } | null {
  if (!week?.trim()) return null;
  const start = new Date(`${week.trim()}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { start, end };
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

export interface SummaryDonationHistoryRow {
  readonly playerTag: string;
  readonly playerName: string;
  readonly donated: number;
  readonly received: number;
  readonly eventCount: number;
  readonly lastDetectedAt: Date;
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

export interface SummaryCapitalRaidSeasonMemberRow {
  readonly playerTag: string;
  readonly playerName: string;
  readonly attacks: number;
  readonly attackLimit: number;
  readonly bonusAttackLimit: number;
  readonly capitalResourcesLooted: number;
}

export interface SummaryCapitalRaidSeasonRow {
  readonly clanTag: string;
  readonly seasonKey: string;
  readonly state: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly capitalTotalLoot: number;
  readonly raidsCompleted: number;
  readonly totalAttacks: number;
  readonly enemyDistrictsDestroyed: number;
  readonly offensiveReward: number;
  readonly defensiveReward: number;
  readonly sourceFetchedAt: Date;
  readonly members: readonly SummaryCapitalRaidSeasonMemberRow[];
}

export interface SummaryWarSnapshotRecord {
  readonly clanTag: string;
  readonly state: string;
  readonly snapshot: unknown;
  readonly fetchedAt: Date;
  readonly warKey?: string;
  readonly trackedClan?: SummaryLinkedClan;
}

export interface SummaryStore {
  readonly listLinkedClans: (guildId: string) => Promise<SummaryLinkedClan[]>;
  readonly listClansForGuild: (guildId: string) => Promise<SummaryClanListRow[]>;
  readonly listDonationSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<SummaryClanMemberSnapshots[]>;
  readonly listDonationHistoryForGuild?: (input: {
    guildId: string;
    clanTags?: readonly string[];
    playerTags?: readonly string[];
    since?: Date;
    until?: Date;
  }) => Promise<SummaryDonationHistoryRow[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<SummaryClanMemberSnapshots[]>;
  readonly listWarAttackHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    warKeyPrefix?: string;
    excludeWarKeyPrefix?: string;
    since?: Date;
    until?: Date;
  }) => Promise<SummaryWarAttackHistoryRow[]>;
  readonly getLatestWarSnapshotsForGuild?: (guildId: string) => Promise<SummaryWarSnapshotRecord[]>;
  readonly listRetainedEndedWarSnapshotsForGuild?: (input: {
    guildId: string;
    clanTag?: string;
    since?: Date;
    until?: Date;
    limit?: number;
  }) => Promise<SummaryWarSnapshotRecord[]>;
  readonly listMissedWarAttackSummaryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    warKeyPrefix?: string;
    excludeWarKeyPrefix?: string;
    since?: Date;
    until?: Date;
  }) => Promise<SummaryMissedWarAttackRow[]>;
  readonly listCapitalRaidSeasonsForGuild?: (input: {
    guildId: string;
    clanTag?: string;
    weekStart?: Date;
    weekEnd?: Date;
    limit?: number;
  }) => Promise<SummaryCapitalRaidSeasonRow[]>;
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
  const seasonRange = getSummarySeasonRange(interaction.options.getString('season'));
  if (subcommand === 'best') {
    if (seasonRange && options.store.listDonationHistoryForGuild) {
      const rows = await options.store.listDonationHistoryForGuild({
        guildId: interaction.guildId,
        ...(clanTag ? { clanTags: [clanTag] } : {}),
        since: seasonRange.start,
        until: seasonRange.end,
      });
      const limit = interaction.options.getInteger('limit') ?? SUMMARY_ROW_LIMIT;
      const order = interaction.options.getString('order') === 'asc' ? 'asc' : 'desc';
      await interaction.editReply(
        buildSummaryDonationHistoryPayload(
          rows,
          limit,
          order,
          withRowLimit(
            buildRowsCoverage(
              clans.length,
              clanTag ? 1 : clans.length,
              rows.length,
              latestDonationHistoryAt(rows),
              baseFilters,
            ),
            limit,
          ),
          order === 'asc' ? 'Lowest Donation History Summary' : 'Best Donation History Summary',
        ),
      );
      return;
    }
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
    if (seasonRange && options.store.listDonationHistoryForGuild) {
      const rows = await options.store.listDonationHistoryForGuild({
        guildId: interaction.guildId,
        ...(clanTag ? { clanTags: [clanTag] } : {}),
        since: seasonRange.start,
        until: seasonRange.end,
      });
      await interaction.editReply(
        buildSummaryDonationHistoryPayload(
          rows,
          SUMMARY_ROW_LIMIT,
          'desc',
          buildRowsCoverage(
            clans.length,
            clanTag ? 1 : clans.length,
            rows.length,
            latestDonationHistoryAt(rows),
            baseFilters,
          ),
          'Donation History Summary',
        ),
      );
      return;
    }
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
  if (subcommand === 'cwl-ranks') {
    const seasonRange = getSummarySeasonRange(interaction.options.getString('season'));
    const rows = await options.store.listWarAttackHistoryForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTags: [clanTag] } : {}),
      warKeyPrefix: 'cwl:',
      ...(seasonRange ? { since: seasonRange.start, until: seasonRange.end } : {}),
    });
    await interaction.editReply(
      buildSummaryCwlRanksPayload(
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
  if (subcommand === 'cwl-status') {
    if (!options.store.getLatestWarSnapshotsForGuild) {
      await interaction.editReply({ content: unavailableSummaryMessage(subcommand, baseFilters) });
      return;
    }
    const snapshots = (await options.store.getLatestWarSnapshotsForGuild(interaction.guildId))
      .filter((snapshot) => !clanTag || snapshot.clanTag === clanTag)
      .filter(isSummaryCwlSnapshot);
    await interaction.editReply(
      buildSummaryCwlStatusPayload(
        snapshots,
        buildRowsCoverage(
          clans.length,
          clanTag ? 1 : clans.length,
          snapshots.length,
          latestWarSnapshotAt(snapshots),
          baseFilters,
        ),
      ),
    );
    return;
  }
  if (subcommand === 'missed-wars') {
    const seasonRange = getSummarySeasonRange(interaction.options.getString('season'));
    const warKeyFilters = getSummaryWarKeyFilters(interaction.options.getString('war_type'));
    const rows = await options.store.listMissedWarAttackSummaryForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTags: [clanTag] } : {}),
      ...warKeyFilters,
      ...(seasonRange ? { since: seasonRange.start, until: seasonRange.end } : {}),
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
  if (subcommand === 'war-results') {
    if (!options.store.listRetainedEndedWarSnapshotsForGuild) {
      await interaction.editReply({ content: unavailableSummaryMessage(subcommand, baseFilters) });
      return;
    }
    const seasonRange = getSummarySeasonRange(interaction.options.getString('season'));
    const snapshots = await options.store.listRetainedEndedWarSnapshotsForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTag } : {}),
      ...(seasonRange ? { since: seasonRange.start, until: seasonRange.end } : {}),
      limit: 100,
    });
    await interaction.editReply(
      buildSummaryWarResultsPayload(
        snapshots,
        buildRowsCoverage(
          clans.length,
          clanTag ? 1 : clans.length,
          snapshots.length,
          latestWarSnapshotAt(snapshots),
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
    const weekRange = getSummaryRaidWeekRange(interaction.options.getString('week'));
    if (options.store.listCapitalRaidSeasonsForGuild) {
      const seasons = await options.store.listCapitalRaidSeasonsForGuild({
        guildId: interaction.guildId,
        ...(clanTag ? { clanTag } : {}),
        ...(weekRange ? { weekStart: weekRange.start, weekEnd: weekRange.end } : {}),
        limit: 50,
      });
      if (seasons.length > 0 || weekRange) {
        await interaction.editReply(
          buildSummaryCapitalRaidSeasonsPayload(
            seasons,
            interaction.options.getString('week'),
            buildRowsCoverage(
              clans.length,
              clanTag ? 1 : clans.length,
              seasons.length,
              latestCapitalRaidSeasonAt(seasons),
              baseFilters,
            ),
          ),
        );
        return;
      }
    }

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
    const weekRange = getSummaryRaidWeekRange(interaction.options.getString('week'));
    if (options.store.listCapitalRaidSeasonsForGuild) {
      const seasons = await options.store.listCapitalRaidSeasonsForGuild({
        guildId: interaction.guildId,
        ...(clanTag ? { clanTag } : {}),
        ...(weekRange ? { weekStart: weekRange.start, weekEnd: weekRange.end } : {}),
        limit: 50,
      });
      if (seasons.length > 0 || weekRange) {
        await interaction.editReply(
          buildSummaryCapitalRaidContributionSeasonsPayload(
            seasons,
            interaction.options.getString('week'),
            buildRowsCoverage(
              clans.length,
              clanTag ? 1 : clans.length,
              seasons.reduce((sum, season) => sum + season.members.length, 0),
              latestCapitalRaidSeasonAt(seasons),
              baseFilters,
            ),
          ),
        );
        return;
      }
    }

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
            'Missed-war source: persisted missed_war_attack_events derived by the war poller. Season filters use stored missed-event occurrence times; regular/CWL filters use persisted war keys. Friendly war labels remain reference-parity only.',
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
            'Donation source: current persisted clan member snapshots; season filters use persisted donation history rows when available and current snapshots otherwise.',
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
            'Donation source: current persisted clan member snapshots; season filters use persisted donation history rows when available and current snapshots otherwise.',
          ),
          coverageField(coverage),
        ),
    ],
  };
}

export function buildSummaryDonationHistoryPayload(
  rows: readonly SummaryDonationHistoryRow[],
  limit: number,
  order: 'asc' | 'desc',
  coverage?: SummaryCoverageContext,
  title = 'Donation History Summary',
): { content?: string; embeds?: EmbedBuilder[] } {
  if (rows.length === 0)
    return {
      content: noDataMessage('donation history rows', coverage),
    };

  const direction = order === 'asc' ? -1 : 1;
  const sorted = [...rows].sort(
    (a, b) =>
      direction * ((b.donated ?? 0) - (a.donated ?? 0) || (b.received ?? 0) - (a.received ?? 0)),
  );
  const donated = rows.reduce((sum, row) => sum + row.donated, 0);
  const received = rows.reduce((sum, row) => sum + row.received, 0);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(truncate(formatDonationHistoryRows(sorted, clampSummaryLimit(limit))))
        .addFields(
          {
            name: 'Totals',
            value: `${donated} donated · ${received} received · ${rows.length} members`,
            inline: false,
          },
          sourceField(
            'Donation source: persisted donation history rows derived from tracked linked clans. Season filters use stored donation event times; no live Clash API lookup or backfill is performed.',
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
            'Current persisted member activity snapshots; per-season activity history is not stored yet.',
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

export function buildSummaryCwlRanksPayload(
  rows: readonly SummaryWarAttackHistoryRow[],
  coverage?: SummaryCoverageContext,
): { content?: string; embeds?: EmbedBuilder[] } {
  if (rows.length === 0)
    return {
      content: noDataMessage('CWL-keyed war attack history rows', coverage),
    };

  const sorted = [...rows].sort(
    (a, b) =>
      b.totalStars - a.totalStars ||
      b.attackCount - a.attackCount ||
      b.averageDestruction - a.averageDestruction,
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
        .setTitle('CWL Rank Summary')
        .setDescription(truncate(formatAttackRows(sorted)))
        .addFields(
          {
            name: 'Totals',
            value: `${totals.attacks} CWL-keyed attacks · ${totals.stars} stars · ${totals.fresh} fresh hits · ${rows.length} attackers`,
            inline: false,
          },
          sourceField(
            'CWL rank source: persisted war attack history rows whose war keys start with `cwl:`. Older CWL rows captured before CWL war keys existed may be absent; no live Clash API lookup or polling enrollment is performed.',
          ),
          coverageField(coverage),
        ),
    ],
  };
}

export function buildSummaryCwlStatusPayload(
  snapshots: readonly SummaryWarSnapshotRecord[],
  coverage?: SummaryCoverageContext,
): { content?: string; embeds?: EmbedBuilder[] } {
  if (snapshots.length === 0)
    return {
      content: noDataMessage('current CWL war snapshots', coverage),
    };

  const sorted = [...snapshots].sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
  const stateCounts = countSummaryWarStates(sorted);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('CWL Status Summary')
        .setDescription(truncate(formatCwlStatusRows(sorted)))
        .addFields(
          {
            name: 'States',
            value: formatStateCounts(stateCounts),
            inline: false,
          },
          sourceField(
            'CWL status source: latest persisted current-war snapshots that expose a CWL war tag/key. This is current retained status only; no live Clash API lookup, backfill, or polling enrollment is performed.',
          ),
          coverageField(coverage),
        )
        .setFooter({
          text: `Showing ${Math.min(sorted.length, SUMMARY_ROW_LIMIT)}/${sorted.length} CWL snapshots`,
        }),
    ],
  };
}

export function buildSummaryWarResultsPayload(
  snapshots: readonly SummaryWarSnapshotRecord[],
  coverage?: SummaryCoverageContext,
): { content?: string; embeds?: EmbedBuilder[] } {
  if (snapshots.length === 0)
    return {
      content: noDataMessage('retained ended war snapshots', coverage),
    };

  const rows = snapshots.map(buildWarResultSummaryRow).sort((a, b) => {
    const outcomeOrder = resultSortWeight(b.result) - resultSortWeight(a.result);
    return outcomeOrder || b.fetchedAt.getTime() - a.fetchedAt.getTime();
  });
  const totals = countWarResults(rows);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('War Results Summary')
        .setDescription(truncate(formatWarResultRows(rows)))
        .addFields(
          {
            name: 'Totals',
            value: `wins ${totals.win} · losses ${totals.loss} · ties ${totals.tie} · unknown ${totals.unknown} · ${rows.length} retained wars`,
            inline: false,
          },
          sourceField(
            'War-results source: retained ended war snapshots captured by the war poller for linked clans. Season filters use stored snapshot fetch times; no live Clash API lookup, backfill, or polling enrollment is performed.',
          ),
          coverageField(coverage),
        )
        .setFooter({
          text: `Showing ${Math.min(rows.length, SUMMARY_ROW_LIMIT)}/${rows.length} retained wars`,
        }),
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

export function buildSummaryCapitalRaidSeasonsPayload(
  seasons: readonly SummaryCapitalRaidSeasonRow[],
  week: string | null,
  coverage?: SummaryCoverageContext,
): { content?: string; embeds?: EmbedBuilder[] } {
  if (seasons.length === 0)
    return {
      content: noDataMessage('stored capital raid seasons', coverage),
    };

  const totals = seasons.reduce(
    (acc, season) => ({
      loot: acc.loot + season.capitalTotalLoot,
      raids: acc.raids + season.raidsCompleted,
      attacks: acc.attacks + season.totalAttacks,
      districts: acc.districts + season.enemyDistrictsDestroyed,
    }),
    { loot: 0, raids: 0, attacks: 0, districts: 0 },
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Capital Raid Season Summary')
        .setDescription(truncate(formatCapitalRaidSeasonRows(seasons)))
        .addFields(
          {
            name: 'Totals',
            value: `${formatNumber(totals.loot)} loot · ${totals.raids} raids completed · ${totals.attacks} attacks · ${totals.districts} districts destroyed`,
            inline: false,
          },
          sourceField(
            `${week?.trim() ? `Week filter: ${formatRaidWeekFilter(week)}. ` : ''}Capital raid source: persisted raid seasons and raid member rows captured by clan polling; no live Clash API lookup or polling enrollment is performed.`,
          ),
          coverageField(coverage),
        )
        .setFooter({
          text: `Showing ${Math.min(seasons.length, SUMMARY_ROW_LIMIT)}/${seasons.length} raid seasons`,
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

export function buildSummaryCapitalRaidContributionSeasonsPayload(
  seasons: readonly SummaryCapitalRaidSeasonRow[],
  week: string | null,
  coverage?: SummaryCoverageContext,
): { content?: string; embeds?: EmbedBuilder[] } {
  const rows = seasons
    .flatMap((season) => season.members.map((member) => ({ ...member, season })))
    .sort(
      (a, b) =>
        b.capitalResourcesLooted - a.capitalResourcesLooted ||
        b.attacks - a.attacks ||
        a.playerName.localeCompare(b.playerName),
    );

  if (rows.length === 0)
    return {
      content: noDataMessage('stored capital raid member rows', coverage),
    };

  const totals = rows.reduce(
    (acc, row) => ({
      loot: acc.loot + row.capitalResourcesLooted,
      attacks: acc.attacks + row.attacks,
    }),
    { loot: 0, attacks: 0 },
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Capital Raid Contribution Summary')
        .setDescription(truncate(formatCapitalRaidContributionSeasonRows(rows)))
        .addFields(
          {
            name: 'Totals',
            value: `${formatNumber(totals.loot)} capital loot · ${totals.attacks} attacks · ${rows.length} member rows`,
            inline: false,
          },
          sourceField(
            `${week?.trim() ? `Week filter: ${formatRaidWeekFilter(week)}. ` : ''}Capital contribution source: persisted raid-season member rows captured by clan polling; no live Clash API lookup or polling enrollment is performed.`,
          ),
          coverageField(coverage),
        )
        .setFooter({
          text: `Showing ${Math.min(rows.length, SUMMARY_ROW_LIMIT)}/${rows.length} raid member rows`,
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

function formatDonationHistoryRows(
  rows: readonly SummaryDonationHistoryRow[],
  limit: number,
): string {
  return rows
    .slice(0, limit)
    .map(
      (row, index) =>
        `${index + 1}. **${escapeMarkdown(row.playerName)}** (\`${row.playerTag}\`) · ${row.donated} donated · ${row.received} received · ${row.eventCount} events · ${time(row.lastDetectedAt, 'R')}`,
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

function latestWarSnapshotAt(rows: readonly SummaryWarSnapshotRecord[]): Date | undefined {
  return latestDate(rows.map((row) => row.fetchedAt));
}

function latestMissedWarAttackAt(rows: readonly SummaryMissedWarAttackRow[]): Date | undefined {
  return latestDate(rows.map((row) => row.latestOccurredAt));
}

function latestDonationHistoryAt(rows: readonly SummaryDonationHistoryRow[]): Date | undefined {
  return latestDate(rows.map((row) => row.lastDetectedAt));
}

function latestCapitalRaidSeasonAt(rows: readonly SummaryCapitalRaidSeasonRow[]): Date | undefined {
  return latestDate(rows.map((row) => row.sourceFetchedAt));
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

function formatCapitalRaidSeasonRows(rows: readonly SummaryCapitalRaidSeasonRow[]): string {
  return rows
    .slice(0, SUMMARY_ROW_LIMIT)
    .map(
      (row, index) =>
        `${index + 1}. \`${row.clanTag}\` · ${formatNumber(row.capitalTotalLoot)} loot · ${row.raidsCompleted} raids · ${row.totalAttacks} attacks · ${row.enemyDistrictsDestroyed} districts · ${time(row.endTime, 'R')}`,
    )
    .join('\n');
}

function formatCapitalRaidContributionSeasonRows(
  rows: readonly (SummaryCapitalRaidSeasonMemberRow & { season: SummaryCapitalRaidSeasonRow })[],
): string {
  return rows
    .slice(0, SUMMARY_ROW_LIMIT)
    .map(
      (row, index) =>
        `${index + 1}. **${escapeMarkdown(row.playerName)}** · ${formatNumber(row.capitalResourcesLooted)} loot · ${row.attacks}/${row.attackLimit + row.bonusAttackLimit} attacks · \`${row.season.clanTag}\``,
    )
    .join('\n');
}

function formatCwlStatusRows(rows: readonly SummaryWarSnapshotRecord[]): string {
  return rows
    .slice(0, SUMMARY_ROW_LIMIT)
    .map((row, index) => {
      const data = extractSummaryWarData(row.snapshot);
      const clan = chooseSummaryPerspectiveClan(data, row.trackedClan?.clanTag ?? row.clanTag);
      const opponent = clan === data?.clan ? data?.opponent : data?.clan;
      const label = row.trackedClan?.alias ?? row.trackedClan?.name ?? clan?.name ?? row.clanTag;
      return `${index + 1}. **${escapeMarkdown(label)}** (\`${row.clanTag}\`) · ${formatSummaryWarState(row.state)} · ${formatSummaryScore(clan, opponent)} · latest ${time(row.fetchedAt, 'R')}`;
    })
    .join('\n');
}

function formatSummaryScore(
  clan: SummaryWarClan | undefined,
  opponent: SummaryWarClan | undefined,
): string {
  return `${formatOptionalNumber(clan?.stars)}-${formatOptionalNumber(opponent?.stars)} ⭐ vs ${escapeMarkdown(opponent?.name ?? opponent?.tag ?? 'unknown opponent')}`;
}

function formatOptionalNumber(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '?';
}

function countSummaryWarStates(rows: readonly SummaryWarSnapshotRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const state = formatSummaryWarState(row.state);
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return counts;
}

function formatStateCounts(counts: Map<string, number>): string {
  return [...counts.entries()].map(([state, count]) => `${state}: ${count}`).join(' · ');
}

function formatSummaryWarState(value: string): string {
  const normalized = value.replace(/_/g, '').toLowerCase();
  if (normalized === 'preparation') return 'Preparation';
  if (normalized === 'inwar') return 'In War';
  if (normalized === 'warended') return 'War Ended';
  if (normalized === 'notinwar') return 'Not In War';
  return value || 'Unknown';
}

function buildWarResultSummaryRow(snapshot: SummaryWarSnapshotRecord): WarResultSummaryRow {
  const data = extractSummaryWarData(snapshot.snapshot);
  const clan = chooseSummaryPerspectiveClan(
    data,
    snapshot.trackedClan?.clanTag ?? snapshot.clanTag,
  );
  const opponent = clan === data?.clan ? data?.opponent : data?.clan;
  return {
    clanLabel:
      snapshot.trackedClan?.alias ?? snapshot.trackedClan?.name ?? clan?.name ?? snapshot.clanTag,
    clanTag: snapshot.clanTag,
    opponentLabel: opponent?.name ?? opponent?.tag ?? 'unknown opponent',
    result: resolveWarResult(clan, opponent),
    clanStars: clan?.stars,
    opponentStars: opponent?.stars,
    clanDestruction: clan?.destructionPercentage,
    opponentDestruction: opponent?.destructionPercentage,
    fetchedAt: snapshot.fetchedAt,
    ...(snapshot.warKey ? { warKey: snapshot.warKey } : {}),
  };
}

function resolveWarResult(
  clan: SummaryWarClan | undefined,
  opponent: SummaryWarClan | undefined,
): WarResultSummaryRow['result'] {
  if (typeof clan?.stars !== 'number' || typeof opponent?.stars !== 'number') return 'unknown';
  if (clan.stars > opponent.stars) return 'win';
  if (clan.stars < opponent.stars) return 'loss';
  if (
    typeof clan.destructionPercentage === 'number' &&
    typeof opponent.destructionPercentage === 'number'
  ) {
    if (clan.destructionPercentage > opponent.destructionPercentage) return 'win';
    if (clan.destructionPercentage < opponent.destructionPercentage) return 'loss';
  }
  return 'tie';
}

function countWarResults(
  rows: readonly WarResultSummaryRow[],
): Record<WarResultSummaryRow['result'], number> {
  const counts: Record<WarResultSummaryRow['result'], number> = {
    win: 0,
    loss: 0,
    tie: 0,
    unknown: 0,
  };
  for (const row of rows) counts[row.result] += 1;
  return counts;
}

function resultSortWeight(result: WarResultSummaryRow['result']): number {
  if (result === 'win') return 4;
  if (result === 'tie') return 3;
  if (result === 'loss') return 2;
  return 1;
}

function formatWarResultRows(rows: readonly WarResultSummaryRow[]): string {
  return rows
    .slice(0, SUMMARY_ROW_LIMIT)
    .map(
      (row, index) =>
        `${index + 1}. **${escapeMarkdown(row.clanLabel)}** (\`${row.clanTag}\`) · ${formatWarResultLabel(row.result)} · ${formatOptionalNumber(row.clanStars)}-${formatOptionalNumber(row.opponentStars)} ⭐ · ${formatOptionalPercent(row.clanDestruction)}/${formatOptionalPercent(row.opponentDestruction)} destruction · vs ${escapeMarkdown(row.opponentLabel)} · latest ${time(row.fetchedAt, 'R')}`,
    )
    .join('\n');
}

function formatWarResultLabel(result: WarResultSummaryRow['result']): string {
  if (result === 'win') return 'Win';
  if (result === 'loss') return 'Loss';
  if (result === 'tie') return 'Tie';
  return 'Unknown';
}

function formatOptionalPercent(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '?';
}

interface SummaryWarData {
  readonly clan?: SummaryWarClan;
  readonly opponent?: SummaryWarClan;
  readonly warTag?: string;
}

interface SummaryWarClan {
  readonly tag?: string;
  readonly name?: string;
  readonly stars?: number;
  readonly destructionPercentage?: number;
}

interface WarResultSummaryRow {
  readonly clanLabel: string;
  readonly clanTag: string;
  readonly opponentLabel: string;
  readonly result: 'win' | 'loss' | 'tie' | 'unknown';
  readonly clanStars: number | undefined;
  readonly opponentStars: number | undefined;
  readonly clanDestruction: number | undefined;
  readonly opponentDestruction: number | undefined;
  readonly fetchedAt: Date;
  readonly warKey?: string;
}

function isSummaryCwlSnapshot(row: SummaryWarSnapshotRecord): boolean {
  if (row.warKey?.toLowerCase().startsWith('cwl:')) return true;
  return Boolean(extractSummaryWarData(row.snapshot)?.warTag);
}

function extractSummaryWarData(snapshot: unknown): SummaryWarData | null {
  const value = unwrapSummarySnapshot(snapshot);
  if (!isRecord(value)) return null;
  const clan = readSummaryWarClan(readRecordValue(value, 'clan'));
  const opponent = readSummaryWarClan(readRecordValue(value, 'opponent'));
  const warTagValue = readRecordValue(value, 'warTag');
  const warTag = typeof warTagValue === 'string' ? warTagValue.trim() : '';
  return {
    ...(clan ? { clan } : {}),
    ...(opponent ? { opponent } : {}),
    ...(warTag ? { warTag } : {}),
  };
}

function readSummaryWarClan(value: unknown): SummaryWarClan | undefined {
  const clan = unwrapSummarySnapshot(value);
  if (!isRecord(clan)) return undefined;
  const tag = readRecordValue(clan, 'tag');
  const name = readRecordValue(clan, 'name');
  const stars = readRecordValue(clan, 'stars');
  const destructionPercentage = readRecordValue(clan, 'destructionPercentage');
  return {
    ...(typeof tag === 'string' ? { tag } : {}),
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof stars === 'number' ? { stars } : {}),
    ...(typeof destructionPercentage === 'number' ? { destructionPercentage } : {}),
  };
}

function chooseSummaryPerspectiveClan(
  data: SummaryWarData | null,
  clanTag: string,
): SummaryWarClan | undefined {
  const normalized = clanTag.toUpperCase();
  if (data?.clan?.tag?.toUpperCase() === normalized) return data.clan;
  if (data?.opponent?.tag?.toUpperCase() === normalized) return data.opponent;
  return data?.clan;
}

function unwrapSummarySnapshot(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const data = readRecordValue(value, 'data');
  if (isRecord(data)) return unwrapSummarySnapshot(data);
  const snapshot = readRecordValue(value, 'snapshot');
  if (isRecord(snapshot)) return unwrapSummarySnapshot(snapshot);
  return value;
}

function readRecordValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
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
