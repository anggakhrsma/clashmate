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
export const LAYOUT_COMMAND_DESCRIPTION = 'Manage and share village layouts.';
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
      .setDescription('Post your village layout to showcase it to the community.')
      .addAttachmentOption((option) =>
        option
          .setName('screenshot')
          .setDescription('Upload a screenshot showing your village layout.')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('layout_link')
          .setDescription('Provide a shareable link to your layout.')
          .setRequired(true)
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option
          .setName('notes')
          .setDescription('Add custom notes or details about your layout.')
          .setRequired(false)
          .setMaxLength(2000),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('config')
      .setDescription('Adjust settings related to layout posting and interactions.')
      .addBooleanOption((option) =>
        option
          .setName('allow_voting')
          .setDescription('Enable or disable voting on posted layouts.')
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('allow_tracking')
          .setDescription('Enable or disable tracking of layout copies.')
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
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'Layout posting is only available in server channels.',
      ephemeral: true,
    });
    return;
  }

  const screenshot = interaction.options.getAttachment('screenshot', true);
  const layoutLink = interaction.options.getString('layout_link', true).trim();
  const notes = interaction.options.getString('notes')?.trim();

  if (!isPublicLayoutLink(layoutLink)) {
    await interaction.reply({
      content:
        'Invalid layout link was provided. Use a public Clash of Clans OpenLayout link from the in-game layout share button.',
      ephemeral: true,
    });
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
  const config = await options.store.getLayoutConfig(interaction.guildId);
  const submission = config.allowTracking
    ? await createTrackedLayoutSubmission(options.store, {
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
        allowVoting: config.allowVoting,
        allowTracking: config.allowTracking,
        ...(parseLayoutLinkMetadata(layoutLink) ?? {}),
        ...(notes ? { notes } : {}),
        submitterId: interaction.user.id,
        ...(submission ? { layoutId: submission.id } : {}),
      }),
    ],
    components: [buildLayoutButtonRow(layoutLink, config.allowVoting, config.allowTracking)],
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
  allowTracking: boolean;
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
      ? 'Tracked and saved for this server. Copy counts and downloader history can be added by the interaction layer later.'
      : input.allowTracking
        ? 'Tracking is enabled, but this submission could not be saved.'
        : 'Not tracked. Layout submission tracking is disabled for this server.',
    inline: false,
  });

  fields.push({
    name: 'Voting',
    value: input.allowVoting
      ? 'Voting is enabled for this server. Upvote and Downvote buttons are shown disabled until vote collection is wired to persisted interactions.'
      : 'Voting is disabled for this server, so vote buttons are not shown.',
    inline: false,
  });

  if (input.notes) fields.push({ name: 'Notes', value: input.notes, inline: false });

  return new EmbedBuilder()
    .setColor(input.view.color ?? DEFAULT_LAYOUT_EMBED_COLOR)
    .setTitle(input.townHall ? `${input.townHall} Layout` : 'Clash of Clans Layout')
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
  allowTracking = false,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(allowTracking ? 'Copy Layout' : 'Open Layout')
      .setURL(layoutLink),
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
    `Layout Voting: ${formatEnabledBoolean(input.config.allowVoting)}`,
    `Layout Tracking: ${formatEnabledBoolean(input.config.allowTracking)}`,
  ].join('\n');
  const trackedSubmissionSummary = formatLayoutSubmissionSummary(input.submissionSummary);

  return new EmbedBuilder()
    .setColor(input.view.color ?? DEFAULT_LAYOUT_EMBED_COLOR)
    .setTitle('Layout Config')
    .setDescription(
      [
        input.updated ? 'Layout configuration was saved.' : 'Current saved layout configuration.',
        input.config.allowVoting
          ? 'Voting buttons are displayed on new layout posts, but remain disabled until persisted vote collection is available.'
          : 'Voting is disabled, so new layout posts only include the copy/open layout button.',
        '',
        settings,
        '',
        '**Accepted fields**',
        '`allow_voting` toggles voting context on layout posts.',
        '`allow_tracking` toggles persisted layout submission records and copy/download context.',
        '',
        '**Channel and permission requirements**',
        '`/layout post` must be used in a server channel with an image screenshot and a public OpenLayout link.',
        '`/layout config` requires Discord Manage Server permission.',
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

async function createTrackedLayoutSubmission(
  store: LayoutConfigStore,
  input: Parameters<LayoutConfigStore['createLayoutSubmission']>[0],
): Promise<{ id: string } | null> {
  try {
    return await store.createLayoutSubmission(input);
  } catch {
    return null;
  }
}

function formatEnabledBoolean(value: boolean): string {
  return value ? 'enabled' : 'disabled';
}

function formatLayoutSubmissionSummary(summary: LayoutSubmissionSummaryRecord): string {
  if (summary.count === 0) {
    return 'Stored submission summary: no tracked layouts yet. New posts are saved only when Layout Tracking is enabled.';
  }

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
