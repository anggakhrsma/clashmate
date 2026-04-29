import type { ClashPlayer } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ChatInputCommandInteraction,
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
  );

export interface LinkCreatePlayer {
  readonly tag: string;
  readonly name: string;
}

export interface LinkCreateCocApi {
  getPlayer: (playerTag: string) => Promise<LinkCreatePlayer | ClashPlayer>;
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
      if (subcommand !== 'create') return;

      await executeLinkCreate(interaction, context, options);
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
