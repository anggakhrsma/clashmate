import type { GlobalAccessBlockStore } from '@clashmate/database';
import {
  type CommandContext,
  isOwner,
  type MessageCommandDefinition,
  type SlashCommandDefinition,
} from '@clashmate/discord';
import { SlashCommandBuilder, type User } from 'discord.js';

export const BLACKLIST_COMMAND_NAME = 'blacklist';
export const BLACKLIST_COMMAND_DESCRIPTION =
  'Toggle whether a Discord user can use ClashMate commands.';
export const BLACKLIST_USER_OPTION_DESCRIPTION =
  'User to add to or remove from the command blacklist.';

export const blacklistCommandData = new SlashCommandBuilder()
  .setName(BLACKLIST_COMMAND_NAME)
  .setDescription(BLACKLIST_COMMAND_DESCRIPTION)
  .setDMPermission(true)
  .addUserOption((option) =>
    option.setName('user').setDescription(BLACKLIST_USER_OPTION_DESCRIPTION).setRequired(true),
  );

export interface BlacklistCommandOptions {
  accessBlocks: GlobalAccessBlockStore;
}

export function createBlacklistSlashCommand(
  options: BlacklistCommandOptions,
): SlashCommandDefinition {
  return {
    name: BLACKLIST_COMMAND_NAME,
    data: blacklistCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;

      if (!isOwner(interaction.user.id, context.ownerIds)) {
        await interaction.reply({
          content: 'Only bot owners can use `/blacklist`.',
          ephemeral: true,
        });
        return;
      }

      const target = interaction.options.getUser('user', true);
      const validation = validateBlacklistTarget(target.id, context);
      if (validation) {
        await interaction.reply({ content: validation, ephemeral: true });
        return;
      }

      const result = await options.accessBlocks.toggle({
        targetType: 'user',
        targetId: target.id,
        targetName: getUserDisplayName(target),
        actorDiscordUserId: interaction.user.id,
      });

      await interaction.reply({
        content: formatBlacklistToggleMessage({
          action: result.action,
          targetDisplayName: getUserDisplayName(target),
          botDisplayName: getBotDisplayName(context),
        }),
        ephemeral: true,
      });
    },
  };
}

export function createBlacklistMessageCommand(
  options: BlacklistCommandOptions,
): MessageCommandDefinition {
  return {
    name: BLACKLIST_COMMAND_NAME,
    ownerOnly: true,
    execute: async (message, context) => {
      if (!isOwner(message.author.id, context.ownerIds)) return;

      const id = message.content.trim().split(/\s+/)[1];
      const target = id ? await context.client.users.fetch(id).catch(() => null) : null;
      if (!target) {
        await message.reply('Invalid userId.');
        return;
      }

      const validation = validateBlacklistTarget(target.id, context);
      if (validation) {
        await message.reply(validation);
        return;
      }

      const result = await options.accessBlocks.toggle({
        targetType: 'user',
        targetId: target.id,
        targetName: getUserDisplayName(target),
        actorDiscordUserId: message.author.id,
      });

      const content = formatBlacklistToggleMessage({
        action: result.action,
        targetDisplayName: getUserDisplayName(target),
        botDisplayName: getBotDisplayName(context),
      });

      if (message.channel.isSendable()) await message.channel.send(content);
      else await message.reply(content);
    },
  };
}

export function validateBlacklistTarget(
  targetUserId: string,
  context: Pick<CommandContext, 'client' | 'ownerIds'>,
): string | undefined {
  if (isOwner(targetUserId, context.ownerIds)) {
    return 'Bot owners cannot be blacklisted.';
  }

  if (targetUserId === context.client.user?.id) {
    return 'ClashMate cannot blacklist itself.';
  }

  return undefined;
}

export function formatBlacklistToggleMessage(options: {
  action: 'created' | 'deleted';
  targetDisplayName: string;
  botDisplayName: string;
}): string {
  if (options.action === 'deleted') {
    return `**${options.targetDisplayName}** has been removed from the ${options.botDisplayName}'s blacklist.`;
  }

  return `**${options.targetDisplayName}** has been blacklisted from using ${options.botDisplayName}'s command.`;
}

function getUserDisplayName(user: User): string {
  return user.displayName ?? user.username;
}

function getBotDisplayName(context: Pick<CommandContext, 'client'>): string {
  return context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate';
}
