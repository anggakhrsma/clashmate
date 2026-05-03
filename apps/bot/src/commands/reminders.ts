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
const DISABLED_RESPONSE =
  'Scheduled reminders are not implemented in ClashMate yet. This first pass only supports `/reminders now` using persisted linked-clan snapshots.';

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

export interface RemindersStore {
  readonly listLinkedClans: (guildId: string) => Promise<RemindersLinkedClan[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<RemindersClanMemberSnapshots[]>;
  readonly listPlayerLinksByTags: (playerTags: readonly string[]) => Promise<RemindersPlayerLink[]>;
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
  if (subcommand !== 'now') {
    const content =
      subcommand === 'list'
        ? `No scheduled reminders are stored yet. ${DISABLED_RESPONSE}`
        : DISABLED_RESPONSE;
    await interaction.reply({ content, ephemeral: true });
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
