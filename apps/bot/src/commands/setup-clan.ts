import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
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
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('clan-logs')
      .setDescription('Setup automatic logs for the clan.')
      .addStringOption((option) =>
        option
          .setName('clan')
          .setDescription('Select the clan to setup logs.')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('action')
          .setDescription('What logs to enable or disable.')
          .addChoices(
            { name: 'Enable', value: 'enable-logs' },
            { name: 'Disable', value: 'disable-logs' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('log')
          .setDescription('Which clan log to configure.')
          .addChoices(
            { name: 'Join/Leave Log', value: 'member_join_leave_log' },
            { name: 'War Attack Log', value: 'war_attack_log' },
            { name: 'War State Log', value: 'war_state_log' },
            { name: 'Missed War Attack Log', value: 'missed_war_attack_log' },
            { name: 'Donation Log (Instant)', value: 'continuous_donation_log' },
            { name: 'Role Change Log', value: 'role_change_log' },
            { name: 'Clan Games Log', value: 'clan_games_log' },
          ),
      )
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Channel to send updates to (defaults to the current channel)')
          .addChannelTypes(...allowedClanChannelTypes),
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
  readonly alias?: string | null;
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
  listClanCategories: (guildId: string) => Promise<SetupClanCategory[]>;
  listLinkedClans: (guildId: string) => Promise<SetupClanTrackedClan[]>;
  linkClan: (input: LinkClanInput) => Promise<LinkClanResult>;
  unlinkClan: (
    input: UnlinkClanInput,
  ) => Promise<{ status: 'unlinked'; clan: SetupClanTrackedClan } | { status: 'not_found' }>;
  unlinkChannel: (
    input: UnlinkChannelInput,
  ) => Promise<{ status: 'unlinked'; clanName: string } | { status: 'not_found' }>;
}

export interface ConfigureClanMemberNotificationsInput {
  readonly guildId: string;
  readonly actorDiscordUserId: string;
  readonly clanTag: string;
  readonly discordChannelId: string;
}

export interface DisableClanMemberNotificationsInput {
  readonly guildId: string;
  readonly actorDiscordUserId: string;
  readonly clanTag: string;
}

export type ConfigureClanMemberNotificationsResult =
  | {
      readonly status: 'configured';
      readonly clanName: string;
      readonly clanTag: string;
      readonly discordChannelId: string;
    }
  | { readonly status: 'clan_not_linked' };

export type DisableClanMemberNotificationsResult =
  | { readonly status: 'disabled'; readonly clanName: string; readonly clanTag: string }
  | { readonly status: 'not_configured'; readonly clanName: string; readonly clanTag: string }
  | { readonly status: 'clan_not_linked' };

export interface SetupClanMemberNotificationStore {
  configureJoinLeaveNotifications: (
    input: ConfigureClanMemberNotificationsInput,
  ) => Promise<ConfigureClanMemberNotificationsResult>;
  disableJoinLeaveNotifications: (
    input: DisableClanMemberNotificationsInput,
  ) => Promise<DisableClanMemberNotificationsResult>;
  configureWarAttackNotifications: (
    input: ConfigureClanMemberNotificationsInput,
  ) => Promise<ConfigureClanMemberNotificationsResult>;
  disableWarAttackNotifications: (
    input: DisableClanMemberNotificationsInput,
  ) => Promise<DisableClanMemberNotificationsResult>;
  configureWarStateNotifications: (
    input: ConfigureClanMemberNotificationsInput,
  ) => Promise<ConfigureClanMemberNotificationsResult>;
  disableWarStateNotifications: (
    input: DisableClanMemberNotificationsInput,
  ) => Promise<DisableClanMemberNotificationsResult>;
  configureMissedWarAttackNotifications: (
    input: ConfigureClanMemberNotificationsInput,
  ) => Promise<ConfigureClanMemberNotificationsResult>;
  disableMissedWarAttackNotifications: (
    input: DisableClanMemberNotificationsInput,
  ) => Promise<DisableClanMemberNotificationsResult>;
  configureDonationNotifications: (
    input: ConfigureClanMemberNotificationsInput,
  ) => Promise<ConfigureClanMemberNotificationsResult>;
  disableDonationNotifications: (
    input: DisableClanMemberNotificationsInput,
  ) => Promise<DisableClanMemberNotificationsResult>;
  configureRoleChangeNotifications: (
    input: ConfigureClanMemberNotificationsInput,
  ) => Promise<ConfigureClanMemberNotificationsResult>;
  disableRoleChangeNotifications: (
    input: DisableClanMemberNotificationsInput,
  ) => Promise<DisableClanMemberNotificationsResult>;
  configureClanGamesNotifications?: (
    input: ConfigureClanMemberNotificationsInput,
  ) => Promise<ConfigureClanMemberNotificationsResult>;
  disableClanGamesNotifications?: (
    input: DisableClanMemberNotificationsInput,
  ) => Promise<DisableClanMemberNotificationsResult>;
}

export interface SetupClanApi {
  getClan: (clanTag: string) => Promise<SetupClanClashClan>;
}

export interface SetupClanCommandOptions {
  clans: SetupClanStore;
  coc: SetupClanApi;
  memberNotifications?: SetupClanMemberNotificationStore;
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
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'clan-logs') {
        await executeSetupClanLogs(interaction, context, options);
        return;
      }

      if (subcommand !== 'clan') return;

      await executeSetupClan(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== SETUP_COMMAND_NAME) return;
      const subcommand = interaction.options.getSubcommand(false);
      if (subcommand !== 'clan' && subcommand !== 'clan-logs') return;

      await autocompleteSetupClan(interaction, options);
    },
  };
}

export async function autocompleteSetupClan(
  interaction: AutocompleteInteraction,
  options: SetupClanCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  const query = String(focused.value ?? '').trim();

  if (focused.name === 'category') {
    const categories = await options.clans.listClanCategories(interaction.guildId);
    await interaction.respond(filterCategoryChoices(categories, query));
    return;
  }

  if (focused.name === 'clan') {
    const clans = await options.clans.listLinkedClans(interaction.guildId);
    await interaction.respond(filterClanChoices(clans, query));
    return;
  }

  await interaction.respond([]);
}

async function executeSetupClanLogs(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: SetupClanCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/setup clan-logs` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'You need the Manage Server permission to use `/setup clan-logs`.',
      ephemeral: true,
    });
    return;
  }

  if (!options.memberNotifications) {
    await interaction.reply({
      content: 'Clan Join/Leave Log configuration is not available yet.',
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

  const action = interaction.options.getString('action') ?? 'enable-logs';
  const logType = interaction.options.getString('log') ?? 'member_join_leave_log';
  if (action === 'disable-logs') {
    const disableLogHandler = getDisableLogHandler(options.memberNotifications, logType);
    if (!disableLogHandler) {
      await interaction.reply({
        content: `${getClanLogLabel(logType)} configuration is not available yet.`,
        ephemeral: true,
      });
      return;
    }

    const result = await disableLogHandler({
      guildId: interaction.guildId,
      actorDiscordUserId: interaction.user.id,
      clanTag,
    });
    await interaction.reply({
      content: formatDisableClanLogMessage(logType, result),
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  if (!channel) {
    await interaction.reply({
      content: `Please choose a channel for the ${getClanLogLabel(logType)}.`,
      ephemeral: true,
    });
    return;
  }

  const configureLogHandler = getConfigureLogHandler(options.memberNotifications, logType);
  if (!configureLogHandler) {
    await interaction.reply({
      content: `${getClanLogLabel(logType)} configuration is not available yet.`,
      ephemeral: true,
    });
    return;
  }

  const result = await configureLogHandler({
    guildId: interaction.guildId,
    actorDiscordUserId: interaction.user.id,
    clanTag,
    discordChannelId: channel.id,
  });
  await interaction.reply({
    content: formatConfigureClanLogMessage(logType, result),
    ephemeral: true,
  });
}

export function filterCategoryChoices(
  categories: readonly SetupClanCategory[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return categories
    .filter((category) => category.displayName.toLowerCase().includes(normalizedQuery))
    .slice(0, 25)
    .map((category) => ({ name: category.displayName, value: category.id }));
}

export function filterClanChoices(
  clans: readonly SetupClanTrackedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  const choices = clans
    .filter((clan) => {
      if (!normalizedQuery) return true;
      return [clan.clanTag, clan.name, clan.alias]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    })
    .slice(0, 25)
    .map((clan) => ({ name: `${clan.name} (${clan.clanTag})`, value: clan.clanTag }));

  if (choices.length === 0 && query.trim()) {
    return [{ name: query.trim(), value: query.trim() }];
  }

  return choices;
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

export function formatConfigureJoinLeaveMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  return `Enabled Join/Leave Log for **${result.clanName} (${result.clanTag})** in <#${result.discordChannelId}>.`;
}

export function formatDisableJoinLeaveMessage(
  result: DisableClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  if (result.status === 'not_configured') {
    return `No Join/Leave Log is enabled for **${result.clanName} (${result.clanTag})**.`;
  }

  return `Disabled Join/Leave Log for **${result.clanName} (${result.clanTag})**.`;
}

export function formatConfigureWarAttackMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  return `Enabled War Attack Log for **${result.clanName} (${result.clanTag})** in <#${result.discordChannelId}>.`;
}

export function formatDisableWarAttackMessage(
  result: DisableClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  if (result.status === 'not_configured') {
    return `No War Attack Log is enabled for **${result.clanName} (${result.clanTag})**.`;
  }

  return `Disabled War Attack Log for **${result.clanName} (${result.clanTag})**.`;
}

export function formatConfigureWarStateMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  return `Enabled War State Log for **${result.clanName} (${result.clanTag})** in <#${result.discordChannelId}>.`;
}

export function formatDisableWarStateMessage(result: DisableClanMemberNotificationsResult): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  if (result.status === 'not_configured') {
    return `No War State Log is enabled for **${result.clanName} (${result.clanTag})**.`;
  }

  return `Disabled War State Log for **${result.clanName} (${result.clanTag})**.`;
}

export function formatConfigureDonationMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  return `Enabled Donation Log for **${result.clanName} (${result.clanTag})** in <#${result.discordChannelId}>.`;
}

export function formatConfigureMissedWarAttackMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  return `Enabled Missed War Attack Log for **${result.clanName} (${result.clanTag})** in <#${result.discordChannelId}>.`;
}

export function formatDisableMissedWarAttackMessage(
  result: DisableClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  if (result.status === 'not_configured') {
    return `No Missed War Attack Log is enabled for **${result.clanName} (${result.clanTag})**.`;
  }

  return `Disabled Missed War Attack Log for **${result.clanName} (${result.clanTag})**.`;
}

export function formatDisableDonationMessage(result: DisableClanMemberNotificationsResult): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  if (result.status === 'not_configured') {
    return `No Donation Log is enabled for **${result.clanName} (${result.clanTag})**.`;
  }

  return `Disabled Donation Log for **${result.clanName} (${result.clanTag})**.`;
}

export function formatConfigureRoleChangeMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  return `Enabled Role Change Log for **${result.clanName} (${result.clanTag})** in <#${result.discordChannelId}>.`;
}

export function formatDisableRoleChangeMessage(
  result: DisableClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  if (result.status === 'not_configured') {
    return `No Role Change Log is enabled for **${result.clanName} (${result.clanTag})**.`;
  }

  return `Disabled Role Change Log for **${result.clanName} (${result.clanTag})**.`;
}

export function formatConfigureClanGamesMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  return `Enabled Clan Games Log for **${result.clanName} (${result.clanTag})** in <#${result.discordChannelId}>.`;
}

export function formatDisableClanGamesMessage(
  result: DisableClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return 'That clan is not linked to this server. Use `/setup clan` first.';
  }

  if (result.status === 'not_configured') {
    return `No Clan Games Log is enabled for **${result.clanName} (${result.clanTag})**.`;
  }

  return `Disabled Clan Games Log for **${result.clanName} (${result.clanTag})**.`;
}

function getConfigureLogHandler(
  store: SetupClanMemberNotificationStore,
  logType: string,
): SetupClanMemberNotificationStore['configureJoinLeaveNotifications'] | undefined {
  if (logType === 'war_attack_log') return store.configureWarAttackNotifications;
  if (logType === 'war_state_log') return store.configureWarStateNotifications;
  if (logType === 'missed_war_attack_log') return store.configureMissedWarAttackNotifications;
  if (logType === 'continuous_donation_log') return store.configureDonationNotifications;
  if (logType === 'role_change_log') return store.configureRoleChangeNotifications;
  if (logType === 'clan_games_log') return store.configureClanGamesNotifications;
  return store.configureJoinLeaveNotifications;
}

function getDisableLogHandler(
  store: SetupClanMemberNotificationStore,
  logType: string,
): SetupClanMemberNotificationStore['disableJoinLeaveNotifications'] | undefined {
  if (logType === 'war_attack_log') return store.disableWarAttackNotifications;
  if (logType === 'war_state_log') return store.disableWarStateNotifications;
  if (logType === 'missed_war_attack_log') return store.disableMissedWarAttackNotifications;
  if (logType === 'continuous_donation_log') return store.disableDonationNotifications;
  if (logType === 'role_change_log') return store.disableRoleChangeNotifications;
  if (logType === 'clan_games_log') return store.disableClanGamesNotifications;
  return store.disableJoinLeaveNotifications;
}

function formatConfigureClanLogMessage(
  logType: string,
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (logType === 'war_attack_log') return formatConfigureWarAttackMessage(result);
  if (logType === 'war_state_log') return formatConfigureWarStateMessage(result);
  if (logType === 'missed_war_attack_log') return formatConfigureMissedWarAttackMessage(result);
  if (logType === 'continuous_donation_log') return formatConfigureDonationMessage(result);
  if (logType === 'role_change_log') return formatConfigureRoleChangeMessage(result);
  if (logType === 'clan_games_log') return formatConfigureClanGamesMessage(result);
  return formatConfigureJoinLeaveMessage(result);
}

function formatDisableClanLogMessage(
  logType: string,
  result: DisableClanMemberNotificationsResult,
): string {
  if (logType === 'war_attack_log') return formatDisableWarAttackMessage(result);
  if (logType === 'war_state_log') return formatDisableWarStateMessage(result);
  if (logType === 'missed_war_attack_log') return formatDisableMissedWarAttackMessage(result);
  if (logType === 'continuous_donation_log') return formatDisableDonationMessage(result);
  if (logType === 'role_change_log') return formatDisableRoleChangeMessage(result);
  if (logType === 'clan_games_log') return formatDisableClanGamesMessage(result);
  return formatDisableJoinLeaveMessage(result);
}

function getClanLogLabel(logType: string): string {
  if (logType === 'war_attack_log') return 'War Attack Log';
  if (logType === 'war_state_log') return 'War State Log';
  if (logType === 'missed_war_attack_log') return 'Missed War Attack Log';
  if (logType === 'continuous_donation_log') return 'Donation Log';
  if (logType === 'role_change_log') return 'Role Change Log';
  if (logType === 'clan_games_log') return 'Clan Games Log';
  return 'Join/Leave Log';
}
