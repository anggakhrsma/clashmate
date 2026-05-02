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
export const CLAN_NOT_FOUND_MESSAGE = 'This clan tag is not valid or was not found.';

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
  const embed = new EmbedBuilder()
    .setTitle(`${escapeMarkdown(clan.name)} (${clan.tag})`)
    .setURL(getClanUrl(clan.tag));

  if (data.badgeUrl) embed.setThumbnail(data.badgeUrl);

  embed.setDescription(
    [
      `Level **${formatNumber(data.clanLevel)}**`,
      `Members **${formatNumber(data.members)}**`,
      `Type **${formatClanType(data.type)}**`,
      `Trophies **${formatNumber(data.clanPoints)}**`,
      `Builder Trophies **${formatNumber(data.clanBuilderBasePoints)}**`,
      data.description ? `\n${escapeMarkdown(data.description)}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join(' • '),
  );

  embed.addFields(
    {
      name: '**War**',
      value: [
        `**Wins**\n${formatNumber(data.warWins)}`,
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
      name: '**Location**',
      value: formatText(data.locationName),
      inline: true,
    },
  );

  return embed;
}

interface ClanDataView {
  readonly clanLevel: number | null;
  readonly members: number | null;
  readonly type: string | null;
  readonly clanPoints: number | null;
  readonly clanBuilderBasePoints: number | null;
  readonly warWins: number | null;
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
