import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  ActionRowBuilder,
  type APIEmbedField,
  type Attachment,
  ButtonBuilder,
  ButtonStyle,
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
      .setDescription('Show or update layout voting and tracking settings.')
      .addBooleanOption((option) =>
        option
          .setName('allow_voting')
          .setDescription('Save whether layout voting should be shown as enabled.')
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('allow_tracking')
          .setDescription('Save whether layout submissions should be tracked.')
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

export interface LayoutSubmissionSummaryRecord {
  count: number;
  latest: Array<{
    id: string;
    layoutLink: string;
    createdAt: string;
  }>;
}

export interface LayoutLinkMetadata {
  gameLayoutId: string;
  townHall?: string;
}

export interface LayoutConfigStore {
  getLayoutConfig: (guildId: string) => Promise<LayoutConfigRecord>;
  getLayoutSubmissionSummary: (
    guildId: string,
    limit?: number,
  ) => Promise<LayoutSubmissionSummaryRecord>;
  updateLayoutConfig: (input: {
    guildId: string;
    guildName: string | null;
    actorDiscordUserId: string;
    allowVoting?: boolean;
    allowTracking?: boolean;
  }) => Promise<LayoutConfigRecord>;
  createLayoutSubmission: (input: {
    guildId: string;
    guildName: string | null;
    channelId: string;
    actorDiscordUserId: string;
    layoutLink: string;
    screenshotUrl: string;
    notes?: string | null;
  }) => Promise<{ id: string }>;
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
    await executeLayoutPost(interaction, context, options);
    return;
  }

  if (subcommand === 'config') {
    await executeLayoutConfig(interaction, context, options);
  }
}

export async function executeLayoutPost(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  options: LayoutCommandOptions,
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
  const config = interaction.guildId
    ? await options.store.getLayoutConfig(interaction.guildId)
    : null;
  const submission =
    interaction.guildId && config?.allowTracking
      ? await options.store.createLayoutSubmission({
          guildId: interaction.guildId,
          guildName: interaction.guild?.name ?? null,
          channelId: interaction.channelId,
          actorDiscordUserId: interaction.user.id,
          layoutLink,
          screenshotUrl: screenshot.url,
          ...(notes ? { notes } : {}),
        })
      : null;

  await interaction.reply({
    embeds: [
      buildLayoutPostEmbed({
        view,
        screenshot,
        layoutLink,
        allowVoting: config?.allowVoting ?? false,
        ...(parseLayoutLinkMetadata(layoutLink) ?? {}),
        ...(notes ? { notes } : {}),
        submitterId: interaction.user.id,
        ...(submission ? { layoutId: submission.id } : {}),
      }),
    ],
    components: [buildLayoutButtonRow(layoutLink, config?.allowVoting ?? false)],
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
  const submissionSummary = await options.store.getLayoutSubmissionSummary(interaction.guildId, 3);
  const view = collectLayoutView(interaction, context);

  await interaction.reply({
    embeds: [buildLayoutConfigEmbed({ view, config, submissionSummary, updated: hasUpdates })],
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
  allowVoting: boolean;
  gameLayoutId?: string;
  townHall?: string;
  notes?: string;
  submitterId: string;
  layoutId?: string;
}): EmbedBuilder {
  const fields: APIEmbedField[] = [
    { name: 'Layout Link', value: input.layoutLink, inline: false },
    { name: 'Submitter', value: `<@${input.submitterId}>`, inline: true },
  ];

  if (input.gameLayoutId) {
    fields.push({ name: 'Game Layout ID', value: input.gameLayoutId, inline: true });
  }

  if (input.townHall) fields.push({ name: 'Town Hall', value: input.townHall, inline: true });

  if (input.layoutId) fields.push({ name: 'Layout ID', value: input.layoutId, inline: true });

  fields.push({
    name: 'Submission Tracking',
    value: input.layoutId
      ? 'Tracked and saved for this server.'
      : 'Not tracked. Layout submission tracking is disabled for this server.',
    inline: false,
  });

  if (input.allowVoting) {
    fields.push({
      name: 'Voting',
      value:
        'Voting display is enabled for this server. Upvote and Downvote buttons are shown disabled because vote collection is pending.',
      inline: false,
    });
  }

  if (input.notes) fields.push({ name: 'Notes', value: input.notes, inline: false });

  return new EmbedBuilder()
    .setColor(input.view.color ?? DEFAULT_LAYOUT_EMBED_COLOR)
    .setTitle('Clash of Clans Layout')
    .setAuthor(
      input.view.botAvatarUrl
        ? { name: input.view.botName, iconURL: input.view.botAvatarUrl }
        : { name: input.view.botName },
    )
    .setFooter({ text: 'Use the button below to open this layout in Clash of Clans.' })
    .setImage(input.screenshot.url)
    .addFields(fields);
}

export function buildLayoutButtonRow(
  layoutLink: string,
  allowVoting: boolean,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Layout').setURL(layoutLink),
  );

  if (allowVoting) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Success)
        .setLabel('Upvote')
        .setCustomId('layout_vote_up_disabled')
        .setDisabled(true),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Danger)
        .setLabel('Downvote')
        .setCustomId('layout_vote_down_disabled')
        .setDisabled(true),
    );
  }

  return row;
}

export function buildOpenLayoutButtonRow(layoutLink: string): ActionRowBuilder<ButtonBuilder> {
  return buildLayoutButtonRow(layoutLink, false);
}

export function buildLayoutConfigEmbed(input: {
  view: LayoutView;
  config: LayoutConfigRecord;
  submissionSummary: LayoutSubmissionSummaryRecord;
  updated: boolean;
}): EmbedBuilder {
  const settings = [
    `Saved voting setting: ${formatEnabledBoolean(input.config.allowVoting)}`,
    `Saved submission tracking: ${formatEnabledBoolean(input.config.allowTracking)}`,
  ].join('\n');
  const trackedSubmissionSummary = formatLayoutSubmissionSummary(input.submissionSummary);

  return new EmbedBuilder()
    .setColor(input.view.color ?? DEFAULT_LAYOUT_EMBED_COLOR)
    .setTitle('Layout Config')
    .setDescription(
      [
        input.updated ? 'Layout configuration was saved.' : 'Current saved layout configuration.',
        input.config.allowVoting
          ? 'Saved submission tracking works when enabled. Voting display is enabled, but vote collection is pending.'
          : 'Saved submission tracking works when enabled. Voting is disabled.',
        '',
        settings,
        '',
        trackedSubmissionSummary,
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

export function parseLayoutLinkMetadata(value: string): LayoutLinkMetadata | null {
  try {
    const url = new URL(value);
    const gameLayoutId = url.searchParams.get('id')?.trim();
    if (!gameLayoutId) return null;

    const townHallMatch = /^TH(\d{1,2})(?:\D|$)/i.exec(gameLayoutId);
    return {
      gameLayoutId,
      ...(townHallMatch?.[1] ? { townHall: `TH${townHallMatch[1]}` } : {}),
    };
  } catch {
    return null;
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

function formatLayoutSubmissionSummary(summary: LayoutSubmissionSummaryRecord): string {
  if (summary.count === 0) return 'Stored submission summary: 0 tracked layouts';

  const latest = summary.latest
    .map((submission) => {
      const timestamp = formatDiscordTimestamp(submission.createdAt);
      return `• ${submission.id}: ${submission.layoutLink}${timestamp ? ` (${timestamp})` : ''}`;
    })
    .join('\n');

  return [
    `Stored submission summary: ${summary.count} tracked layouts`,
    'Latest tracked submissions:',
    latest,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatDiscordTimestamp(value: string): string | null {
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  return `<t:${Math.floor(time / 1000)}:f>`;
}
