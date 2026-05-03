import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
  time,
} from 'discord.js';

export const SUMMARY_COMMAND_NAME = 'summary';
export const SUMMARY_COMMAND_DESCRIPTION = 'Show persisted summaries for linked clans.';

const SUMMARY_ROW_LIMIT = 10;
const EMBED_DESCRIPTION_LIMIT = 4096;

export const summaryCommandData = new SlashCommandBuilder()
  .setName(SUMMARY_COMMAND_NAME)
  .setDescription(SUMMARY_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    addOrderOption(
      addLimitOption(
        addSeasonOption(
          addClansOption(
            subcommand.setName('best').setDescription('Summarize best donation rows.'),
          ),
        ),
      ),
    ),
  )
  .addSubcommand((subcommand) =>
    addClansOption(subcommand.setName('wars').setDescription('Summarize stored war status.')),
  )
  .addSubcommand((subcommand) =>
    addClansOption(subcommand.setName('clans').setDescription('Summarize linked clan snapshots.')),
  )
  .addSubcommand((subcommand) =>
    addClansOption(subcommand.setName('donations').setDescription('Summarize donation snapshots.')),
  )
  .addSubcommand((subcommand) =>
    addClansOption(
      subcommand.setName('activity').setDescription('Summarize member activity snapshots.'),
    ),
  )
  .addSubcommand((subcommand) =>
    addClansOption(
      subcommand.setName('attacks').setDescription('Summarize stored war attack history.'),
    ),
  )
  .addSubcommand((subcommand) =>
    addClansOption(subcommand.setName('compo').setDescription('Summarize town hall composition.')),
  )
  .addSubcommand((subcommand) =>
    addSeasonOption(
      addClansOption(subcommand.setName('cwl-ranks').setDescription('Summarize stored CWL ranks.')),
    ),
  )
  .addSubcommand((subcommand) =>
    addClansOption(subcommand.setName('cwl-status').setDescription('Summarize stored CWL status.')),
  )
  .addSubcommand((subcommand) =>
    addClansOption(subcommand.setName('leagues').setDescription('Summarize linked clan leagues.')),
  )
  .addSubcommand((subcommand) =>
    addLimitOption(
      addClansOption(subcommand.setName('trophies').setDescription('Summarize member trophies.')),
    ),
  )
  .addSubcommand((subcommand) =>
    addSeasonOption(
      addClansOption(subcommand.setName('war-results').setDescription('Summarize war results.')),
    ),
  )
  .addSubcommand((subcommand) =>
    addSeasonOption(
      addWarTypeOption(
        addClansOption(subcommand.setName('missed-wars').setDescription('Summarize missed wars.')),
      ),
    ),
  )
  .addSubcommand((subcommand) =>
    addWeekOption(
      addClansOption(
        subcommand.setName('capital-raids').setDescription('Summarize capital raids.'),
      ),
    ),
  )
  .addSubcommand((subcommand) =>
    addWeekOption(
      addSeasonOption(
        addClansOption(
          subcommand
            .setName('capital-contribution')
            .setDescription('Summarize capital contribution.'),
        ),
      ),
    ),
  )
  .addSubcommand((subcommand) =>
    addSeasonOption(
      addClansOption(subcommand.setName('clan-games').setDescription('Summarize clan games.')),
    ),
  );

function addClansOption(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder.addStringOption((option) =>
    option
      .setName('clans')
      .setDescription('Linked clan tag, name, or alias.')
      .setAutocomplete(true)
      .setRequired(false),
  );
}

function addSeasonOption(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder.addStringOption((option) =>
    option.setName('season').setDescription('Season identifier.').setRequired(false),
  );
}

function addLimitOption(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder.addIntegerOption((option) =>
    option
      .setName('limit')
      .setDescription('Number of rows to show.')
      .setMinValue(3)
      .setMaxValue(10)
      .setRequired(false),
  );
}

function addOrderOption(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder.addStringOption((option) =>
    option
      .setName('order')
      .setDescription('Sort order.')
      .addChoices({ name: 'Descending', value: 'desc' }, { name: 'Ascending', value: 'asc' })
      .setRequired(false),
  );
}

function addWarTypeOption(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder.addStringOption((option) =>
    option
      .setName('war_type')
      .setDescription('Regular, CWL or Friendly Wars (defaults to Regular)')
      .addChoices(
        { name: 'Regular', value: 'regular' },
        { name: 'CWL', value: 'cwl' },
        { name: 'Friendly', value: 'friendly' },
        { name: 'Regular and CWL', value: 'regular-and-cwl' },
      )
      .setRequired(false),
  );
}

function addWeekOption(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder.addStringOption((option) =>
    option.setName('week').setDescription('Raid weekend identifier.').setRequired(false),
  );
}

export interface SummaryLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface SummaryClanListRow extends SummaryLinkedClan {
  readonly categoryId: string | null;
  readonly sortOrder: number;
  readonly snapshot?: unknown;
}

export interface SummaryMemberSnapshotRow {
  readonly playerTag: string;
  readonly name: string;
  readonly donations?: number | null;
  readonly donationsReceived?: number | null;
  readonly trophies?: number | null;
  readonly lastSeenAt?: Date;
  readonly lastFetchedAt?: Date;
}

export interface SummaryClanMemberSnapshots {
  readonly clan: SummaryLinkedClan;
  readonly members: readonly SummaryMemberSnapshotRow[];
}

export interface SummaryWarAttackHistoryRow {
  readonly attackerTag: string;
  readonly attackerName: string | null;
  readonly attackCount: number;
  readonly totalStars: number;
  readonly averageStars: number;
  readonly totalDestruction: number;
  readonly averageDestruction: number;
  readonly freshAttackCount: number;
  readonly lastAttackedAt: Date;
}

export interface SummaryStore {
  readonly listLinkedClans: (guildId: string) => Promise<SummaryLinkedClan[]>;
  readonly listClansForGuild: (guildId: string) => Promise<SummaryClanListRow[]>;
  readonly listDonationSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<SummaryClanMemberSnapshots[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<SummaryClanMemberSnapshots[]>;
  readonly listWarAttackHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
  }) => Promise<SummaryWarAttackHistoryRow[]>;
}

export interface SummaryCommandOptions {
  readonly store: SummaryStore;
}

export function createSummarySlashCommand(options: SummaryCommandOptions): SlashCommandDefinition {
  return {
    name: SUMMARY_COMMAND_NAME,
    data: summaryCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== SUMMARY_COMMAND_NAME) return;
      await executeSummary(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== SUMMARY_COMMAND_NAME) return;
      await autocompleteSummary(interaction, options);
    },
  };
}

async function autocompleteSummary(
  interaction: AutocompleteInteraction,
  options: SummaryCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'clans') {
    await interaction.respond([]);
    return;
  }
  try {
    const clans = await options.store.listLinkedClans(interaction.guildId);
    await interaction.respond(filterSummaryClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterSummaryClanChoices(
  clans: readonly SummaryLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export async function executeSummary(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: SummaryCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/summary` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const subcommand = interaction.options.getSubcommand();
  const clans = await options.store.listLinkedClans(interaction.guildId);
  const clanOption = interaction.options.getString('clans');
  const clan = clanOption ? resolveSummaryClan(clans, clanOption) : undefined;
  if (clanOption && !clan) {
    await interaction.editReply({ content: 'No linked clan was found for that clans option.' });
    return;
  }

  const clanTag = clan?.clanTag;
  if (subcommand === 'best') {
    const snapshots = await options.store.listDonationSnapshotsForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTag } : {}),
    });
    const limit = interaction.options.getInteger('limit') ?? SUMMARY_ROW_LIMIT;
    const order = interaction.options.getString('order') === 'asc' ? 'asc' : 'desc';
    await interaction.editReply(buildSummaryBestPayload(snapshots, limit, order));
    return;
  }
  if (subcommand === 'clans') {
    const rows = await options.store.listClansForGuild(interaction.guildId);
    await interaction.editReply(
      buildSummaryClansPayload(clanTag ? rows.filter((row) => row.clanTag === clanTag) : rows),
    );
    return;
  }
  if (subcommand === 'donations') {
    const snapshots = await options.store.listDonationSnapshotsForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTag } : {}),
    });
    await interaction.editReply(buildSummaryDonationsPayload(snapshots));
    return;
  }
  if (subcommand === 'activity') {
    const snapshots = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTag } : {}),
    });
    await interaction.editReply(buildSummaryActivityPayload(snapshots));
    return;
  }
  if (subcommand === 'attacks') {
    const rows = await options.store.listWarAttackHistoryForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTags: [clanTag] } : {}),
    });
    await interaction.editReply(buildSummaryAttacksPayload(rows));
    return;
  }
  if (subcommand === 'compo') {
    const rows = await options.store.listClansForGuild(interaction.guildId);
    await interaction.editReply(
      buildSummaryCompoPayload(clanTag ? rows.filter((row) => row.clanTag === clanTag) : rows),
    );
    return;
  }
  if (subcommand === 'trophies') {
    const snapshots = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
      ...(clanTag ? { clanTag } : {}),
    });
    await interaction.editReply(
      buildSummaryTrophiesPayload(
        snapshots,
        interaction.options.getInteger('limit') ?? SUMMARY_ROW_LIMIT,
      ),
    );
    return;
  }
  if (subcommand === 'leagues') {
    const rows = await options.store.listClansForGuild(interaction.guildId);
    await interaction.editReply(
      buildSummaryLeaguesPayload(clanTag ? rows.filter((row) => row.clanTag === clanTag) : rows),
    );
    return;
  }

  await interaction.editReply({ content: unavailableSummaryMessage(subcommand) });
}

export function buildSummaryClansPayload(clans: readonly SummaryClanListRow[]): {
  content?: string;
  embeds?: EmbedBuilder[];
} {
  if (clans.length === 0)
    return {
      content: 'No linked clan data is available. Use `/setup clan` and wait for clan polling.',
    };
  const totalMembers = clans.reduce(
    (sum, clan) => sum + (readNumber(clan.snapshot, 'members') ?? 0),
    0,
  );
  const description = clans
    .slice(0, SUMMARY_ROW_LIMIT)
    .map(
      (clan, index) =>
        `${index + 1}. **${escapeMarkdown(clan.alias ?? clan.name ?? clan.clanTag)}** (\`${clan.clanTag}\`) · ${readNumber(clan.snapshot, 'members') ?? '?'} members · level ${readNumber(clan.snapshot, 'clanLevel') ?? '?'}`,
    )
    .join('\n');
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Clan Summary')
        .setDescription(truncate(description))
        .addFields({
          name: 'Totals',
          value: `${clans.length} linked clans · ${totalMembers} observed members`,
          inline: false,
        }),
    ],
  };
}

export function buildSummaryBestPayload(
  snapshots: readonly SummaryClanMemberSnapshots[],
  limit: number,
  order: 'asc' | 'desc',
): { content?: string; embeds?: EmbedBuilder[] } {
  const members = snapshots.flatMap((snapshot) =>
    snapshot.members.map((member) => ({ ...member, clan: snapshot.clan })),
  );
  if (members.length === 0)
    return {
      content:
        'No donation snapshot is available yet. Link/configure a clan and wait for clan polling to observe donations.',
    };
  const direction = order === 'asc' ? -1 : 1;
  const sorted = [...members].sort(
    (a, b) =>
      direction *
      ((b.donations ?? 0) - (a.donations ?? 0) ||
        (b.donationsReceived ?? 0) - (a.donationsReceived ?? 0)),
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(order === 'asc' ? 'Lowest Donation Summary' : 'Best Donation Summary')
        .setDescription(truncate(formatDonationRows(sorted, clampSummaryLimit(limit))))
        .setFooter({
          text: `Showing ${Math.min(sorted.length, clampSummaryLimit(limit))}/${sorted.length} members`,
        }),
    ],
  };
}

export function buildSummaryDonationsPayload(snapshots: readonly SummaryClanMemberSnapshots[]): {
  content?: string;
  embeds?: EmbedBuilder[];
} {
  const members = snapshots.flatMap((snapshot) =>
    snapshot.members.map((member) => ({ ...member, clan: snapshot.clan })),
  );
  if (members.length === 0)
    return {
      content:
        'No donation snapshot is available yet. Link/configure a clan and wait for clan polling to observe donations.',
    };
  const sorted = [...members].sort(
    (a, b) =>
      (b.donations ?? 0) - (a.donations ?? 0) ||
      (b.donationsReceived ?? 0) - (a.donationsReceived ?? 0),
  );
  const donated = members.reduce((sum, member) => sum + (member.donations ?? 0), 0);
  const received = members.reduce((sum, member) => sum + (member.donationsReceived ?? 0), 0);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Donation Summary')
        .setDescription(truncate(formatDonationRows(sorted, SUMMARY_ROW_LIMIT)))
        .addFields({
          name: 'Totals',
          value: `${donated} donated · ${received} received · ${members.length} members`,
          inline: false,
        }),
    ],
  };
}

export function buildSummaryActivityPayload(snapshots: readonly SummaryClanMemberSnapshots[]): {
  content?: string;
  embeds?: EmbedBuilder[];
} {
  const members = snapshots.flatMap((snapshot) =>
    snapshot.members.map((member) => ({ ...member, clan: snapshot.clan })),
  );
  if (members.length === 0)
    return {
      content:
        'No activity snapshot is available yet. Link/configure a clan and wait for clan polling to observe members.',
    };
  const sorted = [...members].sort(
    (a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0),
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Activity Summary')
        .setDescription(truncate(formatActivityRows(sorted)))
        .addFields({
          name: 'Totals',
          value: `${members.length} observed members across ${snapshots.length} clans`,
          inline: false,
        }),
    ],
  };
}

export function buildSummaryAttacksPayload(rows: readonly SummaryWarAttackHistoryRow[]): {
  content?: string;
  embeds?: EmbedBuilder[];
} {
  if (rows.length === 0)
    return {
      content:
        'No war attack history is available yet. Link/configure a clan and wait for war attacks to be detected.',
    };
  const sorted = [...rows].sort(
    (a, b) => b.attackCount - a.attackCount || b.averageStars - a.averageStars,
  );
  const totals = rows.reduce(
    (acc, row) => ({
      attacks: acc.attacks + row.attackCount,
      stars: acc.stars + row.totalStars,
      fresh: acc.fresh + row.freshAttackCount,
    }),
    { attacks: 0, stars: 0, fresh: 0 },
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('War Attack Summary')
        .setDescription(truncate(formatAttackRows(sorted)))
        .addFields({
          name: 'Totals',
          value: `${totals.attacks} attacks · ${totals.stars} stars · ${totals.fresh} fresh hits · ${rows.length} attackers`,
          inline: false,
        }),
    ],
  };
}

export function buildSummaryTrophiesPayload(
  snapshots: readonly SummaryClanMemberSnapshots[],
  limit: number,
): { content?: string; embeds?: EmbedBuilder[] } {
  const rows = snapshots
    .flatMap((snapshot) => snapshot.members.map((member) => ({ member, clan: snapshot.clan })))
    .filter((row) => row.member.trophies !== null && row.member.trophies !== undefined)
    .sort(
      (a, b) =>
        (b.member.trophies ?? -1) - (a.member.trophies ?? -1) ||
        a.member.name.localeCompare(b.member.name),
    );
  if (rows.length === 0)
    return {
      content:
        'No current member snapshot trophies are available yet. Link/configure a clan and wait for clan polling to observe members.',
    };
  const rowLimit = clampSummaryLimit(limit);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Trophy Summary')
        .setDescription(
          truncate(
            rows
              .slice(0, rowLimit)
              .map(
                (row, index) =>
                  `${index + 1}. **${escapeMarkdown(row.member.name)}** · ${row.member.trophies?.toLocaleString()} trophies · ${escapeMarkdown(row.clan.alias ?? row.clan.name ?? row.clan.clanTag)}`,
              )
              .join('\n'),
          ),
        )
        .setFooter({ text: `Showing ${Math.min(rows.length, rowLimit)}/${rows.length} members` }),
    ],
  };
}

export function buildSummaryLeaguesPayload(clans: readonly SummaryClanListRow[]): {
  content?: string;
  embeds?: EmbedBuilder[];
} {
  const rows = clans
    .map((clan) => ({
      clan,
      clanLeague: readNestedString(clan.snapshot, ['league', 'name']),
      warLeague: readNestedString(clan.snapshot, ['warLeague', 'name']),
      capitalLeague: readNestedString(clan.snapshot, ['capitalLeague', 'name']),
    }))
    .filter(
      (row) => row.clanLeague !== null || row.warLeague !== null || row.capitalLeague !== null,
    );
  if (rows.length === 0)
    return {
      content:
        'No league data is available in persisted clan snapshots yet. Link/configure a clan and wait for clan polling.',
    };
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('League Summary')
        .setDescription(
          truncate(
            rows
              .slice(0, SUMMARY_ROW_LIMIT)
              .map(
                (row, index) =>
                  `${index + 1}. **${escapeMarkdown(row.clan.alias ?? row.clan.name ?? row.clan.clanTag)}** · Clan ${escapeMarkdown(row.clanLeague ?? 'Unknown')} · War ${escapeMarkdown(row.warLeague ?? 'Unknown')} · Capital ${escapeMarkdown(row.capitalLeague ?? 'Unknown')}`,
              )
              .join('\n'),
          ),
        )
        .setFooter({
          text: `Showing ${Math.min(rows.length, SUMMARY_ROW_LIMIT)}/${rows.length} clans`,
        }),
    ],
  };
}

export function buildSummaryCompoPayload(clans: readonly SummaryClanListRow[]): {
  content?: string;
  embeds?: EmbedBuilder[];
} {
  if (clans.length === 0)
    return {
      content: 'No linked clan data is available. Use `/setup clan` and wait for clan polling.',
    };
  const rows = collectComposition(clans);
  if (rows.length === 0)
    return {
      content:
        'No town hall composition is available in persisted clan snapshots yet. Wait for clan polling to store member town hall levels.',
    };
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const average = rows.reduce((sum, row) => sum + row.townHallLevel * row.count, 0) / total;
  const description = rows.map((row) => `TH${row.townHallLevel}: **${row.count}**`).join('\n');
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Town Hall Composition Summary')
        .setDescription(description)
        .addFields({
          name: 'Totals',
          value: `${total} members · ${average.toFixed(2)} average TH`,
          inline: false,
        }),
    ],
  };
}

function formatDonationRows(
  rows: readonly (SummaryMemberSnapshotRow & { clan: SummaryLinkedClan })[],
  limit: number,
): string {
  return rows
    .slice(0, limit)
    .map(
      (row, index) =>
        `${index + 1}. **${escapeMarkdown(row.name)}** · ${row.donations ?? 0} donated · ${row.donationsReceived ?? 0} received · ${escapeMarkdown(row.clan.alias ?? row.clan.name ?? row.clan.clanTag)}`,
    )
    .join('\n');
}

function formatActivityRows(
  rows: readonly (SummaryMemberSnapshotRow & { clan: SummaryLinkedClan })[],
): string {
  return rows
    .slice(0, SUMMARY_ROW_LIMIT)
    .map(
      (row, index) =>
        `${index + 1}. **${escapeMarkdown(row.name)}** · ${row.lastSeenAt ? time(row.lastSeenAt, 'R') : 'unknown'} · ${escapeMarkdown(row.clan.alias ?? row.clan.name ?? row.clan.clanTag)}`,
    )
    .join('\n');
}

function formatAttackRows(rows: readonly SummaryWarAttackHistoryRow[]): string {
  return rows
    .slice(0, SUMMARY_ROW_LIMIT)
    .map(
      (row, index) =>
        `${index + 1}. **${escapeMarkdown(row.attackerName ?? row.attackerTag)}** · ${row.attackCount} attacks · ${row.averageStars.toFixed(2)} avg ⭐ · ${row.averageDestruction.toFixed(2)}% avg`,
    )
    .join('\n');
}

function collectComposition(
  clans: readonly SummaryClanListRow[],
): Array<{ townHallLevel: number; count: number }> {
  const counts = new Map<number, number>();
  for (const clan of clans) {
    const memberList = readArray(clan.snapshot, 'memberList');
    for (const member of memberList) {
      const townHallLevel = readNumber(member, 'townHallLevel');
      if (typeof townHallLevel !== 'number' || !Number.isInteger(townHallLevel)) continue;
      counts.set(townHallLevel, (counts.get(townHallLevel) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([townHallLevel, count]) => ({ townHallLevel, count }))
    .sort((a, b) => b.townHallLevel - a.townHallLevel);
}

export function resolveSummaryClan(
  clans: readonly SummaryLinkedClan[],
  query: string,
): SummaryLinkedClan | undefined {
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

function clanMatchesQuery(clan: SummaryLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: SummaryLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[key];
  return typeof candidate === 'number' ? candidate : undefined;
}

function readArray(value: unknown, key: string): readonly unknown[] {
  if (!isRecord(value)) return [];
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : [];
}

function readNestedString(value: unknown, path: readonly string[]): string | null {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === 'string' && current.trim() ? current : null;
}

function clampSummaryLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 3), SUMMARY_ROW_LIMIT);
}

function unavailableSummaryMessage(subcommand: string): string {
  return `Stored data for \`/summary ${subcommand}\` is not available yet. This command only uses persisted ClashMate snapshots and will not call the Clash API or invent historical data.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function truncate(text: string): string {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…`;
}
