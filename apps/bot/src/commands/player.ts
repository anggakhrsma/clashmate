import type { ClashPlayer } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  type User,
} from 'discord.js';

export const PLAYER_COMMAND_NAME = 'player';
export const PLAYER_COMMAND_DESCRIPTION = 'View a Clash of Clans player profile.';
export const PLAYER_NOT_FOUND_MESSAGE =
  'Live Clash API lookup did not find that player. Check the tag and try again; one-off lookups are not stored for polling.';

export const playerCommandData = new SlashCommandBuilder()
  .setName(PLAYER_COMMAND_NAME)
  .setDescription(PLAYER_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('tag').setDescription('Player tag to look up.').setAutocomplete(true),
  )
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
  | {
      readonly status: 'resolved';
      readonly playerTag: string;
      readonly targetUser: User | null;
      readonly source: PlayerTagSource;
    }
  | { readonly status: 'invalid_tag'; readonly input: string }
  | { readonly status: 'no_link'; readonly targetUser: User; readonly isSelf: boolean };

export type PlayerTagSource = 'explicit_tag' | 'stored_user_link';

export function createPlayerSlashCommand(options: PlayerCommandOptions): SlashCommandDefinition {
  return {
    name: PLAYER_COMMAND_NAME,
    data: playerCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== PLAYER_COMMAND_NAME) return;
      await executePlayer(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== PLAYER_COMMAND_NAME) return;
      await autocompletePlayer(interaction, options);
    },
  };
}

export async function autocompletePlayer(
  interaction: AutocompleteInteraction,
  options: { readonly links: Pick<PlayerLinkStore, 'listPlayerTagsForUser'> },
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'tag') {
    await interaction.respond([]);
    return;
  }

  try {
    const tags = await options.links.listPlayerTagsForUser(
      interaction.guildId,
      interaction.user.id,
    );
    await interaction.respond(
      filterPlayerTagAutocompleteChoices(tags, String(focused.value ?? '')),
    );
  } catch {
    await interaction.respond([]);
  }
}

export function filterPlayerTagAutocompleteChoices(
  tags: readonly string[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toUpperCase();
  const queryWithoutHash = stripLeadingHash(normalizedQuery);
  const choicesByTag = new Map<string, string>();

  for (const tag of [...tags].sort(comparePlayerTagsForAutocomplete)) {
    const normalizedTag = normalizePlayerTagForAutocomplete(tag);
    if (!normalizedTagMatchesQuery(normalizedTag, normalizedQuery, queryWithoutHash)) continue;
    if (!choicesByTag.has(normalizedTag.key)) choicesByTag.set(normalizedTag.key, tag);
  }

  return [...choicesByTag.values()].slice(0, 25).map((tag) => ({ name: tag, value: tag }));
}

function comparePlayerTagsForAutocomplete(left: string, right: string): number {
  return left.localeCompare(right, 'en-US', { sensitivity: 'base' });
}

function normalizePlayerTagForAutocomplete(tag: string): {
  readonly key: string;
  readonly withHash: string;
  readonly withoutHash: string;
} {
  const normalized = tag.trim().toUpperCase();
  const withoutHash = stripLeadingHash(normalized);
  return {
    key: withoutHash,
    withHash: `#${withoutHash}`,
    withoutHash,
  };
}

function normalizedTagMatchesQuery(
  tag: ReturnType<typeof normalizePlayerTagForAutocomplete>,
  normalizedQuery: string,
  queryWithoutHash: string,
): boolean {
  if (!normalizedQuery) return true;
  return tag.withHash.includes(normalizedQuery) || tag.withoutHash.includes(queryWithoutHash);
}

function stripLeadingHash(value: string): string {
  return value.startsWith('#') ? value.slice(1) : value;
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
    await interaction.reply({
      content: formatInvalidPlayerTagMessage(resolution.input),
      ephemeral: true,
    });
    return;
  }

  if (resolution.status === 'no_link') {
    await interaction.reply({
      content: formatPlayerNoLinkedMessage(resolution),
      ephemeral: true,
    });
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
    embeds: [
      buildPlayerEmbed(player, {
        linkedDiscordUserId: links[0]?.discordUserId ?? null,
        source: resolution.source,
        targetUser: resolution.targetUser,
      }),
    ],
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
      return withHiddenProperty(
        {
          status: 'resolved',
          playerTag: normalizeClashTag(input.tagOption),
          targetUser: input.userOption,
        },
        'source',
        'explicit_tag' satisfies PlayerTagSource,
      );
    } catch {
      return withHiddenProperty({ status: 'invalid_tag' }, 'input', input.tagOption);
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

  return withHiddenProperty(
    { status: 'resolved', playerTag, targetUser },
    'source',
    'stored_user_link' satisfies PlayerTagSource,
  );
}

export function formatNoLinkedPlayerMessage(
  result: Extract<PlayerResolutionResult, { status: 'no_link' }>,
): string {
  if (result.isSelf) return 'You do not have a linked player account. Use `/link create` first.';
  return `**${result.targetUser.displayName}** does not have a linked player account.`;
}

export function formatPlayerNoLinkedMessage(
  result: Extract<PlayerResolutionResult, { status: 'no_link' }>,
): string {
  if (result.isSelf) {
    return [
      'No stored Discord user link was found for you.',
      'Use `/link create` first, or use `/player tag:<tag>` for a live one-off lookup that is not enrolled for polling.',
    ].join(' ');
  }
  return [
    `No stored Discord user link was found for **${result.targetUser.displayName}**.`,
    'Use `/player tag:<tag>` for a live one-off lookup that is not enrolled for polling.',
  ].join(' ');
}

export function formatInvalidPlayerTagMessage(input: string): string {
  return [
    `I could not normalize \`${input.trim() || 'that value'}\` as a Clash player tag.`,
    'Use a tag like `#ABC123`, or omit `tag` to use a stored Discord user link.',
  ].join(' ');
}

export function buildPlayerEmbed(
  player: ClashPlayer,
  context: PlayerEmbedContext | string | null,
): EmbedBuilder {
  const includeSourceField = typeof context === 'object' && context !== null;
  const embedContext = normalizePlayerEmbedContext(context);
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

  const fields = [
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
          : '**Clan Info**\nNot in a clan',
        '**Last Seen**\nNo stored snapshot data',
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
      value: embedContext.linkedDiscordUserId
        ? `Stored owner link: <@${embedContext.linkedDiscordUserId}>`
        : 'No stored owner link found for this player in ClashMate.',
    },
    {
      name: '**Public Links**',
      value: [
        `[Open player profile](${getPlayerUrl(player.tag)})`,
        data.clan ? `[Open clan profile](${getClanUrl(data.clan.tag)})` : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
    },
  ];

  if (includeSourceField) {
    fields.push({
      name: '**Source**',
      value: formatPlayerSourceContext(embedContext),
    });
  }

  embed.addFields(...fields);

  return embed;
}

interface PlayerEmbedContext {
  readonly linkedDiscordUserId: string | null;
  readonly source: PlayerTagSource;
  readonly targetUser: User | null;
}

function withHiddenProperty<TBase extends object, TKey extends PropertyKey, const TValue>(
  base: TBase,
  key: TKey,
  value: TValue,
): TBase & { readonly [K in TKey]: TValue } {
  Object.defineProperty(base, key, {
    value,
    enumerable: false,
    configurable: true,
  });
  return base as TBase & { readonly [K in TKey]: TValue };
}

function normalizePlayerEmbedContext(
  context: PlayerEmbedContext | string | null,
): PlayerEmbedContext {
  if (typeof context === 'string' || context === null) {
    return { linkedDiscordUserId: context, source: 'explicit_tag', targetUser: null };
  }
  return context;
}

function formatPlayerSourceContext(context: PlayerEmbedContext): string {
  const source =
    context.source === 'explicit_tag'
      ? 'Source: explicit `tag` option.'
      : `Source: stored Discord user link${context.targetUser ? ` for **${context.targetUser.displayName}**` : ''}.`;
  const lookup = 'Lookup: live Clash API request; this one-off command does not enroll polling.';
  const owner = context.linkedDiscordUserId
    ? `Owner link: <@${context.linkedDiscordUserId}> is linked to this player in ClashMate.`
    : 'Owner link: none found in this server. Use `/link create` to connect a Discord user.';

  return `${source}\n${lookup}\n${owner}`;
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
