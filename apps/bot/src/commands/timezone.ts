import type { DatabaseUserTimezonePreferenceStore } from '@clashmate/database';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';

export const TIMEZONE_COMMAND_NAME = 'timezone';
export const TIMEZONE_COMMAND_DESCRIPTION = 'Show the current time for an IANA timezone.';
export const DEFAULT_TIMEZONE_EMBED_COLOR = 0x5865f2;
export const TIMEZONE_FIRST_PASS_NOTE =
  'Your per-server timezone preference has been saved for ClashMate reminders and event displays.';
const INVALID_TIMEZONE_MESSAGE = [
  'I could not recognize that timezone.',
  'Choose an autocomplete suggestion or enter a valid IANA timezone such as `UTC`, `America/New_York`, `Europe/London`, or `Asia/Jakarta`.',
  'City nicknames are accepted for common locations, but saved preferences are stored as canonical IANA identifiers.',
].join('\n');

export interface TimezoneCommandOptions {
  store: DatabaseUserTimezonePreferenceStore;
}

export const timezoneCommandData = new SlashCommandBuilder()
  .setName(TIMEZONE_COMMAND_NAME)
  .setDescription(TIMEZONE_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('location')
      .setDescription('IANA timezone identifier, such as UTC, America/New_York, or Asia/Jakarta.')
      .setAutocomplete(true)
      .setRequired(true),
  );

export interface TimezoneView {
  timezone: string;
  localDateTime: string;
  gmtOffset: string;
  note: string;
  preferenceSummary: string;
  botName: string;
  botAvatarUrl?: string;
  color?: ColorResolvable;
}

interface TimeZoneDateParts {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
}

type TimeZoneDatePartKey = keyof TimeZoneDateParts;

const TIME_ZONE_DATE_PART_KEYS = new Set<string>([
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
]);

const FALLBACK_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Jakarta',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

const COMMON_TIMEZONE_ALIASES = new Map<string, string>([
  ['jakarta', 'Asia/Jakarta'],
  ['new york', 'America/New_York'],
  ['nyc', 'America/New_York'],
  ['los angeles', 'America/Los_Angeles'],
  ['la', 'America/Los_Angeles'],
  ['london', 'Europe/London'],
  ['paris', 'Europe/Paris'],
  ['tokyo', 'Asia/Tokyo'],
  ['sydney', 'Australia/Sydney'],
  ['gmt', 'UTC'],
  ['zulu', 'UTC'],
]);

type SupportedTimeZoneIntl = typeof Intl & {
  readonly supportedValuesOf?: (key: 'timeZone') => string[];
};

export function createTimezoneSlashCommand(
  options: TimezoneCommandOptions,
): SlashCommandDefinition {
  return {
    name: TIMEZONE_COMMAND_NAME,
    data: timezoneCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      await executeTimezoneInteraction(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== TIMEZONE_COMMAND_NAME) return;
      await autocompleteTimezone(interaction);
    },
  };
}

async function autocompleteTimezone(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'location') {
    await interaction.respond([]);
    return;
  }

  await interaction.respond(filterTimezoneChoices(String(focused.value ?? '')));
}

export function filterTimezoneChoices(query: string): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  const choices = new Map<string, string>();

  for (const timezone of listSupportedTimezones()) {
    const normalizedTimezone = timezone.toLowerCase();
    if (timezoneMatchesQuery(normalizedTimezone, normalizedQuery)) choices.set(timezone, timezone);
  }

  for (const [alias, timezone] of COMMON_TIMEZONE_ALIASES) {
    if (!canonicalizeTimeZone(timezone)) continue;
    const normalizedTimezone = timezone.toLowerCase();
    if (
      !normalizedQuery ||
      alias.includes(normalizedQuery) ||
      timezoneMatchesQuery(normalizedTimezone, normalizedQuery)
    ) {
      choices.set(`${timezone} (${alias})`, timezone);
    }
  }

  return [...choices.entries()]
    .map((timezone, index) => ({
      name: timezone[0],
      value: timezone[1],
      index,
      normalizedTimezone: timezone[0].toLowerCase(),
    }))
    .sort((left, right) => {
      const leftRank = timezoneMatchRank(left.normalizedTimezone, normalizedQuery);
      const rightRank = timezoneMatchRank(right.normalizedTimezone, normalizedQuery);
      return leftRank - rightRank || left.index - right.index;
    })
    .slice(0, 25)
    .map(({ name, value }) => ({ name, value }));
}

export async function executeTimezoneInteraction(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  options: TimezoneCommandOptions,
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: '`/timezone` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const timezoneInput = interaction.options.getString('location', true).trim();
  const timezone = canonicalizeTimeZone(timezoneInput);
  if (!timezone) {
    await interaction.reply({
      content: INVALID_TIMEZONE_MESSAGE,
      ephemeral: true,
    });
    return;
  }

  await options.store.setUserTimezonePreference({
    guildId: interaction.guildId,
    guildName: interaction.guild?.name ?? null,
    actorDiscordUserId: interaction.user.id,
    discordUserId: interaction.user.id,
    timezone,
  });

  await interaction.reply({
    embeds: [buildTimezoneEmbed(collectTimezoneView(timezone, interaction, context))],
    ephemeral: true,
  });
}

export function collectTimezoneView(
  timezone: string,
  source: Pick<ChatInputCommandInteraction, 'guild'>,
  context: CommandContext,
  now = new Date(),
): TimezoneView {
  const botAvatarUrl = context.client.user?.displayAvatarURL({ extension: 'png' });

  return {
    timezone,
    localDateTime: formatLocalDateTime(timezone, now),
    gmtOffset: formatGmtOffset(timezone, now),
    note: TIMEZONE_FIRST_PASS_NOTE,
    preferenceSummary: [
      `Canonical timezone: \`${timezone}\``,
      'Scope: this Discord server only.',
      'Persistence: saved in guild settings and audit logged as a timezone preference update.',
    ].join('\n'),
    botName: context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate',
    ...(botAvatarUrl ? { botAvatarUrl } : {}),
    color: source.guild?.members.me?.displayColor || DEFAULT_TIMEZONE_EMBED_COLOR,
  };
}

export function buildTimezoneEmbed(view: TimezoneView): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(view.color ?? DEFAULT_TIMEZONE_EMBED_COLOR)
    .setTitle('Server timezone preference saved')
    .setDescription(view.note)
    .setAuthor(
      view.botAvatarUrl
        ? { name: view.botName, iconURL: view.botAvatarUrl }
        : { name: view.botName },
    )
    .addFields(
      { name: 'Saved server preference', value: view.preferenceSummary, inline: false },
      { name: 'Timezone', value: `\`${view.timezone}\``, inline: false },
      { name: 'Current local time', value: view.localDateTime, inline: false },
      { name: 'Approximate GMT offset', value: `GMT${view.gmtOffset}`, inline: false },
      {
        name: 'Used by',
        value: 'Events, reminders, and other server-aware ClashMate timestamps for you.',
        inline: false,
      },
    );
}

export function canonicalizeTimeZone(timezone: string): string | null {
  const trimmed = timezone.trim();
  if (!trimmed) return null;

  const aliasMatch = COMMON_TIMEZONE_ALIASES.get(trimmed.toLowerCase());
  if (aliasMatch) return canonicalizeTimeZone(aliasMatch);

  const supported = listSupportedTimezones();
  const supportedMatch = supported.find(
    (supportedTimezone) => supportedTimezone.toLowerCase() === trimmed.toLowerCase(),
  );
  if (supportedMatch) return supportedMatch;

  try {
    const canonicalTimezone = new Intl.DateTimeFormat('en-US', {
      timeZone: trimmed,
    }).resolvedOptions().timeZone;
    const canonicalSupportedMatch = supported.find(
      (supportedTimezone) => supportedTimezone.toLowerCase() === canonicalTimezone.toLowerCase(),
    );
    return canonicalSupportedMatch ?? canonicalTimezone;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function isValidTimeZone(timezone: string): boolean {
  if (!timezone.trim()) return false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

function listSupportedTimezones(): string[] {
  const supportedValuesOf = (Intl as SupportedTimeZoneIntl).supportedValuesOf;
  const timezones = supportedValuesOf?.('timeZone') ?? [];
  const uniqueTimezones = new Set<string>(['UTC', ...timezones, ...FALLBACK_TIMEZONES]);
  return [...uniqueTimezones].filter(isValidTimeZone);
}

function timezoneMatchesQuery(normalizedTimezone: string, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const timezoneTokens = tokenizeTimezone(normalizedTimezone);
  const queryTokens = tokenizeTimezone(normalizedQuery);
  return (
    normalizedTimezone.startsWith(normalizedQuery) ||
    normalizedTimezone.includes(normalizedQuery) ||
    queryTokens.every((queryToken) =>
      timezoneTokens.some((timezoneToken) => timezoneToken.startsWith(queryToken)),
    )
  );
}

function timezoneMatchRank(normalizedTimezone: string, normalizedQuery: string): number {
  if (!normalizedQuery) return normalizedTimezone === 'utc' ? 0 : 1;
  if (normalizedTimezone === 'utc' && 'utc'.startsWith(normalizedQuery)) return 0;
  if (normalizedTimezone === normalizedQuery) return 1;
  if (normalizedTimezone.startsWith(normalizedQuery)) return 2;
  const timezoneTokens = tokenizeTimezone(normalizedTimezone);
  const queryTokens = tokenizeTimezone(normalizedQuery);
  if (timezoneTokens.some((timezoneToken) => timezoneToken === normalizedQuery)) return 3;
  if (
    queryTokens.every((queryToken) =>
      timezoneTokens.some((timezoneToken) => timezoneToken.startsWith(queryToken)),
    )
  ) {
    return 4;
  }
  return 5;
}

function tokenizeTimezone(value: string): string[] {
  return value
    .split(/[\s/_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function formatLocalDateTime(timezone: string, date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date);
}

export function formatGmtOffset(timezone: string, date = new Date()): string {
  const offsetMinutes = getTimeZoneOffsetMinutes(timezone, date);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (absoluteMinutes % 60).toString().padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function isTimeZoneDatePart(part: string): part is TimeZoneDatePartKey {
  return TIME_ZONE_DATE_PART_KEYS.has(part);
}

function getTimeZoneOffsetMinutes(timezone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const values: TimeZoneDateParts = {};
  for (const part of parts) {
    if (!isTimeZoneDatePart(part.type)) continue;
    values[part.type] = Number(part.value);
  }

  const zonedUtcMs = Date.UTC(
    values.year ?? 0,
    (values.month ?? 1) - 1,
    values.day ?? 1,
    values.hour ?? 0,
    values.minute ?? 0,
    values.second ?? 0,
  );

  return Math.round((zonedUtcMs - date.getTime()) / 60_000);
}
