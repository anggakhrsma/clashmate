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
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('delete')
      .setDescription('Deletes a player account/clan from a Discord account.')
      .addStringOption((option) =>
        option
          .setName('player_tag')
          .setDescription('The player tag to unlink.')
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option.setName('clan_tag').setDescription('The clan tag to unlink.').setAutocomplete(true),
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

export type LinkDefaultClanStoreResult = { readonly status: 'stored' };

export type LinkDeleteDefaultClanStoreResult =
  | { readonly status: 'deleted'; readonly discordUserId: string }
  | { readonly status: 'not_found' }
  | { readonly status: 'permission_denied'; readonly discordUserId: string };

export interface LinkCreateStore {
  linkPlayer: (input: {
    guildId: string;
    actorDiscordUserId: string;
    discordUserId: string;
    playerTag: string;
    isDefault: boolean;
  }) => Promise<LinkCreateStoreResult>;
  setDefaultClan: (input: {
    guildId: string;
    actorDiscordUserId: string;
    discordUserId: string;
    clanTag: string;
    clanName: string;
  }) => Promise<LinkDefaultClanStoreResult>;
  deleteDefaultClan: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
    canDeleteOtherUsers: boolean;
  }) => Promise<LinkDeleteDefaultClanStoreResult>;
  listPlayerLinksByTags: (playerTags: readonly string[]) => Promise<LinkListPlayerLink[]>;
  deletePlayerLink: (input: LinkDeleteStoreInput) => Promise<LinkDeleteStoreResult>;
}

export interface LinkDeleteStoreInput {
  readonly guildId: string;
  readonly actorDiscordUserId: string;
  readonly playerTag: string;
  readonly canDeleteOtherUsers: boolean;
}

export type LinkDeleteStoreResult =
  | {
      readonly status: 'deleted';
      readonly discordUserId: string;
      readonly promotedDefaultTag: string | null;
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'permission_denied'; readonly discordUserId: string };

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
  readonly config: LinkManagerConfigStore;
}

export interface LinkManagerConfigStore {
  getGuildConfig: (guildId: string) => Promise<{ linksManagerRoleIds: readonly string[] }>;
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
        return;
      }
      if (subcommand === 'delete') {
        await executeLinkDelete(interaction, options);
      }
    },
  };
}

export async function executeLinkDelete(
  interaction: ChatInputCommandInteraction,
  options: LinkCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/link delete` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const clanTag = interaction.options.getString('clan_tag');
  const playerTagOption = interaction.options.getString('player_tag');
  if (clanTag && playerTagOption) {
    await interaction.reply({
      content: 'Please specify either a player tag or a clan tag, not both.',
      ephemeral: true,
    });
    return;
  }

  if (clanTag) {
    let normalizedClanTag: string;
    try {
      normalizedClanTag = normalizeClashTag(clanTag);
    } catch {
      await interaction.reply({
        content: 'This player or clan tag is not valid.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const result = await options.links.deleteDefaultClan({
      guildId: interaction.guildId,
      actorDiscordUserId: interaction.user.id,
      clanTag: normalizedClanTag,
      canDeleteOtherUsers: await canManageLinks(interaction, options.config),
    });

    await interaction.editReply(formatLinkDeleteDefaultClanResult(result, normalizedClanTag));
    return;
  }

  if (!playerTagOption) {
    await interaction.reply({
      content: 'You must specify a player/clan tag to execute this command.',
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
  const result = await options.links.deletePlayerLink({
    guildId: interaction.guildId,
    actorDiscordUserId: interaction.user.id,
    playerTag,
    canDeleteOtherUsers: await canManageLinks(interaction, options.config),
  });

  await interaction.editReply(formatLinkDeleteResult(result, playerTag));
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
  const playerTagOption = interaction.options.getString('player_tag');
  if (clanTag && playerTagOption) {
    await interaction.reply({
      content: 'Please specify either a player tag or a clan tag, not both.',
      ephemeral: true,
    });
    return;
  }

  if (!playerTagOption && !clanTag) {
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

  if (
    targetUser.id !== interaction.user.id &&
    !(await canManageLinks(interaction, options.config))
  ) {
    await interaction.reply({
      content:
        'You can link your own accounts here. Linking accounts or default clans for another user requires Manage Server or a configured links manager role.',
      ephemeral: true,
    });
    return;
  }

  if (clanTag) {
    await executeLinkCreateDefaultClan(interaction, options, targetUser, clanTag);
    return;
  }

  if (!playerTagOption) return;

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

async function executeLinkCreateDefaultClan(
  interaction: ChatInputCommandInteraction<'cached'>,
  options: LinkCommandOptions,
  targetUser: User,
  clanTagOption: string,
): Promise<void> {
  let clanTag: string;
  try {
    clanTag = normalizeClashTag(clanTagOption);
  } catch {
    await interaction.reply({ content: 'This player or clan tag is not valid.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let clan: ClashClan;
  try {
    clan = await options.coc.getClan(clanTag);
  } catch {
    await interaction.editReply('This player or clan tag is not valid.');
    return;
  }

  const result = await options.links.setDefaultClan({
    guildId: interaction.guildId,
    actorDiscordUserId: interaction.user.id,
    discordUserId: targetUser.id,
    clanTag: clan.tag,
    clanName: clan.name,
  });

  await interaction.editReply(formatLinkCreateDefaultClanResult(result, clan, targetUser));
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
  const shownRows = Math.min(
    rows.length,
    description.length > 4096 ? countRowsWithinLimit(rows) : rows.length,
  );
  const badgeUrl = extractClanBadgeUrl(clan.data);
  const embed = new EmbedBuilder()
    .setAuthor(
      badgeUrl
        ? { name: `${clan.name} (${clan.tag})`, iconURL: badgeUrl }
        : { name: `${clan.name} (${clan.tag})` },
    )
    .setDescription(description.slice(0, 4096))
    .setFooter({
      text: `Showing ${shownRows}/${rows.length} clan members (${links.length} linked rows matched). Read-only lookup: no clan enrollment or polling changes.`,
    });

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

function countRowsWithinLimit(rows: readonly LinkListRow[]): number {
  let count = 0;
  let length = 0;
  const groups = [
    { title: 'Players in the Server', rows: rows.filter((row) => row.isLinked && row.isInServer) },
    {
      title: 'Players not in the Server',
      rows: rows.filter((row) => row.isLinked && !row.isInServer),
    },
    { title: 'Players not Linked', rows: rows.filter((row) => !row.isLinked) },
  ];

  for (const [index, group] of groups.entries()) {
    if (index > 0) length += 2;
    length += `**${group.title}: ${group.rows.length}**`.length;
    for (const row of group.rows) {
      length += formatLinkListRow(row).length + 1;
      if (length > 4096) return count;
      count += 1;
    }
  }
  return count;
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
  const targetLabel = `**${targetUser.displayName}**`;

  switch (result.status) {
    case 'linked':
      return `Successfully linked ${playerLabel} to ${targetLabel}. ${result.wasDefault ? 'Default account: this player is now first for ClashMate commands.' : 'Default account: existing preference was preserved; use `is_default:Yes` to promote this player.'} This link is local to this server and does not enroll the player or clan for polling.`;
    case 'already_linked_to_user':
      return `${playerLabel} is already linked to ${targetLabel}. No new row was created; use \`is_default:Yes\` to make it the default account if needed.`;
    case 'already_linked_to_other_user':
      return `${playerLabel} is already linked to <@${result.discordUserId}>. Conflict guidance: ask a links manager to remove the stale link, or use /verify with the in-game API token if you own this account.`;
    case 'max_accounts_reached':
      return `${targetLabel} already has the maximum number of linked accounts (${result.maxAccounts} accounts/user). Delete an old link or choose another target user before linking more.`;
  }
}

export function formatLinkDeleteResult(result: LinkDeleteStoreResult, playerTag: string): string {
  if (result.status === 'deleted') {
    const defaultNote = result.promotedDefaultTag
      ? ` **${result.promotedDefaultTag}** is now the default account for that user.`
      : ' That user has no promoted replacement default account from this delete.';
    return `Successfully deleted the link with the tag **${playerTag}** for <@${result.discordUserId}>.${defaultNote} This only removes the Discord link; it does not change polling enrollment.`;
  }
  if (result.status === 'not_found') {
    return `No matches were found with the tag **${playerTag}**. Nothing was deleted; check the tag or list the clan links first.`;
  }
  return `Permission denied: **${playerTag}** belongs to <@${result.discordUserId}>. You can delete your own links here; deleting another user's link requires Manage Server or a configured links manager role.`;
}

export function formatLinkCreateDefaultClanResult(
  _result: LinkDefaultClanStoreResult,
  clan: Pick<ClashClan, 'name' | 'tag'>,
  targetUser: Pick<User, 'displayName'>,
): string {
  return `Stored **${clan.name} (${clan.tag})** as **${targetUser.displayName}**'s default clan for ClashMate features. Default clan: this server preference is now set for that user and audited. This does not link the clan to the server or enroll it for polling unless configured elsewhere.`;
}

export function formatLinkDeleteDefaultClanResult(
  result: LinkDeleteDefaultClanStoreResult,
  clanTag: string,
): string {
  if (result.status === 'deleted') {
    return `Deleted the default clan link for **${clanTag}** from <@${result.discordUserId}>. The preference change is audited and does not unlink or unenroll any configured clan polling.`;
  }
  if (result.status === 'not_found') {
    return `No default clan link was found for **${clanTag}**. Nothing was deleted; default clans are separate from server-linked clans.`;
  }
  return `Permission denied: the default clan **${clanTag}** belongs to <@${result.discordUserId}>. You can delete your own default clan links here; deleting another user's default clan link requires Manage Server or a configured links manager role.`;
}

export async function canManageLinks(
  interaction: ChatInputCommandInteraction<'cached'>,
  config: LinkManagerConfigStore,
): Promise<boolean> {
  if (interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return true;

  const guildConfig = await config.getGuildConfig(interaction.guildId);
  return hasConfiguredManagerRole({
    memberRoleIds: interaction.member.roles.cache.map((role) => role.id),
    managerRoleIds: guildConfig.linksManagerRoleIds,
  });
}

export function hasConfiguredManagerRole(input: {
  readonly memberRoleIds: readonly string[];
  readonly managerRoleIds: readonly string[];
}): boolean {
  if (input.managerRoleIds.length === 0) return false;
  return input.memberRoleIds.some((roleId) => input.managerRoleIds.includes(roleId));
}
