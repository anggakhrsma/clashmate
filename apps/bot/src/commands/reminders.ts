import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
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
const MAX_MENTIONS = 40;
const MAX_MESSAGE_LENGTH = 1_800;
const STORAGE_ONLY_NOTE =
  'Delivery scheduling and worker fan-out are not implemented yet; stored schedules are configuration only for now.';

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
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('edit')
      .setDescription('Edit a scheduled reminder.')
      .addStringOption((option) => addReminderTypeOption(option).setRequired(true))
      .addStringOption((option) =>
        option.setName('id').setDescription('Reminder ID.').setRequired(true),
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
        option.setName('channel').setDescription('Reminder channel filter.').setRequired(false),
      )
      .addStringOption((option) =>
        option.setName('reminder_id').setDescription('Reminder ID filter.').setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('delete')
      .setDescription('Delete a scheduled reminder.')
      .addStringOption((option) => addReminderTypeOption(option).setRequired(true))
      .addStringOption((option) => option.setName('id').setDescription('Reminder ID.')),
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
        'Link/configure the clan and wait for clan polling to store member snapshots.',
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
  const clans = await options.store.listLinkedClans(interaction.guildId);
  const clanInputs = splitClanInputs(interaction.options.getString('clans', true));
  const schedule = await options.store.createReminderSchedule({
    guildId: interaction.guildId,
    guildName: interaction.guild.name,
    actorDiscordUserId: interaction.user.id,
    schedule: {
      id: createReminderId(),
      type: parseReminderType(interaction.options.getString('type', true)),
      duration: interaction.options.getString('duration', true),
      clans: clanInputs.map((input) => toScheduleClan(input, clans)),
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
      schedule.duration +
      '. ' +
      STORAGE_ONLY_NOTE,
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

  await interaction.reply({
    content:
      schedules.length === 0
        ? `No stored ${formatReminderType(type)} reminders matched. ${STORAGE_ONLY_NOTE}`
        : `${formatReminderList(schedules, compact)}\n\n${STORAGE_ONLY_NOTE}`,
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
  const type = parseReminderType(interaction.options.getString('type', true));
  const id = interaction.options.getString('id', true).trim();
  const updated = await options.store.updateReminderScheduleDuration({
    guildId: interaction.guildId,
    guildName: interaction.guild.name,
    actorDiscordUserId: interaction.user.id,
    type,
    id,
    duration,
  });
  await interaction.reply({
    content: updated
      ? `Updated reminder ${inlineCode(id)} duration to ${duration}. ${STORAGE_ONLY_NOTE}`
      : `No ${formatReminderType(type)} reminder was found with ID ${inlineCode(id)}.`,
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
      : `No ${formatReminderType(type)} reminder was found with ID ${inlineCode(id)}.`,
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
      '. ' +
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
  const unlinkedCount = input.members.length - mentions.length;
  const truncatedNote =
    input.links.length > MAX_MENTIONS ? `\n_Mentions capped at ${MAX_MENTIONS} users._` : '';
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
    `Snapshot members: ${input.members.length}. Linked mentions: ${mentions.length}. Unlinked snapshot members: ${Math.max(unlinkedCount, 0)}.${truncatedNote}`,
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
        ? `\`${schedule.id}\` ${schedule.duration} <#${schedule.channelId}> ${formatScheduleClans(schedule.clans)}`
        : [
            `**${formatReminderType(schedule.type)}** \`${schedule.id}\``,
            `Duration: ${schedule.duration} • Channel: <#${schedule.channelId}>`,
            `Clans: ${formatScheduleClans(schedule.clans)}`,
            `Exclude participant list: ${schedule.excludeParticipantList ? 'yes' : 'no'}`,
            `Message: ${schedule.message.slice(0, 180)}`,
          ].join('\n'),
    );
  const extra = schedules.length > 20 ? `\n…and ${schedules.length - 20} more.` : '';
  return `${lines.join(compact ? '\n' : '\n\n')}${extra}`;
}
