import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';

export const EVENTS_COMMAND_NAME = 'events';
export const EVENTS_COMMAND_DESCRIPTION = 'Show upcoming Clash of Clans game events.';
export const DEFAULT_EVENTS_EMBED_COLOR = 0x5865f2;
export const EVENTS_FIRST_PASS_NOTE =
  "First pass: this calendar uses approximate recurring UTC windows instead of ClashPerk's live event feed.";

export const eventsCommandData = new SlashCommandBuilder()
  .setName(EVENTS_COMMAND_NAME)
  .setDescription(EVENTS_COMMAND_DESCRIPTION)
  .setDMPermission(true);

export interface EventCalendarItem {
  name: string;
  startsAt: Date;
  endsAt?: Date;
  description: string;
}

export interface EventsView {
  botName: string;
  botAvatarUrl?: string;
  color?: ColorResolvable;
  generatedAt: Date;
  events: readonly EventCalendarItem[];
  note: string;
}

export function createEventsSlashCommand(): SlashCommandDefinition {
  return {
    name: EVENTS_COMMAND_NAME,
    data: eventsCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      await executeEventsInteraction(interaction, context);
    },
  };
}

export async function executeEventsInteraction(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const view = collectEventsView(interaction, context);

  await interaction.reply({
    embeds: [buildEventsEmbed(view)],
    ephemeral: false,
  });
}

export function collectEventsView(
  source: Pick<ChatInputCommandInteraction, 'guild'>,
  context: CommandContext,
  now = new Date(),
): EventsView {
  const botAvatarUrl = context.client.user?.displayAvatarURL({ extension: 'png' });

  return {
    botName: context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate',
    ...(botAvatarUrl ? { botAvatarUrl } : {}),
    color: source.guild?.members.me?.displayColor || DEFAULT_EVENTS_EMBED_COLOR,
    generatedAt: now,
    events: buildApproximateEventCalendar(now),
    note: EVENTS_FIRST_PASS_NOTE,
  };
}

export function buildEventsEmbed(view: EventsView): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(view.color ?? DEFAULT_EVENTS_EMBED_COLOR)
    .setTitle('Upcoming Game Events Calendar')
    .setDescription(view.note)
    .setAuthor(
      view.botAvatarUrl
        ? { name: view.botName, iconURL: view.botAvatarUrl }
        : { name: view.botName },
    )
    .addFields(
      view.events.map((event) => ({
        name: event.name,
        value: formatCalendarItem(event),
        inline: false,
      })),
    )
    .setFooter({ text: `Synced ${formatUtcDateTime(view.generatedAt)}` })
    .setTimestamp(view.generatedAt);
}

export function buildApproximateEventCalendar(now = new Date()): EventCalendarItem[] {
  return [
    nextCwlWindow(now),
    nextClanGamesWindow(now),
    nextRaidWeekendWindow(now),
    nextSeasonReset(now),
  ].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
}

function nextClanGamesWindow(now: Date): EventCalendarItem {
  const current = utcDate(now.getUTCFullYear(), now.getUTCMonth(), 22);
  const startsAt = isBeforeWindowEnd(now, current, 6) ? current : addUtcMonths(current, 1);

  return {
    name: 'Clan Games',
    startsAt,
    endsAt: addUtcDays(startsAt, 6),
    description: 'Approximate monthly Clan Games window around days 22–28 UTC.',
  };
}

function nextCwlWindow(now: Date): EventCalendarItem {
  const current = utcDate(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const startsAt = isBeforeWindowEnd(now, current, 10) ? current : addUtcMonths(current, 1);

  return {
    name: 'Clan War Leagues',
    startsAt,
    endsAt: addUtcDays(startsAt, 10),
    description: 'Approximate signup and early-month CWL window around days 1–11 UTC.',
  };
}

function nextRaidWeekendWindow(now: Date): EventCalendarItem {
  const day = now.getUTCDay();
  const daysUntilFriday = (5 - day + 7) % 7;
  const thisFriday = utcDate(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysUntilFriday,
  );
  const thisMonday = addUtcDays(thisFriday, 3);
  const startsAt = now.getTime() < thisMonday.getTime() ? thisFriday : addUtcDays(thisFriday, 7);

  return {
    name: 'Raid Weekend',
    startsAt,
    endsAt: addUtcDays(startsAt, 3),
    description: 'Approximate weekly Clan Capital Raid Weekend from Friday to Monday UTC.',
  };
}

function nextSeasonReset(now: Date): EventCalendarItem {
  const startsAt = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);

  return {
    name: 'Season Reset',
    startsAt,
    description: 'Approximate current season reset at the next UTC month boundary.',
  };
}

function formatCalendarItem(event: EventCalendarItem): string {
  const range = event.endsAt
    ? `${formatTimestamp(event.startsAt)} → ${formatTimestamp(event.endsAt)}`
    : formatTimestamp(event.startsAt);
  return `${range}\n${event.description}`;
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

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

function addUtcDays(date: Date, days: number): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);
}

function addUtcMonths(date: Date, months: number): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate());
}
