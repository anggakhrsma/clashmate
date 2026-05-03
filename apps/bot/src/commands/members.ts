import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  time,
  type User,
} from 'discord.js';

export const MEMBERS_COMMAND_NAME = 'members';
export const MEMBERS_COMMAND_DESCRIPTION = 'Show tracked clan members from polling snapshots.';
export const MEMBERS_NO_SNAPSHOT_MESSAGE =
  'No member snapshot is available yet. Link/configure a clan and wait for clan polling to observe members.';

const MEMBERS_OPTIONS = ['overview', 'tags', 'trophies', 'donations'] as const;
export type MembersOption = (typeof MEMBERS_OPTIONS)[number];
const MAX_MEMBER_ROWS = 25;
const EMBED_DESCRIPTION_LIMIT = 4096;

export const membersCommandData = new SlashCommandBuilder()
  .setName(MEMBERS_COMMAND_NAME)
  .setDescription(MEMBERS_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('clan')
      .setDescription('Clan tag or name or alias.')
      .setAutocomplete(true)
      .setRequired(false),
  )
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('Discord user whose linked player clans should be matched.')
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('option')
      .setDescription('Select a member snapshot view.')
      .setRequired(false)
      .addChoices(
        { name: 'Overview', value: 'overview' },
        { name: 'Tags', value: 'tags' },
        { name: 'Trophies', value: 'trophies' },
        { name: 'Donations', value: 'donations' },
      ),
  );

export interface MembersLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface MembersSnapshotRow {
  readonly playerTag: string;
  readonly name: string;
  readonly role: string | null;
  readonly expLevel: number | null;
  readonly leagueId: number | null;
  readonly trophies: number | null;
  readonly clanRank: number | null;
  readonly previousClanRank: number | null;
  readonly donations: number | null;
  readonly donationsReceived: number | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly lastFetchedAt: Date;
}

export interface MembersClanSnapshots {
  readonly clan: MembersLinkedClan;
  readonly members: readonly MembersSnapshotRow[];
}

export interface MembersStore {
  readonly listLinkedClans: (guildId: string) => Promise<MembersLinkedClan[]>;
  readonly listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<MembersClanSnapshots[]>;
}

export interface MembersCommandOptions {
  readonly store: MembersStore;
}

export function createMembersSlashCommand(options: MembersCommandOptions): SlashCommandDefinition {
  return {
    name: MEMBERS_COMMAND_NAME,
    data: membersCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== MEMBERS_COMMAND_NAME) return;
      await executeMembers(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== MEMBERS_COMMAND_NAME) return;
      await autocompleteMembers(interaction, options);
    },
  };
}

async function autocompleteMembers(
  interaction: AutocompleteInteraction,
  options: MembersCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'clan') {
    await interaction.respond([]);
    return;
  }
  try {
    const clans = await options.store.listLinkedClans(interaction.guildId);
    await interaction.respond(filterMemberClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterMemberClanChoices(
  clans: readonly MembersLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export async function executeMembers(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: MembersCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/members` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const option = parseMembersOption(interaction.options.getString('option'));
  const clanOption = interaction.options.getString('clan');
  const userOption = interaction.options.getUser('user');
  const clans = await options.store.listLinkedClans(interaction.guildId);

  if (clanOption) {
    const clan = resolveMemberClan(clans, clanOption);
    if (!clan) {
      await interaction.editReply({ content: 'No linked clan was found for that clan option.' });
      return;
    }
    const [snapshots] = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
      clanTag: clan.clanTag,
    });
    await replyWithMembers(interaction, snapshots, option, userOption);
    return;
  }

  const snapshots = await options.store.listClanMemberSnapshotsForGuild({
    guildId: interaction.guildId,
  });
  const selected = userOption
    ? await selectClanForUser(interaction.guildId, userOption, snapshots, options.store)
    : snapshots.find((entry) => entry.members.length > 0);

  if (selected === 'no_link') {
    await interaction.editReply({ content: formatNoLinkedMembersMessage(userOption) });
    return;
  }

  await replyWithMembers(interaction, selected, option, userOption);
}

function parseMembersOption(value: string | null): MembersOption {
  return MEMBERS_OPTIONS.includes(value as MembersOption) ? (value as MembersOption) : 'overview';
}

async function selectClanForUser(
  guildId: string,
  user: User,
  snapshots: readonly MembersClanSnapshots[],
  store: Pick<MembersStore, 'listPlayerTagsForUser'>,
): Promise<MembersClanSnapshots | 'no_link' | undefined> {
  const tags = new Set(
    (await store.listPlayerTagsForUser(guildId, user.id)).map((tag) => tag.toUpperCase()),
  );
  if (tags.size === 0) return 'no_link';
  return snapshots.find((entry) =>
    entry.members.some((member) => tags.has(member.playerTag.toUpperCase())),
  );
}

function formatNoLinkedMembersMessage(user: User | null): string {
  if (!user) return 'No linked player accounts were found. Use `/link create` first.';
  return `**${escapeMarkdown(user.displayName)}** does not have linked player accounts. Use \`/link create\` first.`;
}

async function replyWithMembers(
  interaction: ChatInputCommandInteraction,
  snapshots: MembersClanSnapshots | undefined,
  option: MembersOption,
  user: User | null,
): Promise<void> {
  if (!snapshots || snapshots.members.length === 0) {
    await interaction.editReply({ content: MEMBERS_NO_SNAPSHOT_MESSAGE });
    return;
  }
  await interaction.editReply({ embeds: [buildMembersEmbed(snapshots, option, user)] });
}

export function resolveMemberClan(
  clans: readonly MembersLinkedClan[],
  query: string,
): MembersLinkedClan | undefined {
  const normalizedQuery = query.trim().toLowerCase();
  let normalizedTag: string | undefined;
  try {
    normalizedTag = normalizeClashTag(query).toLowerCase();
  } catch {
    normalizedTag = undefined;
  }
  return clans.find((clan) => {
    return (
      clan.clanTag.toLowerCase() === normalizedTag ||
      clan.clanTag.replace(/^#/, '').toLowerCase() === normalizedQuery.replace(/^#/, '') ||
      clan.alias?.trim().toLowerCase() === normalizedQuery ||
      clan.name?.trim().toLowerCase() === normalizedQuery
    );
  });
}

function clanMatchesQuery(clan: MembersLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: MembersLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

export function buildMembersEmbed(
  snapshots: MembersClanSnapshots,
  option: MembersOption,
  user: User | null,
): EmbedBuilder {
  const members = sortMembers(snapshots.members, option).slice(0, MAX_MEMBER_ROWS);
  const clanName = snapshots.clan.alias ?? snapshots.clan.name ?? 'Linked Clan';
  const embed = new EmbedBuilder()
    .setTitle(`${clanName} Members`)
    .setDescription(truncateEmbedDescription(formatMembersDescription(members, option)))
    .setFooter({
      text: `Showing ${members.length}/${snapshots.members.length} from stored snapshots`,
    });

  if (user) embed.setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() });
  embed.addFields({
    name: 'Clan',
    value: `${escapeMarkdown(clanName)} (${snapshots.clan.clanTag})`,
    inline: false,
  });
  return embed;
}

function sortMembers(
  members: readonly MembersSnapshotRow[],
  option: MembersOption,
): MembersSnapshotRow[] {
  const rows = [...members];
  if (option === 'trophies')
    return rows.sort((a, b) => (b.trophies ?? -1) - (a.trophies ?? -1) || compareNames(a, b));
  if (option === 'donations')
    return rows.sort((a, b) => (b.donations ?? -1) - (a.donations ?? -1) || compareNames(a, b));
  if (option === 'tags')
    return rows.sort((a, b) => roleWeight(b.role) - roleWeight(a.role) || compareNames(a, b));
  return rows.sort((a, b) => (a.clanRank ?? 999) - (b.clanRank ?? 999) || compareNames(a, b));
}

function formatMembersDescription(
  members: readonly MembersSnapshotRow[],
  option: MembersOption,
): string {
  if (option === 'tags') {
    return members
      .map(
        (member) =>
          `**${formatRole(member.role)}** · \`${member.playerTag}\` · ${escapeMarkdown(member.name)}`,
      )
      .join('\n');
  }
  if (option === 'trophies') {
    return members
      .map(
        (member, index) =>
          `${index + 1}. ${escapeMarkdown(member.name)} · ${member.trophies ?? 0} trophies · ${formatRole(member.role)} · ${time(member.lastFetchedAt, 'R')}`,
      )
      .join('\n');
  }
  if (option === 'donations') {
    return members
      .map(
        (member, index) =>
          `${index + 1}. ${escapeMarkdown(member.name)} · ${member.donations ?? 0}/${member.donationsReceived ?? 0} donated/received · ${formatRole(member.role)} · ${time(member.lastFetchedAt, 'R')}`,
      )
      .join('\n');
  }
  return members
    .map(
      (member) =>
        `**${escapeMarkdown(member.name)}** · ${formatRole(member.role)} · ${member.trophies ?? 0} trophies · ${member.donations ?? 0}/${member.donationsReceived ?? 0} donated/received · observed ${time(member.lastFetchedAt, 'R')}`,
    )
    .join('\n');
}

function truncateEmbedDescription(text: string): string {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…`;
}

function compareNames(left: MembersSnapshotRow, right: MembersSnapshotRow): number {
  return left.name.localeCompare(right.name) || left.playerTag.localeCompare(right.playerTag);
}

function roleWeight(role: string | null): number {
  if (role === 'leader') return 4;
  if (role === 'coLeader') return 3;
  if (role === 'admin') return 2;
  return 1;
}

function formatRole(role: string | null): string {
  if (role === 'leader') return 'Leader';
  if (role === 'coLeader') return 'Co-leader';
  if (role === 'admin') return 'Elder';
  return 'Member';
}
