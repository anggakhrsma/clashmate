import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type APIEmbedField,
  type Attachment,
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const LAYOUT_COMMAND_NAME = 'layout';
export const LAYOUT_COMMAND_DESCRIPTION = 'Share and configure Clash of Clans layouts.';
export const DEFAULT_LAYOUT_EMBED_COLOR = 0x5865f2;

const PUBLIC_LAYOUT_LINK_REGEX =
  /^https?:\/\/link\.clashofclans\.com\/[a-z]{1,2}\/?\?action=OpenLayout&id=TH\S+$/i;

export const layoutCommandData = new SlashCommandBuilder()
  .setName(LAYOUT_COMMAND_NAME)
  .setDescription(LAYOUT_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('post')
      .setDescription('Post a Clash of Clans layout.')
      .addAttachmentOption((option) =>
        option
          .setName('screenshot')
          .setDescription('Screenshot image for the layout.')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('layout_link')
          .setDescription('Public Clash of Clans OpenLayout link.')
          .setRequired(true)
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option
          .setName('notes')
          .setDescription('Optional notes to include with the layout.')
          .setRequired(false)
          .setMaxLength(2000),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('config')
      .setDescription('Show first-pass layout configuration status.')
      .addBooleanOption((option) =>
        option
          .setName('allow_voting')
          .setDescription('Request layout voting when persistence is available.')
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('allow_tracking')
          .setDescription('Request layout tracking when persistence is available.')
          .setRequired(false),
      ),
  );

export interface LayoutView {
  botName: string;
  botAvatarUrl?: string;
  color?: ColorResolvable;
}

export interface LayoutConfigRecord {
  allowVoting: boolean;
  allowTracking: boolean;
}

export interface LayoutConfigStore {
  getLayoutConfig: (guildId: string) => Promise<LayoutConfigRecord>;
  updateLayoutConfig: (input: {
    guildId: string;
    guildName: string | null;
    actorDiscordUserId: string;
    allowVoting?: boolean;
    allowTracking?: boolean;
  }) => Promise<LayoutConfigRecord>;
}

export interface LayoutCommandOptions {
  store: LayoutConfigStore;
}

export function createLayoutSlashCommand(options: LayoutCommandOptions): SlashCommandDefinition {
  return {
    name: LAYOUT_COMMAND_NAME,
    data: layoutCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      await executeLayoutInteraction(interaction, context, options);
    },
  };
}

export async function executeLayoutInteraction(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  options: LayoutCommandOptions,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'post') {
    await executeLayoutPost(interaction, context);
    return;
  }

  if (subcommand === 'config') {
    await executeLayoutConfig(interaction, context, options);
  }
}

export async function executeLayoutPost(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const screenshot = interaction.options.getAttachment('screenshot', true);
  const layoutLink = interaction.options.getString('layout_link', true).trim();
  const notes = interaction.options.getString('notes')?.trim();

  if (!isPublicLayoutLink(layoutLink)) {
    await interaction.reply({ content: 'Invalid layout link was provided.', ephemeral: true });
    return;
  }

  if (!isImageAttachment(screenshot)) {
    await interaction.reply({
      content: 'The screenshot attachment must be an image.',
      ephemeral: true,
    });
    return;
  }

  const view = collectLayoutView(interaction, context);
  await interaction.reply({
    embeds: [
      buildLayoutPostEmbed({
        view,
        screenshot,
        layoutLink,
        ...(notes ? { notes } : {}),
        submitterId: interaction.user.id,
      }),
    ],
    allowedMentions: { users: [] },
  });
}

export async function executeLayoutConfig(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  options: LayoutCommandOptions,
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'Layout configuration is only available in servers.',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'You need Manage Server permission to configure layouts.',
      ephemeral: true,
    });
    return;
  }

  const allowVoting = interaction.options.getBoolean('allow_voting');
  const allowTracking = interaction.options.getBoolean('allow_tracking');
  const hasUpdates = typeof allowVoting === 'boolean' || typeof allowTracking === 'boolean';
  const config = hasUpdates
    ? await options.store.updateLayoutConfig({
        guildId: interaction.guildId,
        guildName: interaction.guild?.name ?? null,
        actorDiscordUserId: interaction.user.id,
        ...(typeof allowVoting === 'boolean' ? { allowVoting } : {}),
        ...(typeof allowTracking === 'boolean' ? { allowTracking } : {}),
      })
    : await options.store.getLayoutConfig(interaction.guildId);
  const view = collectLayoutView(interaction, context);

  await interaction.reply({
    embeds: [buildLayoutConfigEmbed({ view, config, updated: hasUpdates })],
    ephemeral: true,
  });
}

export function collectLayoutView(
  source: Pick<ChatInputCommandInteraction, 'guild'>,
  context: CommandContext,
): LayoutView {
  const botAvatarUrl = context.client.user?.displayAvatarURL({ extension: 'png' });

  return {
    botName: context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate',
    ...(botAvatarUrl ? { botAvatarUrl } : {}),
    color: source.guild?.members.me?.displayColor || DEFAULT_LAYOUT_EMBED_COLOR,
  };
}

export function buildLayoutPostEmbed(input: {
  view: LayoutView;
  screenshot: Attachment;
  layoutLink: string;
  notes?: string;
  submitterId: string;
}): EmbedBuilder {
  const fields: APIEmbedField[] = [
    { name: 'Layout Link', value: input.layoutLink, inline: false },
    { name: 'Submitter', value: `<@${input.submitterId}>`, inline: true },
  ];

  if (input.notes) fields.push({ name: 'Notes', value: input.notes, inline: false });

  return new EmbedBuilder()
    .setColor(input.view.color ?? DEFAULT_LAYOUT_EMBED_COLOR)
    .setTitle('Clash of Clans Layout')
    .setAuthor(
      input.view.botAvatarUrl
        ? { name: input.view.botName, iconURL: input.view.botAvatarUrl }
        : { name: input.view.botName },
    )
    .setImage(input.screenshot.url)
    .addFields(fields);
}

export function buildLayoutConfigEmbed(input: {
  view: LayoutView;
  config: LayoutConfigRecord;
  updated: boolean;
}): EmbedBuilder {
  const settings = [
    `Layout voting: ${formatEnabledBoolean(input.config.allowVoting)}`,
    `Layout tracking: ${formatEnabledBoolean(input.config.allowTracking)}`,
  ].join('\n');

  return new EmbedBuilder()
    .setColor(input.view.color ?? DEFAULT_LAYOUT_EMBED_COLOR)
    .setTitle('Layout Config')
    .setDescription(
      [
        input.updated ? 'Layout configuration was saved.' : 'Current saved layout configuration.',
        'Voting/tracking collectors and layout download tracking are not implemented yet.',
        '',
        settings,
      ].join('\n'),
    )
    .setAuthor(
      input.view.botAvatarUrl
        ? { name: input.view.botName, iconURL: input.view.botAvatarUrl }
        : { name: input.view.botName },
    );
}

export function isPublicLayoutLink(value: string): boolean {
  if (!PUBLIC_LAYOUT_LINK_REGEX.test(value)) return false;

  try {
    const url = new URL(value);
    return (
      url.hostname === 'link.clashofclans.com' && url.searchParams.get('action') === 'OpenLayout'
    );
  } catch {
    return false;
  }
}

export function isImageAttachment(
  attachment: Pick<Attachment, 'contentType' | 'name' | 'url'>,
): boolean {
  if (attachment.contentType) return attachment.contentType.toLowerCase().startsWith('image/');
  const fileName = attachment.name || attachment.url;
  return /\.(?:png|jpe?g|gif|webp)$/i.test(fileName);
}

function formatEnabledBoolean(value: boolean): string {
  return value ? 'enabled' : 'disabled';
}
