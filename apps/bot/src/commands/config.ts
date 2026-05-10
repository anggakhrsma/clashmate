import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const CONFIG_COMMAND_NAME = 'config';
export const CONFIG_COMMAND_DESCRIPTION = 'Configure ClashMate server settings.';
export const DEFAULT_CONFIG_EMBED_COLOR = 0x5865f2;
export const MIN_WEBHOOK_LIMIT = 3;
export const MAX_WEBHOOK_LIMIT = 8;

export const configCommandData = new SlashCommandBuilder()
  .setName(CONFIG_COMMAND_NAME)
  .setDescription(CONFIG_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addRoleOption((option) =>
    option
      .setName('bot_manager_role')
      .setDescription('Role allowed to manage ClashMate bot settings.'),
  )
  .addRoleOption((option) =>
    option
      .setName('links_manager_role')
      .setDescription('Role allowed to manage ClashMate player and clan links.'),
  )
  .addStringOption((option) =>
    option.setName('color_code').setDescription('Embed color as a hex code, e.g. #5865F2.'),
  )
  .addBooleanOption((option) =>
    option.setName('clear_bot_manager_role').setDescription('Clear stored bot manager roles.'),
  )
  .addBooleanOption((option) =>
    option.setName('clear_links_manager_role').setDescription('Clear stored links manager roles.'),
  )
  .addBooleanOption((option) =>
    option
      .setName('clear_color_code')
      .setDescription('Request clearing the stored embed color if the current store supports it.'),
  )
  .addIntegerOption((option) =>
    option
      .setName('webhook_limit')
      .setDescription('Maximum webhooks ClashMate should maintain per channel.')
      .setMinValue(MIN_WEBHOOK_LIMIT)
      .setMaxValue(MAX_WEBHOOK_LIMIT),
  );

export interface ConfigView {
  embedColor: string | null;
  webhookLimit: number;
  botManagerRoleIds: readonly string[];
  linksManagerRoleIds: readonly string[];
}

export interface UpdateConfigInput {
  guildId: string;
  guildName: string | null;
  actorDiscordUserId: string;
  embedColor?: string;
  webhookLimit?: number;
  botManagerRoleIds?: readonly string[];
  linksManagerRoleIds?: readonly string[];
}

export interface ConfigStore {
  getGuildConfig: (guildId: string) => Promise<ConfigView>;
  updateGuildConfig: (input: UpdateConfigInput) => Promise<ConfigView>;
}

export interface ConfigCommandOptions {
  store: ConfigStore;
}

export function createConfigSlashCommand(options: ConfigCommandOptions): SlashCommandDefinition {
  return {
    name: CONFIG_COMMAND_NAME,
    data: configCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== CONFIG_COMMAND_NAME) return;
      await executeConfigInteraction(interaction, context, options);
    },
  };
}

export async function executeConfigInteraction(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: ConfigCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/config` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'You need the Manage Server permission to use `/config`.',
      ephemeral: true,
    });
    return;
  }

  const parsed = parseConfigOptions({
    colorCode: interaction.options.getString('color_code'),
    webhookLimit: interaction.options.getInteger('webhook_limit'),
    botManagerRoleId: interaction.options.getRole('bot_manager_role')?.id,
    linksManagerRoleId: interaction.options.getRole('links_manager_role')?.id,
    clearBotManagerRole: interaction.options.getBoolean('clear_bot_manager_role') ?? false,
    clearLinksManagerRole: interaction.options.getBoolean('clear_links_manager_role') ?? false,
    clearColorCode: interaction.options.getBoolean('clear_color_code') ?? false,
  });

  if (parsed.status === 'invalid_color') {
    await interaction.reply({
      content:
        'Provide `color_code` as a 6-digit hex color such as `#5865F2` or `5865F2`. Clearing uses `clear_color_code:true` when the backing store supports color clearing.',
      ephemeral: true,
    });
    return;
  }

  if (parsed.status === 'unsupported_color_clear') {
    await interaction.reply({
      content:
        'The current configuration store cannot clear `color_code` without a schema/store change. Set a new 6-digit hex color such as `#5865F2` or `5865F2` instead.',
      ephemeral: true,
    });
    return;
  }

  const before = await options.store.getGuildConfig(interaction.guildId);

  const view = parsed.hasUpdates
    ? await options.store.updateGuildConfig({
        guildId: interaction.guildId,
        guildName: interaction.guild.name,
        actorDiscordUserId: interaction.user.id,
        ...parsed.updates,
      })
    : before;

  await interaction.reply({
    embeds: [
      buildConfigEmbed(view, interaction.guild.members.me?.displayColor, before, parsed.hasUpdates),
    ],
    ephemeral: true,
    allowedMentions: { roles: [] },
  });
}

export type ParseConfigOptionsResult =
  | { status: 'ok'; hasUpdates: boolean; updates: Partial<UpdateConfigInput> }
  | { status: 'invalid_color' }
  | { status: 'unsupported_color_clear' };

export function parseConfigOptions(input: {
  colorCode: string | null;
  webhookLimit: number | null;
  botManagerRoleId: string | undefined;
  linksManagerRoleId: string | undefined;
  clearBotManagerRole: boolean;
  clearLinksManagerRole: boolean;
  clearColorCode: boolean;
}): ParseConfigOptionsResult {
  const updates: Partial<UpdateConfigInput> = {};

  if (input.clearColorCode) return { status: 'unsupported_color_clear' };

  if (input.colorCode !== null) {
    const embedColor = normalizeHexColor(input.colorCode);
    if (!embedColor) return { status: 'invalid_color' };
    updates.embedColor = embedColor;
  }

  if (input.webhookLimit !== null) {
    updates.webhookLimit = clampWebhookLimit(input.webhookLimit);
  }

  if (input.clearBotManagerRole) updates.botManagerRoleIds = [];
  else if (input.botManagerRoleId) updates.botManagerRoleIds = [input.botManagerRoleId];

  if (input.clearLinksManagerRole) updates.linksManagerRoleIds = [];
  else if (input.linksManagerRoleId) updates.linksManagerRoleIds = [input.linksManagerRoleId];

  return { status: 'ok', hasUpdates: Object.keys(updates).length > 0, updates };
}

export function normalizeHexColor(value: string): string | undefined {
  const trimmed = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) return undefined;
  return `#${trimmed.toUpperCase()}`;
}

export function clampWebhookLimit(value: number): number {
  return Math.max(MIN_WEBHOOK_LIMIT, Math.min(MAX_WEBHOOK_LIMIT, value));
}

export function buildConfigEmbed(
  view: ConfigView,
  displayColor?: ColorResolvable,
  before?: ConfigView,
  attemptedUpdate = false,
): EmbedBuilder {
  const color = view.embedColor ? Number.parseInt(view.embedColor.slice(1), 16) : displayColor;
  const effectiveColor = color ?? DEFAULT_CONFIG_EMBED_COLOR;
  return new EmbedBuilder()
    .setColor(effectiveColor)
    .setTitle('ClashMate Configuration')
    .setDescription(
      'Current saved server configuration. Use command options to persist updates; without options this is a diagnostics view. Slash `/` is fixed because ClashMate is slash-only.',
    )
    .addFields(
      {
        name: 'Update Status',
        value: formatUpdateStatus(view, before, attemptedUpdate),
        inline: false,
      },
      {
        name: 'Permissions & Audit',
        value:
          'Requires Discord Manage Server. Saved changes include the acting user for audit logs when the backing store records configuration history.',
        inline: false,
      },
      {
        name: 'Slash Prefix',
        value: '`/` (fixed; message prefixes are not supported)',
        inline: true,
      },
      {
        name: 'Webhook Limit',
        value: `${view.webhookLimit} per channel (allowed ${MIN_WEBHOOK_LIMIT}-${MAX_WEBHOOK_LIMIT}; values outside the range are clamped before saving)`,
        inline: true,
      },
      {
        name: 'Color Code',
        value: `${view.embedColor ?? 'None'}\nPreview color: ${formatColorPreview(effectiveColor)}`,
        inline: true,
      },
      {
        name: `Bot Manager Roles (${view.botManagerRoleIds.length})`,
        value: formatRoleList(view.botManagerRoleIds),
        inline: false,
      },
      {
        name: `Links Manager Roles (${view.linksManagerRoleIds.length})`,
        value: formatRoleList(view.linksManagerRoleIds),
        inline: false,
      },
      {
        name: 'Configuration Diagnostics',
        value:
          'Premium, Patreon, and feature-flag dumps are intentionally not shown. ClashMate reports normal persisted settings and supported self-hosted capabilities instead.',
        inline: false,
      },
    );
}

function formatRoleList(roleIds: readonly string[]): string {
  return roleIds.length ? roleIds.map((roleId) => `<@&${roleId}>`).join(' ') : 'None';
}

function formatColorPreview(color: ColorResolvable): string {
  return typeof color === 'number'
    ? `#${color.toString(16).padStart(6, '0').toUpperCase()}`
    : String(color);
}

function formatUpdateStatus(
  view: ConfigView,
  before: ConfigView | undefined,
  attemptedUpdate: boolean,
): string {
  if (!attemptedUpdate) return 'No updates requested; showing saved settings.';
  if (!before) return 'Updated saved settings.';

  const changed: string[] = [];
  const unchanged: string[] = [];
  collectStatus(changed, unchanged, 'color code', before.embedColor, view.embedColor);
  collectStatus(changed, unchanged, 'webhook limit', before.webhookLimit, view.webhookLimit);
  collectStatus(
    changed,
    unchanged,
    'bot manager roles',
    before.botManagerRoleIds.join(','),
    view.botManagerRoleIds.join(','),
  );
  collectStatus(
    changed,
    unchanged,
    'links manager roles',
    before.linksManagerRoleIds.join(','),
    view.linksManagerRoleIds.join(','),
  );

  return [
    `Updated: ${changed.length ? changed.join(', ') : 'none'}.`,
    `Saved unchanged: ${unchanged.join(', ') || 'none'}.`,
  ].join('\n');
}

function collectStatus(
  changed: string[],
  unchanged: string[],
  label: string,
  before: string | number | null,
  after: string | number | null,
): void {
  if (before === after) unchanged.push(label);
  else changed.push(label);
}
