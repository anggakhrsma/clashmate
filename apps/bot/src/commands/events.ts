import type { DatabaseUserTimezonePreferenceStore } from '@clashmate/database';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { canonicalizeTimeZone, filterTimezoneChoices } from './timezone.js';

export const EVENTS_COMMAND_NAME = 'events';
export const EVENTS_COMMAND_DESCRIPTION = 'Shows the next in-game events.';
export const DEFAULT_EVENTS_EMBED_COLOR = 0x5865f2;
export const EVENTS_FIRST_PASS_NOTE =
  'First pass/static schedule: ClashMate estimates recurring Clash of Clans event times from known UTC windows; this is not a live Supercell event feed.';
const EVENTS_SCHEDULE_SOURCE = 'Source: static ClashMate schedule parity with ClashPerk /events.';

export const eventsCommandData = new SlashCommandBuilder()
  .setName(EVENTS_COMMAND_NAME)
  .setDescription(EVENTS_COMMAND_DESCRIPTION)
  .setDMPermission(true)
  .addStringOption((option) =>
    option
      .setName('timezone')
      .setDescription('Override times with an IANA timezone, such as UTC or Asia/Jakarta.')
      .setAutocomplete(true)
      .setRequired(false),
  );

export interface EventCalendarItem {
  name: string;
  startsAt: Date;
  endsAt?: Date;
  status: 'Active now' | 'Ends' | 'Starts' | 'Next';
  description: string;
}

export interface EventsView {
  botName: string;
  botAvatarUrl?: string;
  color?: ColorResolvable;
  generatedAt: Date;
  events: readonly EventCalendarItem[];
  note: string;
  timezone?: string;
  timezoneSource: 'option' | 'preference' | 'utc';
  timezoneFallbackReason?: EventsTimezoneFallbackReason;
}

export interface EventsCommandOptions {
  readonly timezones?: Pick<DatabaseUserTimezonePreferenceStore, 'getUserTimezonePreference'>;
}

export function createEventsSlashCommand(
  options: EventsCommandOptions = {},
): SlashCommandDefinition {
  return {
    name: EVENTS_COMMAND_NAME,
    data: eventsCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      await executeEventsInteraction(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== EVENTS_COMMAND_NAME) return;
      await autocompleteEventsTimezone(interaction);
    },
  };
}

async function autocompleteEventsTimezone(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'timezone') {
    await interaction.respond([]);
    return;
  }

  await interaction.respond(filterTimezoneChoices(String(focused.value ?? '')));
}

export async function executeEventsInteraction(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  options: EventsCommandOptions = {},
): Promise<void> {
  const timezoneInput = interaction.options.getString('timezone')?.trim();
  const canonicalTimezoneInput = timezoneInput ? canonicalizeTimeZone(timezoneInput) : null;
  const timezoneOption = canonicalTimezoneInput ?? undefined;
  if (timezoneInput && !timezoneOption) {
    await interaction.reply({
      content:
        'Please provide a valid IANA timezone identifier, such as `UTC`, `America/New_York`, or `Asia/Jakarta`.',
      ephemeral: true,
    });
    return;
  }

  const timezone = await resolveEventsTimezone({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    ...(timezoneOption ? { timezoneOption } : {}),
    ...(options.timezones ? { preferences: options.timezones } : {}),
  });
  const view = collectEventsView(interaction, context, new Date(), timezone);

  await interaction.reply({
    embeds: [buildEventsEmbed(view)],
    ephemeral: false,
  });
}

export function collectEventsView(
  source: Pick<ChatInputCommandInteraction, 'guild'>,
  context: CommandContext,
  now = new Date(),
  timezone: EventsResolvedTimezone = { source: 'utc' },
): EventsView {
  const botAvatarUrl = context.client.user?.displayAvatarURL({ extension: 'png' });

  return {
    botName: context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate',
    ...(botAvatarUrl ? { botAvatarUrl } : {}),
    color: source.guild?.members.me?.displayColor || DEFAULT_EVENTS_EMBED_COLOR,
    generatedAt: now,
    events: buildApproximateEventCalendar(now),
    note: formatEventsNote(timezone),
    ...(timezone.timezone ? { timezone: timezone.timezone } : {}),
    timezoneSource: timezone.source,
    ...(timezone.fallbackReason ? { timezoneFallbackReason: timezone.fallbackReason } : {}),
  };
}

export function buildEventsEmbed(view: EventsView): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(view.color ?? DEFAULT_EVENTS_EMBED_COLOR)
    .setTitle('Upcoming Events!')
    .setDescription(view.note)
    .setAuthor(
      view.botAvatarUrl
        ? { name: view.botName, iconURL: view.botAvatarUrl }
        : { name: view.botName },
    )
    .setFooter({ text: `Synced ${formatFooterDateTime(view)}` })
    .setTimestamp(view.generatedAt);

  if (view.events.length === 0) {
    embed.addFields(...buildEventsDiagnosticFields(view));
    embed.addFields({
      name: 'No events found',
      value:
        'The static event schedule did not produce upcoming events. Try again later; if this persists, ClashMate needs its static schedule updated.',
      inline: false,
    });
    return embed;
  }

  embed.addFields(...buildEventsDiagnosticFields(view));
  embed.addFields(
    view.events.map((event, index, events) => ({
      name: event.name,
      value: `${formatCalendarItem(event, view.timezone)}${index === events.length - 1 ? '' : '\n\u200b'}`,
      inline: false,
    })),
  );

  return embed;
}

interface EventsResolvedTimezone {
  readonly timezone?: string;
  readonly source: 'option' | 'preference' | 'utc';
  readonly fallbackReason?: EventsTimezoneFallbackReason;
}

type EventsTimezoneFallbackReason =
  | 'dm'
  | 'missing-preference'
  | 'invalid-preference'
  | 'read-failed';

async function resolveEventsTimezone(input: {
  readonly guildId: string | null;
  readonly userId: string;
  readonly timezoneOption?: string;
  readonly preferences?: Pick<DatabaseUserTimezonePreferenceStore, 'getUserTimezonePreference'>;
}): Promise<EventsResolvedTimezone> {
  if (input.timezoneOption) return { timezone: input.timezoneOption, source: 'option' };
  if (!input.guildId) return { source: 'utc', fallbackReason: 'dm' };
  if (!input.preferences) return { source: 'utc', fallbackReason: 'missing-preference' };

  try {
    const preference = await input.preferences.getUserTimezonePreference(
      input.guildId,
      input.userId,
    );
    const timezone = preference?.timezone.trim();
    const canonicalTimezone = timezone ? canonicalizeTimeZone(timezone) : null;
    if (!timezone) return { source: 'utc', fallbackReason: 'missing-preference' };
    if (!canonicalTimezone) return { source: 'utc', fallbackReason: 'invalid-preference' };
    return { timezone: canonicalTimezone, source: 'preference' };
  } catch {
    return { source: 'utc', fallbackReason: 'read-failed' };
  }
}

export function buildApproximateEventCalendar(now = new Date()): EventCalendarItem[] {
  return [
    nextClanGamesEvent(now),
    nextCwlEvent(now),
    nextSeasonReset(now),
    nextRaidWeekendEvent(now),
  ]
    .filter((event): event is EventCalendarItem => event !== null)
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
}

function nextClanGamesEvent(now: Date): EventCalendarItem {
  const current = utcDate(now.getUTCFullYear(), now.getUTCMonth(), 22, 8);
  const startsAt = isBeforeWindowEnd(now, current, 6) ? current : addUtcMonths(current, 1);
  const endsAt = addUtcDays(startsAt, 6);
  const active = now.getTime() >= startsAt.getTime() && now.getTime() < endsAt.getTime();

  return {
    name: active ? 'Clan Games (Ending)' : 'Clan Games',
    startsAt: active ? endsAt : startsAt,
    status: active ? 'Ends' : 'Starts',
    description: active
      ? 'Approximate Clan Games ending time for the current monthly event.'
      : 'Approximate monthly Clan Games start around day 22 at 08:00 UTC.',
  };
}

function nextCwlEvent(now: Date): EventCalendarItem {
  const current = utcDate(now.getUTCFullYear(), now.getUTCMonth(), 1, 8);
  const startsAt = isBeforeWindowEnd(now, current, 10) ? current : addUtcMonths(current, 1);
  const signupEndsAt = addUtcDays(startsAt, 2);
  const endsAt = addUtcDays(startsAt, 10);
  const timestamp = now.getTime();

  if (timestamp >= startsAt.getTime() && timestamp < signupEndsAt.getTime()) {
    return {
      name: 'CWL Signup (Ending)',
      startsAt: signupEndsAt,
      status: 'Ends',
      description: 'Approximate CWL signup closing time for the current monthly league.',
    };
  }

  if (timestamp >= signupEndsAt.getTime() && timestamp < endsAt.getTime()) {
    return {
      name: 'CWL (Ending)',
      startsAt: endsAt,
      status: 'Ends',
      description: 'Approximate CWL ending time for the current monthly league.',
    };
  }

  return {
    name: 'CWL',
    startsAt,
    status: 'Starts',
    description: 'Approximate monthly CWL start around day 1 at 08:00 UTC.',
  };
}

function nextRaidWeekendEvent(now: Date): EventCalendarItem {
  const day = now.getUTCDay();
  const daysSinceFriday = (day - 5 + 7) % 7;
  const latestFriday = utcDate(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceFriday,
    7,
  );
  const latestMonday = addUtcDays(latestFriday, 3);
  const active = now.getTime() >= latestFriday.getTime() && now.getTime() < latestMonday.getTime();
  const startsAt =
    now.getTime() < latestMonday.getTime() ? latestFriday : addUtcDays(latestFriday, 7);
  const endsAt = addUtcDays(startsAt, 3);

  return {
    name: active ? 'Raid Weekend (Ending)' : 'Raid Weekend',
    startsAt: active ? endsAt : startsAt,
    status: active ? 'Ends' : 'Starts',
    description: active
      ? 'Approximate Clan Capital Raid Weekend ending time.'
      : 'Approximate weekly Clan Capital Raid Weekend start on Friday at 07:00 UTC.',
  };
}

function nextSeasonReset(now: Date): EventCalendarItem {
  const startsAt = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);

  return {
    name: 'Season Reset',
    startsAt,
    status: 'Next',
    description: 'Approximate current season reset at the next UTC month boundary.',
  };
}

function buildEventsDiagnosticFields(
  view: EventsView,
): { name: string; value: string; inline: boolean }[] {
  const activeCount = view.events.filter((event) => event.status === 'Ends').length;
  const upcomingCount = view.events.length - activeCount;
  const nextTransition = view.events[0];

  return [
    {
      name: 'Diagnostics',
      value: [
        `Generated: ${formatEventTimestamp(view.generatedAt, view.timezone)}`,
        `Timezone: ${formatTimezoneDiagnostic(view)}`,
        `Events: ${activeCount} active, ${upcomingCount} upcoming`,
        `Next transition: ${nextTransition ? formatNextTransition(nextTransition, view.timezone) : 'none'}`,
        'Schedule: static estimates only; no live Supercell event feed was queried.',
      ].join('\n'),
      inline: false,
    },
  ];
}

function formatNextTransition(event: EventCalendarItem, timezone: string | undefined): string {
  return `${event.name} ${event.status.toLowerCase()} ${formatEventTimestamp(event.startsAt, timezone)}`;
}

function formatTimezoneDiagnostic(view: EventsView): string {
  if (view.timezone) {
    const source = view.timezoneSource === 'option' ? 'option' : 'saved preference';
    return `${view.timezone} (${source})`;
  }

  const reason = view.timezoneFallbackReason
    ? `; ${formatTimezoneFallbackReason(view.timezoneFallbackReason)}`
    : '';
  return `UTC (fallback${reason})`;
}

function formatTimezoneFallbackReason(reason: EventsTimezoneFallbackReason): string {
  switch (reason) {
    case 'dm':
      return 'server preferences are unavailable in DMs';
    case 'missing-preference':
      return 'no saved /timezone preference';
    case 'invalid-preference':
      return 'saved /timezone preference is invalid';
    case 'read-failed':
      return 'saved /timezone preference could not be read';
  }
}

function formatCalendarItem(event: EventCalendarItem, timezone: string | undefined): string {
  const range = event.endsAt
    ? `${formatEventTimestamp(event.startsAt, timezone)} → ${formatEventTimestamp(event.endsAt, timezone)}`
    : formatEventTimestamp(event.startsAt, timezone);
  return `**${event.status}:** ${range}\n${event.description}`;
}

function formatEventTimestamp(date: Date, timezone: string | undefined): string {
  const discordTimestamp = formatTimestamp(date);
  if (!timezone) return discordTimestamp;
  return `${formatZonedDateTime(date, timezone)} · ${discordTimestamp}`;
}

function formatEventsNote(timezone: EventsResolvedTimezone): string {
  if (!timezone.timezone)
    return `${EVENTS_FIRST_PASS_NOTE}\n${EVENTS_SCHEDULE_SOURCE}\nTimes use Discord timestamps and fall back to UTC${formatTimezoneFallbackNote(timezone.fallbackReason)}.`;
  const source =
    timezone.source === 'option'
      ? 'the timezone option for this response'
      : 'your saved /timezone preference';
  return `${EVENTS_FIRST_PASS_NOTE}\n${EVENTS_SCHEDULE_SOURCE}\nLocal times use ${source} (${timezone.timezone}); Discord timestamps still render in each viewer's locale.`;
}

function formatTimezoneFallbackNote(reason: EventsTimezoneFallbackReason | undefined): string {
  switch (reason) {
    case 'dm':
      return ' because server timezone preferences are unavailable in DMs';
    case 'missing-preference':
      return ' because no timezone option or saved /timezone preference was available';
    case 'invalid-preference':
      return ' because the saved /timezone preference is invalid';
    case 'read-failed':
      return ' because the saved /timezone preference could not be read';
    default:
      return '';
  }
}

function formatFooterDateTime(
  view: Pick<EventsView, 'generatedAt' | 'timezone' | 'timezoneSource'>,
): string {
  if (!view.timezone) return formatUtcDateTime(view.generatedAt);
  const source = view.timezoneSource === 'option' ? 'timezone option' : 'saved preference';
  return `${formatZonedDateTime(view.generatedAt, view.timezone)} ${view.timezone} (${source})`;
}

function formatZonedDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date);
}

function formatTimestamp(date: Date): string {
  const seconds = Math.floor(date.getTime() / 1000);
  return `<t:${seconds}:F> (<t:${seconds}:R>)`;
}

function formatUtcDateTime(date: Date): string {
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
}

function isBeforeWindowEnd(now: Date, startsAt: Date, durationDays: number): boolean {
  return now.getTime() < addUtcDays(startsAt, durationDays).getTime();
}

function utcDate(year: number, month: number, day: number, hour = 0): Date {
  return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
}

function addUtcDays(date: Date, days: number): Date {
  return utcDate(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days,
    date.getUTCHours(),
  );
}

function addUtcMonths(date: Date, months: number): Date {
  return utcDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    date.getUTCDate(),
    date.getUTCHours(),
  );
}
