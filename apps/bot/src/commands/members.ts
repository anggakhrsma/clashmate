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
  readonly linkedClanLabels?: readonly string[];
  readonly linkedClanCount: number;
  readonly linkedClanWithRowsCount: number;
  readonly latestSnapshotAt: Date | null;
  readonly storedMemberRowCount: number;
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
      linkedClanLabels: [formatLinkedClanDiagnosticLabel(clan)],
      linkedClanCount: clans.length,
      linkedClanWithRowsCount: snapshots && snapshots.members.length > 0 ? 1 : 0,
      latestSnapshotAt: getLatestSnapshotTimeForSnapshot(snapshots),
      storedMemberRowCount: snapshots?.members.length ?? 0,
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
    await interaction.editReply({
      content: formatNoLinkedMembersMessage(userOption, {
        linkedClanCount: clans.length,
        linkedClanWithRowsCount: countClansWithStoredMemberRows(snapshots),
        linkedClanLabels: formatLinkedClanDiagnosticLabels(clans),
        latestSnapshotAt: getLatestSnapshotTimeForSnapshots(snapshots),
        storedMemberRowCount: countStoredMemberRows(snapshots),
        user: userOption,
        option,
      }),
    });
    return;
  }

  await replyWithMembers(interaction, selected, {
    linkedClanCount: clans.length,
    linkedClanWithRowsCount: countClansWithStoredMemberRows(snapshots),
    linkedClanLabels: formatLinkedClanDiagnosticLabels(clans),
    latestSnapshotAt: getLatestSnapshotTimeForSnapshots(snapshots),
    storedMemberRowCount: countStoredMemberRows(snapshots),
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

function formatNoLinkedMembersMessage(user: User | null, filters: MembersFilterContext): string {
  const parts = user
    ? [
        `**${escapeMarkdown(user.displayName)}** does not have linked player accounts in this server.`,
        'Ask them to use `/link create`, then run `/members user:<user>` again.',
      ]
    : [
        'No linked player accounts were found.',
        'Use `/link create` first, then run `/members user:<you>` again.',
      ];
  parts.push(formatMembersCoverageContext(filters));
  parts.push(
    'Source: persisted clan-poller member snapshots only; `/members` does not perform live Clash API lookups or enroll search-only clans for polling.',
  );
  return parts.join('\n');
}

function formatMembersCoverageContext(filters: MembersFilterContext): string {
  const parts = [
    `linked clans: ${filters.linkedClanCount}`,
    `with snapshots: ${filters.linkedClanWithRowsCount}`,
    `considered: ${formatLinkedClanDiagnosticList(filters.linkedClanLabels)}`,
    `stored member rows: ${filters.storedMemberRowCount}`,
    `latest snapshot: ${formatLatestMemberSnapshot(filters.latestSnapshotAt)}`,
    `view: ${formatMembersOptionLabel(filters.option)}`,
  ];
  if (filters.clan) {
    const clanName = filters.clan.alias ?? filters.clan.name ?? filters.clan.clanTag;
    parts.push(`clan filter: ${escapeMarkdown(clanName)} (${filters.clan.clanTag})`);
  } else {
    parts.push('clan filter: first linked clan with stored rows');
  }
  if (!filters.user) {
    parts.push('user filter: not applied');
  } else {
    parts.push(`user filter: ${escapeMarkdown(filters.user.displayName)}`);
  }
  return parts.join(' · ');
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
    embeds: [buildMembersEmbed(snapshots, filters.option, filters.user, filters)],
  });
}

function formatNoMembersSnapshotMessage(filters: MembersFilterContext): string {
  const parts = ['No stored member snapshot rows matched the accepted `/members` filters.'];
  parts.push(formatMembersCoverageContext(filters));
  parts.push(
    'Source: persisted clan-poller member snapshots only; `/members` does not perform live Clash API lookups or enroll search-only clans for polling.',
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
  coverage?: MembersFilterContext,
): EmbedBuilder {
  const members = sortMembers(snapshots.members, option).slice(0, MAX_MEMBER_ROWS);
  const clanName = snapshots.clan.alias ?? snapshots.clan.name ?? 'Linked Clan';
  const limitation = formatMembersOptionLimitation(option);
  const latestFetchedAt = getLatestMemberSnapshotTime(snapshots.members);
  const coverageContext =
    coverage ??
    ({
      clan: snapshots.clan,
      linkedClanLabels: [formatLinkedClanDiagnosticLabel(snapshots.clan)],
      linkedClanCount: 1,
      linkedClanWithRowsCount: snapshots.members.length > 0 ? 1 : 0,
      latestSnapshotAt: latestFetchedAt,
      storedMemberRowCount: snapshots.members.length,
      user,
      option,
    } satisfies MembersFilterContext);
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
      `Linked clan coverage: ${coverageContext.linkedClanWithRowsCount}/${coverageContext.linkedClanCount} have stored member rows`,
      `Clan set: ${formatLinkedClanDiagnosticList(coverageContext.linkedClanLabels)}`,
      `Stored member rows considered: ${coverageContext.storedMemberRowCount}`,
      `Rows shown: ${members.length}/${snapshots.members.length} selected (limit ${MAX_MEMBER_ROWS})`,
      `Option coverage: ${formatMembersOptionCoverage(option, snapshots.members)}`,
      `Snapshot freshness: ${formatMemberSnapshotFreshness(coverageContext.latestSnapshotAt)}`,
      formatMembersClanFilterSummary(coverageContext.clan),
      formatMembersUserFilterSummary(user),
      'Source: persisted clan-poller member snapshots only; no live Clash API lookup.',
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

function formatLinkedClanDiagnosticLabels(clans: readonly MembersLinkedClan[]): readonly string[] {
  return clans.map((clan) => formatLinkedClanDiagnosticLabel(clan));
}

function formatLinkedClanDiagnosticLabel(clan: MembersLinkedClan): string {
  const label = clan.alias ?? clan.name ?? clan.clanTag;
  return `${escapeMarkdown(label)} (${clan.clanTag})`;
}

function formatLinkedClanDiagnosticList(labels: readonly string[] | undefined): string {
  if (!labels || labels.length === 0) return 'none';
  const shown = labels.slice(0, 3);
  const suffix = labels.length > shown.length ? ` +${labels.length - shown.length} more` : '';
  return `${shown.join(', ')}${suffix}`;
}

function formatMembersUserFilterSummary(user: User | null): string {
  if (!user) return 'User filter: not applied.';
  return `User filter: selected the first stored clan containing a linked tag for ${escapeMarkdown(user.displayName)}; rows remain clan-wide.`;
}

function formatMembersClanFilterSummary(clan: MembersLinkedClan | undefined): string {
  if (!clan) return 'Clan filter: first linked clan with stored rows.';
  const clanName = clan.alias ?? clan.name ?? clan.clanTag;
  return `Clan filter: ${escapeMarkdown(clanName)} (${clan.clanTag}).`;
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

function getLatestSnapshotTimeForSnapshot(snapshot: MembersClanSnapshots | undefined): Date | null {
  return snapshot ? getLatestMemberSnapshotTime(snapshot.members) : null;
}

function getLatestSnapshotTimeForSnapshots(
  snapshots: readonly MembersClanSnapshots[],
): Date | null {
  const latest = snapshots.reduce<number | null>((value, snapshot) => {
    const snapshotTime = getLatestMemberSnapshotTime(snapshot.members)?.getTime() ?? null;
    if (snapshotTime === null) return value;
    return value === null || snapshotTime > value ? snapshotTime : value;
  }, null);
  return latest === null ? null : new Date(latest);
}

function countStoredMemberRows(snapshots: readonly MembersClanSnapshots[]): number {
  return snapshots.reduce((total, snapshot) => total + snapshot.members.length, 0);
}

function countClansWithStoredMemberRows(snapshots: readonly MembersClanSnapshots[]): number {
  return snapshots.filter((snapshot) => snapshot.members.length > 0).length;
}

function formatMemberSnapshotFreshness(latestFetchedAt: Date | null): string {
  if (!latestFetchedAt) return 'not available';
  const ageMs = Date.now() - latestFetchedAt.getTime();
  const ageHours = Math.max(0, Math.floor(ageMs / 3_600_000));
  const status = ageHours < 6 ? 'fresh' : ageHours < 24 ? 'aging' : 'stale';
  return `${formatLatestMemberSnapshot(latestFetchedAt)} · ${status} persisted data`;
}

function formatMembersOptionCoverage(
  option: MembersOption,
  members: readonly MembersSnapshotRow[],
): string {
  const total = members.length;
  if (total === 0) return 'no selected rows';

  if (option === 'donations' || option === 'attacks') {
    const donationRows = countRowsWithAnyValue(members, ['donations', 'donationsReceived']);
    const suffix =
      option === 'attacks' ? '; attack/defense totals are not persisted in member snapshots' : '';
    return `${donationRows}/${total} rows include donation counters${suffix}`;
  }
  if (option === 'trophies') {
    return `${countRowsWithAnyValue(members, ['trophies'])}/${total} rows include trophies`;
  }
  if (option === 'heroes' || option === 'progress') {
    return `${countRowsWithAnyValue(members, ['expLevel', 'trophies', 'clanRank'])}/${total} rows include persisted progress fields; hero details are not in clan snapshots`;
  }
  if (option === 'join-date') {
    return `${total}/${total} rows include first/last observed timestamps`;
  }
  if (option === 'link-list') {
    return `${total}/${total} rows include player tags; Discord link mentions are read from linked-player data only when selecting a user`;
  }
  if (option === 'war-pref') {
    const roleRows = members.filter((member) => member.role !== null).length;
    return `${roleRows}/${total} rows include clan roles; war preference is not persisted in member snapshots`;
  }
  return `${total}/${total} rows include persisted member identity fields`;
}

type NullableNumberMemberKey = {
  [Key in keyof MembersSnapshotRow]: MembersSnapshotRow[Key] extends number | null ? Key : never;
}[keyof MembersSnapshotRow];

function countRowsWithAnyValue(
  members: readonly MembersSnapshotRow[],
  keys: readonly NullableNumberMemberKey[],
): number {
  return members.filter((member) => keys.some((key) => member[key] !== null)).length;
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
