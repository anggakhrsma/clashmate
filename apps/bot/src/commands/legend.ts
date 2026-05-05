import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
} from 'discord.js';

export const LEGEND_COMMAND_NAME = 'legend';
export const LEGEND_COMMAND_DESCRIPTION = 'Show persisted Legend League views for linked clans.';

const LEGEND_TROPHY_FLOOR = 5000;
const NEAR_LEGEND_TROPHY_FLOOR = 4900;
const LEGEND_SEASON_CHOICE_MONTHS = 18;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const legendSeasonChoices = buildLegendSeasonChoices();

export const legendCommandData = new SlashCommandBuilder()
  .setName(LEGEND_COMMAND_NAME)
  .setDescription(LEGEND_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('attacks')
      .setDescription('Show Legend attacks from stored data when available.')
      .addStringOption((option) =>
        option
          .setName('clans')
          .setDescription('Linked clan tag, name, or alias.')
          .setAutocomplete(true)
          .setRequired(false),
      )
      .addUserOption((option) =>
        option.setName('user').setDescription('Discord user to filter by.').setRequired(false),
      )
      .addNumberOption((option) =>
        option
          .setName('day')
          .setDescription(
            'Legend day number accepted for parity; stored attacks are not available yet.',
          )
          .setMinValue(1)
          .setMaxValue(35)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('days')
      .setDescription('Show Legend day history from stored data when available.')
      .addStringOption((option) =>
        option
          .setName('player')
          .setDescription('Player tag or name from current linked-clan snapshots.')
          .setAutocomplete(true)
          .setRequired(false),
      )
      .addUserOption((option) =>
        option.setName('user').setDescription('Discord user to filter by.').setRequired(false),
      )
      .addNumberOption((option) =>
        option
          .setName('day')
          .setDescription(
            'Legend day number accepted for parity; stored days are not available yet.',
          )
          .setMinValue(1)
          .setMaxValue(35)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('leaderboard')
      .setDescription('Show a Legend leaderboard from current linked-clan member snapshots.')
      .addStringOption((option) =>
        option
          .setName('clans')
          .setDescription('Linked clan tag, name, or alias.')
          .setAutocomplete(true)
          .setRequired(false),
      )
      .addNumberOption((option) =>
        option
          .setName('limit')
          .setDescription('Number of players to show.')
          .setMinValue(3)
          .setMaxValue(100)
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('season')
          .setDescription('Season accepted for parity; current persisted snapshots are used.')
          .addChoices(...legendSeasonChoices)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('stats')
      .setDescription('Show a persisted Legend snapshot summary.')
      .addStringOption((option) =>
        option
          .setName('reference_date')
          .setDescription('Date accepted for parity; current persisted snapshots are used.')
          .setRequired(false),
      ),
  );

export interface LegendLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface LegendMemberSnapshotRow {
  readonly playerTag: string;
  readonly name: string;
  readonly trophies: number | null;
  readonly lastFetchedAt: Date;
}

export interface LegendClanSnapshots {
  readonly clan: LegendLinkedClan;
  readonly members: readonly LegendMemberSnapshotRow[];
}

export interface LegendStore {
  readonly listLinkedClans: (guildId: string) => Promise<LegendLinkedClan[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<LegendClanSnapshots[]>;
}

export interface LegendCommandOptions {
  readonly store: LegendStore;
}

type LegendSubcommand = 'attacks' | 'days' | 'leaderboard' | 'stats';

export function createLegendSlashCommand(options: LegendCommandOptions): SlashCommandDefinition {
  return {
    name: LEGEND_COMMAND_NAME,
    data: legendCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== LEGEND_COMMAND_NAME) return;
      await executeLegend(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== LEGEND_COMMAND_NAME) return;
      await autocompleteLegend(interaction, options);
    },
  };
}

async function autocompleteLegend(
  interaction: AutocompleteInteraction,
  options: LegendCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  try {
    if (focused.name === 'clans') {
      const clans = await options.store.listLinkedClans(interaction.guildId);
      await interaction.respond(filterLegendClanChoices(clans, String(focused.value ?? '')));
      return;
    }

    if (focused.name === 'player') {
      const snapshots = await options.store.listClanMemberSnapshotsForGuild({
        guildId: interaction.guildId,
      });
      await interaction.respond(filterLegendPlayerChoices(snapshots, String(focused.value ?? '')));
      return;
    }
  } catch {
    await interaction.respond([]);
    return;
  }

  await interaction.respond([]);
}

export async function executeLegend(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: LegendCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/legend` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const subcommand = interaction.options.getSubcommand() as LegendSubcommand;
  if (subcommand === 'attacks') {
    const clanOption = interaction.options.getString('clans');
    const clan = await resolveLegendClan(interaction.guildId, clanOption, options.store);
    if (clanOption && !clan) {
      await interaction.editReply({
        content:
          'I could not resolve that clan from linked clans in this server. Pick a linked clan from autocomplete or use its exact tag, name, or alias.',
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        buildLegendUnsupportedEmbed('Legend Attacks', {
          clan,
          userMention: interaction.options.getUser('user')?.toString() ?? null,
          day: interaction.options.getNumber('day'),
        }),
      ],
    });
    return;
  }
  if (subcommand === 'days') {
    const snapshots = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
    });
    const playerOption = interaction.options.getString('player');
    const player = resolveLegendPlayerSnapshot(snapshots, playerOption);
    if (playerOption && !player) {
      await interaction.editReply({
        content:
          'I could not resolve that player from current linked-clan member snapshots in this server. Pick a stored player from autocomplete or use its exact tag or name.',
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        buildLegendUnsupportedEmbed('Legend Days', {
          player,
          userMention: interaction.options.getUser('user')?.toString() ?? null,
          day: interaction.options.getNumber('day'),
        }),
      ],
    });
    return;
  }

  const clanOption = subcommand === 'leaderboard' ? interaction.options.getString('clans') : null;
  const clanTag = await resolveLegendClanTag(interaction.guildId, clanOption, options.store);
  const snapshots = await options.store.listClanMemberSnapshotsForGuild({
    guildId: interaction.guildId,
    ...(clanTag ? { clanTag } : {}),
  });

  if (subcommand === 'stats') {
    const referenceDate = parseLegendReferenceDate(interaction.options.getString('reference_date'));
    await interaction.editReply({ embeds: [buildLegendStatsEmbed(snapshots, referenceDate)] });
    return;
  }

  const limit = Math.min(
    Math.max(Math.trunc(interaction.options.getNumber('limit') ?? 25), 3),
    100,
  );
  const season = interaction.options.getString('season');
  await interaction.editReply({ embeds: [buildLegendLeaderboardEmbed(snapshots, limit, season)] });
}

export function buildLegendLeaderboardEmbed(
  snapshots: readonly LegendClanSnapshots[],
  limit: number,
  season: string | null,
): EmbedBuilder {
  const rows = collectLegendRows(snapshots)
    .filter(
      (row) => row.member.trophies !== null && row.member.trophies >= NEAR_LEGEND_TROPHY_FLOOR,
    )
    .sort(
      (a, b) =>
        (b.member.trophies ?? -1) - (a.member.trophies ?? -1) ||
        a.member.name.localeCompare(b.member.name),
    );

  const embed = new EmbedBuilder()
    .setTitle('Legend Leaderboard')
    .setDescription(
      'Persisted-data-only view. No Clash API lookups, external feeds, exports, or auto-updating boards are used.',
    );

  if (season)
    embed.addFields({
      name: 'Season',
      value: `${formatLegendSeasonSelection(season)} (accepted for parity; current snapshots shown)`,
      inline: false,
    });

  if (rows.length === 0) {
    return embed.addFields({
      name: 'No data',
      value:
        'No current linked-clan member snapshots at or near Legend League are available yet. Link/configure clans and wait for clan polling to store member trophies.',
      inline: false,
    });
  }

  return embed
    .addFields({
      name: 'Players',
      value: rows
        .slice(0, limit)
        .map(
          (row, index) =>
            `${index + 1}. **${escapeMarkdown(row.member.name)}** (${row.member.playerTag}) · ${row.member.trophies?.toLocaleString()} trophies · ${escapeMarkdown(labelForLegendClan(row.clan))}`,
        )
        .join('\n'),
      inline: false,
    })
    .setFooter({ text: `Showing ${Math.min(rows.length, limit)}/${rows.length} snapshot players` });
}

interface LegendReferenceDateSelection {
  readonly raw: string | null;
  readonly parsed: Date | null;
}

export function buildLegendStatsEmbed(
  snapshots: readonly LegendClanSnapshots[],
  referenceDate: LegendReferenceDateSelection = { raw: null, parsed: null },
): EmbedBuilder {
  const rows = collectLegendRows(snapshots).filter((row) => row.member.trophies !== null);
  const legendCount = rows.filter(
    (row) => (row.member.trophies ?? 0) >= LEGEND_TROPHY_FLOOR,
  ).length;
  const nearLegendCount = rows.filter(
    (row) =>
      (row.member.trophies ?? 0) >= NEAR_LEGEND_TROPHY_FLOOR &&
      (row.member.trophies ?? 0) < LEGEND_TROPHY_FLOOR,
  ).length;
  const top = [...rows].sort((a, b) => (b.member.trophies ?? -1) - (a.member.trophies ?? -1))[0];

  const embed = new EmbedBuilder()
    .setTitle('Legend Snapshot Stats')
    .setDescription(
      'Persisted snapshot summary only. Reference dates are accepted for command parity, but current stored member snapshots are used; no live Clash API lookups are made.',
    );

  embed.addFields({
    name: 'Reference date',
    value: formatLegendReferenceDate(referenceDate),
    inline: false,
  });

  if (rows.length === 0) {
    return embed.addFields({
      name: 'No data',
      value:
        'No stored member trophy snapshots are available yet. Link/configure clans and wait for clan polling to observe members.',
      inline: false,
    });
  }

  embed.addFields(
    { name: 'Snapshot players', value: rows.length.toLocaleString(), inline: true },
    { name: 'Legend League (≥ 5,000)', value: legendCount.toLocaleString(), inline: true },
    { name: 'Near Legend (4,900–4,999)', value: nearLegendCount.toLocaleString(), inline: true },
    {
      name: 'Current thresholds',
      value:
        'Counts use persisted snapshot trophies with Legend ≥ 5,000 and Near Legend 4,900–4,999.',
      inline: false,
    },
  );

  if (top) {
    embed.addFields({
      name: 'Top stored player',
      value: `**${escapeMarkdown(top.member.name)}** (${top.member.playerTag}) · ${top.member.trophies?.toLocaleString()} trophies · ${escapeMarkdown(labelForLegendClan(top.clan))}`,
      inline: false,
    });
  }

  return embed;
}

interface LegendUnsupportedFilterContext {
  readonly clan?: LegendLinkedClan | undefined;
  readonly player?: LegendMemberSnapshotRow | undefined;
  readonly userMention?: string | null;
  readonly day?: number | null;
}

export function buildLegendUnsupportedEmbed(
  title: string,
  filterContext: LegendUnsupportedFilterContext = {},
): EmbedBuilder {
  const filterLines = formatLegendUnsupportedFilterLines(filterContext);
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      'No stored Legend attack/day data exists in ClashMate yet, so this first-pass command does not perform live lookups. It uses no Clash API calls, exports, external feeds, or polling enrollment.',
    );

  if (filterLines.length > 0) {
    embed.addFields({ name: 'Accepted filters', value: filterLines.join('\n'), inline: false });
  }

  return embed;
}

export function filterLegendClanChoices(
  clans: readonly LegendLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatLegendClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export function filterLegendPlayerChoices(
  snapshots: readonly LegendClanSnapshots[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return collectLegendRows(snapshots)
    .filter((row) => {
      if (!normalizedQuery) return true;
      return (
        row.member.name.toLowerCase().includes(normalizedQuery) ||
        row.member.playerTag.toLowerCase().includes(normalizedQuery)
      );
    })
    .sort((a, b) => (b.member.trophies ?? -1) - (a.member.trophies ?? -1))
    .slice(0, 25)
    .map((row) => ({
      name: `${row.member.name} (${row.member.playerTag})`,
      value: row.member.playerTag,
    }));
}

async function resolveLegendClanTag(
  guildId: string,
  clanOption: string | null,
  store: LegendStore,
): Promise<string | undefined> {
  if (!clanOption) return undefined;
  const clans = await store.listLinkedClans(guildId);
  const normalizedOption = clanOption.trim().toLowerCase();
  const normalizedTag = normalizeClashTag(clanOption);
  return clans.find(
    (clan) =>
      clan.clanTag === normalizedTag ||
      clan.alias?.toLowerCase() === normalizedOption ||
      clan.name?.toLowerCase() === normalizedOption,
  )?.clanTag;
}

async function resolveLegendClan(
  guildId: string,
  clanOption: string | null,
  store: LegendStore,
): Promise<LegendLinkedClan | undefined> {
  if (!clanOption) return undefined;
  const clans = await store.listLinkedClans(guildId);
  const normalizedOption = clanOption.trim().toLowerCase();
  const normalizedTag = tryNormalizeLegendTag(clanOption);
  return clans.find(
    (clan) =>
      (normalizedTag !== null && clan.clanTag === normalizedTag) ||
      clan.alias?.toLowerCase() === normalizedOption ||
      clan.name?.toLowerCase() === normalizedOption,
  );
}

function resolveLegendPlayerSnapshot(
  snapshots: readonly LegendClanSnapshots[],
  playerOption: string | null,
): LegendMemberSnapshotRow | undefined {
  if (!playerOption) return undefined;
  const normalizedOption = playerOption.trim().toLowerCase();
  const normalizedTag = tryNormalizeLegendTag(playerOption);
  return collectLegendRows(snapshots).find(
    (row) =>
      (normalizedTag !== null && row.member.playerTag === normalizedTag) ||
      row.member.name.toLowerCase() === normalizedOption,
  )?.member;
}

function tryNormalizeLegendTag(value: string): string | null {
  try {
    return normalizeClashTag(value);
  } catch {
    return null;
  }
}

function formatLegendUnsupportedFilterLines(
  filterContext: LegendUnsupportedFilterContext,
): string[] {
  const lines: string[] = [];
  if (filterContext.clan) {
    lines.push(
      `Clan: ${escapeMarkdown(labelForLegendClan(filterContext.clan))} (${filterContext.clan.clanTag})`,
    );
  }
  if (filterContext.player) {
    lines.push(
      `Player: ${escapeMarkdown(filterContext.player.name)} (${filterContext.player.playerTag})`,
    );
  }
  if (filterContext.userMention) lines.push(`User: ${filterContext.userMention}`);
  if (filterContext.day !== null && filterContext.day !== undefined) {
    lines.push(`Day: ${Math.trunc(filterContext.day).toLocaleString()}`);
  }
  return lines;
}

function collectLegendRows(snapshots: readonly LegendClanSnapshots[]) {
  return snapshots.flatMap((snapshot) =>
    snapshot.members.map((member) => ({ member, clan: snapshot.clan })),
  );
}

function clanMatchesQuery(clan: LegendLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.name, clan.alias].some((value) =>
    value?.toLowerCase().includes(normalizedQuery),
  );
}

function formatLegendClanChoiceName(clan: LegendLinkedClan): string {
  const label = labelForLegendClan(clan);
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function labelForLegendClan(clan: LegendLinkedClan): string {
  return clan.alias ?? clan.name ?? clan.clanTag;
}

export function buildLegendSeasonChoices(
  referenceDate = new Date(),
): ApplicationCommandOptionChoiceData<string>[] {
  const choices: ApplicationCommandOptionChoiceData<string>[] = [];
  const monthIndex = referenceDate.getUTCMonth();
  const year = referenceDate.getUTCFullYear();

  for (let offset = 0; offset < LEGEND_SEASON_CHOICE_MONTHS; offset += 1) {
    const date = new Date(Date.UTC(year, monthIndex - offset, 1));
    const seasonId = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    choices.push({
      name: `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      value: seasonId,
    });
  }

  return choices;
}

function formatLegendSeasonSelection(season: string): string {
  const choice = legendSeasonChoices.find((item) => item.value === season);
  if (!choice) return season;
  return `${choice.name} (${season})`;
}

function parseLegendReferenceDate(rawReferenceDate: string | null): LegendReferenceDateSelection {
  const raw = rawReferenceDate?.trim() ?? '';
  if (!raw) return { raw: null, parsed: null };

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return { raw, parsed: null };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return { raw, parsed: null };
  }

  return { raw, parsed };
}

function formatLegendReferenceDate(referenceDate: LegendReferenceDateSelection): string {
  const parityNote = 'accepted for parity; current persisted member snapshots are used.';
  if (!referenceDate.raw) return `Not provided; ${parityNote}`;
  if (!referenceDate.parsed) {
    return `Unparsed label: ${escapeMarkdown(referenceDate.raw)}; ${parityNote}`;
  }

  return `${referenceDate.parsed.toISOString().slice(0, 10)} UTC; ${parityNote}`;
}
