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

export const DONATIONS_COMMAND_NAME = 'donations';
export const DONATIONS_COMMAND_DESCRIPTION = 'Show donation totals from tracked clan snapshots.';
export const DONATIONS_NO_SNAPSHOT_MESSAGE =
  'No donation snapshot is available yet. Link/configure a clan and wait for clan polling to observe donations.';

const DONATION_SORTS = ['donated', 'received', 'difference', 'ratio'] as const;
export type DonationSort = (typeof DONATION_SORTS)[number];
const MAX_DONATION_ROWS = 25;
const EMBED_DESCRIPTION_LIMIT = 4096;

export const donationsCommandData = new SlashCommandBuilder()
  .setName(DONATIONS_COMMAND_NAME)
  .setDescription(DONATIONS_COMMAND_DESCRIPTION)
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
      .setDescription('Discord user whose linked players should be matched.')
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('sort')
      .setDescription('Donation leaderboard sort.')
      .setRequired(false)
      .addChoices(
        { name: 'Donated', value: 'donated' },
        { name: 'Received', value: 'received' },
        { name: 'Difference', value: 'difference' },
        { name: 'Ratio', value: 'ratio' },
      ),
  );

export interface DonationsLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface DonationSnapshotRow {
  readonly playerTag: string;
  readonly name: string;
  readonly donations: number | null;
  readonly donationsReceived: number | null;
  readonly lastFetchedAt: Date;
}

export interface DonationsClanSnapshots {
  readonly clan: DonationsLinkedClan;
  readonly members: readonly DonationSnapshotRow[];
}

export interface DonationsStore {
  readonly listLinkedClans: (guildId: string) => Promise<DonationsLinkedClan[]>;
  readonly listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
  readonly listDonationSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<DonationsClanSnapshots[]>;
}

export interface DonationsCommandOptions {
  readonly store: DonationsStore;
}

export function createDonationsSlashCommand(
  options: DonationsCommandOptions,
): SlashCommandDefinition {
  return {
    name: DONATIONS_COMMAND_NAME,
    data: donationsCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== DONATIONS_COMMAND_NAME) return;
      await executeDonations(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== DONATIONS_COMMAND_NAME) return;
      await autocompleteDonations(interaction, options);
    },
  };
}

async function autocompleteDonations(
  interaction: AutocompleteInteraction,
  options: DonationsCommandOptions,
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
    await interaction.respond(filterDonationClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterDonationClanChoices(
  clans: readonly DonationsLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export async function executeDonations(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: DonationsCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/donations` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const clanOption = interaction.options.getString('clan');
  const userOption = interaction.options.getUser('user');
  const sort = parseDonationSort(interaction.options.getString('sort'));
  const clans = await options.store.listLinkedClans(interaction.guildId);

  if (clanOption) {
    const clan = resolveDonationClan(clans, clanOption);
    if (!clan) {
      await interaction.editReply({ content: 'No linked clan was found for that clan option.' });
      return;
    }
    const [snapshots] = await options.store.listDonationSnapshotsForGuild({
      guildId: interaction.guildId,
      clanTag: clan.clanTag,
    });
    await replyWithDonations(interaction, snapshots, sort, userOption);
    return;
  }

  const snapshots = await options.store.listDonationSnapshotsForGuild({
    guildId: interaction.guildId,
  });
  const selected = userOption
    ? await selectClanForUser(interaction.guildId, userOption, snapshots, options.store)
    : snapshots.find((entry) => entry.members.length > 0);

  if (selected === 'no_link') {
    await interaction.editReply({ content: formatNoLinkedPlayersMessage(userOption) });
    return;
  }

  await replyWithDonations(interaction, selected, sort, userOption);
}

function parseDonationSort(value: string | null): DonationSort {
  return DONATION_SORTS.includes(value as DonationSort) ? (value as DonationSort) : 'donated';
}

async function selectClanForUser(
  guildId: string,
  user: User,
  snapshots: readonly DonationsClanSnapshots[],
  store: Pick<DonationsStore, 'listPlayerTagsForUser'>,
): Promise<DonationsClanSnapshots | 'no_link' | undefined> {
  const tags = new Set(
    (await store.listPlayerTagsForUser(guildId, user.id)).map((tag) => tag.toUpperCase()),
  );
  if (tags.size === 0) return 'no_link';
  return snapshots.find((entry) =>
    entry.members.some((member) => tags.has(member.playerTag.toUpperCase())),
  );
}

function formatNoLinkedPlayersMessage(user: User | null): string {
  if (!user) return 'No linked player accounts were found. Use `/link create` first.';
  return `**${escapeMarkdown(user.displayName)}** does not have linked player accounts. Use \`/link create\` first.`;
}

async function replyWithDonations(
  interaction: ChatInputCommandInteraction,
  snapshots: DonationsClanSnapshots | undefined,
  sort: DonationSort,
  user: User | null,
): Promise<void> {
  if (!snapshots || snapshots.members.length === 0) {
    await interaction.editReply({ content: DONATIONS_NO_SNAPSHOT_MESSAGE });
    return;
  }
  await interaction.editReply({ embeds: [buildDonationsEmbed(snapshots, sort, user)] });
}

export function resolveDonationClan(
  clans: readonly DonationsLinkedClan[],
  query: string,
): DonationsLinkedClan | undefined {
  const normalizedQuery = query.trim().toLowerCase();
  let normalizedTag: string | undefined;
  try {
    normalizedTag = normalizeClashTag(query).toLowerCase();
  } catch {
    normalizedTag = undefined;
  }
  return clans.find(
    (clan) =>
      clan.clanTag.toLowerCase() === normalizedTag ||
      clan.clanTag.replace(/^#/, '').toLowerCase() === normalizedQuery.replace(/^#/, '') ||
      clan.alias?.trim().toLowerCase() === normalizedQuery ||
      clan.name?.trim().toLowerCase() === normalizedQuery,
  );
}

export function buildDonationsEmbed(
  snapshots: DonationsClanSnapshots,
  sort: DonationSort,
  user: User | null,
): EmbedBuilder {
  const rows = sortDonationRows(snapshots.members, sort).slice(0, MAX_DONATION_ROWS);
  const clanName = snapshots.clan.alias ?? snapshots.clan.name ?? 'Linked Clan';
  const totals = computeDonationTotals(snapshots.members);
  const embed = new EmbedBuilder()
    .setTitle(`${clanName} Donations`)
    .setDescription(truncateEmbedDescription(formatDonationRows(rows)))
    .addFields(
      {
        name: 'Clan',
        value: `${escapeMarkdown(clanName)} (${snapshots.clan.clanTag})`,
        inline: false,
      },
      {
        name: 'Totals',
        value: `${totals.donated} donated · ${totals.received} received · ${formatDifference(totals.difference)} difference`,
        inline: false,
      },
      {
        name: 'Snapshot source',
        value: 'Values are based on latest polling snapshots, not live Clash API calls.',
        inline: false,
      },
    )
    .setFooter({ text: `Sorted by ${sort}; showing ${rows.length}/${snapshots.members.length}` });

  if (user) embed.setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() });
  return embed;
}

function sortDonationRows(
  members: readonly DonationSnapshotRow[],
  sort: DonationSort,
): DonationSnapshotRow[] {
  const rows = [...members];
  return rows.sort(
    (a, b) => donationSortValue(b, sort) - donationSortValue(a, sort) || compareNames(a, b),
  );
}

function donationSortValue(member: DonationSnapshotRow, sort: DonationSort): number {
  const donated = member.donations ?? 0;
  const received = member.donationsReceived ?? 0;
  if (sort === 'received') return received;
  if (sort === 'difference') return donated - received;
  if (sort === 'ratio') return received === 0 ? 0 : donated / received;
  return donated;
}

function formatDonationRows(members: readonly DonationSnapshotRow[]): string {
  return members
    .map((member, index) => {
      const donated = member.donations ?? 0;
      const received = member.donationsReceived ?? 0;
      const difference = donated - received;
      const ratio = received === 0 ? '0.00' : (donated / received).toFixed(2);
      return `${index + 1}. **${escapeMarkdown(member.name)}** (\`${member.playerTag}\`) · ${donated} donated · ${received} received · ${formatDifference(difference)} diff · ${ratio} ratio · ${time(member.lastFetchedAt, 'R')}`;
    })
    .join('\n');
}

function computeDonationTotals(members: readonly DonationSnapshotRow[]): {
  donated: number;
  received: number;
  difference: number;
} {
  const totals = members.reduce(
    (acc, member) => ({
      donated: acc.donated + (member.donations ?? 0),
      received: acc.received + (member.donationsReceived ?? 0),
    }),
    { donated: 0, received: 0 },
  );
  return { ...totals, difference: totals.donated - totals.received };
}

function formatDifference(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function clanMatchesQuery(clan: DonationsLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: DonationsLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function truncateEmbedDescription(text: string): string {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…`;
}

function compareNames(left: DonationSnapshotRow, right: DonationSnapshotRow): number {
  return left.name.localeCompare(right.name) || left.playerTag.localeCompare(right.playerTag);
}
