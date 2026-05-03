import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';

export const TIMEZONE_COMMAND_NAME = 'timezone';
export const TIMEZONE_COMMAND_DESCRIPTION = 'Show the current time for an IANA timezone.';
export const DEFAULT_TIMEZONE_EMBED_COLOR = 0x5865f2;
export const TIMEZONE_FIRST_PASS_NOTE =
  'First pass: this command accepts IANA timezone identifiers directly and does not persist preferences or geocode locations yet.';

export const timezoneCommandData = new SlashCommandBuilder()
  .setName(TIMEZONE_COMMAND_NAME)
  .setDescription(TIMEZONE_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('location')
      .setDescription('IANA timezone identifier, such as UTC, America/New_York, or Asia/Jakarta.')
      .setRequired(true),
  );

export interface TimezoneView {
  timezone: string;
  localDateTime: string;
  gmtOffset: string;
  note: string;
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

export function createTimezoneSlashCommand(): SlashCommandDefinition {
  return {
    name: TIMEZONE_COMMAND_NAME,
    data: timezoneCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      await executeTimezoneInteraction(interaction, context);
    },
  };
}

export async function executeTimezoneInteraction(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: '`/timezone` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const timezone = interaction.options.getString('location', true).trim();
  if (!isValidTimeZone(timezone)) {
    await interaction.reply({
      content:
        'Please provide a valid IANA timezone identifier, such as `UTC`, `America/New_York`, or `Asia/Jakarta`.',
      ephemeral: true,
    });
    return;
  }

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
    botName: context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate',
    ...(botAvatarUrl ? { botAvatarUrl } : {}),
    color: source.guild?.members.me?.displayColor || DEFAULT_TIMEZONE_EMBED_COLOR,
  };
}

export function buildTimezoneEmbed(view: TimezoneView): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(view.color ?? DEFAULT_TIMEZONE_EMBED_COLOR)
    .setTitle('Timezone')
    .setDescription(view.note)
    .setAuthor(
      view.botAvatarUrl
        ? { name: view.botName, iconURL: view.botAvatarUrl }
        : { name: view.botName },
    )
    .addFields(
      { name: 'Timezone', value: `\`${view.timezone}\``, inline: false },
      { name: 'Current local time', value: view.localDateTime, inline: false },
      { name: 'Approximate GMT offset', value: `GMT${view.gmtOffset}`, inline: false },
    );
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
