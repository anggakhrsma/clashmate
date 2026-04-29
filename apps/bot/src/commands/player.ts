import type { ClashPlayer } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  type User,
} from 'discord.js';

export const PLAYER_COMMAND_NAME = 'player';
export const PLAYER_COMMAND_DESCRIPTION = 'View a Clash of Clans player profile.';
export const PLAYER_NOT_FOUND_MESSAGE = 'This player tag is not valid or was not found.';

export const playerCommandData = new SlashCommandBuilder()
  .setName(PLAYER_COMMAND_NAME)
  .setDescription(PLAYER_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) => option.setName('tag').setDescription('Player tag to look up.'))
  .addUserOption((option) =>
    option.setName('user').setDescription('Discord user whose linked account to show.'),
  );

export interface PlayerCocApi {
  getPlayer: (playerTag: string) => Promise<ClashPlayer>;
}

export interface PlayerLinkStore {
  listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
  listPlayerLinksByTags: (
    playerTags: readonly string[],
  ) => Promise<Array<{ discordUserId: string; playerTag: string }>>;
}

export interface PlayerCommandOptions {
  readonly coc: PlayerCocApi;
  readonly links: PlayerLinkStore;
}

export type PlayerResolutionResult =
  | { readonly status: 'resolved'; readonly playerTag: string; readonly targetUser: User | null }
  | { readonly status: 'invalid_tag' }
  | { readonly status: 'no_link'; readonly targetUser: User; readonly isSelf: boolean };

export function createPlayerSlashCommand(options: PlayerCommandOptions): SlashCommandDefinition {
  return {
    name: PLAYER_COMMAND_NAME,
    data: playerCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== PLAYER_COMMAND_NAME) return;
      await executePlayer(interaction, context, options);
    },
  };
}

export async function executePlayer(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: PlayerCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/player` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const resolution = await resolvePlayerTag({
    guildId: interaction.guildId,
    invokingUser: interaction.user,
    tagOption: interaction.options.getString('tag'),
    userOption: interaction.options.getUser('user'),
    links: options.links,
  });

  if (resolution.status === 'invalid_tag') {
    await interaction.reply({ content: PLAYER_NOT_FOUND_MESSAGE, ephemeral: true });
    return;
  }

  if (resolution.status === 'no_link') {
    await interaction.reply({ content: formatNoLinkedPlayerMessage(resolution), ephemeral: true });
    return;
  }

  await interaction.deferReply();

  let player: ClashPlayer;
  try {
    player = await options.coc.getPlayer(resolution.playerTag);
  } catch {
    await interaction.editReply(PLAYER_NOT_FOUND_MESSAGE);
    return;
  }

  const links = await options.links.listPlayerLinksByTags([player.tag]);
  await interaction.editReply({
    embeds: [buildPlayerEmbed(player, links[0]?.discordUserId ?? null)],
  });
}

export async function resolvePlayerTag(input: {
  readonly guildId: string;
  readonly invokingUser: User;
  readonly tagOption: string | null;
  readonly userOption: User | null;
  readonly links: Pick<PlayerLinkStore, 'listPlayerTagsForUser'>;
}): Promise<PlayerResolutionResult> {
  if (input.tagOption) {
    try {
      return {
        status: 'resolved',
        playerTag: normalizeClashTag(input.tagOption),
        targetUser: input.userOption,
      };
    } catch {
      return { status: 'invalid_tag' };
    }
  }

  const targetUser = input.userOption ?? input.invokingUser;
  const tags = await input.links.listPlayerTagsForUser(input.guildId, targetUser.id);
  const [playerTag] = tags;

  if (!playerTag) {
    return {
      status: 'no_link',
      targetUser,
      isSelf: targetUser.id === input.invokingUser.id,
    };
  }

  return { status: 'resolved', playerTag, targetUser };
}

export function formatNoLinkedPlayerMessage(
  result: Extract<PlayerResolutionResult, { status: 'no_link' }>,
): string {
  if (result.isSelf) return 'You do not have a linked player account. Use `/link create` first.';
  return `**${result.targetUser.displayName}** does not have a linked player account.`;
}

export function buildPlayerEmbed(
  player: ClashPlayer,
  linkedDiscordUserId: string | null,
): EmbedBuilder {
  const data = readPlayerData(player);
  const embed = new EmbedBuilder()
    .setTitle(`${escapeMarkdown(player.name)} (${player.tag})`)
    .setURL(getPlayerUrl(player.tag))
    .setDescription(
      [
        `TH **${formatTownHall(data.townHallLevel, data.townHallWeaponLevel)}**`,
        `XP **${formatNumber(data.expLevel)}**`,
        `Trophies **${formatNumber(data.trophies)}**`,
        `War Stars **${formatNumber(data.warStars)}**`,
      ].join(' • '),
    );

  if (data.leagueIconUrl) embed.setThumbnail(data.leagueIconUrl);

  embed.addFields(
    {
      name: '**Season Stats**',
      value: [
        `**Donated**\n${formatNumber(data.donations)}`,
        `**Received**\n${formatNumber(data.donationsReceived)}`,
        `**Attacks Won**\n${formatNumber(data.attackWins)}`,
        `**Defense Won**\n${formatNumber(data.defenseWins)}`,
      ].join('\n'),
    },
    {
      name: '**Other Stats**',
      value: [
        `**Best Trophies**\n${formatNumber(data.bestTrophies)}`,
        data.clan
          ? `**Clan Info**\n[${escapeMarkdown(data.clan.name)}](${getClanUrl(data.clan.tag)}) (${formatRole(data.role)})`
          : null,
        '**Last Seen**\nUnknown',
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
    },
    {
      name: '**Achievement Stats**',
      value: formatAchievements(data.achievements),
    },
    {
      name: '**Heroes**',
      value: data.heroes.length
        ? data.heroes.map((hero) => `${hero.name} ${hero.level}`).join(' ')
        : 'None',
    },
    {
      name: '**Discord**',
      value: linkedDiscordUserId ? `<@${linkedDiscordUserId}>` : 'Not Found',
    },
  );

  return embed;
}

interface PlayerDataView {
  readonly townHallLevel: number | null;
  readonly townHallWeaponLevel: number | null;
  readonly expLevel: number | null;
  readonly trophies: number | null;
  readonly warStars: number | null;
  readonly donations: number | null;
  readonly donationsReceived: number | null;
  readonly attackWins: number | null;
  readonly defenseWins: number | null;
  readonly bestTrophies: number | null;
  readonly role: string | null;
  readonly leagueIconUrl: string | null;
  readonly clan: { readonly name: string; readonly tag: string } | null;
  readonly achievements: ReadonlyMap<string, number>;
  readonly heroes: Array<{ readonly name: string; readonly level: number }>;
}

function readPlayerData(player: ClashPlayer): PlayerDataView {
  const data = isRecord(player.data) ? player.data : {};
  const league = readRecord(readValue(data, 'league'));
  const iconUrls = readRecord(league ? readValue(league, 'iconUrls') : undefined);
  const clan = readRecord(readValue(data, 'clan'));
  const clanName = readString(clan ? readValue(clan, 'name') : undefined);
  const clanTag = readString(clan ? readValue(clan, 'tag') : undefined);

  return {
    townHallLevel: readNumber(readValue(data, 'townHallLevel')),
    townHallWeaponLevel: readNumber(readValue(data, 'townHallWeaponLevel')),
    expLevel: readNumber(readValue(data, 'expLevel')),
    trophies: readNumber(readValue(data, 'trophies')),
    warStars: readNumber(readValue(data, 'warStars')),
    donations: readNumber(readValue(data, 'donations')),
    donationsReceived: readNumber(readValue(data, 'donationsReceived')),
    attackWins: readNumber(readValue(data, 'attackWins')),
    defenseWins: readNumber(readValue(data, 'defenseWins')),
    bestTrophies: readNumber(readValue(data, 'bestTrophies')),
    role: readString(readValue(data, 'role')),
    leagueIconUrl: readString(iconUrls ? readValue(iconUrls, 'small') : undefined),
    clan: clanName && clanTag ? { name: clanName, tag: clanTag } : null,
    achievements: readAchievements(readValue(data, 'achievements')),
    heroes: readHeroes(readValue(data, 'heroes')),
  };
}

function readAchievements(value: unknown): ReadonlyMap<string, number> {
  const achievements = new Map<string, number>();
  if (!Array.isArray(value)) return achievements;

  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = readString(readValue(item, 'name'));
    const count = readNumber(readValue(item, 'value'));
    if (name && count !== null) achievements.set(name, count);
  }

  return achievements;
}

function readHeroes(value: unknown): Array<{ readonly name: string; readonly level: number }> {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (readString(readValue(item, 'village')) !== 'home') return [];
    const name = readString(readValue(item, 'name'));
    const level = readNumber(readValue(item, 'level'));
    return name && level !== null ? [{ name, level }] : [];
  });
}

function formatAchievements(achievements: ReadonlyMap<string, number>): string {
  const rows = [
    ['Gold Grab', 'Gold Grab'],
    ['Elixir Escapade', 'Elixir Escapade'],
    ['Heroic Heist', 'Heroic Heist'],
    ['Friend in Need', 'Troops Donated'],
    ['Sharing is caring', 'Spells Donated'],
    ['Siege Sharer', 'Siege Donated'],
    ['Conqueror', 'Attacks Won'],
    ['Unbreakable', 'Defense Won'],
    ['War League Legend', 'CWL War Stars'],
    ['Games Champion', 'Clan Games Points'],
    ['Aggressive Capitalism', 'Capital Gold Looted'],
    ['Most Valuable Clanmate', 'Capital Gold Contributed'],
  ] as const;

  return rows
    .map(([key, label]) => `**${label}**\n${formatNumber(achievements.get(key) ?? null)}`)
    .join('\n');
}

function formatTownHall(level: number | null, weaponLevel: number | null): string {
  return `${level ?? 'Unknown'}${weaponLevel ? `.${weaponLevel}` : ''}`;
}

function formatRole(role: string | null): string {
  switch (role) {
    case 'admin':
      return 'Elder';
    case 'coLeader':
      return 'Co-Leader';
    case 'leader':
      return 'Leader';
    case 'member':
      return 'Member';
    default:
      return 'Unknown';
  }
}

function formatNumber(value: number | null): string {
  return value === null ? 'Unknown' : value.toLocaleString('en-US');
}

function getPlayerUrl(tag: string): string {
  return `https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${encodeURIComponent(tag)}`;
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
