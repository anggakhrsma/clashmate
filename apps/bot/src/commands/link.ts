import type { ClashClan, ClashPlayer } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type User,
} from 'discord.js';

export const LINK_COMMAND_NAME = 'link';
export const LINK_COMMAND_DESCRIPTION = 'Create, delete or list player links.';

export const linkCommandData = new SlashCommandBuilder()
  .setName(LINK_COMMAND_NAME)
  .setDescription(LINK_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('create')
      .setDescription('Links a player account/clan to a Discord account.')
      .addStringOption((option) =>
        option.setName('player_tag').setDescription('The player tag to link.'),
      )
      .addStringOption((option) =>
        option.setName('clan_tag').setDescription('The default clan tag to link.'),
      )
      .addUserOption((option) =>
        option.setName('user').setDescription('User account to link to the tag.'),
      )
      .addStringOption((option) =>
        option
          .setName('is_default')
          .setDescription('Whether to set this as the default account.')
          .addChoices({ name: 'Yes', value: 'true' }, { name: 'No', value: 'false' }),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('List all player links of a clan.')
      .addStringOption((option) =>
        option.setName('clan').setDescription('Clan tag or name or alias.').setAutocomplete(true),
      ),
  );

export interface LinkCreatePlayer {
  readonly tag: string;
  readonly name: string;
}

export interface LinkCreateCocApi {
  getPlayer: (playerTag: string) => Promise<LinkCreatePlayer | ClashPlayer>;
  getClan: (clanTag: string) => Promise<ClashClan>;
}

export type LinkCreateStoreResult =
  | { readonly status: 'linked'; readonly wasDefault: boolean }
  | { readonly status: 'already_linked_to_user' }
  | { readonly status: 'already_linked_to_other_user'; readonly discordUserId: string }
  | { readonly status: 'max_accounts_reached'; readonly maxAccounts: number };

export interface LinkCreateStore {
  linkPlayer: (input: {
    guildId: string;
    actorDiscordUserId: string;
    discordUserId: string;
    playerTag: string;
    isDefault: boolean;
  }) => Promise<LinkCreateStoreResult>;
  listPlayerLinksByTags: (playerTags: readonly string[]) => Promise<LinkListPlayerLink[]>;
}

export interface LinkListPlayerLink {
  readonly discordUserId: string;
  readonly playerTag: string;
  readonly isVerified: boolean;
}

export interface LinkListClanMember {
  readonly tag: string;
  readonly name: string;
  readonly townHallLevel?: number | null;
}

export interface LinkListRow {
  readonly playerTag: string;
  readonly playerName: string;
  readonly townHallLevel: number | null;
  readonly discordUserId: string | null;
  readonly discordDisplayName: string | null;
  readonly isVerified: boolean;
  readonly isInServer: boolean;
  readonly isLinked: boolean;
}

export interface LinkCommandOptions {
  readonly coc: LinkCreateCocApi;
  readonly links: LinkCreateStore;
}

export function createLinkSlashCommand(options: LinkCommandOptions): SlashCommandDefinition {
  return {
    name: LINK_COMMAND_NAME,
    data: linkCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== LINK_COMMAND_NAME) return;
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'create') {
        await executeLinkCreate(interaction, context, options);
        return;
      }
      if (subcommand === 'list') {
        await executeLinkList(interaction, options);
      }
    },
  };
}

export async function executeLinkCreate(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: LinkCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/link create` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const clanTag = interaction.options.getString('clan_tag');
  if (clanTag) {
    await interaction.reply({
      content:
        '`clan_tag` support for `/link create` is deferred until ClashMate has user default-clan storage.',
      ephemeral: true,
    });
    return;
  }

  const playerTagOption = interaction.options.getString('player_tag');
  if (!playerTagOption) {
    await interaction.reply({
      content: 'You must specify a player/clan tag to execute this command.',
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser('user') ?? interaction.user;
  if (targetUser.bot) {
    await interaction.reply({
      content: 'Bot accounts are not allowed to be linked.',
      ephemeral: true,
    });
    return;
  }

  if (targetUser.id !== interaction.user.id && !canManageLinks(interaction)) {
    await interaction.reply({
      content: 'You need the Manage Server permission to link accounts for another user.',
      ephemeral: true,
    });
    return;
  }

  let playerTag: string;
  try {
    playerTag = normalizeClashTag(playerTagOption);
  } catch {
    await interaction.reply({ content: 'This player or clan tag is not valid.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let player: LinkCreatePlayer;
  try {
    player = await options.coc.getPlayer(playerTag);
  } catch {
    await interaction.editReply('This player or clan tag is not valid.');
    return;
  }

  const isDefault = interaction.options.getString('is_default') === 'true';
  const result = await options.links.linkPlayer({
    guildId: interaction.guildId,
    actorDiscordUserId: interaction.user.id,
    discordUserId: targetUser.id,
    playerTag: player.tag,
    isDefault,
  });

  await interaction.editReply(formatLinkCreateResult(result, player, targetUser));
}

export async function executeLinkList(
  interaction: ChatInputCommandInteraction,
  options: LinkCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/link list` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const clanOption = interaction.options.getString('clan');
  if (!clanOption) {
    await interaction.reply({
      content: 'You must specify a clan tag to execute this command.',
      ephemeral: true,
    });
    return;
  }

  let clanTag: string;
  try {
    clanTag = normalizeClashTag(clanOption);
  } catch {
    await interaction.reply({ content: 'This player or clan tag is not valid.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  let clan: ClashClan;
  try {
    clan = await options.coc.getClan(clanTag);
  } catch {
    await interaction.editReply('This player or clan tag is not valid.');
    return;
  }

  const members = extractClanMembers(clan);
  if (members.length === 0) {
    await interaction.editReply(`No clan members found for **${clan.name} (${clan.tag})**.`);
    return;
  }

  const links = await options.links.listPlayerLinksByTags(members.map((member) => member.tag));
  const linkedUserIds = [...new Set(links.map((link) => link.discordUserId))];
  const guildMembers = new Map<string, string>();

  if (linkedUserIds.length > 0) {
    try {
      const fetched = await interaction.guild.members.fetch({ user: linkedUserIds });
      for (const [userId, member] of fetched) guildMembers.set(userId, member.displayName);
    } catch {
      for (const userId of linkedUserIds) {
        const cached = interaction.guild.members.cache.get(userId);
        if (cached) guildMembers.set(userId, cached.displayName);
      }
    }
  }

  await interaction.editReply({ embeds: [buildLinkListEmbed(clan, members, links, guildMembers)] });
}

export function extractClanMembers(clan: ClashClan): LinkListClanMember[] {
  const data = clan.data;
  if (!isClanDataWithMembers(data)) return [];

  return data.memberList.map((member) => ({
    tag: member.tag,
    name: member.name,
    townHallLevel: member.townHallLevel ?? null,
  }));
}

export function buildLinkListRows(
  members: readonly LinkListClanMember[],
  links: readonly LinkListPlayerLink[],
  guildMembers: ReadonlyMap<string, string>,
): LinkListRow[] {
  const linksByTag = new Map(links.map((link) => [link.playerTag, link]));

  return members.map((member) => {
    const link = linksByTag.get(member.tag);
    const displayName = link ? (guildMembers.get(link.discordUserId) ?? null) : null;

    return {
      playerTag: member.tag,
      playerName: member.name,
      townHallLevel: member.townHallLevel ?? null,
      discordUserId: link?.discordUserId ?? null,
      discordDisplayName: displayName,
      isVerified: link?.isVerified ?? false,
      isInServer: Boolean(link && displayName),
      isLinked: Boolean(link),
    };
  });
}

export function buildLinkListEmbed(
  clan: Pick<ClashClan, 'name' | 'tag' | 'data'>,
  members: readonly LinkListClanMember[],
  links: readonly LinkListPlayerLink[],
  guildMembers: ReadonlyMap<string, string>,
): EmbedBuilder {
  const rows = buildLinkListRows(members, links, guildMembers);
  const description = formatLinkListDescription(rows);
  const badgeUrl = extractClanBadgeUrl(clan.data);
  const embed = new EmbedBuilder()
    .setAuthor(
      badgeUrl
        ? { name: `${clan.name} (${clan.tag})`, iconURL: badgeUrl }
        : { name: `${clan.name} (${clan.tag})` },
    )
    .setDescription(description.slice(0, 4096));

  return embed;
}

export function formatLinkListDescription(rows: readonly LinkListRow[]): string {
  const inServer = rows.filter((row) => row.isLinked && row.isInServer);
  const notInServer = rows.filter((row) => row.isLinked && !row.isInServer);
  const notLinked = rows.filter((row) => !row.isLinked);

  return [
    formatLinkListGroup('Players in the Server', inServer),
    formatLinkListGroup('Players not in the Server', notInServer),
    formatLinkListGroup('Players not Linked', notLinked),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function formatLinkListGroup(title: string, rows: readonly LinkListRow[]): string {
  const lines = [`**${title}: ${rows.length}**`];
  lines.push(...rows.map(formatLinkListRow));
  return lines.join('\n');
}

function formatLinkListRow(row: LinkListRow): string {
  const status = row.isVerified ? '✅' : row.isLinked ? '☑️' : '❌';
  const townHall = row.townHallLevel === null ? '??' : String(row.townHallLevel).padStart(2, '0');
  const user = row.discordDisplayName ?? row.playerTag;
  return `${status} \`${townHall} ${row.playerName} ${user}\``;
}

function isClanDataWithMembers(value: unknown): value is {
  memberList: Array<{ tag: string; name: string; townHallLevel?: number | null }>;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'memberList' in value &&
    Array.isArray(value.memberList) &&
    value.memberList.every(
      (member) =>
        typeof member === 'object' &&
        member !== null &&
        'tag' in member &&
        typeof member.tag === 'string' &&
        'name' in member &&
        typeof member.name === 'string',
    )
  );
}

function extractClanBadgeUrl(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('badgeUrls' in data)) return undefined;
  const { badgeUrls } = data;
  if (typeof badgeUrls !== 'object' || badgeUrls === null || !('small' in badgeUrls))
    return undefined;
  return typeof badgeUrls.small === 'string' ? badgeUrls.small : undefined;
}

export function formatLinkCreateResult(
  result: LinkCreateStoreResult,
  player: LinkCreatePlayer,
  targetUser: Pick<User, 'displayName'>,
): string {
  const playerLabel = `**${player.name} (${player.tag})**`;

  switch (result.status) {
    case 'linked':
      return `Successfully linked ${playerLabel} to **${targetUser.displayName}**.`;
    case 'already_linked_to_user':
      return `${playerLabel} is already linked.`;
    case 'already_linked_to_other_user':
      return `${playerLabel} is already linked to another user. If you own this account, please use the /verify command.`;
    case 'max_accounts_reached':
      return `The maximum account limit has been reached. (${result.maxAccounts} accounts/user)`;
  }
}

export function canManageLinks(interaction: ChatInputCommandInteraction<'cached'>): boolean {
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
}
