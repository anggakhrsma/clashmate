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
export const INVITE_COMMAND_DESCRIPTION = 'Get the bot invite and support server link.';
export const DEFAULT_INVITE_EMBED_COLOR = 0x5865f2;
export const CLASHMATE_SOURCE_URL = 'https://github.com/anggakhrsma/clashmate';
export const CLASHMATE_SUPPORT_URL = 'https://cmte.io/support';
export const CLASHMATE_INVITE_NOTE =
  'ClashMate is open-source and self-hostable; there is no premium tier or custom bot hosting upsell.';

const INVITE_PERMISSIONS = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageWebhooks,
]);

export const inviteCommandData = new SlashCommandBuilder()
  .setName(INVITE_COMMAND_NAME)
  .setDescription(INVITE_COMMAND_DESCRIPTION)
  .setDMPermission(true);

export interface InviteView {
  botName: string;
  botAvatarUrl?: string;
  color?: ColorResolvable;
  applicationId?: string;
  inviteUrl?: string;
  visibleInGuild: boolean;
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
    ...(applicationId ? { applicationId } : {}),
    ...(applicationId ? { inviteUrl: buildInviteUrl(applicationId) } : {}),
    visibleInGuild: Boolean(source.guild),
  };
}

export function buildInviteEmbed(view: InviteView): EmbedBuilder {
  const description = view.inviteUrl
    ? [
        'ClashMate can be added to as many servers as you want. Share the bot with friends or run your own self-hosted copy.',
        '',
        `**[Add to Discord](${view.inviteUrl})**`,
        '',
        '**Scopes:** `bot`, `applications.commands`',
        `**Application id:** ${view.applicationId ? `\`${view.applicationId}\`` : 'Unavailable'}`,
        `**Visibility:** ${formatVisibility(view.visibleInGuild)}`,
        `**Requested permissions:** ${formatInvitePermissionSummary()}`,
        `**Permission categories:** ${formatInvitePermissionCategories()}`,
        '',
        `**Support Server:** ${CLASHMATE_SUPPORT_URL} | **Source Code:** ${CLASHMATE_SOURCE_URL}`,
        CLASHMATE_INVITE_NOTE,
      ]
    : [
        'I could not build an invite link because the bot application id is unavailable.',
        'Use the support link below or verify the bot token/application configuration, then try `/invite` again.',
        '',
        '**Scopes:** `bot`, `applications.commands`',
        '**Application id:** Unavailable',
        `**Visibility:** ${formatVisibility(view.visibleInGuild)}`,
        `**Requested permissions:** ${formatInvitePermissionSummary()}`,
        `**Permission categories:** ${formatInvitePermissionCategories()}`,
        '',
        `**Support Server:** ${CLASHMATE_SUPPORT_URL} | **Source Code:** ${CLASHMATE_SOURCE_URL}`,
        CLASHMATE_INVITE_NOTE,
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
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', applicationId);
  url.searchParams.set('scope', [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join(' '));
  url.searchParams.set('permissions', INVITE_PERMISSIONS.bitfield.toString());
  return url.toString();
}

function formatInvitePermissions(): string {
  return INVITE_PERMISSIONS.toArray()
    .map((permission) => `\`${permission}\``)
    .join(', ');
}

function formatInvitePermissionSummary(): string {
  return `${INVITE_PERMISSIONS.toArray().length} permissions (${formatInvitePermissions()})`;
}

function formatInvitePermissionCategories(): string {
  return ['channel visibility', 'messaging', 'embeds/files', 'reactions', 'roles', 'webhooks']
    .map((category) => `\`${category}\``)
    .join(', ');
}

function formatVisibility(visibleInGuild: boolean): string {
  return visibleInGuild ? 'Server command response (ephemeral)' : 'DM command response';
}
