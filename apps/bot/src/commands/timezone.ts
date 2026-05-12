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
  'Common aliases like `london`, `nyc`, `tokyo`, and `gmt` are accepted, but saved preferences use canonical IANA identifiers.',
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
  requestedTimezone: string;
  canonicalizationSummary: string;
  localDateTime: string;
  gmtOffset: string;
  note: string;
  previousTimezoneSummary: string;
  preferenceSaveStatus: string;
  preferenceSummary: string;
  diagnosticSummary: string;
  botName: string;
  botAvatarUrl?: string;
  color?: ColorResolvable;
}

interface ParsedTimezoneInput {
  timezone: string;
  requestedTimezone: string;
  canonicalizationSummary: string;
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

interface TimezoneChoiceCandidate {
  readonly name: string;
  readonly value: string;
  readonly matchText: string;
  readonly hasAliasContext: boolean;
  readonly index: number;
}

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
  const candidates: TimezoneChoiceCandidate[] = [];
  let index = 0;

  for (const timezone of listSupportedTimezones()) {
    const normalizedTimezone = timezone.toLowerCase();
    if (timezoneMatchesQuery(normalizedTimezone, normalizedQuery)) {
      candidates.push({
        name: timezone,
        value: timezone,
        matchText: normalizedTimezone,
        hasAliasContext: false,
        index,
      });
      index += 1;
    }
  }

  for (const [timezone, aliases] of listCanonicalTimezoneAliases()) {
    const normalizedTimezone = timezone.toLowerCase();
    const matchingAliases = aliases.filter((alias) =>
      timezoneMatchesQuery(alias.toLowerCase(), normalizedQuery),
    );
    const timezoneMatches = timezoneMatchesQuery(normalizedTimezone, normalizedQuery);
    if (!normalizedQuery || timezoneMatches || matchingAliases.length > 0) {
      const labelAliases = matchingAliases.length > 0 ? matchingAliases : aliases;
      candidates.push({
        name: `${timezone} (${labelAliases.join(', ')})`,
        value: timezone,
        matchText: `${normalizedTimezone} ${aliases.join(' ').toLowerCase()}`,
        hasAliasContext: true,
        index,
      });
      index += 1;
    }
  }

  const rankedChoices = candidates.sort((left, right) => {
    const leftRank = timezoneMatchRank(left.matchText, normalizedQuery);
    const rightRank = timezoneMatchRank(right.matchText, normalizedQuery);
    return (
      leftRank - rightRank ||
      Number(right.hasAliasContext) - Number(left.hasAliasContext) ||
      left.value.localeCompare(right.value) ||
      left.index - right.index
    );
  });

  const uniqueChoices = new Map<string, TimezoneChoiceCandidate>();
  for (const choice of rankedChoices) {
    if (uniqueChoices.has(choice.value)) continue;
    uniqueChoices.set(choice.value, choice);
  }

  return [...uniqueChoices.values()].slice(0, 25).map(({ name, value }) => ({ name, value }));
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
  const parsedTimezone = parseTimezoneInput(timezoneInput);
  if (!parsedTimezone) {
    await interaction.reply({
      content: INVALID_TIMEZONE_MESSAGE,
      ephemeral: true,
    });
    return;
  }

  const previousPreference = await options.store.getUserTimezonePreference(
    interaction.guildId,
    interaction.user.id,
  );

  await options.store.setUserTimezonePreference({
    guildId: interaction.guildId,
    guildName: interaction.guild?.name ?? null,
    actorDiscordUserId: interaction.user.id,
    discordUserId: interaction.user.id,
    timezone: parsedTimezone.timezone,
  });

  await interaction.reply({
    embeds: [
      buildTimezoneEmbed(
        collectTimezoneView(
          parsedTimezone,
          interaction,
          context,
          new Date(),
          previousPreference?.timezone,
        ),
      ),
    ],
    ephemeral: true,
  });
}

export function collectTimezoneView(
  parsedTimezone: ParsedTimezoneInput | string,
  source: Pick<ChatInputCommandInteraction, 'guild'>,
  context: CommandContext,
  now = new Date(),
  previousTimezone?: string | null,
): TimezoneView {
  const botAvatarUrl = context.client.user?.displayAvatarURL({ extension: 'png' });
  const timezoneView =
    typeof parsedTimezone === 'string'
      ? {
          timezone: parsedTimezone,
          requestedTimezone: parsedTimezone,
          canonicalizationSummary: 'Input already matched the saved canonical timezone.',
        }
      : parsedTimezone;

  return {
    timezone: timezoneView.timezone,
    requestedTimezone: timezoneView.requestedTimezone,
    canonicalizationSummary: timezoneView.canonicalizationSummary,
    localDateTime: formatLocalDateTime(timezoneView.timezone, now),
    gmtOffset: formatGmtOffset(timezoneView.timezone, now),
    note: TIMEZONE_FIRST_PASS_NOTE,
    previousTimezoneSummary: formatPreviousTimezoneSummary(previousTimezone, timezoneView.timezone),
    preferenceSaveStatus: 'Saved successfully for this Discord server.',
    preferenceSummary: [
      `Canonical timezone: \`${timezoneView.timezone}\``,
      'Target user: your Discord account in this server.',
      'Scope: persisted for this Discord server only; other servers can keep different values.',
      'Persistence: saved in guild settings and audit logged as a timezone preference update.',
    ].join('\n'),
    diagnosticSummary: [
      'Validation: stored values are canonical IANA timezones; choose autocomplete suggestions when unsure.',
      'Autocomplete: suggests supported IANA zones and common city aliases, then saves the canonical zone.',
      'Data source: uses the saved preference only; no live Clash API calls, polling, or tracking enrollment.',
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
      { name: 'Previous value', value: view.previousTimezoneSummary, inline: false },
      { name: 'Preference save status', value: view.preferenceSaveStatus, inline: false },
      {
        name: 'Accepted input',
        value: `\`${view.requestedTimezone}\` → \`${view.timezone}\`\n${view.canonicalizationSummary}`,
        inline: false,
      },
      { name: 'Timezone', value: `\`${view.timezone}\``, inline: false },
      { name: 'Current local time', value: view.localDateTime, inline: false },
      { name: 'Approximate GMT offset', value: `GMT${view.gmtOffset}`, inline: false },
      {
        name: 'Used by',
        value: 'Events, reminders, and other server-aware ClashMate timestamps for you.',
        inline: false,
      },
      { name: 'Diagnostics', value: view.diagnosticSummary, inline: false },
    );
}

function formatPreviousTimezoneSummary(
  previousTimezone: string | null | undefined,
  timezone: string,
): string {
  if (!previousTimezone) return 'No saved timezone was found before this update.';
  if (previousTimezone === timezone)
    return `Already saved as \`${timezone}\`; refreshed this value.`;
  return `Changed from \`${previousTimezone}\` to \`${timezone}\`.`;
}

export function parseTimezoneInput(timezone: string): ParsedTimezoneInput | null {
  const requestedTimezone = timezone.trim();
  if (!requestedTimezone) return null;

  const aliasMatch = COMMON_TIMEZONE_ALIASES.get(requestedTimezone.toLowerCase());
  const canonicalTimezone = canonicalizeTimeZone(requestedTimezone);
  if (!canonicalTimezone) return null;

  return {
    timezone: canonicalTimezone,
    requestedTimezone,
    canonicalizationSummary: buildCanonicalizationSummary(
      requestedTimezone,
      canonicalTimezone,
      aliasMatch,
    ),
  };
}

function buildCanonicalizationSummary(
  requestedTimezone: string,
  canonicalTimezone: string,
  aliasMatch?: string,
): string {
  if (aliasMatch) return `Accepted alias for \`${canonicalTimezone}\`.`;
  if (requestedTimezone === canonicalTimezone)
    return 'Input already matched the saved canonical timezone.';
  if (requestedTimezone.toLowerCase() === canonicalTimezone.toLowerCase()) {
    return 'Letter casing was normalized to the canonical timezone.';
  }
  return 'Input was resolved to the canonical timezone supported by this runtime.';
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

function listCanonicalTimezoneAliases(): Array<readonly [timezone: string, aliases: string[]]> {
  const aliasesByTimezone = new Map<string, string[]>();

  for (const [alias, timezone] of COMMON_TIMEZONE_ALIASES) {
    const canonicalTimezone = canonicalizeTimeZone(timezone);
    if (!canonicalTimezone) continue;

    const aliases = aliasesByTimezone.get(canonicalTimezone) ?? [];
    aliases.push(alias);
    aliasesByTimezone.set(canonicalTimezone, aliases);
  }

  return [...aliasesByTimezone.entries()].sort(([leftTimezone], [rightTimezone]) =>
    leftTimezone.localeCompare(rightTimezone),
  );
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
