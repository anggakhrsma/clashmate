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
  type User,
} from 'discord.js';

export const CWL_COMMAND_NAME = 'cwl';
export const CWL_COMMAND_DESCRIPTION = 'Show CWL summaries from stored war data.';

const SNAPSHOT_SUBCOMMANDS = ['roster', 'round', 'lineup', 'members'] as const;
const HISTORY_SUBCOMMANDS = ['stars', 'attacks', 'stats'] as const;
const MAX_ROWS = 20;
const CWL_SEASON_CHOICE_COUNT = 12;
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

const CWL_SEASON_CHOICES = buildRecentCwlSeasonChoices(new Date());

export const cwlCommandData = new SlashCommandBuilder()
  .setName(CWL_COMMAND_NAME)
  .setDescription(CWL_COMMAND_DESCRIPTION)
  .setDMPermission(false);

for (const name of SNAPSHOT_SUBCOMMANDS) {
  cwlCommandData.addSubcommand((subcommand) => {
    subcommand.setName(name).setDescription(`Show CWL ${name} from persisted war snapshots.`);
    addClanOption(subcommand);
    if (name === 'round') addSeasonOption(subcommand);
    addUserOption(subcommand);
    return subcommand;
  });
}
for (const name of HISTORY_SUBCOMMANDS) {
  cwlCommandData.addSubcommand((subcommand) => {
    subcommand.setName(name).setDescription(`Show CWL ${name} from persisted war attack history.`);
    addClanOption(subcommand);
    addSeasonOption(subcommand);
    addUserOption(subcommand);
    return subcommand;
  });
}

type CwlSubcommand = (typeof SNAPSHOT_SUBCOMMANDS)[number] | (typeof HISTORY_SUBCOMMANDS)[number];

export interface CwlLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface CwlWarSnapshotRecord {
  readonly clanTag: string;
  readonly state: string;
  readonly snapshot: unknown;
  readonly fetchedAt: Date;
  readonly trackedClan?: CwlLinkedClan;
  readonly warKey?: string;
}

export interface CwlWarAttackHistoryRow {
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

export interface CwlStore {
  readonly listLinkedClans: (guildId: string) => Promise<CwlLinkedClan[]>;
  readonly getLatestWarSnapshot: (clanTag: string) => Promise<CwlWarSnapshotRecord | null>;
  readonly getLatestWarSnapshotsForGuild: (guildId: string) => Promise<CwlWarSnapshotRecord[]>;
  readonly getRetainedWarSnapshotsForGuild: (input: {
    guildId: string;
    warKey: string;
    clanTag?: string;
  }) => Promise<CwlWarSnapshotRecord[]>;
  readonly getLinkedPlayerTags: (guildId: string, discordUserId: string) => Promise<string[]>;
  readonly listWarAttackHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    attackerTags?: readonly string[];
  }) => Promise<CwlWarAttackHistoryRow[]>;
}

export interface CwlCommandOptions {
  readonly store: CwlStore;
}

interface WarMember {
  readonly tag?: string;
  readonly name?: string;
  readonly townhallLevel?: number;
  readonly townHallLevel?: number;
  readonly mapPosition?: number;
}

interface WarClan {
  readonly tag?: string;
  readonly name?: string;
  readonly stars?: number;
  readonly attacks?: number;
  readonly destructionPercentage?: number;
  readonly badgeUrls?: {
    readonly small?: string;
    readonly medium?: string;
    readonly large?: string;
  };
  readonly members?: readonly WarMember[];
}

interface WarData {
  readonly state?: string;
  readonly clan?: WarClan;
  readonly opponent?: WarClan;
  readonly teamSize?: number;
  readonly startTime?: string;
  readonly endTime?: string;
}

interface CwlEntry {
  readonly snapshot: CwlWarSnapshotRecord;
  readonly war: WarData;
}

interface CwlSnapshotSourceContext {
  readonly scannedCount: number;
  readonly matchedCount?: number;
  readonly latestFetchedAt: Date | null;
  readonly season: string | null;
  readonly linkedClanCount?: number;
}

interface CwlDiagnosticInput {
  readonly clan?: CwlLinkedClan | null;
  readonly user?: User | null;
  readonly season: string | null;
  readonly linkedPlayerTagCount?: number;
  readonly linkedClanCount?: number;
}

export function createCwlSlashCommand(options: CwlCommandOptions): SlashCommandDefinition {
  return {
    name: CWL_COMMAND_NAME,
    data: cwlCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand() || interaction.commandName !== CWL_COMMAND_NAME) return;
      await executeCwl(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== CWL_COMMAND_NAME) return;
      await autocompleteCwl(interaction, options);
    },
  };
}

async function executeCwl(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: CwlCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: '`/cwl` can only be used in a server.', ephemeral: true });
    return;
  }
  await interaction.deferReply();

  const subcommand = interaction.options.getSubcommand() as CwlSubcommand;
  const clans = await options.store.listLinkedClans(interaction.guildId);
  const clanOption = interaction.options.getString('clan');
  const clan = clanOption ? resolveCwlClan(clans, clanOption) : null;
  if (clanOption && !clan) {
    await interaction.editReply('No linked clan was found for that clan option.');
    return;
  }
  const user = interaction.options.getUser('user');
  const playerTags = user
    ? await options.store.getLinkedPlayerTags(interaction.guildId, user.id)
    : [];
  if (user && playerTags.length === 0) {
    await interaction.editReply(
      'No linked player tags were found for that user. Use `/link create` to link a Clash account first; `/cwl` can only filter users through linked Clash accounts.',
    );
    return;
  }

  if (HISTORY_SUBCOMMANDS.includes(subcommand as (typeof HISTORY_SUBCOMMANDS)[number])) {
    const rows = await options.store.listWarAttackHistoryForGuild({
      guildId: interaction.guildId,
      ...(clan ? { clanTags: [clan.clanTag] } : {}),
      ...(playerTags.length > 0 ? { attackerTags: playerTags } : {}),
    });
    const ranked = rankCwlAttackRows(rows);
    if (ranked.length === 0) {
      await interaction.editReply(
        noDataMessage('war attack history', {
          clan,
          user,
          season: interaction.options.getString('season'),
          linkedPlayerTagCount: playerTags.length,
          linkedClanCount: clans.length,
        }),
      );
      return;
    }
    await interaction.editReply({
      embeds: [
        buildCwlHistoryEmbed(subcommand, ranked, {
          clan,
          user,
          season: interaction.options.getString('season'),
          linkedPlayerTagCount: playerTags.length,
          linkedClanCount: clans.length,
        }),
      ],
    });
    return;
  }

  const snapshots = clan
    ? [await options.store.getLatestWarSnapshot(clan.clanTag)].filter(
        (value): value is CwlWarSnapshotRecord => Boolean(value),
      )
    : await options.store.getLatestWarSnapshotsForGuild(interaction.guildId);
  const snapshotContext = buildSnapshotSourceContext(
    snapshots,
    interaction.options.getString('season'),
    clans.length,
  );
  const entries = snapshots
    .map((snapshot) => ({ snapshot, war: extractCwlWarData(snapshot.snapshot) }))
    .filter((entry): entry is CwlEntry => Boolean(entry.war))
    .filter((entry) => playerTags.length === 0 || warIncludesPlayer(entry.war, playerTags));
  const entry = chooseCwlEntry(entries);
  const resolvedSnapshotContext = { ...snapshotContext, matchedCount: entries.length };
  if (!entry) {
    await interaction.editReply(
      noDataMessage('war snapshots', {
        clan,
        user,
        season: interaction.options.getString('season'),
        linkedPlayerTagCount: playerTags.length,
        linkedClanCount: clans.length,
        snapshotContext: resolvedSnapshotContext,
      }),
    );
    return;
  }
  await interaction.editReply({
    embeds: [
      buildCwlSnapshotEmbed(
        subcommand,
        entry,
        {
          clan,
          user,
          season: interaction.options.getString('season'),
          linkedPlayerTagCount: playerTags.length,
          linkedClanCount: clans.length,
        },
        resolvedSnapshotContext,
      ),
    ],
  });
}

async function autocompleteCwl(
  interaction: AutocompleteInteraction,
  options: CwlCommandOptions,
): Promise<void> {
  if (!interaction.guildId || interaction.options.getFocused(true).name !== 'clan') {
    await interaction.respond([]);
    return;
  }
  let clans: CwlLinkedClan[];
  try {
    clans = await options.store.listLinkedClans(interaction.guildId);
  } catch {
    await interaction.respond([]);
    return;
  }
  await interaction.respond(
    filterCwlClanChoices(clans, String(interaction.options.getFocused(true).value ?? '')),
  );
}

export function filterCwlClanChoices(
  clans: readonly CwlLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalized = query.trim().toLowerCase();
  return clans
    .filter(
      (clan) =>
        !normalized ||
        [clan.clanTag, clan.name, clan.alias]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(normalized)),
    )
    .sort(compareCwlLinkedClans)
    .slice(0, 25)
    .map((clan) => ({
      name: formatCwlClanChoiceName(clan),
      value: clan.clanTag,
    }));
}

export function buildCwlSnapshotEmbed(
  subcommand: CwlSubcommand,
  entry: CwlEntry,
  input: CwlDiagnosticInput | string | null,
  sourceContext?: CwlSnapshotSourceContext,
): EmbedBuilder {
  const season = typeof input === 'string' || input === null ? input : input.season;
  const resolvedSourceContext =
    sourceContext ?? buildSnapshotSourceContext([entry.snapshot], season);
  const clan = choosePerspectiveClan(
    entry.war,
    entry.snapshot.trackedClan?.clanTag ?? entry.snapshot.clanTag,
  );
  const opponent = clan === entry.war.clan ? entry.war.opponent : entry.war.clan;
  const embed = new EmbedBuilder()
    .setTitle(`CWL ${capitalize(subcommand)}`)
    .setAuthor(buildAuthor(clan, entry.snapshot.trackedClan))
    .setFooter({ text: buildSourceFooter(season) });
  if (subcommand === 'round') {
    embed.setDescription(
      [
        `Against: **${opponent?.name ?? 'Unknown Clan'}** (${opponent?.tag ?? 'unknown'})`,
        `Score: ${formatNumber(clan?.stars)} ⭐ / ${formatNumber(opponent?.stars)} ⭐`,
        `Attacks: ${formatNumber(clan?.attacks)} / ${formatNumber(opponent?.attacks)}`,
        `Destruction: ${formatPercent(clan?.destructionPercentage)} / ${formatPercent(opponent?.destructionPercentage)}`,
        ...(entry.war.endTime ? [`Ends: ${time(new Date(entry.war.endTime), 'R')}`] : []),
      ].join('\n'),
    );
    embed.addFields(buildSnapshotSourceField(subcommand, entry, resolvedSourceContext, input));
    return embed;
  }
  embed.setDescription(formatMembers(clan?.members ?? []));
  if (opponent?.members?.length)
    embed.addFields({
      name: `Opponent: ${opponent.name ?? opponent.tag ?? 'Unknown'}`,
      value: formatMembers(opponent.members),
      inline: false,
    });
  embed.addFields(buildSnapshotSourceField(subcommand, entry, resolvedSourceContext, input));
  return embed;
}

export function buildCwlHistoryEmbed(
  subcommand: CwlSubcommand,
  rows: readonly CwlWarAttackHistoryRow[],
  input: CwlDiagnosticInput,
): EmbedBuilder {
  const totals = rows.reduce(
    (acc, row) => ({ attacks: acc.attacks + row.attackCount, stars: acc.stars + row.totalStars }),
    { attacks: 0, stars: 0 },
  );
  const filters = formatAcceptedFilters(input);
  const latestAttack = maxDate(rows.map((row) => row.lastAttackedAt));
  const shownCount = Math.min(rows.length, MAX_ROWS);
  const hiddenCount = Math.max(rows.length - shownCount, 0);
  const sourceLabel = formatCwlSourceLabel(subcommand, 'attack history');
  const description = rows
    .slice(0, MAX_ROWS)
    .map(
      (row, index) =>
        `${index + 1}. **${escapeMarkdown(row.attackerName ?? row.attackerTag)}** (\`${row.attackerTag}\`) · ${row.attackCount} hits · ${row.totalStars} ⭐ · ${row.averageStars.toFixed(2)} avg · ${row.averageDestruction.toFixed(2)}% · ${time(row.lastAttackedAt, 'R')}`,
    )
    .join('\n');
  const embed = new EmbedBuilder()
    .setTitle(`CWL ${capitalize(subcommand)}`)
    .setDescription(description)
    .addFields(
      { name: 'Totals', value: `${totals.attacks} attacks · ${totals.stars} stars`, inline: false },
      {
        name: 'Source',
        value: [
          sourceLabel,
          `linked clans ${formatCount(input.linkedClanCount)}`,
          `Persisted-only: scanned ${rows.length} stored attack ${rows.length === 1 ? 'row' : 'rows'} · ${totals.attacks} stored attack ${totals.attacks === 1 ? 'event' : 'events'}`,
          `visible ${shownCount} · hidden ${hiddenCount} · total ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} (display limit ${MAX_ROWS})`,
          latestAttack ? `latest event ${formatFreshness(latestAttack)}` : '',
          filters ? `filters accepted: ${filters}` : 'filters resolved to all linked clans',
          input.season
            ? 'season is a retained-data label; rows are limited to persisted attack history currently stored'
            : 'current retained attack history only',
          'Exact CWL-only filtering may be approximate; classification and season filtering use stored war data',
          'no live fallback or on-demand polling',
        ]
          .filter(Boolean)
          .join(' · '),
        inline: false,
      },
    )
    .setFooter({ text: buildSourceFooter(input.season) });
  if (input.clan)
    embed.addFields({
      name: 'Clan filter',
      value: `${input.clan.alias ?? input.clan.name ?? 'Linked Clan'} (${input.clan.clanTag})`,
      inline: false,
    });
  if (input.season)
    embed.addFields({
      name: 'Season filter',
      value: `${formatSeasonLabel(input.season)} — display/filter label only until persisted CWL season metadata is available.`,
      inline: false,
    });
  if (input.user)
    embed.setAuthor({ name: input.user.displayName, iconURL: input.user.displayAvatarURL() });
  return embed;
}

export function extractCwlWarData(snapshot: unknown): WarData | null {
  const value = unwrapSnapshot(snapshot);
  if (!isRecord(value)) return null;
  const record = value as {
    readonly clan?: unknown;
    readonly opponent?: unknown;
    readonly state?: unknown;
    readonly teamSize?: unknown;
    readonly startTime?: unknown;
    readonly endTime?: unknown;
  };
  const clan = readClan(record.clan);
  const opponent = readClan(record.opponent);
  if (!clan || !opponent) return null;
  const state = readString(record.state);
  const teamSize = readNumber(record.teamSize);
  const startTime = readString(record.startTime);
  const endTime = readString(record.endTime);
  return {
    clan,
    opponent,
    ...(state ? { state } : {}),
    ...(teamSize !== null ? { teamSize } : {}),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
  };
}

export function rankCwlAttackRows(
  rows: readonly CwlWarAttackHistoryRow[],
): CwlWarAttackHistoryRow[] {
  return [...rows].sort(
    (a, b) =>
      b.totalStars - a.totalStars ||
      b.attackCount - a.attackCount ||
      b.averageDestruction - a.averageDestruction,
  );
}

function addClanOption(subcommand: SlashCommandSubcommandBuilder): void {
  subcommand.addStringOption((option) =>
    option
      .setName('clan')
      .setDescription('Linked clan tag, name, or alias to filter persisted CWL data.')
      .setAutocomplete(true)
      .setRequired(false),
  );
}
function addUserOption(subcommand: SlashCommandSubcommandBuilder): void {
  subcommand.addUserOption((option) =>
    option
      .setName('user')
      .setDescription('Discord user whose linked Clash accounts should be matched.')
      .setRequired(false),
  );
}
function addSeasonOption(subcommand: SlashCommandSubcommandBuilder): void {
  subcommand.addStringOption((option) =>
    option
      .setName('season')
      .setDescription('CWL season label; exact filtering depends on stored war metadata.')
      .addChoices(...CWL_SEASON_CHOICES)
      .setRequired(false),
  );
}

function buildRecentCwlSeasonChoices(now: Date): ApplicationCommandOptionChoiceData<string>[] {
  const choices: ApplicationCommandOptionChoiceData<string>[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  while (choices.length < CWL_SEASON_CHOICE_COUNT) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const seasonId = `${year}-${String(month + 1).padStart(2, '0')}`;
    choices.push({ name: `${MONTH_NAMES[month]} ${year}`, value: seasonId });
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return choices;
}

function resolveCwlClan(clans: readonly CwlLinkedClan[], query: string): CwlLinkedClan | null {
  const normalized = query.trim().toLowerCase();
  let tag: string | null = null;
  try {
    tag = normalizeClashTag(query).toLowerCase();
  } catch {
    tag = null;
  }
  return (
    clans.find(
      (clan) =>
        clan.clanTag.toLowerCase() === tag ||
        clan.clanTag.replace(/^#/, '').toLowerCase() === normalized.replace(/^#/, '') ||
        clan.alias?.toLowerCase() === normalized ||
        clan.name?.toLowerCase() === normalized,
    ) ?? null
  );
}
function compareCwlLinkedClans(a: CwlLinkedClan, b: CwlLinkedClan): number {
  return (
    cwlClanSortKey(a).localeCompare(cwlClanSortKey(b), 'en') ||
    a.clanTag.localeCompare(b.clanTag, 'en')
  );
}
function cwlClanSortKey(clan: CwlLinkedClan): string {
  return (clan.alias ?? clan.name ?? clan.clanTag).toLowerCase();
}
function formatCwlClanChoiceName(clan: CwlLinkedClan): string {
  return truncateDiscordChoiceName(`${clan.alias ?? clan.name ?? clan.clanTag} (${clan.clanTag})`);
}
function truncateDiscordChoiceName(value: string): string {
  const maxLength = 100;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
function chooseCwlEntry(entries: readonly CwlEntry[]): CwlEntry | null {
  return (
    entries.find(
      (entry) => normalizeState(entry.war.state ?? entry.snapshot.state) !== 'notinwar',
    ) ??
    entries[0] ??
    null
  );
}
function choosePerspectiveClan(war: WarData, clanTag: string): WarClan | undefined {
  const tag = clanTag.toUpperCase();
  return war.clan?.tag?.toUpperCase() === tag
    ? war.clan
    : war.opponent?.tag?.toUpperCase() === tag
      ? war.opponent
      : war.clan;
}
function buildAuthor(
  clan: WarClan | undefined,
  tracked: CwlLinkedClan | undefined,
): { name: string; iconURL?: string } {
  const name = `${clan?.name ?? tracked?.name ?? tracked?.clanTag ?? 'Unknown Clan'} (${clan?.tag ?? tracked?.clanTag ?? 'unknown'})`;
  const iconURL = clan?.badgeUrls?.medium ?? clan?.badgeUrls?.small ?? clan?.badgeUrls?.large;
  return iconURL ? { name, iconURL } : { name };
}
function formatMembers(members: readonly WarMember[]): string {
  const rows = [...members]
    .sort((a, b) => (a.mapPosition ?? 999) - (b.mapPosition ?? 999))
    .slice(0, MAX_ROWS)
    .map(
      (member) =>
        `#${member.mapPosition ?? '?'} TH${member.townhallLevel ?? member.townHallLevel ?? '?'} **${escapeMarkdown(member.name ?? member.tag ?? 'Unknown')}**`,
    );
  return rows.length ? rows.join('\n') : 'No member roster is available in the stored snapshot.';
}
function warIncludesPlayer(war: WarData, tags: readonly string[]): boolean {
  const set = new Set(tags.map((tag) => tag.toUpperCase()));
  return [war.clan, war.opponent].some((clan) =>
    clan?.members?.some((member) => member.tag && set.has(member.tag.toUpperCase())),
  );
}
function noDataMessage(
  source: string,
  input: CwlDiagnosticInput & { snapshotContext?: CwlSnapshotSourceContext },
): string {
  const filters = formatAcceptedFilters(input);
  const linkedClanSummary = `linked clans ${formatCount(input.linkedClanCount)}`;
  const season = input.season ? ` Season label accepted: ${formatSeasonLabel(input.season)}.` : '';
  const coverage = input.snapshotContext
    ? ` ${linkedClanSummary}; scanned ${input.snapshotContext.scannedCount} persisted war ${input.snapshotContext.scannedCount === 1 ? 'snapshot' : 'snapshots'}; ${input.snapshotContext.matchedCount ?? 0} matched the accepted filters${input.snapshotContext.latestFetchedAt ? `; latest snapshot ${formatFreshness(input.snapshotContext.latestFetchedAt)}` : ''}; visible 0 · hidden 0 · total 0 rows.`
    : ` ${linkedClanSummary}; scanned 0 stored attack summary rows for this filter; showing 0 rows (display limit ${MAX_ROWS}).`;
  return [
    `No CWL ${source} data is available for the accepted filters${filters ? ` (${filters})` : ''}.`,
    `${coverage}${season} Persisted-only: no live Clash API fallback and no on-demand polling were used. CWL-only classification and season filtering are approximate until stored CWL round metadata is available.`,
    'Link the clan, wait for scheduled war polling to store activity, or try a broader clan/user/season filter.',
  ].join(' ');
}
function buildSourceFooter(season: string | null): string {
  if (!season) return 'Persisted war data first pass';
  const label = formatSeasonLabel(season);
  return `Season label: ${label} · persisted war data first pass`;
}
function formatSeasonLabel(season: string): string {
  const choice = CWL_SEASON_CHOICES.find((candidate) => candidate.value === season);
  return choice ? `${choice.name} (${season})` : season;
}
function buildSnapshotSourceContext(
  snapshots: readonly CwlWarSnapshotRecord[],
  season: string | null,
  linkedClanCount?: number,
): CwlSnapshotSourceContext {
  return {
    scannedCount: snapshots.length,
    latestFetchedAt: maxDate(snapshots.map((snapshot) => snapshot.fetchedAt)),
    season,
    ...(typeof linkedClanCount === 'number' ? { linkedClanCount } : {}),
  };
}
function buildSnapshotSourceField(
  subcommand: CwlSubcommand,
  entry: CwlEntry,
  context: CwlSnapshotSourceContext,
  input: CwlDiagnosticInput | string | null,
): { name: string; value: string; inline: false } {
  const filters = typeof input === 'string' || input === null ? '' : formatAcceptedFilters(input);
  const rowCounts = formatSnapshotRowCounts(subcommand, entry);
  const details = [
    formatCwlSourceLabel(subcommand, 'current war snapshot'),
    `linked clans ${formatCount(context.linkedClanCount)}`,
    `Persisted-only: scanned ${context.scannedCount} stored war ${context.scannedCount === 1 ? 'snapshot' : 'snapshots'}`,
    `visible snapshots 1 · hidden snapshots ${Math.max((context.matchedCount ?? 1) - 1, 0)} · matched snapshots ${context.matchedCount ?? 1}`,
    rowCounts,
    context.latestFetchedAt ? `latest fetched ${formatFreshness(context.latestFetchedAt)}` : '',
    filters ? `filters accepted: ${filters}` : 'filters resolved to all linked clans',
    `state ${formatState(entry.war.state ?? entry.snapshot.state)}`,
    ...formatRoundContext(entry.snapshot, entry.war),
    context.season
      ? 'season is a retained-data label; current snapshot selection still uses persisted latest snapshots'
      : 'current latest snapshot data only',
    'CWL-only classification/season filtering is approximate from stored war data',
    'no live fallback or on-demand polling',
  ].filter((detail) => detail.length > 0);
  return { name: 'Source / coverage', value: details.join(' · '), inline: false };
}
function formatRoundContext(snapshot: CwlWarSnapshotRecord, war: WarData): string[] {
  const details: string[] = [];
  const round = readRoundLabel(snapshot.snapshot);
  if (round) details.push(`round ${round}`);
  if (war.teamSize) details.push(`${war.teamSize}v${war.teamSize}`);
  if (snapshot.warKey) details.push(`war ${snapshot.warKey}`);
  return details;
}
function formatSnapshotRowCounts(subcommand: CwlSubcommand, entry: CwlEntry): string {
  if (subcommand === 'round') return 'round rows visible 1 · hidden 0 · total 1';
  const clan = choosePerspectiveClan(
    entry.war,
    entry.snapshot.trackedClan?.clanTag ?? entry.snapshot.clanTag,
  );
  const opponent = clan === entry.war.clan ? entry.war.opponent : entry.war.clan;
  const clanRows = clan?.members?.length ?? 0;
  const opponentRows = opponent?.members?.length ?? 0;
  const visibleClanRows = Math.min(clanRows, MAX_ROWS);
  const visibleOpponentRows = Math.min(opponentRows, MAX_ROWS);
  return `${subcommand} member rows visible ${visibleClanRows + visibleOpponentRows} · hidden ${Math.max(clanRows - visibleClanRows, 0) + Math.max(opponentRows - visibleOpponentRows, 0)} · total ${clanRows + opponentRows} (clan ${visibleClanRows}/${clanRows}, opponent ${visibleOpponentRows}/${opponentRows})`;
}
function readRoundLabel(snapshot: unknown): string | null {
  const value = unwrapSnapshot(snapshot);
  if (!isRecord(value)) return null;
  const record = value as {
    readonly round?: unknown;
    readonly roundNumber?: unknown;
    readonly warRound?: unknown;
  };
  return (
    readString(record.round) ??
    readNumber(record.roundNumber)?.toString() ??
    readString(record.warRound)
  );
}
function formatAcceptedFilters(input: CwlDiagnosticInput): string {
  return [
    ...(input.clan ? [`clan ${input.clan.alias ?? input.clan.name ?? input.clan.clanTag}`] : []),
    ...(input.user
      ? [
          `user ${input.user.displayName} (${input.linkedPlayerTagCount ?? 0} linked player ${input.linkedPlayerTagCount === 1 ? 'tag' : 'tags'})`,
        ]
      : []),
    ...(input.season ? [`season ${formatSeasonLabel(input.season)}`] : []),
  ].join(', ');
}
function formatCwlSourceLabel(subcommand: CwlSubcommand, source: string): string {
  return `selected /cwl ${subcommand} · source ${source}`;
}
function formatCount(value: number | undefined): string {
  return typeof value === 'number' ? String(value) : 'unknown';
}
function maxDate(values: readonly Date[]): Date | null {
  return values.reduce<Date | null>(
    (latest, value) => (!latest || value.getTime() > latest.getTime() ? value : latest),
    null,
  );
}
function formatFreshness(value: Date): string {
  return `${time(value, 'R')} (${time(value, 'f')})`;
}
function formatState(value: string | undefined): string {
  const state = normalizeState(value);
  return state === 'inwar'
    ? 'Battle Day'
    : state === 'warended'
      ? 'War Ended'
      : state === 'preparation'
        ? 'Preparation'
        : (value ?? 'Unknown');
}
function normalizeState(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replaceAll('_', '');
}
function formatNumber(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '?';
}
function formatPercent(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '?';
}
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function unwrapSnapshot(snapshot: unknown): unknown {
  if (!isRecord(snapshot)) return null;
  const record = snapshot as { readonly data?: unknown; readonly snapshot?: unknown };
  if (isRecord(record.data)) return record.data;
  if (isRecord(record.snapshot)) return unwrapSnapshot(record.snapshot);
  return snapshot;
}
function readClan(value: unknown): WarClan | null {
  if (!isRecord(value)) return null;
  const record = value as {
    readonly tag?: unknown;
    readonly name?: unknown;
    readonly stars?: unknown;
    readonly attacks?: unknown;
    readonly destructionPercentage?: unknown;
    readonly badgeUrls?: unknown;
    readonly members?: unknown;
  };
  const tag = readString(record.tag);
  const name = readString(record.name);
  const stars = readNumber(record.stars);
  const attacks = readNumber(record.attacks);
  const destructionPercentage = readNumber(record.destructionPercentage);
  const badgeUrls = readBadgeUrls(record.badgeUrls);
  return {
    members: Array.isArray(record.members) ? record.members.flatMap(readMember) : [],
    ...(tag ? { tag } : {}),
    ...(name ? { name } : {}),
    ...(stars !== null ? { stars } : {}),
    ...(attacks !== null ? { attacks } : {}),
    ...(destructionPercentage !== null ? { destructionPercentage } : {}),
    ...(badgeUrls ? { badgeUrls } : {}),
  };
}
function readMember(value: unknown): WarMember[] {
  if (!isRecord(value)) return [];
  const record = value as {
    readonly tag?: unknown;
    readonly name?: unknown;
    readonly townhallLevel?: unknown;
    readonly townHallLevel?: unknown;
    readonly mapPosition?: unknown;
  };
  const tag = readString(record.tag);
  const name = readString(record.name);
  const townhallLevel = readNumber(record.townhallLevel);
  const townHallLevel = readNumber(record.townHallLevel);
  const mapPosition = readNumber(record.mapPosition);
  return [
    {
      ...(tag ? { tag } : {}),
      ...(name ? { name } : {}),
      ...(townhallLevel !== null ? { townhallLevel } : {}),
      ...(townHallLevel !== null ? { townHallLevel } : {}),
      ...(mapPosition !== null ? { mapPosition } : {}),
    },
  ];
}
function readBadgeUrls(value: unknown): WarClan['badgeUrls'] | undefined {
  if (!isRecord(value)) return undefined;
  const record = value as {
    readonly small?: unknown;
    readonly medium?: unknown;
    readonly large?: unknown;
  };
  const small = readString(record.small);
  const medium = readString(record.medium);
  const large = readString(record.large);
  return small || medium || large
    ? { ...(small ? { small } : {}), ...(medium ? { medium } : {}), ...(large ? { large } : {}) }
    : undefined;
}
function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
