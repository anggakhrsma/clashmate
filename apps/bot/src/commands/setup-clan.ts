import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type Channel,
  ChannelType,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const SETUP_COMMAND_NAME = 'setup';
export const SETUP_COMMAND_DESCRIPTION =
  'Enable/disable features on the server or add/remove clans.';

const allowedClanChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.GuildMedia,
] as const;

export const setupClanCommandData = new SlashCommandBuilder()
  .setName(SETUP_COMMAND_NAME)
  .setDescription(SETUP_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('clan')
      .setDescription('Link/unlink clans to the server or channels.')
      .addStringOption((option) =>
        option
          .setName('clan')
          .setDescription('Clan tag or name or alias.')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('category')
          .setDescription('Category of the clan. (select from the menu or type your own)')
          .setMaxLength(36)
          .setAutocomplete(true),
      )
      .addChannelOption((option) =>
        option
          .setName('clan_channel')
          .setDescription('Link the clan to a channel.')
          .addChannelTypes(...allowedClanChannelTypes),
      )
      .addChannelOption((option) =>
        option
          .setName('unlink_clan_channel')
          .setDescription('Unlink a channel from the clan.')
          .addChannelTypes(...allowedClanChannelTypes),
      )
      .addBooleanOption((option) =>
        option
          .setName('unlink_clan')
          .setDescription(
            'Unlink a clan from the server and remove all the features related to it.',
          ),
      ),
  );

export interface SetupClanClashClan {
  readonly tag: string;
  readonly name: string;
}

export interface SetupClanTrackedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string;
}

export interface SetupClanCategory {
  readonly id: string;
  readonly displayName: string;
}

export interface SetupClanChannelConflict {
  readonly clanName: string;
  readonly clanTag: string;
}

export interface LinkClanInput {
  readonly guildId: string;
  readonly guildName: string;
  readonly actorDiscordUserId: string;
  readonly clan: SetupClanClashClan;
  readonly category?: string;
  readonly channelId?: string;
  readonly channelType?: string;
}

export type LinkClanResult =
  | {
      readonly status: 'linked';
      readonly clanName: string;
      readonly clanTag: string;
      readonly category?: SetupClanCategory;
      readonly channelLinked: boolean;
    }
  | {
      readonly status: 'channel_conflict';
      readonly conflict: SetupClanChannelConflict;
    };

export interface UnlinkClanInput {
  readonly guildId: string;
  readonly actorDiscordUserId: string;
  readonly clanTag: string;
}

export interface UnlinkChannelInput {
  readonly guildId: string;
  readonly actorDiscordUserId: string;
  readonly channelId: string;
}

export interface SetupClanStore {
  linkClan: (input: LinkClanInput) => Promise<LinkClanResult>;
  unlinkClan: (
    input: UnlinkClanInput,
  ) => Promise<{ status: 'unlinked'; clan: SetupClanTrackedClan } | { status: 'not_found' }>;
  unlinkChannel: (
    input: UnlinkChannelInput,
  ) => Promise<{ status: 'unlinked'; clanName: string } | { status: 'not_found' }>;
}

export interface SetupClanApi {
  getClan: (clanTag: string) => Promise<SetupClanClashClan>;
}

export interface SetupClanCommandOptions {
  clans: SetupClanStore;
  coc: SetupClanApi;
}

export function createSetupClanSlashCommand(
  options: SetupClanCommandOptions,
): SlashCommandDefinition {
  return {
    name: SETUP_COMMAND_NAME,
    data: setupClanCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== SETUP_COMMAND_NAME) return;
      if (interaction.options.getSubcommand() !== 'clan') return;

      await executeSetupClan(interaction, context, options);
    },
  };
}

async function executeSetupClan(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: SetupClanCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/setup clan` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'You need the Manage Server permission to use `/setup clan`.',
      ephemeral: true,
    });
    return;
  }

  const clanOption = interaction.options.getString('clan', true);
  let clanTag: string;
  try {
    clanTag = normalizeClashTag(clanOption);
  } catch {
    await interaction.reply({
      content: 'Please provide a valid Clash of Clans clan tag.',
      ephemeral: true,
    });
    return;
  }

  const unlinkChannel = interaction.options.getChannel('unlink_clan_channel');
  if (unlinkChannel) {
    const result = await options.clans.unlinkChannel({
      guildId: interaction.guildId,
      actorDiscordUserId: interaction.user.id,
      channelId: unlinkChannel.id,
    });
    await interaction.reply({
      content: formatUnlinkChannelMessage(result, unlinkChannel.id),
      ephemeral: true,
    });
    return;
  }

  if (interaction.options.getBoolean('unlink_clan') === true) {
    const result = await options.clans.unlinkClan({
      guildId: interaction.guildId,
      actorDiscordUserId: interaction.user.id,
      clanTag,
    });
    await interaction.reply({ content: formatUnlinkClanMessage(result), ephemeral: true });
    return;
  }

  let clan: SetupClanClashClan;
  try {
    clan = await options.coc.getClan(clanTag);
  } catch {
    await interaction.reply({ content: `Could not find clan **${clanTag}**.`, ephemeral: true });
    return;
  }

  const channel = interaction.options.getChannel('clan_channel');
  const category = interaction.options.getString('category') ?? undefined;
  const result = await options.clans.linkClan({
    guildId: interaction.guildId,
    guildName: interaction.guild.name,
    actorDiscordUserId: interaction.user.id,
    clan,
    ...(category ? { category } : {}),
    ...(channel ? { channelId: channel.id, channelType: getChannelTypeName(channel) } : {}),
  });

  await interaction.reply({
    content: formatLinkClanMessage(result, interaction.guild.name, channel?.id),
    ephemeral: true,
  });
}

function getChannelTypeName(channel: Channel): string {
  return ChannelType[channel.type] ?? String(channel.type);
}

function normalizeClashTag(tag: string): string {
  const normalized = tag.trim().toUpperCase().replace(/^#?/, '#').replace(/O/g, '0');
  if (!/^#[0289PYLQGRJCUV]+$/.test(normalized)) {
    throw new Error(`Invalid Clash of Clans tag: ${tag}`);
  }
  return normalized;
}

export function formatUnlinkChannelMessage(
  result: Awaited<ReturnType<SetupClanStore['unlinkChannel']>>,
  channelId: string,
): string {
  if (result.status === 'unlinked') {
    return `Successfully unlinked **${result.clanName}** from <#${channelId}>.`;
  }
  return `No clans were found that are linked to <#${channelId}>.`;
}

export function formatUnlinkClanMessage(
  result: Awaited<ReturnType<SetupClanStore['unlinkClan']>>,
): string {
  if (result.status === 'unlinked') {
    return `Successfully unlinked **${result.clan.name} (${result.clan.clanTag})**.`;
  }
  return 'No clans were found on the server for the specified tag.';
}

export function formatLinkClanMessage(
  result: LinkClanResult,
  guildName: string,
  channelId?: string,
): string {
  if (result.status === 'channel_conflict') {
    return `<#${channelId}> is already linked to ${result.conflict.clanName} (${result.conflict.clanTag})`;
  }

  const channelText = result.channelLinked && channelId ? ` <#${channelId}>` : '';
  const categoryText = result.category ? ` with category **${result.category.displayName}**` : '';
  return `Successfully linked **${result.clanName} (${result.clanTag})** to **${guildName}**${channelText}${categoryText}.`;
}
