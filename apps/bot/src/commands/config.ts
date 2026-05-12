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
export const DISCORD_CHANNEL_WEBHOOK_LIMIT = 15;
export const MAX_MANAGER_ROLES_PER_SETTING = 25;

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
          'Requires Discord Manage Server. Bot manager roles can help ClashMate checks, but they do not bypass Discord server permissions. Saved changes include the acting user for audit/history when the backing store records configuration changes.',
        inline: false,
      },
      {
        name: 'Slash Prefix',
        value: '`/` (fixed; message prefixes are not supported)',
        inline: true,
      },
      {
        name: 'Webhook Limit',
        value: formatWebhookLimit(view.webhookLimit),
        inline: true,
      },
      {
        name: 'Color Code',
        value: formatColorDiagnostics(view.embedColor, effectiveColor),
        inline: true,
      },
      {
        name: `Bot Manager Roles (${view.botManagerRoleIds.length})`,
        value: formatRoleDiagnostics(view.botManagerRoleIds),
        inline: false,
      },
      {
        name: `Links Manager Roles (${view.linksManagerRoleIds.length})`,
        value: formatRoleDiagnostics(view.linksManagerRoleIds),
        inline: false,
      },
      {
        name: 'Clear & Update Semantics',
        value:
          'Role clear options remove the saved role list for that setting. Setting a role replaces the saved list with the selected role. Omitted options keep their current persisted values. Color clearing is reported as unsupported until nullable color persistence is available.',
        inline: false,
      },
      {
        name: 'Persisted Scope',
        value:
          'Settings are saved for this Discord server only and survive bot restarts through the configured store. Diagnostics use the existing guild configuration read/update result only; they do not query Discord/Clash live APIs or enroll polling resources.',
        inline: false,
      },
      {
        name: 'Discord Limitations',
        value:
          'Server-level settings such as slash command availability, integration permissions, role hierarchy, channel overwrites, and Discord webhook quotas are enforced by Discord and must be adjusted in Discord when they block ClashMate actions.',
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

function formatRoleDiagnostics(roleIds: readonly string[]): string {
  return [
    formatRoleList(roleIds),
    `Configured: ${roleIds.length}/${MAX_MANAGER_ROLES_PER_SETTING}.`,
    'Deleted roles or role hierarchy/permission changes are controlled by Discord and may require updating this saved setting.',
  ].join('\n');
}

function formatWebhookLimit(limit: number): string {
  const reserved = Math.max(0, DISCORD_CHANNEL_WEBHOOK_LIMIT - limit);
  return [
    `${limit} per channel`,
    `ClashMate cap: ${MIN_WEBHOOK_LIMIT}-${MAX_WEBHOOK_LIMIT}; Discord channel quota is ${DISCORD_CHANNEL_WEBHOOK_LIMIT} webhooks.`,
    `Leaves at least ${reserved} webhook slot${reserved === 1 ? '' : 's'} for non-ClashMate uses when Discord's quota is otherwise empty.`,
  ].join('\n');
}

function formatColorDiagnostics(
  embedColor: string | null,
  effectiveColor: ColorResolvable,
): string {
  return [
    embedColor ?? 'None',
    `Preview color: ${formatColorPreview(effectiveColor)}`,
    embedColor
      ? 'Set `color_code` to replace it; omitted color options keep this value.'
      : 'Using the bot display/default color until a 6-digit hex `color_code` is saved.',
    'Clearing is unavailable until the config store supports nullable colors.',
  ].join('\n');
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
  if (!attemptedUpdate) {
    return 'No updates requested; showing saved settings. Provide one or more options to persist changes.';
  }
  if (!before) return 'Updated saved settings.';

  const changed: string[] = [];
  const unchanged: string[] = [];
  collectStatus(
    changed,
    unchanged,
    'color code',
    before.embedColor,
    view.embedColor,
    formatNullable,
  );
  collectStatus(
    changed,
    unchanged,
    'webhook limit',
    before.webhookLimit,
    view.webhookLimit,
    String,
  );
  collectStatus(
    changed,
    unchanged,
    'bot manager roles',
    before.botManagerRoleIds,
    view.botManagerRoleIds,
    formatRoleCount,
  );
  collectStatus(
    changed,
    unchanged,
    'links manager roles',
    before.linksManagerRoleIds,
    view.linksManagerRoleIds,
    formatRoleCount,
  );

  const summary = changed.length
    ? `Updated: ${changed.join(', ')}.`
    : 'No effective changes were saved; requested values already matched the persisted configuration.';

  return [
    summary,
    `Saved unchanged: ${unchanged.join(', ') || 'none'}.`,
    'Only fields included in this command invocation are changed; omitted settings keep their current values.',
  ].join('\n');
}

function collectStatus(
  changed: string[],
  unchanged: string[],
  label: string,
  before: string | number | null | readonly string[],
  after: string | number | null | readonly string[],
  format: (value: string | number | null | readonly string[]) => string,
): void {
  const beforeText = format(before);
  const afterText = format(after);
  if (isStatusValueEqual(before, after)) unchanged.push(`${label} (${afterText})`);
  else changed.push(`${label} (${beforeText} → ${afterText})`);
}

function isStatusValueEqual(
  before: string | number | null | readonly string[],
  after: string | number | null | readonly string[],
): boolean {
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length && before.every((value, index) => value === after[index]);
  }
  return before === after;
}

function formatNullable(value: string | number | null | readonly string[]): string {
  return value === null ? 'none' : String(value);
}

function formatRoleCount(value: string | number | null | readonly string[]): string {
  return Array.isArray(value) ? `${value.length} configured` : String(value);
}
