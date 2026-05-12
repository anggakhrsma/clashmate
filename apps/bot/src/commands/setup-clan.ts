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
      .setName('enable')
      .setDescription('This legacy setup flow has been replaced by newer setup commands.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('disable')
      .setDescription('This legacy setup flow has been replaced by newer setup commands.'),
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
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('List all enabled features and clans.')
      .addStringOption((option) =>
        option.setName('clans').setDescription('Select the clans to list.').setAutocomplete(true),
      ),
  );

export interface SetupClanClashClan {
  readonly tag: string;
  readonly name: string;
}

export interface SetupClanTrackedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias?: string | null;
  readonly categoryId?: string | null;
  readonly channelIds?: readonly string[] | null;
  readonly sortOrder?: number | null;
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
  listClansForGuild?: (guildId: string) => Promise<SetupClanTrackedClan[]>;
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

      if (subcommand === 'enable' || subcommand === 'disable') {
        await executeDeprecatedSetupFlow(interaction, subcommand);
        return;
      }

      if (subcommand === 'clan-logs') {
        await executeSetupClanLogs(interaction, context, options);
        return;
      }

      if (subcommand === 'list') {
        await executeSetupList(interaction, options);
        return;
      }

      if (subcommand !== 'clan') return;

      await executeSetupClan(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== SETUP_COMMAND_NAME) return;
      const subcommand = interaction.options.getSubcommand(false);
      if (subcommand !== 'clan' && subcommand !== 'clan-logs' && subcommand !== 'list') return;

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
    try {
      const categories = await options.clans.listClanCategories(interaction.guildId);
      await interaction.respond(filterCategoryChoices(categories, query));
    } catch {
      await interaction.respond([]);
    }
    return;
  }

  if (focused.name === 'clan' || focused.name === 'clans') {
    try {
      const clans = await options.clans.listLinkedClans(interaction.guildId);
      await interaction.respond(filterClanChoices(clans, query));
    } catch {
      await interaction.respond([]);
    }
    return;
  }

  await interaction.respond([]);
}

async function executeDeprecatedSetupFlow(
  interaction: ChatInputCommandInteraction,
  subcommand: 'enable' | 'disable',
): Promise<void> {
  await interaction.reply({
    content: formatDeprecatedSetupFlowMessage(subcommand),
    ephemeral: true,
  });
}

export function formatDeprecatedSetupFlowMessage(subcommand: 'enable' | 'disable'): string {
  return `\`/setup ${subcommand}\` is a legacy setup flow and is not used in ClashMate. Current setup coverage: use \`/setup clan\` to link/unlink clans, categories, and clan channels; \`/setup clan-logs\` to enable/disable log targets; and \`/setup list\` to review persisted server configuration.`;
}

async function executeSetupList(
  interaction: ChatInputCommandInteraction,
  options: SetupClanCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/setup list` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content:
        "You need the Discord Manage Server permission to use `/setup list` because it shows this server's saved ClashMate setup.",
      ephemeral: true,
    });
    return;
  }

  const [clans, categories] = await Promise.all([
    listSetupClans(options.clans, interaction.guildId),
    options.clans.listClanCategories(interaction.guildId),
  ]);
  const filter = interaction.options.getString('clans')?.trim();

  await interaction.reply({
    content: formatSetupListMessage(clans, categories, filter),
    ephemeral: true,
  });
}

async function listSetupClans(
  store: SetupClanStore,
  guildId: string,
): Promise<SetupClanTrackedClan[]> {
  return store.listClansForGuild
    ? store.listClansForGuild(guildId)
    : store.listLinkedClans(guildId);
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
      content:
        'You need the Discord Manage Server permission to use `/setup clan-logs` because it changes persisted log configuration for this server.',
      ephemeral: true,
    });
    return;
  }

  if (!options.memberNotifications) {
    await interaction.reply({
      content:
        'Clan log configuration is not available in this ClashMate instance yet. Link clans with `/setup clan` now, then configure logs after the backing store is enabled.',
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
        content: formatUnavailableClanLogMessage(logType),
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
      content: `Please choose a channel for the ${getClanLogLabel(logType)}. ClashMate saves the selected channel as the delivery target for this server/clan log.`,
      ephemeral: true,
    });
    return;
  }

  const configureLogHandler = getConfigureLogHandler(options.memberNotifications, logType);
  if (!configureLogHandler) {
    await interaction.reply({
      content: formatUnavailableClanLogMessage(logType),
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
  return dedupeCategoriesByAcceptedValue(categories)
    .filter((category) => category.displayName.toLowerCase().includes(normalizedQuery))
    .map((category) => ({ name: category.displayName, value: category.id }))
    .slice(0, 25);
}

export function filterClanChoices(
  clans: readonly SetupClanTrackedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  const choices = dedupeClansByAcceptedValue(clans)
    .filter((clan) => {
      if (!normalizedQuery) return true;
      return [clan.clanTag, clan.name, clan.alias]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    })
    .map((clan) => ({
      name: `${clan.name ?? clan.clanTag} (${clan.clanTag})`,
      value: clan.clanTag,
    }))
    .slice(0, 25);

  if (choices.length === 0 && query.trim()) {
    return [{ name: query.trim(), value: query.trim() }];
  }

  return choices;
}

function dedupeCategoriesByAcceptedValue(
  categories: readonly SetupClanCategory[],
): SetupClanCategory[] {
  return [...categories]
    .sort((left, right) =>
      compareAcceptedChoice(left.id, right.id, left.displayName, right.displayName),
    )
    .filter((category, index, sortedCategories) => {
      const previousCategory = sortedCategories[index - 1];
      return !previousCategory || previousCategory.id !== category.id;
    });
}

function dedupeClansByAcceptedValue(
  clans: readonly SetupClanTrackedClan[],
): SetupClanTrackedClan[] {
  return [...clans]
    .sort((left, right) =>
      compareAcceptedChoice(
        left.clanTag,
        right.clanTag,
        left.name ?? left.alias ?? left.clanTag,
        right.name ?? right.alias ?? right.clanTag,
      ),
    )
    .filter((clan, index, sortedClans) => {
      const previousClan = sortedClans[index - 1];
      return !previousClan || previousClan.clanTag !== clan.clanTag;
    });
}

function compareAcceptedChoice(
  leftValue: string,
  rightValue: string,
  leftName: string,
  rightName: string,
): number {
  const valueComparison = leftValue.localeCompare(rightValue);
  if (valueComparison !== 0) return valueComparison;

  return leftName.localeCompare(rightName);
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
      content:
        'You need the Discord Manage Server permission to use `/setup clan` because it changes persisted linked-clan, category, channel, and audit configuration for this server.',
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
      content: formatUnlinkChannelMessage(result, unlinkChannel.id, true),
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
    await interaction.reply({ content: formatUnlinkClanMessage(result, true), ephemeral: true });
    return;
  }

  let clan: SetupClanClashClan;
  try {
    clan = await options.coc.getClan(clanTag);
  } catch {
    await interaction.reply({
      content: `Could not find clan **${clanTag}**. Nothing was saved, and ClashMate does not create polling enrollment from failed setup lookups.`,
      ephemeral: true,
    });
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
  includeAcceptedFilterDetails = false,
): string {
  if (result.status === 'unlinked') {
    return `Successfully unlinked **${result.clanName}** from <#${channelId}>. Channel mapping count changed by -1 for this server; the clan remains linked and no live Clash lookup was made.`;
  }
  if (includeAcceptedFilterDetails) {
    return `No linked clan/channel matched the accepted channel filter <#${channelId}>. Channel mapping count changed by 0; choose a channel currently shown in \`/setup list\` or link one with \`/setup clan\`.`;
  }
  return `No clans were found that are linked to <#${channelId}>. Choose a linked clan channel or add one with \`/setup clan\`.`;
}

export function formatUnlinkClanMessage(
  result: Awaited<ReturnType<SetupClanStore['unlinkClan']>>,
  includeAcceptedFilterDetails = false,
): string {
  if (result.status === 'unlinked') {
    return `Successfully unlinked **${result.clan.name} (${result.clan.clanTag})**. Linked-clan count changed by -1 for this server; saved channel/log targets for that clan were removed with the persisted server configuration.`;
  }
  if (includeAcceptedFilterDetails) {
    return 'No linked clan matched the accepted clan tag filter. Use `/setup list` to review linked clans or `/setup clan` with a valid clan tag to link one.';
  }
  return 'No clans were found on the server for the specified tag. Use `/setup list` to review linked clans or `/setup clan` to link this clan first.';
}

export function formatLinkClanMessage(
  result: LinkClanResult,
  guildName: string,
  channelId?: string,
): string {
  if (result.status === 'channel_conflict') {
    return `<#${channelId}> is already linked to ${result.conflict.clanName} (${result.conflict.clanTag}). The clan link/update was saved for this server, but channel mapping count changed by 0; choose a different text/announcement/thread/media channel or unlink the existing mapping first.`;
  }

  const channelText =
    result.channelLinked && channelId
      ? ` Channel mapping: <#${channelId}> (+1 or refreshed).`
      : ' Channel mapping: unchanged.';
  const categoryText = result.category
    ? ` Category selection: **${result.category.displayName}**.`
    : ' Category selection: unchanged or none.';
  return `Successfully linked **${result.clanName} (${result.clanTag})** to **${guildName}**. Linked-clan count: saved or refreshed for this server.${channelText}${categoryText} Use \`/setup list\` to review persisted server configuration.`;
}

export function formatSetupListMessage(
  clans: readonly SetupClanTrackedClan[],
  categories: readonly SetupClanCategory[],
  filter?: string,
): string {
  const filteredClans = filter ? filterSetupClans(clans, filter) : clans;
  if (clans.length === 0) {
    return [
      'No clans are linked to this server. Use `/setup clan` with a clan tag to link a clan before configuring logs or channels.',
      'Source: saved ClashMate setup for this Discord server. Polling note: only linked/configured resources are tracked.',
    ].join('\n');
  }
  if (filteredClans.length === 0) {
    return `No linked clans matched the accepted \`clans\` filter${filter ? ` \`${filter}\`` : ''}. Try a clan tag, name, alias, or clear the filter to list all saved clans.`;
  }

  const categoryNames = new Map(categories.map((category) => [category.id, category.displayName]));
  const usedCategoryIds = new Set(
    clans
      .map((clan) => clan.categoryId)
      .filter((categoryId): categoryId is string => Boolean(categoryId)),
  );
  const visibleChannelCount = clans.reduce(
    (total, clan) => total + (clan.channelIds?.filter(Boolean).length ?? 0),
    0,
  );
  const duplicateChannelCount = countDuplicateChannelMappings(clans);
  const lines = filteredClans.map((clan, index) => {
    const channelMentions = clan.channelIds?.filter(Boolean).map((channelId) => `<#${channelId}>`);
    const details = [
      clan.alias ? `alias: ${clan.alias}` : undefined,
      clan.categoryId
        ? `category: ${categoryNames.get(clan.categoryId) ?? clan.categoryId}`
        : undefined,
      channelMentions && channelMentions.length > 0
        ? `channels: ${channelMentions.join(' ')}`
        : undefined,
      typeof clan.sortOrder === 'number' ? `sort: ${clan.sortOrder}` : undefined,
    ].filter((detail): detail is string => Boolean(detail));
    const detailsText = details.length > 0 ? ` — ${details.join(', ')}` : '';
    return `${index + 1}. **${clan.name ?? clan.clanTag}** (${clan.clanTag})${detailsText}`;
  });

  const suffix = filter ? ` matching \`${filter}\`` : '';
  const categorySummary =
    categories.length > 0
      ? `${usedCategoryIds.size}/${categories.length} categories used`
      : 'no categories configured';
  const channelSummary =
    visibleChannelCount > 0
      ? `${visibleChannelCount} visible channel links`
      : 'no visible channel links';
  const conflictSummary =
    duplicateChannelCount > 0
      ? `${duplicateChannelCount} duplicate channel conflicts to review`
      : 'no duplicate channel conflicts detected';
  return [
    `Linked clans${suffix}: ${filteredClans.length}/${clans.length}`,
    `Source: saved ClashMate setup for this Discord server. Summary: ${categorySummary}; ${channelSummary}; ${conflictSummary}.`,
    ...lines,
    'Flow coverage: `/setup clan` links/unlinks clans, categories, and channels; `/setup clan-logs` enables/disables per-clan log targets; `/setup list` reviews persisted server configuration.',
  ].join('\n');
}

function countDuplicateChannelMappings(clans: readonly SetupClanTrackedClan[]): number {
  const channelIds = clans.flatMap((clan) => clan.channelIds?.filter(Boolean) ?? []);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const channelId of channelIds) {
    if (seen.has(channelId)) duplicates.add(channelId);
    seen.add(channelId);
  }
  return duplicates.size;
}

function filterSetupClans(
  clans: readonly SetupClanTrackedClan[],
  filter: string,
): SetupClanTrackedClan[] {
  const terms = filter
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) return [...clans];

  return clans.filter((clan) =>
    terms.some((term) =>
      [clan.clanTag, clan.name, clan.alias]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(term)),
    ),
  );
}

export function formatConfigureJoinLeaveMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  return formatEnabledLogMessage('Join/Leave Log', result, 'join/leave');
}

export function formatDisableJoinLeaveMessage(
  result: DisableClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  if (result.status === 'not_configured') {
    return formatNotConfiguredLogMessage('Join/Leave Log', result);
  }

  return formatDisabledLogMessage('Join/Leave Log', result);
}

export function formatConfigureWarAttackMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  return formatEnabledLogMessage('War Attack Log', result, 'war attack');
}

export function formatDisableWarAttackMessage(
  result: DisableClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  if (result.status === 'not_configured') {
    return formatNotConfiguredLogMessage('War Attack Log', result);
  }

  return formatDisabledLogMessage('War Attack Log', result);
}

export function formatConfigureWarStateMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  return formatEnabledLogMessage('War State Log', result, 'war state');
}

export function formatDisableWarStateMessage(result: DisableClanMemberNotificationsResult): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  if (result.status === 'not_configured') {
    return formatNotConfiguredLogMessage('War State Log', result);
  }

  return formatDisabledLogMessage('War State Log', result);
}

export function formatConfigureDonationMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  return formatEnabledLogMessage('Donation Log', result, 'donation');
}

export function formatConfigureMissedWarAttackMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  return formatEnabledLogMessage('Missed War Attack Log', result, 'missed war attack');
}

export function formatDisableMissedWarAttackMessage(
  result: DisableClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  if (result.status === 'not_configured') {
    return formatNotConfiguredLogMessage('Missed War Attack Log', result);
  }

  return formatDisabledLogMessage('Missed War Attack Log', result);
}

export function formatDisableDonationMessage(result: DisableClanMemberNotificationsResult): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  if (result.status === 'not_configured') {
    return formatNotConfiguredLogMessage('Donation Log', result);
  }

  return formatDisabledLogMessage('Donation Log', result);
}

export function formatConfigureRoleChangeMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  return formatEnabledLogMessage('Role Change Log', result, 'role change');
}

export function formatDisableRoleChangeMessage(
  result: DisableClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  if (result.status === 'not_configured') {
    return formatNotConfiguredLogMessage('Role Change Log', result);
  }

  return formatDisabledLogMessage('Role Change Log', result);
}

export function formatConfigureClanGamesMessage(
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  return formatEnabledLogMessage('Clan Games Log', result, 'clan games');
}

export function formatDisableClanGamesMessage(
  result: DisableClanMemberNotificationsResult,
): string {
  if (result.status === 'clan_not_linked') {
    return formatClanNotLinkedForLogsMessage();
  }

  if (result.status === 'not_configured') {
    return formatNotConfiguredLogMessage('Clan Games Log', result);
  }

  return formatDisabledLogMessage('Clan Games Log', result);
}

function formatEnabledLogMessage(
  logLabel: string,
  result: ConfigureClanMemberNotificationsResult & { status: 'configured' },
  eventContext: string,
): string {
  return `Enabled ${logLabel} for **${result.clanName} (${result.clanTag})** in <#${result.discordChannelId}>. Log target count for this clan/log: 1 saved channel. Scope: persisted server configuration for the linked clan; delivery starts after worker-derived ${eventContext} events, with no live fallback lookup added by this command.`;
}

function formatNotConfiguredLogMessage(
  logLabel: string,
  result: DisableClanMemberNotificationsResult & { status: 'not_configured' },
): string {
  return `No ${logLabel} is enabled for **${result.clanName} (${result.clanTag})** in this server's saved setup. Log target count for this clan/log: 0 saved channels. Use \`/setup clan-logs\` with Enable and an accepted channel to configure it, then \`/setup list\` to review linked clans and channels.`;
}

function formatDisabledLogMessage(
  logLabel: string,
  result: DisableClanMemberNotificationsResult & { status: 'disabled' },
): string {
  return `Disabled ${logLabel} for **${result.clanName} (${result.clanTag})**. Log target count for this clan/log: 0 saved channels. Scope: persisted server configuration for the linked clan; the saved channel target was removed without changing other clan links.`;
}

function getConfigureLogHandler(
  store: SetupClanMemberNotificationStore,
  logType: string,
): SetupClanMemberNotificationStore['configureJoinLeaveNotifications'] | undefined {
  if (logType === 'member_join_leave_log') return store.configureJoinLeaveNotifications;
  if (logType === 'war_attack_log') return store.configureWarAttackNotifications;
  if (logType === 'war_state_log') return store.configureWarStateNotifications;
  if (logType === 'missed_war_attack_log') return store.configureMissedWarAttackNotifications;
  if (logType === 'continuous_donation_log') return store.configureDonationNotifications;
  if (logType === 'role_change_log') return store.configureRoleChangeNotifications;
  if (logType === 'clan_games_log') return store.configureClanGamesNotifications;
  return undefined;
}

function getDisableLogHandler(
  store: SetupClanMemberNotificationStore,
  logType: string,
): SetupClanMemberNotificationStore['disableJoinLeaveNotifications'] | undefined {
  if (logType === 'member_join_leave_log') return store.disableJoinLeaveNotifications;
  if (logType === 'war_attack_log') return store.disableWarAttackNotifications;
  if (logType === 'war_state_log') return store.disableWarStateNotifications;
  if (logType === 'missed_war_attack_log') return store.disableMissedWarAttackNotifications;
  if (logType === 'continuous_donation_log') return store.disableDonationNotifications;
  if (logType === 'role_change_log') return store.disableRoleChangeNotifications;
  if (logType === 'clan_games_log') return store.disableClanGamesNotifications;
  return undefined;
}

function formatConfigureClanLogMessage(
  logType: string,
  result: ConfigureClanMemberNotificationsResult,
): string {
  if (logType === 'member_join_leave_log') return formatConfigureJoinLeaveMessage(result);
  if (logType === 'war_attack_log') return formatConfigureWarAttackMessage(result);
  if (logType === 'war_state_log') return formatConfigureWarStateMessage(result);
  if (logType === 'missed_war_attack_log') return formatConfigureMissedWarAttackMessage(result);
  if (logType === 'continuous_donation_log') return formatConfigureDonationMessage(result);
  if (logType === 'role_change_log') return formatConfigureRoleChangeMessage(result);
  if (logType === 'clan_games_log') return formatConfigureClanGamesMessage(result);
  return `${getClanLogLabel(logType)} configuration is not available yet.`;
}

function formatDisableClanLogMessage(
  logType: string,
  result: DisableClanMemberNotificationsResult,
): string {
  if (logType === 'member_join_leave_log') return formatDisableJoinLeaveMessage(result);
  if (logType === 'war_attack_log') return formatDisableWarAttackMessage(result);
  if (logType === 'war_state_log') return formatDisableWarStateMessage(result);
  if (logType === 'missed_war_attack_log') return formatDisableMissedWarAttackMessage(result);
  if (logType === 'continuous_donation_log') return formatDisableDonationMessage(result);
  if (logType === 'role_change_log') return formatDisableRoleChangeMessage(result);
  if (logType === 'clan_games_log') return formatDisableClanGamesMessage(result);
  return `${getClanLogLabel(logType)} configuration is not available yet.`;
}

function getClanLogLabel(logType: string): string {
  if (logType === 'member_join_leave_log') return 'Join/Leave Log';
  if (logType === 'war_attack_log') return 'War Attack Log';
  if (logType === 'war_state_log') return 'War State Log';
  if (logType === 'missed_war_attack_log') return 'Missed War Attack Log';
  if (logType === 'continuous_donation_log') return 'Donation Log';
  if (logType === 'role_change_log') return 'Role Change Log';
  if (logType === 'clan_games_log') return 'Clan Games Log';
  return 'Clan Log';
}

function formatClanNotLinkedForLogsMessage(): string {
  return 'That clan is not linked to this server. Linked-clan count for this action: 0 matches. Use `/setup clan` first so ClashMate can save guild-scoped configuration, then enable log targets with `/setup clan-logs`.';
}

function formatUnavailableClanLogMessage(logType: string): string {
  return `${getClanLogLabel(logType)} configuration is not available in this ClashMate instance yet. Log target count changed by 0. Use \`/setup list\` to review currently saved clans/channels and configure an available clan log type when its backing store is enabled.`;
}
