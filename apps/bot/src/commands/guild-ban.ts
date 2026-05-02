import type { GlobalAccessBlockStore } from '@clashmate/database';
import { type CommandContext, isOwner, type SlashCommandDefinition } from '@clashmate/discord';
import { SlashCommandBuilder } from 'discord.js';

export const GUILD_BAN_COMMAND_NAME = 'guild-ban';
export const GUILD_BAN_COMMAND_DESCRIPTION =
  'Toggle whether a Discord server can use ClashMate commands.';
export const GUILD_BAN_ID_OPTION_DESCRIPTION =
  'Server ID to add to or remove from the command blacklist.';

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export const guildBanCommandData = new SlashCommandBuilder()
  .setName(GUILD_BAN_COMMAND_NAME)
  .setDescription(GUILD_BAN_COMMAND_DESCRIPTION)
  .setDMPermission(true)
  .addStringOption((option) =>
    option.setName('id').setDescription(GUILD_BAN_ID_OPTION_DESCRIPTION).setRequired(true),
  );

export interface GuildBanCommandOptions {
  accessBlocks: GlobalAccessBlockStore;
}

export function createGuildBanSlashCommand(
  options: GuildBanCommandOptions,
): SlashCommandDefinition {
  return {
    name: GUILD_BAN_COMMAND_NAME,
    data: guildBanCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;

      if (!isOwner(interaction.user.id, context.ownerIds)) {
        await interaction.reply({
          content: 'Only bot owners can use `/guild-ban`.',
          ephemeral: true,
        });
        return;
      }

      const guildId = interaction.options.getString('id', true).trim();
      if (!isDiscordSnowflake(guildId)) {
        await interaction.reply({ content: 'Invalid guildId.', ephemeral: true });
        return;
      }

      const targetDisplayName = resolveGuildDisplayName(guildId, context);
      const result = await options.accessBlocks.toggle({
        targetType: 'guild',
        targetId: guildId,
        targetName: targetDisplayName,
        actorDiscordUserId: interaction.user.id,
      });

      await interaction.reply({
        content: formatGuildBanToggleMessage({
          action: result.action,
          targetDisplayName,
          botDisplayName: getBotDisplayName(context),
        }),
        ephemeral: true,
      });
    },
  };
}

export function isDiscordSnowflake(value: string): boolean {
  return DISCORD_SNOWFLAKE_PATTERN.test(value);
}

export function resolveGuildDisplayName(
  guildId: string,
  context: Pick<CommandContext, 'client'>,
): string {
  return context.client.guilds.cache.get(guildId)?.name ?? guildId;
}

export function formatGuildBanToggleMessage(options: {
  action: 'created' | 'deleted';
  targetDisplayName: string;
  botDisplayName: string;
}): string {
  if (options.action === 'deleted') {
    return `**${options.targetDisplayName}** has been removed from the ${options.botDisplayName}'s blacklist.`;
  }

  return `**${options.targetDisplayName}** has been blacklisted from using ${options.botDisplayName}'s command.`;
}

function getBotDisplayName(context: Pick<CommandContext, 'client'>): string {
  return context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate';
}
