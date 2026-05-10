import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  ChannelType,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandStringOption,
} from 'discord.js';

export const REMINDERS_COMMAND_NAME = 'reminders';
export const REMINDERS_COMMAND_DESCRIPTION = 'Manage ClashMate reminders.';

const REMINDER_TYPES = [
  { name: 'Clan Wars', value: 'clan-wars' },
  { name: 'Capital Raids', value: 'capital-raids' },
  { name: 'Clan Games', value: 'clan-games' },
] as const;

const DURATION_CHOICES = ['30m', '1h', '2h', '6h', '12h', '1d', '2d', '3d'];
const MAX_REMINDER_DURATION_MINUTES = 30 * 24 * 60;
const MAX_MENTIONS = 40;
const MAX_MESSAGE_LENGTH = 1_800;
const STORAGE_ONLY_NOTE =
  'Schedules use linked clans and polling snapshots only; there is no live Clash API fallback from this command.';
const REMINDER_WORKER_NOTE =
  'The worker must be running with clan/player/war polling enabled for scheduled reminders and member mentions to stay current.';
const SUPPORTED_REMINDER_TYPES_NOTE =
  'Supported schedule types: Clan Wars, Capital Raids, and Clan Games.';

const allowedReminderChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.GuildMedia,
] as const;

export const remindersCommandData = new SlashCommandBuilder()
  .setName(REMINDERS_COMMAND_NAME)
  .setDescription(REMINDERS_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('create')
      .setDescription('Create a scheduled reminder.')
      .addStringOption((option) => addReminderTypeOption(option).setRequired(true))
      .addStringOption((option) =>
        option
          .setName('duration')
          .setDescription('Remaining duration to mention members (e.g. 6h, 12h, 1d, 2d).')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((option) => addClanOption(option).setRequired(true))
      .addStringOption((option) =>
        option
          .setName('message')
          .setDescription('Reminder message to send.')
          .setMaxLength(MAX_MESSAGE_LENGTH)
          .setRequired(true),
      )
      .addBooleanOption((option) =>
        option
          .setName('exclude_participant_list')
          .setDescription('Exclude the participant list from the reminder.')
          .setRequired(false),
      )
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Channel to send the reminder in.')
          .addChannelTypes(...allowedReminderChannelTypes)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('edit')
      .setDescription('Edit a scheduled reminder.')
      .addStringOption((option) => addReminderTypeOption(option).setRequired(true))
      .addStringOption((option) =>
        option.setName('id').setDescription('Reminder ID.').setAutocomplete(true).setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('duration')
          .setDescription('Remaining duration to mention members (e.g. 6h, 12h, 1d, 2d).')
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('List scheduled reminders.')
      .addStringOption((option) => addReminderTypeOption(option).setRequired(true))
      .addBooleanOption((option) =>
        option.setName('compact_list').setDescription('Show a compact list.').setRequired(false),
      )
      .addStringOption((option) => addClanOption(option).setRequired(false))
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Reminder channel filter.')
          .addChannelTypes(...allowedReminderChannelTypes)
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('reminder_id')
          .setDescription('Reminder ID filter.')
          .setAutocomplete(true)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('delete')
      .setDescription('Delete a scheduled reminder.')
      .addStringOption((option) => addReminderTypeOption(option).setRequired(true))
      .addStringOption((option) =>
        option.setName('id').setDescription('Reminder ID.').setAutocomplete(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('now')
      .setDescription('Send an immediate reminder from persisted clan snapshots.')
      .addStringOption((option) => addReminderTypeOption(option).setRequired(true))
      .addStringOption((option) =>
        option
          .setName('message')
          .setDescription('Reminder message to send.')
          .setMaxLength(MAX_MESSAGE_LENGTH)
          .setRequired(true),
      )
      .addStringOption((option) => addClanOption(option).setRequired(true)),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('config')
      .setDescription('Configure reminder behavior.')
      .addStringOption((option) =>
        option
          .setName('reminder_ping_exclusion')
          .setDescription('Enable or disable reminder ping exclusion.')
          .addChoices({ name: 'Enable', value: 'enable' }, { name: 'Disable', value: 'disable' }),
      ),
  );

type StringOption = SlashCommandStringOption;

function addReminderTypeOption(option: StringOption): StringOption {
  return option
    .setName('type')
    .setDescription('Reminder type.')
    .addChoices(...REMINDER_TYPES);
}

function addClanOption(option: StringOption): StringOption {
  return option
    .setName('clans')
    .setDescription('Linked clan tag, name, or alias.')
    .setAutocomplete(true);
}

export interface RemindersLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface RemindersMemberSnapshot {
  readonly playerTag: string;
  readonly name: string;
}

export interface RemindersClanMemberSnapshots {
  readonly clan: RemindersLinkedClan;
  readonly members: RemindersMemberSnapshot[];
}

export interface RemindersPlayerLink {
  readonly discordUserId: string;
  readonly playerTag: string;
}

export type ReminderScheduleType = 'clan-wars' | 'capital-raids' | 'clan-games';

export interface ReminderScheduleClan {
  readonly input: string;
  readonly clanTag: string | null;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface ReminderSchedule {
  readonly id: string;
  readonly type: ReminderScheduleType;
  readonly duration: string;
  readonly clans: readonly ReminderScheduleClan[];
  readonly message: string;
  readonly excludeParticipantList: boolean;
  readonly channelId: string;
  readonly actorDiscordUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReminderSettings {
  readonly schedules: readonly ReminderSchedule[];
  readonly reminderPingExclusion: boolean;
}

export interface RemindersStore {
  readonly listLinkedClans: (guildId: string) => Promise<RemindersLinkedClan[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<RemindersClanMemberSnapshots[]>;
  readonly listPlayerLinksByTags: (playerTags: readonly string[]) => Promise<RemindersPlayerLink[]>;
  readonly getReminderSettings: (guildId: string) => Promise<ReminderSettings>;
  readonly createReminderSchedule: (input: {
    guildId: string;
    guildName: string | null;
    actorDiscordUserId: string;
    schedule: Omit<ReminderSchedule, 'createdAt' | 'updatedAt'>;
  }) => Promise<ReminderSchedule>;
  readonly updateReminderScheduleDuration: (input: {
    guildId: string;
    guildName: string | null;
    actorDiscordUserId: string;
    type: ReminderScheduleType;
    id: string;
    duration: string;
  }) => Promise<ReminderSchedule | null>;
  readonly deleteReminderSchedule: (input: {
    guildId: string;
    guildName: string | null;
    actorDiscordUserId: string;
    type: ReminderScheduleType;
    id: string;
  }) => Promise<ReminderSchedule | null>;
  readonly setReminderPingExclusion: (input: {
    guildId: string;
    guildName: string | null;
    actorDiscordUserId: string;
    enabled: boolean;
  }) => Promise<ReminderSettings>;
}

export interface RemindersCommandOptions {
  readonly store: RemindersStore;
}

export function createRemindersSlashCommand(
  options: RemindersCommandOptions,
): SlashCommandDefinition {
  return {
    name: REMINDERS_COMMAND_NAME,
    data: remindersCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== REMINDERS_COMMAND_NAME) return;
      await executeReminders(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== REMINDERS_COMMAND_NAME) return;
      await autocompleteReminders(interaction, options);
    },
  };
}

async function autocompleteReminders(
  interaction: AutocompleteInteraction,
  options: RemindersCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'duration') {
    const query = String(focused.value ?? '').toLowerCase();
    await interaction.respond(
      DURATION_CHOICES.filter((value) => value.includes(query)).map((value) => ({
        name: value,
        value,
      })),
    );
    return;
  }
  if (focused.name === 'id' || focused.name === 'reminder_id') {
    try {
      const settings = await options.store.getReminderSettings(interaction.guildId);
      const selectedType = parseOptionalReminderType(interaction.options.getString('type'));
      await interaction.respond(
        filterReminderIdChoices(settings.schedules, String(focused.value ?? ''), selectedType),
      );
    } catch {
      await interaction.respond([]);
    }
    return;
  }
  if (focused.name !== 'clans') {
    await interaction.respond([]);
    return;
  }
  try {
    const clans = await options.store.listLinkedClans(interaction.guildId);
    await interaction.respond(filterReminderClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterReminderClanChoices(
  clans: readonly RemindersLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export function filterReminderIdChoices(
  schedules: readonly ReminderSchedule[],
  query: string,
  type?: ReminderScheduleType,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return schedules
    .filter(
      (schedule) =>
        (!type || schedule.type === type) && scheduleMatchesIdQuery(schedule, normalizedQuery),
    )
    .slice(0, 25)
    .map((schedule) => ({ name: formatReminderIdChoiceName(schedule), value: schedule.id }));
}

export async function executeReminders(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: RemindersCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/reminders` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'create') {
    await handleCreateReminder(interaction, options);
    return;
  }
  if (subcommand === 'list') {
    await handleListReminders(interaction, options);
    return;
  }
  if (subcommand === 'edit') {
    await handleEditReminder(interaction, options);
    return;
  }
  if (subcommand === 'delete') {
    await handleDeleteReminder(interaction, options);
    return;
  }
  if (subcommand === 'config') {
    await handleReminderConfig(interaction, options);
    return;
  }

  await interaction.deferReply();
  const clans = await options.store.listLinkedClans(interaction.guildId);
  const clan = resolveReminderClan(clans, interaction.options.getString('clans', true));
  if (!clan) {
    await interaction.editReply({ content: 'No linked clan was found for that clans option.' });
    return;
  }

  const [snapshot] = await options.store.listClanMemberSnapshotsForGuild({
    guildId: interaction.guildId,
    clanTag: clan.clanTag,
  });
  if (!snapshot || snapshot.members.length === 0) {
    await interaction.editReply({
      content:
        `No persisted member snapshot is available for ${formatClanLabel(clan)} yet. ` +
        'Link/configure the clan, make sure polling is running, and wait for clan polling to store member snapshots. ' +
        STORAGE_ONLY_NOTE,
    });
    return;
  }

  const links = await options.store.listPlayerLinksByTags(
    snapshot.members.map((member) => member.playerTag),
  );
  await interaction.editReply({
    content: buildImmediateReminderMessage({
      type: interaction.options.getString('type', true),
      customMessage: interaction.options.getString('message', true),
      clan,
      members: snapshot.members,
      links,
    }),
    allowedMentions: { users: links.map((link) => link.discordUserId).slice(0, MAX_MENTIONS) },
  });
}

async function handleCreateReminder(
  interaction: ChatInputCommandInteraction<'cached'>,
  options: RemindersCommandOptions,
): Promise<void> {
  const duration = parseReminderDuration(interaction.options.getString('duration', true));
  if (!duration) {
    await interaction.reply({
      content: 'Provide a positive duration like `30m`, `1h`, `6h`, or `2d` up to 30 days.',
      ephemeral: true,
    });
    return;
  }
  const clans = await options.store.listLinkedClans(interaction.guildId);
  const clanInputs = splitClanInputs(interaction.options.getString('clans', true));
  const scheduleClans = clanInputs.map((input) => toScheduleClan(input, clans));
  const unmatchedClanInputs = clanInputs.filter((input) => !resolveReminderClan(clans, input));
  const schedule = await options.store.createReminderSchedule({
    guildId: interaction.guildId,
    guildName: interaction.guild.name,
    actorDiscordUserId: interaction.user.id,
    schedule: {
      id: createReminderId(),
      type: parseReminderType(interaction.options.getString('type', true)),
      duration: duration.normalized,
      clans: scheduleClans,
      message: interaction.options.getString('message', true),
      excludeParticipantList: interaction.options.getBoolean('exclude_participant_list') ?? false,
      channelId: interaction.options.getChannel('channel')?.id ?? interaction.channelId,
      actorDiscordUserId: interaction.user.id,
    },
  });

  await interaction.reply({
    content:
      'Stored ' +
      formatReminderType(schedule.type) +
      ' reminder ' +
      inlineCode(schedule.id) +
      ' for ' +
      formatScheduleClans(schedule.clans) +
      ' in <#' +
      schedule.channelId +
      '> at ' +
      formatReminderDurationForDisplay(schedule.duration) +
      '. Next due: ' +
      formatReminderNextDue(schedule) +
      '. ' +
      formatUnmatchedClanWarning(unmatchedClanInputs) +
      `Exclude participant list: ${schedule.excludeParticipantList ? 'yes' : 'no'}. ` +
      STORAGE_ONLY_NOTE +
      ' ' +
      REMINDER_WORKER_NOTE,
    ephemeral: true,
  });
}

async function handleListReminders(
  interaction: ChatInputCommandInteraction<'cached'>,
  options: RemindersCommandOptions,
): Promise<void> {
  const settings = await options.store.getReminderSettings(interaction.guildId);
  const type = parseReminderType(interaction.options.getString('type', true));
  const clanFilter = interaction.options.getString('clans')?.trim();
  const channelId = interaction.options.getChannel('channel')?.id;
  const reminderId = interaction.options.getString('reminder_id')?.trim();
  const compact = interaction.options.getBoolean('compact_list') ?? false;
  const schedules = settings.schedules.filter(
    (schedule) =>
      schedule.type === type &&
      (!reminderId || schedule.id === reminderId) &&
      (!channelId || schedule.channelId === channelId) &&
      (!clanFilter || schedule.clans.some((clan) => scheduleClanMatches(clan, clanFilter))),
  );
  const totalForType = settings.schedules.filter((schedule) => schedule.type === type).length;

  await interaction.reply({
    content:
      schedules.length === 0
        ? `${formatReminderNoDataContext({ type, clanFilter, channelId, reminderId, totalForType })} ${STORAGE_ONLY_NOTE}`
        : `${formatReminderList(schedules, compact)}\n\n${SUPPORTED_REMINDER_TYPES_NOTE} ${STORAGE_ONLY_NOTE} ${REMINDER_WORKER_NOTE}`,
    ephemeral: true,
  });
}

async function handleEditReminder(
  interaction: ChatInputCommandInteraction<'cached'>,
  options: RemindersCommandOptions,
): Promise<void> {
  const duration = interaction.options.getString('duration');
  if (!duration) {
    await interaction.reply({ content: 'Provide a new duration to update.', ephemeral: true });
    return;
  }
  const parsedDuration = parseReminderDuration(duration);
  if (!parsedDuration) {
    await interaction.reply({
      content: 'Provide a positive duration like `30m`, `1h`, `6h`, or `2d` up to 30 days.',
      ephemeral: true,
    });
    return;
  }
  const type = parseReminderType(interaction.options.getString('type', true));
  const id = interaction.options.getString('id', true).trim();
  const updated = await options.store.updateReminderScheduleDuration({
    guildId: interaction.guildId,
    guildName: interaction.guild.name,
    actorDiscordUserId: interaction.user.id,
    type,
    id,
    duration: parsedDuration.normalized,
  });
  await interaction.reply({
    content: updated
      ? `Updated reminder ${inlineCode(id)} duration to ${formatReminderDurationForDisplay(updated.duration)}. Next due: ${formatReminderNextDue(updated)}. ${STORAGE_ONLY_NOTE} ${REMINDER_WORKER_NOTE}`
      : `No ${formatReminderType(type)} reminder was found with ID ${inlineCode(id)}. Use ${inlineCode('/reminders list')} for stored IDs and verify the selected type.`,
    ephemeral: true,
  });
}

async function handleDeleteReminder(
  interaction: ChatInputCommandInteraction<'cached'>,
  options: RemindersCommandOptions,
): Promise<void> {
  const id = interaction.options.getString('id')?.trim();
  if (!id) {
    await interaction.reply({ content: 'Provide a reminder ID to delete.', ephemeral: true });
    return;
  }
  const type = parseReminderType(interaction.options.getString('type', true));
  const deleted = await options.store.deleteReminderSchedule({
    guildId: interaction.guildId,
    guildName: interaction.guild.name,
    actorDiscordUserId: interaction.user.id,
    type,
    id,
  });
  await interaction.reply({
    content: deleted
      ? `Deleted reminder ${inlineCode(id)}. ${STORAGE_ONLY_NOTE}`
      : `No ${formatReminderType(type)} reminder was found with ID ${inlineCode(id)}. Use ${inlineCode('/reminders list')} for stored IDs and verify the selected type.`,
    ephemeral: true,
  });
}

async function handleReminderConfig(
  interaction: ChatInputCommandInteraction<'cached'>,
  options: RemindersCommandOptions,
): Promise<void> {
  const value = interaction.options.getString('reminder_ping_exclusion');
  const settings = value
    ? await options.store.setReminderPingExclusion({
        guildId: interaction.guildId,
        guildName: interaction.guild.name,
        actorDiscordUserId: interaction.user.id,
        enabled: value === 'enable',
      })
    : await options.store.getReminderSettings(interaction.guildId);
  await interaction.reply({
    content:
      'Reminder ping exclusion is ' +
      (settings.reminderPingExclusion ? 'enabled' : 'disabled') +
      '. When enabled, players covered by reminder ping exclusion config are skipped by reminder delivery; immediate pings still use linked player accounts from the latest member snapshot. ' +
      STORAGE_ONLY_NOTE,
    ephemeral: true,
  });
}
export function buildImmediateReminderMessage(input: {
  type: string;
  customMessage: string;
  clan: RemindersLinkedClan;
  members: readonly RemindersMemberSnapshot[];
  links: readonly RemindersPlayerLink[];
}): string {
  const linkedByTag = new Map(
    input.links.map((link) => [normalizeClashTag(link.playerTag), link.discordUserId]),
  );
  const mentions = input.members
    .map((member) => linkedByTag.get(normalizeClashTag(member.playerTag)))
    .filter((userId): userId is string => Boolean(userId))
    .filter((userId, index, all) => all.indexOf(userId) === index)
    .slice(0, MAX_MENTIONS)
    .map((userId) => `<@${userId}>`);
  const linkedMentionCount = new Set(
    input.members
      .map((member) => linkedByTag.get(normalizeClashTag(member.playerTag)))
      .filter((userId): userId is string => Boolean(userId)),
  ).size;
  const unlinkedCount = input.members.length - linkedMentionCount;
  const truncatedNote =
    linkedMentionCount > MAX_MENTIONS ? `\n_Mentions capped at ${MAX_MENTIONS} users._` : '';
  const mentionText =
    mentions.length > 0
      ? mentions.join(' ')
      : '_No linked Discord users were found for current snapshot members._';

  return [
    `**${formatReminderType(input.type)} reminder for ${formatClanLabel(input.clan)}**`,
    input.customMessage,
    '',
    mentionText,
    '',
    `Source: persisted member snapshot for ${formatClanLabel(input.clan)}; storage-only, no live Clash API lookup.`,
    `Members considered: ${input.members.length}. Linked mention count: ${linkedMentionCount}. Mention cap: ${MAX_MENTIONS}. Mentioned now: ${mentions.length}. Unlinked snapshot members: ${Math.max(unlinkedCount, 0)}.${truncatedNote}`,
    mentions.length === 0
      ? 'Action: link Discord users to player tags and wait for player/member snapshots before retrying.'
      : 'Immediate pings mention linked Discord users from the stored snapshot only.',
    STORAGE_ONLY_NOTE,
  ].join('\n');
}

function resolveReminderClan(
  clans: readonly RemindersLinkedClan[],
  value: string,
): RemindersLinkedClan | undefined {
  const normalizedValue = normalizeClashTag(value);
  const loweredValue = value.trim().toLowerCase();
  return clans.find(
    (clan) =>
      normalizeClashTag(clan.clanTag) === normalizedValue ||
      clan.alias?.toLowerCase() === loweredValue ||
      clan.name?.toLowerCase() === loweredValue,
  );
}

function clanMatchesQuery(clan: RemindersLinkedClan, query: string): boolean {
  if (!query) return true;
  return [clan.clanTag, clan.name, clan.alias]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query));
}

function formatClanChoiceName(clan: RemindersLinkedClan): string {
  const label = clan.alias
    ? `${clan.alias} — ${clan.name ?? clan.clanTag}`
    : (clan.name ?? clan.clanTag);
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function scheduleMatchesIdQuery(schedule: ReminderSchedule, query: string): boolean {
  if (!query) return true;
  const typeLabel = formatReminderType(schedule.type);
  return [
    schedule.id,
    schedule.type,
    typeLabel,
    schedule.channelId,
    ...schedule.clans.flatMap((clan) => [clan.input, clan.clanTag, clan.name, clan.alias]),
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query));
}

function formatReminderIdChoiceName(schedule: ReminderSchedule): string {
  const clanLabel = formatScheduleClans(schedule.clans) || 'No clans';
  return [
    schedule.id,
    formatReminderType(schedule.type),
    clanLabel,
    `next ${formatReminderNextDue(schedule)}`,
    `<#${schedule.channelId}>`,
  ]
    .join(' · ')
    .slice(0, 100);
}

function formatClanLabel(clan: RemindersLinkedClan): string {
  return `${clan.name ?? clan.alias ?? clan.clanTag} (${clan.clanTag})`;
}

function formatReminderType(type: string): string {
  return REMINDER_TYPES.find((entry) => entry.value === type)?.name ?? type;
}

function inlineCode(value: string): string {
  return `\`${value.replaceAll('`', '')}\``;
}

function parseReminderType(type: string): ReminderScheduleType {
  if (type === 'clan-wars' || type === 'capital-raids' || type === 'clan-games') return type;
  return 'clan-wars';
}

function parseOptionalReminderType(type: string | null): ReminderScheduleType | undefined {
  if (type === 'clan-wars' || type === 'capital-raids' || type === 'clan-games') return type;
  return undefined;
}

function parseReminderDuration(
  value: string,
): { normalized: string; amount: number; unit: string } | null {
  const match = /^(\d+)([mhd])$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number.parseInt(match[1] ?? '', 10);
  const unit = (match[2] ?? '').toLowerCase();
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const minutes = unit === 'm' ? amount : unit === 'h' ? amount * 60 : amount * 24 * 60;
  if (minutes > MAX_REMINDER_DURATION_MINUTES) return null;
  return { normalized: `${amount}${unit}`, amount, unit };
}

function formatReminderDurationForDisplay(value: string): string {
  const duration = parseReminderDuration(value);
  if (!duration) return `unverified duration ${inlineCode(value)}`;
  const unitName = duration.unit === 'm' ? 'minute' : duration.unit === 'h' ? 'hour' : 'day';
  return `${duration.amount} ${unitName}${duration.amount === 1 ? '' : 's'} (${duration.normalized})`;
}

function reminderDurationMilliseconds(value: string): number | null {
  const duration = parseReminderDuration(value);
  if (!duration) return null;
  const minutes =
    duration.unit === 'm'
      ? duration.amount
      : duration.unit === 'h'
        ? duration.amount * 60
        : duration.amount * 24 * 60;
  return minutes * 60 * 1000;
}

function formatReminderNextDue(schedule: Pick<ReminderSchedule, 'createdAt' | 'duration'>): string {
  const durationMs = reminderDurationMilliseconds(schedule.duration);
  const createdAtMs = new Date(schedule.createdAt).getTime();
  if (!durationMs || Number.isNaN(createdAtMs)) return 'unknown';

  const nowMs = Date.now();
  const elapsedMs = nowMs - createdAtMs;
  const bucket = elapsedMs < durationMs ? 1 : Math.floor(elapsedMs / durationMs) + 1;
  const nextDueMs = createdAtMs + bucket * durationMs;
  return `${formatDiscordTimestamp(nextDueMs, 'R')} (${formatDiscordTimestamp(nextDueMs, 'f')})`;
}

function formatReminderCadence(schedule: Pick<ReminderSchedule, 'createdAt' | 'duration'>): string {
  const duration = parseReminderDuration(schedule.duration);
  if (!duration || Number.isNaN(new Date(schedule.createdAt).getTime())) return 'Due: unknown';
  return `Due every ${formatReminderDurationForDisplay(schedule.duration)} • Next due: ${formatReminderNextDue(schedule)}`;
}

function formatDiscordTimestamp(timeMs: number, style: 'R' | 'f'): string {
  return `<t:${Math.floor(timeMs / 1000)}:${style}>`;
}

function createReminderId(): string {
  return `r${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
}

function splitClanInputs(value: string): string[] {
  const inputs = value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return inputs.length > 0 ? inputs : [value.trim()];
}

function toScheduleClan(
  input: string,
  clans: readonly RemindersLinkedClan[],
): ReminderScheduleClan {
  const clan = resolveReminderClan(clans, input);
  return {
    input,
    clanTag: clan?.clanTag ?? (input.startsWith('#') ? normalizeClashTag(input) : null),
    name: clan?.name ?? null,
    alias: clan?.alias ?? null,
  };
}

function formatUnmatchedClanWarning(unmatchedClanInputs: readonly string[]): string {
  if (unmatchedClanInputs.length === 0) return '';
  return (
    'Warning: the following clan inputs did not match linked clans: ' +
    unmatchedClanInputs.map(inlineCode).join(', ') +
    '. They were stored without Clash API lookup; link the clan or use an existing alias/tag for snapshot-backed delivery. '
  );
}

function formatReminderNoDataContext(input: {
  type: ReminderScheduleType;
  clanFilter: string | undefined;
  channelId: string | undefined;
  reminderId: string | undefined;
  totalForType: number;
}): string {
  const filters = [
    `type=${formatReminderType(input.type)}`,
    `clan=${input.clanFilter ? inlineCode(input.clanFilter) : 'all'}`,
    `channel=${input.channelId ? `<#${input.channelId}>` : 'all'}`,
    `reminder_id=${input.reminderId ? inlineCode(input.reminderId) : 'all'}`,
  ];
  return (
    `No stored ${formatReminderType(input.type)} reminders matched. ` +
    `Active filters: ${filters.join(', ')}. ` +
    `Stored schedules for this type: ${input.totalForType}. ` +
    `Action: use ${inlineCode('/reminders create')} to store a schedule, or clear filters/use autocomplete to find an existing reminder. ` +
    REMINDER_WORKER_NOTE
  );
}

function formatScheduleClans(clans: readonly ReminderScheduleClan[]): string {
  if (clans.length === 0) return 'no clans';
  return clans
    .map((clan) => clan.name ?? clan.alias ?? clan.clanTag ?? clan.input)
    .join(', ')
    .slice(0, 500);
}

function scheduleClanMatches(clan: ReminderScheduleClan, filter: string): boolean {
  const lowered = filter.toLowerCase();
  const normalized = normalizeClashTag(filter);
  return [clan.input, clan.clanTag, clan.name, clan.alias]
    .filter((value): value is string => Boolean(value))
    .some(
      (value) => value.toLowerCase().includes(lowered) || normalizeClashTag(value) === normalized,
    );
}

function formatReminderList(schedules: readonly ReminderSchedule[], compact: boolean): string {
  const lines = schedules
    .slice(0, 20)
    .map((schedule) =>
      compact
        ? `\`${schedule.id}\` ${formatReminderDurationForDisplay(schedule.duration)} • Next due: ${formatReminderNextDue(schedule)} • <#${schedule.channelId}> ${formatScheduleClans(schedule.clans)}`
        : [
            `**${formatReminderType(schedule.type)}** \`${schedule.id}\``,
            `Duration: ${formatReminderDurationForDisplay(schedule.duration)} • Channel: <#${schedule.channelId}>`,
            formatReminderCadence(schedule),
            `Clans: ${formatScheduleClans(schedule.clans)}`,
            `Exclude participant list: ${schedule.excludeParticipantList ? 'yes' : 'no'}`,
            `Message: ${schedule.message.slice(0, 180)}`,
          ].join('\n'),
    );
  const extra = schedules.length > 20 ? `\n…and ${schedules.length - 20} more.` : '';
  return `${lines.join(compact ? '\n' : '\n\n')}${extra}`;
}
