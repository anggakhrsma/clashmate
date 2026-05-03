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
  });

  if (parsed.status === 'invalid_color') {
    await interaction.reply({
      content: 'Provide `color_code` as a 6-digit hex color, for example `#5865F2`.',
      ephemeral: true,
    });
    return;
  }

  const view = parsed.hasUpdates
    ? await options.store.updateGuildConfig({
        guildId: interaction.guildId,
        guildName: interaction.guild.name,
        actorDiscordUserId: interaction.user.id,
        ...parsed.updates,
      })
    : await options.store.getGuildConfig(interaction.guildId);

  await interaction.reply({
    embeds: [buildConfigEmbed(view, interaction.guild.members.me?.displayColor)],
    ephemeral: true,
    allowedMentions: { roles: [] },
  });
}

export type ParseConfigOptionsResult =
  | { status: 'ok'; hasUpdates: boolean; updates: Partial<UpdateConfigInput> }
  | { status: 'invalid_color' };

export function parseConfigOptions(input: {
  colorCode: string | null;
  webhookLimit: number | null;
  botManagerRoleId: string | undefined;
  linksManagerRoleId: string | undefined;
}): ParseConfigOptionsResult {
  const updates: Partial<UpdateConfigInput> = {};

  if (input.colorCode !== null) {
    const embedColor = normalizeHexColor(input.colorCode);
    if (!embedColor) return { status: 'invalid_color' };
    updates.embedColor = embedColor;
  }

  if (input.webhookLimit !== null) {
    updates.webhookLimit = clampWebhookLimit(input.webhookLimit);
  }

  if (input.botManagerRoleId) updates.botManagerRoleIds = [input.botManagerRoleId];
  if (input.linksManagerRoleId) updates.linksManagerRoleIds = [input.linksManagerRoleId];

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

export function buildConfigEmbed(view: ConfigView, displayColor?: ColorResolvable): EmbedBuilder {
  const color = view.embedColor ? Number.parseInt(view.embedColor.slice(1), 16) : displayColor;
  return new EmbedBuilder()
    .setColor(color ?? DEFAULT_CONFIG_EMBED_COLOR)
    .setTitle('ClashMate Configuration')
    .setDescription(
      'Current server configuration. Role settings are stored for future permission integration.',
    )
    .addFields(
      { name: 'Prefix', value: '/', inline: true },
      { name: 'Webhook Limit', value: String(view.webhookLimit), inline: true },
      { name: 'Color Code', value: view.embedColor ?? 'None', inline: true },
      { name: 'Bot Manager Roles', value: formatRoleList(view.botManagerRoleIds), inline: false },
      {
        name: 'Links Manager Roles',
        value: formatRoleList(view.linksManagerRoleIds),
        inline: false,
      },
    );
}

function formatRoleList(roleIds: readonly string[]): string {
  return roleIds.length ? roleIds.map((roleId) => `<@&${roleId}>`).join(' ') : 'None';
}
