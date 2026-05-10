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
  'No member snapshot is available yet. Link a clan with `/setup clan`, then wait for clan polling to observe members.';

const MEMBERS_OPTIONS = [
  'overview',
  'tags',
  'trophies',
  'donations',
  'heroes',
  'link-list',
  'war-pref',
  'join-date',
  'progress',
  'attacks',
  'clan',
] as const;
export type MembersOption = (typeof MEMBERS_OPTIONS)[number];
const MAX_MEMBER_ROWS = 25;
const EMBED_DESCRIPTION_LIMIT = 4096;

interface MembersFilterContext {
  readonly clan?: MembersLinkedClan;
  readonly linkedClanCount: number;
  readonly user: User | null;
  readonly option: MembersOption;
}

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
        { name: 'Heroes/War Weight', value: 'heroes' },
        { name: 'Discord Links', value: 'link-list' },
        { name: 'War Preferences', value: 'war-pref' },
        { name: 'Last Joining Date', value: 'join-date' },
        { name: 'Player Progress', value: 'progress' },
        { name: 'Attacks & Defenses', value: 'attacks' },
        { name: 'Clan Overview', value: 'clan' },
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
      await interaction.editReply({
        content:
          'No linked clan was found for that clan option. Pick an autocomplete result or link the clan with `/setup clan` first.',
      });
      return;
    }
    const [snapshots] = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
      clanTag: clan.clanTag,
    });
    await replyWithMembers(interaction, snapshots, {
      clan,
      linkedClanCount: clans.length,
      user: userOption,
      option,
    });
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

  await replyWithMembers(interaction, selected, {
    linkedClanCount: clans.length,
    user: userOption,
    option,
  });
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
  if (!user) {
    return 'No linked player accounts were found. Use `/link create` first, then run `/members user:<you>` again.';
  }
  return `**${escapeMarkdown(user.displayName)}** does not have linked player accounts in this server. Ask them to use \`/link create\`, then run \`/members user:${escapeMarkdown(user.displayName)}\` again.`;
}

async function replyWithMembers(
  interaction: ChatInputCommandInteraction,
  snapshots: MembersClanSnapshots | undefined,
  filters: MembersFilterContext,
): Promise<void> {
  if (!snapshots || snapshots.members.length === 0) {
    await interaction.editReply({ content: formatNoMembersSnapshotMessage(filters) });
    return;
  }
  await interaction.editReply({
    embeds: [buildMembersEmbed(snapshots, filters.option, filters.user, filters.linkedClanCount)],
  });
}

function formatNoMembersSnapshotMessage(filters: MembersFilterContext): string {
  const parts = ['No stored member snapshot rows matched the accepted `/members` filters.'];
  parts.push(`linked clans: ${filters.linkedClanCount}`);
  if (filters.clan) {
    const clanName = filters.clan.alias ?? filters.clan.name ?? filters.clan.clanTag;
    parts.push(`clan: ${escapeMarkdown(clanName)} (${filters.clan.clanTag})`);
  } else {
    parts.push('clan: first linked clan with stored member rows');
  }
  if (filters.user) parts.push(`user: ${escapeMarkdown(filters.user.displayName)}`);
  parts.push(`view: ${formatMembersOptionLabel(filters.option)}`);
  parts.push(
    'Source: persisted clan-poller member snapshots only; `/members` does not perform a live Clash API lookup.',
  );
  if (filters.user) {
    parts.push(
      'User filtering selects the first stored clan containing one of that Discord user’s linked player tags; it does not hide other rows from that clan.',
    );
  }
  parts.push(formatMembersPollingPrerequisite(filters.linkedClanCount));
  return parts.join('\n');
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
  linkedClanCount = 1,
): EmbedBuilder {
  const members = sortMembers(snapshots.members, option).slice(0, MAX_MEMBER_ROWS);
  const clanName = snapshots.clan.alias ?? snapshots.clan.name ?? 'Linked Clan';
  const limitation = formatMembersOptionLimitation(option);
  const latestFetchedAt = getLatestMemberSnapshotTime(snapshots.members);
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
  embed.addFields({
    name: 'Coverage',
    value: [
      `View: ${formatMembersOptionLabel(option)}`,
      `Linked clans in server: ${linkedClanCount}`,
      `Rows considered: ${snapshots.members.length}`,
      `Visible rows: ${members.length}`,
      `Latest snapshot: ${formatLatestMemberSnapshot(latestFetchedAt)}`,
      'Source: persisted clan-poller member snapshots only; no live Clash API lookup.',
      formatMembersUserFilterSummary(user),
    ].join('\n'),
    inline: false,
  });
  if (limitation) {
    embed.addFields({ name: 'Snapshot limitation', value: limitation, inline: false });
  }
  return embed;
}

function formatLatestMemberSnapshot(latestFetchedAt: Date | null): string {
  if (!latestFetchedAt) return 'not available';
  return `${time(latestFetchedAt, 'R')} (${time(latestFetchedAt, 'f')})`;
}

function formatMembersUserFilterSummary(user: User | null): string {
  if (!user) return 'User filter: not applied.';
  return `User filter: selected the first stored clan containing a linked tag for ${escapeMarkdown(user.displayName)}; rows remain clan-wide.`;
}

function formatMembersPollingPrerequisite(linkedClanCount: number): string {
  if (linkedClanCount === 0) {
    return 'Polling prerequisite: link at least one clan with `/setup clan`, then wait for clan polling to create member snapshots.';
  }
  return MEMBERS_NO_SNAPSHOT_MESSAGE;
}

function getLatestMemberSnapshotTime(members: readonly MembersSnapshotRow[]): Date | null {
  const latest = members.reduce<number | null>((value, member) => {
    const fetchedAt = member.lastFetchedAt.getTime();
    return value === null || fetchedAt > value ? fetchedAt : value;
  }, null);
  return latest === null ? null : new Date(latest);
}

function formatMembersOptionLabel(option: MembersOption): string {
  if (option === 'link-list') return 'Discord Links';
  if (option === 'war-pref') return 'War Preferences';
  if (option === 'join-date') return 'Last Joining Date';
  if (option === 'clan') return 'Clan Overview';
  return option
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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
  if (option === 'join-date')
    return rows.sort(
      (a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime() || compareNames(a, b),
    );
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
  if (option === 'join-date') {
    return members
      .map(
        (member, index) =>
          `${index + 1}. ${escapeMarkdown(member.name)} · first seen ${time(member.firstSeenAt, 'R')} · last seen ${time(member.lastSeenAt, 'R')}`,
      )
      .join('\n');
  }
  if (option === 'heroes' || option === 'progress') {
    return members
      .map(
        (member, index) =>
          `${index + 1}. ${escapeMarkdown(member.name)} · XP ${member.expLevel ?? 0} · ${member.trophies ?? 0} trophies · rank ${member.clanRank ?? 'n/a'} · ${time(member.lastFetchedAt, 'R')}`,
      )
      .join('\n');
  }
  if (option === 'link-list') {
    return members
      .map(
        (member, index) =>
          `${index + 1}. ${escapeMarkdown(member.name)} · \`${member.playerTag}\` · Discord link not stored in this clan snapshot`,
      )
      .join('\n');
  }
  if (option === 'war-pref') {
    return members
      .map(
        (member, index) =>
          `${index + 1}. ${escapeMarkdown(member.name)} · ${formatRole(member.role)} · war preference not stored in clan snapshots`,
      )
      .join('\n');
  }
  if (option === 'attacks') {
    return members
      .map(
        (member, index) =>
          `${index + 1}. ${escapeMarkdown(member.name)} · ${member.donations ?? 0}/${member.donationsReceived ?? 0} donated/received · attack/defense totals not stored in clan snapshots`,
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

function formatMembersOptionLimitation(option: MembersOption): string | null {
  if (option === 'heroes') {
    return 'Hero levels and war weight require player-detail data and are not stored in clan-poller member snapshots; showing persisted XP, trophies, rank, and snapshot age instead.';
  }
  if (option === 'link-list') {
    return 'Discord link records are stored separately from member snapshots; this view can show tags from the snapshot, but not linked Discord mentions.';
  }
  if (option === 'war-pref') {
    return 'War preference is not included in persisted clan member snapshots; this view falls back to role context only.';
  }
  if (option === 'join-date') {
    return 'Join date is approximated from the first time this player tag appeared in stored snapshots, not the original in-game join time.';
  }
  if (option === 'progress') {
    return 'Detailed player progress requires player-detail data and is not stored in clan-poller member snapshots; showing persisted XP, trophies, rank, and snapshot age instead.';
  }
  if (option === 'attacks') {
    return 'Attack and defense totals are not stored in clan-poller member snapshots; showing donations as the closest persisted activity fields.';
  }
  if (option === 'clan')
    return 'Clan overview uses the standard persisted member snapshot summary.';
  return null;
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
