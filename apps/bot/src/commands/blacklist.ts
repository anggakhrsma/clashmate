import type { GlobalAccessBlockStore } from '@clashmate/database';
import { type CommandContext, isOwner, type SlashCommandDefinition } from '@clashmate/discord';
import { SlashCommandBuilder, type User } from 'discord.js';

export const BLACKLIST_COMMAND_NAME = 'blacklist';
export const BLACKLIST_COMMAND_DESCRIPTION =
  'Owner-only toggle for globally blocking a user from ClashMate commands.';
export const BLACKLIST_USER_OPTION_DESCRIPTION =
  'Discord user to add to or remove from the global command blacklist.';

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
          content:
            'Only configured bot owners can use `/blacklist`; server admins cannot manage the global command blacklist.',
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

export function validateBlacklistTarget(
  targetUserId: string,
  context: Pick<CommandContext, 'client' | 'ownerIds'>,
): string | undefined {
  if (isOwner(targetUserId, context.ownerIds)) {
    return 'That user is configured as a bot owner and cannot be blacklisted.';
  }

  if (targetUserId === context.client.user?.id) {
    return 'ClashMate cannot blacklist itself; choose a Discord user instead.';
  }

  return undefined;
}

export function formatBlacklistToggleMessage(options: {
  action: 'created' | 'deleted';
  targetDisplayName: string;
  botDisplayName: string;
}): string {
  if (options.action === 'deleted') {
    return `No longer blacklisted: **${options.targetDisplayName}** can use ${options.botDisplayName} commands again. This global access change has been saved.`;
  }

  return `Blacklisted **${options.targetDisplayName}** from using ${options.botDisplayName} commands. This global access change has been saved and will be enforced on future command attempts.`;
}

function getUserDisplayName(user: User): string {
  return user.displayName ?? user.username;
}

function getBotDisplayName(context: Pick<CommandContext, 'client'>): string {
  return context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate';
}
