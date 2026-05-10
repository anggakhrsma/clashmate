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
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
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
    await interaction.editReply({ content: formatActivityNoDataMessage(options) });
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

  const embed = new EmbedBuilder()
    .setTitle('Clan Activity')
    .setDescription(
      truncateEmbedDescription(formatActivityDescription(summaries, options.timezone)),
    )
    .addFields({
      name: 'Source & coverage',
      value: formatActivitySourceContext(context),
      inline: false,
    })
    .setFooter({
      text: `Window: ${options.days} day(s) · Display timezone: ${formatActivityTimezoneLabel(options)}`,
    });

  return embed;
}

interface ActivitySnapshotContext {
  readonly snapshotsConsidered: number;
  readonly memberRowsConsidered: number;
  readonly visibleRows: number;
  readonly linkedClanCount?: number;
  readonly clansWithSnapshots: number;
  readonly latestFetchedAt?: Date;
  readonly filters: readonly string[];
  readonly timezoneLabel: string;
  readonly windowLabel: string;
}

function collectActivitySnapshotContext(
  snapshots: readonly ActivityClanSnapshots[],
  summaries: readonly ActivityClanSummary[],
  options: BuildActivityOptions,
): ActivitySnapshotContext {
  const latestFetchedAt = snapshots
    .flatMap((snapshot) => snapshot.members.map((member) => member.lastFetchedAt))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    snapshotsConsidered: snapshots.length,
    memberRowsConsidered: snapshots.reduce((total, snapshot) => total + snapshot.members.length, 0),
    visibleRows: summaries.reduce((total, summary) => total + summary.recentMembers.length, 0),
    ...(typeof options.linkedClanCount === 'number'
      ? { linkedClanCount: options.linkedClanCount }
      : {}),
    clansWithSnapshots: snapshots.filter((snapshot) => snapshot.members.length > 0).length,
    ...(latestFetchedAt ? { latestFetchedAt } : {}),
    filters: formatActivityFilters(options),
    timezoneLabel: formatActivityTimezoneLabel(options),
    windowLabel: formatActivityWindowLabel(options.days),
  };
}

function formatActivitySourceContext(context: ActivitySnapshotContext): string {
  const configuredClans =
    typeof context.linkedClanCount === 'number' ? `${context.linkedClanCount}` : 'unknown';
  return [
    'Source: persisted ClashMate clan-member snapshots written by clan polling. This command does not call the Clash API live, backfill history, or render the old image chart.',
    `Activity calculation: members with last-seen timestamps inside ${context.windowLabel} count as active; other stored members count as inactive for the percentage.`,
    `Linked clans configured: ${configuredClans} · Snapshot clans returned: ${context.snapshotsConsidered} · With member rows: ${context.clansWithSnapshots}`,
    `Member rows considered: ${context.memberRowsConsidered} · Visible rows: ${context.visibleRows}`,
    `Latest stored snapshot fetch: ${context.latestFetchedAt ? time(context.latestFetchedAt, 'R') : 'none; wait for polling or check linked clan setup'}`,
    `Active filters: ${context.filters.join(' · ')} · user=not filtered by /activity`,
    `Timezone: ${context.timezoneLabel}`,
    'Polling prerequisite: clan polling must run after the clan is linked/configured; search-only lookups and Discord user links do not create activity snapshots.',
  ].join('\n');
}

function formatActivityNoDataMessage(options: BuildActivityOptions): string {
  const linkedClanText =
    typeof options.linkedClanCount === 'number'
      ? `Linked clans configured: ${options.linkedClanCount}.`
      : 'Linked clan coverage is unavailable.';
  return [
    ACTIVITY_NO_SNAPSHOT_MESSAGE,
    linkedClanText,
    `Selected filters: ${formatActivityFilters(options).join(' · ')} · user=not filtered by /activity · timezone=${formatActivityTimezoneLabel(options)}.`,
    `Activity/inactivity calculation: ${formatActivityWindowLabel(options.days)}; members seen inside the window are active, stored members outside it are inactive.`,
    'Source coverage: stored linked-clan member snapshots only; there is no live Clash API fallback, historical ClickHouse activity table, or image chart renderer.',
    'Action: verify the clan is linked/configured for this server, check that the selected clan filter matches a linked clan, keep the worker running, and wait for clan polling to fetch fresh snapshots.',
  ].join('\n');
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
  timezone: string | undefined,
): string {
  if (summaries.length === 0)
    return 'No persisted member activity rows matched the linked clan filter yet; wait for clan polling to store snapshots.';
  return summaries
    .map((summary) => {
      const recent = summary.recentMembers.length
        ? summary.recentMembers
            .map(
              (member, index) =>
                `${index + 1}. ${escapeMarkdown(member.name)} (\`${member.playerTag}\`) · last seen ${formatActivityTimestamp(member.lastSeenAt, timezone)}`,
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

function formatClanChoiceName(clan: ActivityLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function formatActivityClanLabel(clan: ActivityLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim();
  return label ? `${label} (${clan.clanTag})` : clan.clanTag;
}

function truncateEmbedDescription(text: string): string {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…`;
}
