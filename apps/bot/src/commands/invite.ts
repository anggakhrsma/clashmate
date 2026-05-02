import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  OAuth2Scopes,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from 'discord.js';

export const INVITE_COMMAND_NAME = 'invite';
export const INVITE_COMMAND_DESCRIPTION = 'Get an invite link for ClashMate.';
export const DEFAULT_INVITE_EMBED_COLOR = 0x5865f2;
export const CLASHMATE_SOURCE_URL = 'https://github.com/anggakhrsma/clashmate';
export const CLASHMATE_SUPPORT_URL = 'https://cmte.io/support';

const INVITE_PERMISSIONS = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
]);

export const inviteCommandData = new SlashCommandBuilder()
  .setName(INVITE_COMMAND_NAME)
  .setDescription(INVITE_COMMAND_DESCRIPTION)
  .setDMPermission(true);

export interface InviteView {
  botName: string;
  botAvatarUrl?: string;
  color?: ColorResolvable;
  inviteUrl?: string;
}

export function createInviteSlashCommand(): SlashCommandDefinition {
  return {
    name: INVITE_COMMAND_NAME,
    data: inviteCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      await executeInviteInteraction(interaction, context);
    },
  };
}

export async function executeInviteInteraction(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const view = collectInviteView(interaction, context);

  await interaction.reply({
    embeds: [buildInviteEmbed(view)],
    ephemeral: interaction.inGuild(),
  });
}

export function collectInviteView(
  source: Pick<ChatInputCommandInteraction, 'guild'>,
  context: CommandContext,
): InviteView {
  const botAvatarUrl =
    context.client.user && typeof context.client.user.displayAvatarURL === 'function'
      ? context.client.user.displayAvatarURL({ extension: 'png' })
      : undefined;
  const applicationId = context.client.application?.id ?? context.client.user?.id;

  return {
    botName: context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate',
    ...(botAvatarUrl ? { botAvatarUrl } : {}),
    color: source.guild?.members.me?.displayColor || DEFAULT_INVITE_EMBED_COLOR,
    ...(applicationId ? { inviteUrl: buildInviteUrl(applicationId) } : {}),
  };
}

export function buildInviteEmbed(view: InviteView): EmbedBuilder {
  const description = view.inviteUrl
    ? [
        'ClashMate can be added to any server where you have permission to manage apps.',
        '',
        `**[Add to Discord](${view.inviteUrl})**`,
        '',
        `Source: [GitHub](${CLASHMATE_SOURCE_URL}) • Support: [ClashMate Support](${CLASHMATE_SUPPORT_URL})`,
      ]
    : [
        'I could not build an invite link because the bot application id is unavailable.',
        '',
        `Source: [GitHub](${CLASHMATE_SOURCE_URL}) • Support: [ClashMate Support](${CLASHMATE_SUPPORT_URL})`,
      ];

  return new EmbedBuilder()
    .setColor(view.color ?? DEFAULT_INVITE_EMBED_COLOR)
    .setDescription(description.join('\n'))
    .setAuthor(
      view.botAvatarUrl
        ? { name: view.botName, iconURL: view.botAvatarUrl }
        : { name: view.botName },
    );
}

export function buildInviteUrl(applicationId: string): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', applicationId);
  url.searchParams.set('scope', [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join(' '));
  url.searchParams.set('permissions', INVITE_PERMISSIONS.bitfield.toString());
  return url.toString();
}
