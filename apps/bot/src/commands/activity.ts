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
} from 'discord.js';
import { filterTimezoneChoices } from './timezone.js';

export const ACTIVITY_COMMAND_NAME = 'activity';
export const ACTIVITY_COMMAND_DESCRIPTION = 'Show active members from tracked clan snapshots.';
export const ACTIVITY_NO_SNAPSHOT_MESSAGE =
  'No persisted member snapshot is available for this server/filter yet. Link or configure a clan, keep the worker running, and wait for clan polling to store member rows.';

const ACTIVITY_DAYS = [1, 3, 7, 15, 30] as const;
export type ActivityDays = (typeof ACTIVITY_DAYS)[number];
const DEFAULT_ACTIVITY_DAYS: ActivityDays = 1;
const DEFAULT_ACTIVITY_LIMIT = 10;
const MAX_ACTIVITY_LIMIT = 20;
const EMBED_DESCRIPTION_LIMIT = 4096;

export const activityCommandData = new SlashCommandBuilder()
  .setName(ACTIVITY_COMMAND_NAME)
  .setDescription(ACTIVITY_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('clans')
      .setDescription('Linked clan tag, name, or alias.')
      .setAutocomplete(true)
      .setRequired(false),
  )
  .addIntegerOption((option) =>
    option
      .setName('days')
      .setDescription('Activity window in days.')
      .setRequired(false)
      .addChoices(
        { name: '1', value: 1 },
        { name: '3', value: 3 },
        { name: '7', value: 7 },
        { name: '15', value: 15 },
        { name: '30', value: 30 },
      ),
  )
  .addIntegerOption((option) =>
    option
      .setName('limit')
      .setDescription('Recent members to show per clan.')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(MAX_ACTIVITY_LIMIT),
  )
  .addStringOption((option) =>
    option
      .setName('timezone')
      .setDescription('IANA timezone used for display, for example Asia/Jakarta.')
      .setAutocomplete(true)
      .setRequired(false),
  );

export interface ActivityLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface ActivitySnapshotRow {
  readonly playerTag: string;
  readonly name: string;
  readonly lastSeenAt: Date;
  readonly lastFetchedAt: Date;
}

export interface ActivityClanSnapshots {
  readonly clan: ActivityLinkedClan;
  readonly members: readonly ActivitySnapshotRow[];
}

export interface ActivityStore {
  readonly listLinkedClans: (guildId: string) => Promise<ActivityLinkedClan[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<ActivityClanSnapshots[]>;
}

export interface ActivityCommandOptions {
  readonly store: ActivityStore;
  readonly timezones?: Pick<DatabaseUserTimezonePreferenceStore, 'getUserTimezonePreference'>;
}

export function createActivitySlashCommand(
  options: ActivityCommandOptions,
): SlashCommandDefinition {
  return {
    name: ACTIVITY_COMMAND_NAME,
    data: activityCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== ACTIVITY_COMMAND_NAME) return;
      await executeActivity(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== ACTIVITY_COMMAND_NAME) return;
      await autocompleteActivity(interaction, options);
    },
  };
}

async function autocompleteActivity(
  interaction: AutocompleteInteraction,
  options: ActivityCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'timezone') {
    await interaction.respond(filterTimezoneChoices(String(focused.value ?? '')));
    return;
  }
  if (focused.name !== 'clans') {
    await interaction.respond([]);
    return;
  }
  try {
    const clans = await options.store.listLinkedClans(interaction.guildId);
    await interaction.respond(filterActivityClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterActivityClanChoices(
  clans: readonly ActivityLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  const choices: ApplicationCommandOptionChoiceData<string>[] = [];
  const seenChoiceValues = new Set<string>();
  const seenClanTags = new Set<string>();

  for (const clan of [...clans]
    .filter((candidate) => clanMatchesQuery(candidate, normalizedQuery))
    .sort(compareActivityClanChoices)) {
    const value = clan.alias ?? clan.clanTag;
    const normalizedValue = value.trim().toLowerCase();
    const normalizedClanTag = clan.clanTag.trim().toLowerCase();
    if (seenChoiceValues.has(normalizedValue) || seenClanTags.has(normalizedClanTag)) continue;

    seenChoiceValues.add(normalizedValue);
    seenClanTags.add(normalizedClanTag);
    choices.push({ name: formatClanChoiceName(clan), value });
    if (choices.length === 25) break;
  }

  return choices;
}

export async function executeActivity(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: ActivityCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/activity` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const timezoneOption = interaction.options.getString('timezone')?.trim();
  if (timezoneOption && !isValidTimeZone(timezoneOption)) {
    await interaction.reply({
      content: 'That timezone is not a valid IANA timezone.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const timezone = await resolveActivityTimezone({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    ...(timezoneOption ? { timezoneOption } : {}),
    ...(options.timezones ? { preferences: options.timezones } : {}),
  });
  const days = parseActivityDays(interaction.options.getInteger('days'));
  const limit = clampActivityLimit(interaction.options.getInteger('limit'));
  const clanOption = interaction.options.getString('clans');
  const clans = await options.store.listLinkedClans(interaction.guildId);

  if (clanOption) {
    const clan = resolveActivityClan(clans, clanOption);
    if (!clan) {
      await interaction.editReply({ content: 'No linked clan was found for that clans option.' });
      return;
    }
    const snapshots = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
      clanTag: clan.clanTag,
    });
    await replyWithActivity(
      interaction,
      snapshots,
      buildActivityOptions(days, limit, timezone, {
        clanFilter: formatActivityClanLabel(clan),
        linkedClanCount: clans.length,
      }),
    );
    return;
  }

  const snapshots = await options.store.listClanMemberSnapshotsForGuild({
    guildId: interaction.guildId,
  });
  await replyWithActivity(
    interaction,
    snapshots,
    buildActivityOptions(days, limit, timezone, { linkedClanCount: clans.length }),
  );
}

async function replyWithActivity(
  interaction: ChatInputCommandInteraction,
  snapshots: readonly ActivityClanSnapshots[],
  options: BuildActivityOptions,
): Promise<void> {
  if (snapshots.length === 0 || snapshots.every((entry) => entry.members.length === 0)) {
    await interaction.editReply({
      content: formatActivityNoDataMessage(collectActivitySnapshotContext(snapshots, [], options)),
    });
    return;
  }
  await interaction.editReply({ embeds: [buildActivityEmbed(snapshots, options)] });
}

interface BuildActivityOptions {
  readonly days: ActivityDays;
  readonly limit: number;
  readonly timezone?: string;
  readonly timezoneSource?: ActivityTimezoneSource;
  readonly clanFilter?: string;
  readonly linkedClanCount?: number;
  readonly now?: Date;
}

type ActivityTimezoneSource = 'option' | 'preference';

function buildActivityOptions(
  days: ActivityDays,
  limit: number,
  timezone: ActivityResolvedTimezone,
  context?: Pick<BuildActivityOptions, 'clanFilter' | 'linkedClanCount'>,
): BuildActivityOptions {
  return {
    days,
    limit,
    ...(timezone.timezone ? { timezone: timezone.timezone } : {}),
    ...(timezone.source ? { timezoneSource: timezone.source } : {}),
    ...(context?.clanFilter ? { clanFilter: context.clanFilter } : {}),
    ...(typeof context?.linkedClanCount === 'number'
      ? { linkedClanCount: context.linkedClanCount }
      : {}),
  };
}

interface ActivityResolvedTimezone {
  readonly timezone?: string;
  readonly source?: ActivityTimezoneSource;
}

async function resolveActivityTimezone(input: {
  readonly guildId: string;
  readonly userId: string;
  readonly timezoneOption?: string;
  readonly preferences?: Pick<DatabaseUserTimezonePreferenceStore, 'getUserTimezonePreference'>;
}): Promise<ActivityResolvedTimezone> {
  if (input.timezoneOption) return { timezone: input.timezoneOption, source: 'option' };
  if (!input.preferences) return {};

  const preference = await input.preferences.getUserTimezonePreference(input.guildId, input.userId);
  const timezone = preference?.timezone.trim();
  if (!timezone || !isValidTimeZone(timezone)) return {};
  return { timezone, source: 'preference' };
}

export function buildActivityEmbed(
  snapshots: readonly ActivityClanSnapshots[],
  options: BuildActivityOptions,
): EmbedBuilder {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.days * 24 * 60 * 60 * 1000);
  const summaries = snapshots
    .map((snapshot) => summarizeClanActivity(snapshot, cutoff, options.limit))
    .filter((summary) => summary.totalMembers > 0)
    .sort((a, b) => b.activeMembers - a.activeMembers || a.clanName.localeCompare(b.clanName));
  const context = collectActivitySnapshotContext(snapshots, summaries, options);

  return new EmbedBuilder()
    .setTitle('Clan Activity')
    .setDescription(truncateEmbedDescription(formatActivityDescription(summaries, context)))
    .addFields({
      name: 'Snapshot context',
      value: formatActivitySourceContext(context),
      inline: false,
    })
    .setFooter({
      text: `Window: ${options.days} day(s) · Limit: ${options.limit} · Timezone: ${context.timezoneLabel}`,
    });
}

interface ActivitySnapshotContext {
  readonly snapshotsConsidered: number;
  readonly memberRowsConsidered: number;
  readonly visibleRows: number;
  readonly activeMembers: number;
  readonly inactiveMembers: number;
  readonly activePercentage: number;
  readonly linkedClanCount?: number;
  readonly clansWithSnapshots: number;
  readonly latestFetchedAt?: Date;
  readonly latestSnapshotAge?: string;
  readonly snapshotFreshnessGuidance: string;
  readonly filters: readonly string[];
  readonly timezoneLabel: string;
  readonly timezoneValue?: string;
  readonly windowLabel: string;
}

function collectActivitySnapshotContext(
  snapshots: readonly ActivityClanSnapshots[],
  summaries: readonly ActivityClanSummary[],
  options: BuildActivityOptions,
): ActivitySnapshotContext {
  const now = options.now ?? new Date();
  const latestFetchedAt = snapshots
    .flatMap((snapshot) => snapshot.members.map((member) => member.lastFetchedAt))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const activeMembers = summaries.reduce((total, summary) => total + summary.activeMembers, 0);
  const totalMembers = summaries.reduce((total, summary) => total + summary.totalMembers, 0);
  const inactiveMembers = Math.max(0, totalMembers - activeMembers);

  return {
    snapshotsConsidered: snapshots.length,
    memberRowsConsidered: snapshots.reduce((total, snapshot) => total + snapshot.members.length, 0),
    visibleRows: summaries.reduce((total, summary) => total + summary.recentMembers.length, 0),
    activeMembers,
    inactiveMembers,
    activePercentage: totalMembers === 0 ? 0 : Math.round((activeMembers / totalMembers) * 100),
    ...(typeof options.linkedClanCount === 'number'
      ? { linkedClanCount: options.linkedClanCount }
      : {}),
    clansWithSnapshots: snapshots.filter((snapshot) => snapshot.members.length > 0).length,
    ...(latestFetchedAt ? { latestFetchedAt } : {}),
    ...(latestFetchedAt ? { latestSnapshotAge: formatSnapshotAge(latestFetchedAt, now) } : {}),
    snapshotFreshnessGuidance: formatSnapshotFreshnessGuidance(latestFetchedAt, now),
    filters: formatActivityFilters(options),
    timezoneLabel: formatActivityTimezoneLabel(options),
    ...(options.timezone ? { timezoneValue: options.timezone } : {}),
    windowLabel: formatActivityWindowLabel(options.days),
  };
}

function formatActivitySourceContext(context: ActivitySnapshotContext): string {
  const linkedClans =
    typeof context.linkedClanCount === 'number' ? `${context.linkedClanCount}` : 'unknown';
  const latestSnapshot = formatLatestSnapshotLabel(context);
  return [
    'Source: persisted clan-member snapshots only; no live Clash API lookup or history backfill.',
    `Linked clans: ${linkedClans} configured · ${context.snapshotsConsidered} snapshot set(s) returned · ${context.clansWithSnapshots} with member rows.`,
    `Snapshot rows: ${context.memberRowsConsidered} considered · ${context.visibleRows} shown in the recent-members list.`,
    `Activity: ${context.activeMembers} active · ${context.inactiveMembers} inactive · ${context.activePercentage}% active within ${context.windowLabel}.`,
    `Filters: ${context.filters.join(' · ')} · timezone=${context.timezoneLabel}.`,
    `Freshness: ${latestSnapshot} · ${context.snapshotFreshnessGuidance}.`,
    'Guidance: if no rows appear, link/configure a clan, wait for clan polling, and confirm the selected filter matches a linked clan.',
  ].join('\n');
}

function formatActivityNoDataMessage(context: ActivitySnapshotContext): string {
  const linkedClanText =
    typeof context.linkedClanCount === 'number'
      ? `Linked clans: ${context.linkedClanCount}.`
      : 'Linked clan coverage is unavailable.';
  return [
    ACTIVITY_NO_SNAPSHOT_MESSAGE,
    `${linkedClanText} Snapshots returned: ${context.snapshotsConsidered}; member rows considered: ${context.memberRowsConsidered}.`,
    `Filters: ${context.filters.join(' · ')} · timezone=${context.timezoneLabel}.`,
    `Freshness: ${formatLatestSnapshotLabel(context)} · ${context.snapshotFreshnessGuidance}.`,
    'This command uses persisted snapshots only; there is no live Clash API fallback.',
  ].join(' ');
}

function formatLatestSnapshotLabel(context: ActivitySnapshotContext): string {
  if (!context.latestFetchedAt) return 'none yet';
  return `${time(context.latestFetchedAt, 'R')} (${context.latestSnapshotAge ?? 'age unknown'} old)`;
}

function formatSnapshotAge(snapshotAt: Date, now: Date): string {
  const ageMs = Math.max(0, now.getTime() - snapshotAt.getTime());
  const totalMinutes = Math.floor(ageMs / 60_000);
  if (totalMinutes < 1) return 'less than 1m';

  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    ...(days > 0 ? [`${days}d`] : []),
    ...(hours > 0 ? [`${hours}h`] : []),
    ...(days === 0 && minutes > 0 ? [`${minutes}m`] : []),
  ];
  return parts.join(' ');
}

function formatSnapshotFreshnessGuidance(snapshotAt: Date | undefined, now: Date): string {
  if (!snapshotAt) return 'No stored fetch yet; wait for the next clan polling pass';

  const ageMs = Math.max(0, now.getTime() - snapshotAt.getTime());
  if (ageMs > 24 * 60 * 60 * 1000) {
    return 'Snapshot looks stale; check worker health if activity should be current';
  }
  return 'Snapshot is recent enough for persisted-output diagnostics';
}

function formatActivityFilters(options: BuildActivityOptions): string[] {
  return [
    `clans=${options.clanFilter ?? 'all linked clans'}`,
    `days=${options.days}`,
    `limit=${options.limit}`,
  ];
}

function formatActivityWindowLabel(days: ActivityDays): string {
  const bucket = days <= 3 ? 'hourly-style recent activity window' : 'daily-style activity window';
  return `${days} day(s), ${bucket}`;
}

export function summarizeClanActivity(
  snapshot: ActivityClanSnapshots,
  cutoff: Date,
  limit: number,
): ActivityClanSummary {
  const totalMembers = snapshot.members.length;
  const activeMembers = snapshot.members.filter((member) => member.lastSeenAt >= cutoff).length;
  const clanName = snapshot.clan.alias ?? snapshot.clan.name ?? 'Linked Clan';
  return {
    clanTag: snapshot.clan.clanTag,
    clanName,
    totalMembers,
    activeMembers,
    activePercentage: totalMembers === 0 ? 0 : Math.round((activeMembers / totalMembers) * 100),
    recentMembers: [...snapshot.members]
      .sort(
        (a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime() || a.name.localeCompare(b.name),
      )
      .slice(0, limit),
  };
}

interface ActivityClanSummary {
  readonly clanTag: string;
  readonly clanName: string;
  readonly totalMembers: number;
  readonly activeMembers: number;
  readonly activePercentage: number;
  readonly recentMembers: readonly ActivitySnapshotRow[];
}

function formatActivityDescription(
  summaries: readonly ActivityClanSummary[],
  context: ActivitySnapshotContext,
): string {
  if (summaries.length === 0) {
    return [
      'No persisted member activity rows matched the linked clan filter yet.',
      'Wait for clan polling to store snapshots, or verify the clan filter matches a linked clan.',
    ].join(' ');
  }
  return summaries
    .map((summary) => {
      const recent = summary.recentMembers.length
        ? summary.recentMembers
            .map(
              (member, index) =>
                `${index + 1}. ${escapeMarkdown(member.name)} (\`${member.playerTag}\`) · last seen ${formatActivityTimestamp(member.lastSeenAt, context.timezoneValue)}`,
            )
            .join('\n')
        : 'No recent member rows in the stored snapshot.';
      return [
        `**${escapeMarkdown(summary.clanName)}** (${summary.clanTag})`,
        `${summary.activeMembers}/${summary.totalMembers} active · ${summary.activePercentage}% active`,
        recent,
      ].join('\n');
    })
    .join('\n\n');
}

function formatActivityTimestamp(date: Date, timezone: string | undefined): string {
  if (!timezone) return time(date, 'R');
  return `${formatZonedDateTime(date, timezone)} (${time(date, 'R')})`;
}

function formatZonedDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date);
}

function formatActivityTimezoneLabel(
  options: Pick<BuildActivityOptions, 'timezone' | 'timezoneSource'>,
): string {
  if (!options.timezone) return 'UTC/default';
  return options.timezoneSource === 'preference'
    ? `${options.timezone} (saved preference)`
    : options.timezone;
}

function parseActivityDays(value: number | null): ActivityDays {
  return ACTIVITY_DAYS.includes(value as ActivityDays)
    ? (value as ActivityDays)
    : DEFAULT_ACTIVITY_DAYS;
}

function clampActivityLimit(value: number | null): number {
  if (!value) return DEFAULT_ACTIVITY_LIMIT;
  return Math.min(MAX_ACTIVITY_LIMIT, Math.max(1, value));
}

export function resolveActivityClan(
  clans: readonly ActivityLinkedClan[],
  query: string,
): ActivityLinkedClan | undefined {
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

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function clanMatchesQuery(clan: ActivityLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function compareActivityClanChoices(a: ActivityLinkedClan, b: ActivityLinkedClan): number {
  return (
    normalizeChoiceSortValue(a.name).localeCompare(normalizeChoiceSortValue(b.name)) ||
    normalizeChoiceSortValue(a.alias).localeCompare(normalizeChoiceSortValue(b.alias)) ||
    normalizeChoiceSortValue(a.clanTag).localeCompare(normalizeChoiceSortValue(b.clanTag)) ||
    a.id.localeCompare(b.id)
  );
}

function normalizeChoiceSortValue(value: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

function formatClanChoiceName(clan: ActivityLinkedClan): string {
  const alias = clan.alias?.trim();
  const name = clan.name?.trim();
  const context = [
    name ? `name: ${name}` : undefined,
    alias ? `alias: ${alias}` : undefined,
    `tag: ${clan.clanTag}`,
  ].filter((part): part is string => Boolean(part));

  return context.join(' · ').slice(0, 100);
}

function formatActivityClanLabel(clan: ActivityLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim();
  return label ? `${label} (${clan.clanTag})` : clan.clanTag;
}

function truncateEmbedDescription(text: string): string {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…`;
}
