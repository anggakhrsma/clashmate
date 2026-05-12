import type { ClashClan } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
} from 'discord.js';

export const CLAN_COMMAND_NAME = 'clan';
export const CLAN_COMMAND_DESCRIPTION = 'View a Clash of Clans clan profile.';
export const CLAN_NOT_FOUND_MESSAGE =
  'I could not find that clan from the live Clash API. Use a clan tag such as `#2PP`, or select an accepted clan tag/name suggestion when Discord shows one. If the tag is correct, the API may be temporarily unavailable or the clan profile may not be public yet.';

export const clanCommandData = new SlashCommandBuilder()
  .setName(CLAN_COMMAND_NAME)
  .setDescription(CLAN_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('tag').setDescription('Clan tag to look up.').setRequired(true),
  );

export interface ClanCocApi {
  getClan: (clanTag: string) => Promise<ClashClan>;
}

export interface ClanCommandOptions {
  readonly coc: ClanCocApi;
}

export function createClanSlashCommand(options: ClanCommandOptions): SlashCommandDefinition {
  return {
    name: CLAN_COMMAND_NAME,
    data: clanCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== CLAN_COMMAND_NAME) return;
      await executeClan(interaction, context, options);
    },
  };
}

export async function executeClan(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: ClanCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: '`/clan` can only be used in a server.', ephemeral: true });
    return;
  }

  const tag = interaction.options.getString('tag', true);
  let normalizedTag: string;
  try {
    normalizedTag = normalizeClashTag(tag);
  } catch {
    await interaction.reply({ content: CLAN_NOT_FOUND_MESSAGE, ephemeral: true });
    return;
  }

  let clan: ClashClan;
  try {
    clan = await options.coc.getClan(normalizedTag);
  } catch {
    await interaction.reply({ content: CLAN_NOT_FOUND_MESSAGE, ephemeral: true });
    return;
  }

  await interaction.reply({ embeds: [buildClanEmbed(clan)] });
}

export function buildClanEmbed(clan: ClashClan): EmbedBuilder {
  const data = readClanData(clan);
  const normalizedTag = normalizeClanTagForDisplay(clan.tag);
  const embed = new EmbedBuilder()
    .setTitle(`${escapeMarkdown(clan.name)} (${normalizedTag})`)
    .setURL(getClanUrl(normalizedTag));

  if (data.badgeUrl) embed.setThumbnail(data.badgeUrl);

  embed.setDescription(
    [
      `Tag **${escapeMarkdown(normalizedTag)}**`,
      `Level **${formatNumber(data.clanLevel)}**`,
      `Members **${formatMembers(data.members)}**`,
      `Type **${formatClanType(data.type)}**`,
      `Location **${escapeMarkdown(formatText(data.locationName))}**`,
      data.description ? `\n${escapeMarkdown(data.description)}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join(' • '),
  );

  embed.addFields(
    {
      name: '**Trophies**',
      value: [
        `**Home Village**\n${formatNumber(data.clanPoints)}`,
        `**Builder Base**\n${formatNumber(data.clanBuilderBasePoints)}`,
      ].join('\n'),
      inline: true,
    },
    {
      name: '**War**',
      value: [
        `**Wins**\n${formatNumber(data.warWins)}`,
        `**Losses/Ties**\n${formatWarRecordRemainder(data.warLosses, data.warTies)}`,
        `**Win Streak**\n${formatNumber(data.warWinStreak)}`,
        `**War League**\n${formatText(data.warLeagueName)}`,
      ].join('\n'),
      inline: true,
    },
    {
      name: '**Capital**',
      value: [
        `**Capital League**\n${formatText(data.capitalLeagueName)}`,
        `**Capital Hall**\n${formatNumber(data.capitalHallLevel)}`,
      ].join('\n'),
      inline: true,
    },
    {
      name: '**Coverage**',
      value: [
        `Level/member stats: ${formatCoverage(data.clanLevel, data.members)}`,
        `League stats: ${formatCoverage(data.warLeagueName, data.capitalLeagueName)}`,
        `War stats: ${formatCoverage(data.warWins, data.warWinStreak)}`,
        `Capital/trophy stats: ${formatCoverage(
          data.capitalHallLevel,
          data.clanPoints,
          data.clanBuilderBasePoints,
        )}`,
      ].join('\n'),
    },
    {
      name: '**Lookup Source**',
      value: `Live Clash API clan profile for normalized tag ${escapeMarkdown(
        normalizedTag,
      )}. This one-off lookup does not link the clan, create history, or enroll it in ClashMate polling.`,
    },
  );

  embed.setFooter({ text: `Open the public in-game profile: ${getClanUrl(normalizedTag)}` });

  return embed;
}

interface ClanDataView {
  readonly clanLevel: number | null;
  readonly members: number | null;
  readonly type: string | null;
  readonly clanPoints: number | null;
  readonly clanBuilderBasePoints: number | null;
  readonly warWins: number | null;
  readonly warLosses: number | null;
  readonly warTies: number | null;
  readonly warWinStreak: number | null;
  readonly warLeagueName: string | null;
  readonly capitalLeagueName: string | null;
  readonly capitalHallLevel: number | null;
  readonly locationName: string | null;
  readonly description: string | null;
  readonly badgeUrl: string | null;
}

function readClanData(clan: ClashClan): ClanDataView {
  const data = isRecord(clan.data) ? clan.data : {};
  const warLeague = readRecord(readValue(data, 'warLeague'));
  const capitalLeague = readRecord(readValue(data, 'capitalLeague'));
  const clanCapital = readRecord(readValue(data, 'clanCapital'));
  const location = readRecord(readValue(data, 'location'));
  const badgeUrls = readRecord(readValue(data, 'badgeUrls'));

  return {
    clanLevel: readNumber(readValue(data, 'clanLevel')),
    members: readNumber(readValue(data, 'members')),
    type: readString(readValue(data, 'type')),
    clanPoints: readNumber(readValue(data, 'clanPoints')),
    clanBuilderBasePoints: readNumber(readValue(data, 'clanBuilderBasePoints')),
    warWins: readNumber(readValue(data, 'warWins')),
    warLosses: readNumber(readValue(data, 'warLosses')),
    warTies: readNumber(readValue(data, 'warTies')),
    warWinStreak: readNumber(readValue(data, 'warWinStreak')),
    warLeagueName: readString(warLeague ? readValue(warLeague, 'name') : undefined),
    capitalLeagueName: readString(capitalLeague ? readValue(capitalLeague, 'name') : undefined),
    capitalHallLevel: readNumber(
      clanCapital ? readValue(clanCapital, 'capitalHallLevel') : undefined,
    ),
    locationName: readString(location ? readValue(location, 'name') : undefined),
    description: readString(readValue(data, 'description')),
    badgeUrl:
      readString(badgeUrls ? readValue(badgeUrls, 'medium') : undefined) ??
      readString(badgeUrls ? readValue(badgeUrls, 'small') : undefined),
  };
}

function normalizeClanTagForDisplay(tag: string): string {
  try {
    return normalizeClashTag(tag);
  } catch {
    return tag;
  }
}

function formatClanType(type: string | null): string {
  switch (type) {
    case 'inviteOnly':
      return 'Invite Only';
    case 'closed':
      return 'Closed';
    case 'open':
      return 'Anyone Can Join';
    default:
      return 'Unknown';
  }
}

function formatNumber(value: number | null): string {
  return value === null ? 'Unknown' : value.toLocaleString('en-US');
}

function formatMembers(value: number | null): string {
  return value === null ? 'Unknown' : `${value.toLocaleString('en-US')}/50`;
}

function formatWarRecordRemainder(losses: number | null, ties: number | null): string {
  if (losses === null && ties === null) return 'Unknown';
  return `${formatNumber(losses)} / ${formatNumber(ties)}`;
}

function formatCoverage(...values: readonly unknown[]): string {
  return values.every((value) => value !== null && value !== undefined) ? 'available' : 'partial';
}

function formatText(value: string | null): string {
  return value?.trim() || 'Unknown';
}

function getClanUrl(tag: string): string {
  return `https://link.clashofclans.com/en?action=OpenClanProfile&tag=${encodeURIComponent(tag)}`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
