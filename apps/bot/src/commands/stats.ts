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

export const STATS_COMMAND_NAME = 'stats';
export const STATS_COMMAND_DESCRIPTION = 'Show war attack stats from stored history.';
export const STATS_NO_ATTACK_EVENTS_MESSAGE =
  'No war attack stats are available yet. Link/configure a clan and wait for war attacks to be detected.';
export const STATS_DEFENSE_UNAVAILABLE_MESSAGE =
  'Persisted defense stats are not available yet. ClashMate currently stores war attack history only.';

const MAX_STATS_ROWS = 15;
const EMBED_DESCRIPTION_LIMIT = 4096;
const STARS_OPTIONS = ['==3', '==2', '>=2', '==1', '>=1'] as const;
type StarsOption = (typeof STARS_OPTIONS)[number];
type AttemptOption = 'fresh' | 'cleanup';

export const statsCommandData = new SlashCommandBuilder()
  .setName(STATS_COMMAND_NAME)
  .setDescription(STATS_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('attacks')
      .setDescription('Show attacker rankings from stored war attack history.')
      .addStringOption((option) =>
        option
          .setName('clan')
          .setDescription('Clan tag, name, or alias filter.')
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
          .setName('stars')
          .setDescription('Star result filter label.')
          .setRequired(false)
          .addChoices(
            { name: '3', value: '==3' },
            { name: '2', value: '==2' },
            { name: '>= 2', value: '>=2' },
            { name: '1', value: '==1' },
            { name: '>= 1', value: '>=1' },
          ),
      )
      .addIntegerOption((option) =>
        option
          .setName('days')
          .setDescription('Limit to attacks detected in the last N days.')
          .setMinValue(1)
          .setMaxValue(180)
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('attempt')
          .setDescription('Show fresh or cleanup hit context where stored aggregates allow it.')
          .setRequired(false)
          .addChoices({ name: 'Fresh', value: 'fresh' }, { name: 'Cleanup', value: 'cleanup' }),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('defense')
      .setDescription('Show defense stats from stored history.')
      .addStringOption((option) =>
        option
          .setName('clan')
          .setDescription('Clan tag, name, or alias filter.')
          .setAutocomplete(true)
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('Discord user whose linked players should be matched.')
          .setRequired(false),
      ),
  );

export interface StatsLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface StatsWarAttackHistoryRow {
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

export interface StatsStore {
  readonly listLinkedClans: (guildId: string) => Promise<StatsLinkedClan[]>;
  readonly listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
  readonly listWarAttackHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    attackerTags?: readonly string[];
    since?: Date;
  }) => Promise<StatsWarAttackHistoryRow[]>;
}

export interface StatsCommandOptions {
  readonly store: StatsStore;
}

export function createStatsSlashCommand(options: StatsCommandOptions): SlashCommandDefinition {
  return {
    name: STATS_COMMAND_NAME,
    data: statsCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== STATS_COMMAND_NAME) return;
      await executeStats(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== STATS_COMMAND_NAME) return;
      await autocompleteStats(interaction, options);
    },
  };
}

async function autocompleteStats(
  interaction: AutocompleteInteraction,
  options: StatsCommandOptions,
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
    await interaction.respond(filterStatsClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterStatsClanChoices(
  clans: readonly StatsLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export async function executeStats(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: StatsCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: '`/stats` can only be used in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'defense') {
    await interaction.editReply({ content: STATS_DEFENSE_UNAVAILABLE_MESSAGE });
    return;
  }
  if (subcommand !== 'attacks') {
    await interaction.editReply({ content: 'Only `/stats attacks` is available right now.' });
    return;
  }

  const clans = await options.store.listLinkedClans(interaction.guildId);
  const clanOption = interaction.options.getString('clan');
  const userOption = interaction.options.getUser('user');
  const starsOption = readStarsOption(interaction.options.getString('stars'));
  const attemptOption = readAttemptOption(interaction.options.getString('attempt'));
  const days = interaction.options.getInteger('days');

  let clanTags: string[] | undefined;
  let clanLabel: string | undefined;
  if (clanOption) {
    const clan = resolveStatsClan(clans, clanOption);
    if (!clan) {
      await interaction.editReply({ content: 'No linked clan was found for that clan option.' });
      return;
    }
    clanTags = [clan.clanTag];
    clanLabel = `${clan.alias ?? clan.name ?? 'Linked Clan'} (${clan.clanTag})`;
  }

  let playerTags: string[] | undefined;
  if (userOption) {
    playerTags = await options.store.listPlayerTagsForUser(interaction.guildId, userOption.id);
    if (playerTags.length === 0) {
      await interaction.editReply({ content: formatNoLinkedPlayersMessage(userOption) });
      return;
    }
  }

  const rows = await options.store.listWarAttackHistoryForGuild({
    guildId: interaction.guildId,
    ...(clanTags ? { clanTags } : {}),
    ...(playerTags ? { attackerTags: playerTags } : {}),
    ...(days ? { since: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } : {}),
  });
  const rankedRows = rankStatsRows(filterRowsByAttempt(rows, attemptOption));

  if (rankedRows.length === 0) {
    await interaction.editReply({ content: STATS_NO_ATTACK_EVENTS_MESSAGE });
    return;
  }

  await interaction.editReply({
    embeds: [
      buildStatsAttacksEmbed(rankedRows, {
        clanLabel,
        user: userOption,
        starsOption,
        attemptOption,
        days,
      }),
    ],
  });
}

export function filterRowsByAttempt(
  rows: readonly StatsWarAttackHistoryRow[],
  attempt: AttemptOption | null,
): StatsWarAttackHistoryRow[] {
  if (attempt === 'fresh') return rows.filter((row) => row.freshAttackCount > 0);
  if (attempt === 'cleanup') return rows.filter((row) => row.attackCount > row.freshAttackCount);
  return [...rows];
}

export function rankStatsRows(
  rows: readonly StatsWarAttackHistoryRow[],
): StatsWarAttackHistoryRow[] {
  return [...rows].sort(
    (a, b) =>
      b.attackCount - a.attackCount ||
      b.averageStars - a.averageStars ||
      b.averageDestruction - a.averageDestruction ||
      b.freshAttackCount - a.freshAttackCount ||
      b.lastAttackedAt.getTime() - a.lastAttackedAt.getTime(),
  );
}

export function buildStatsAttacksEmbed(
  rows: readonly StatsWarAttackHistoryRow[],
  input: {
    readonly clanLabel: string | undefined;
    readonly user: User | null;
    readonly starsOption: StarsOption | null;
    readonly attemptOption: AttemptOption | null;
    readonly days: number | null;
  },
): EmbedBuilder {
  const selectedRows = rows.slice(0, MAX_STATS_ROWS);
  const totals = rows.reduce(
    (acc, row) => ({
      attacks: acc.attacks + row.attackCount,
      stars: acc.stars + row.totalStars,
      destruction: acc.destruction + row.totalDestruction,
      fresh: acc.fresh + row.freshAttackCount,
    }),
    { attacks: 0, stars: 0, destruction: 0, fresh: 0 },
  );
  const averageStars = totals.attacks > 0 ? totals.stars / totals.attacks : 0;
  const averageDestruction = totals.attacks > 0 ? totals.destruction / totals.attacks : 0;
  const embed = new EmbedBuilder()
    .setTitle('War Attack Stats')
    .setDescription(truncateEmbedDescription(formatStatsRows(selectedRows)))
    .addFields(
      {
        name: 'Totals',
        value: `${totals.attacks} attacks · ${totals.stars} stars · ${averageStars.toFixed(2)} avg stars · ${averageDestruction.toFixed(2)}% avg destruction · ${totals.fresh} fresh hits`,
        inline: false,
      },
      {
        name: 'Source',
        value: buildSourceNote(input.starsOption, input.attemptOption),
        inline: false,
      },
    )
    .setFooter({ text: buildStatsFooter(selectedRows.length, rows.length, input.days) });

  if (input.clanLabel)
    embed.addFields({ name: 'Clan filter', value: input.clanLabel, inline: false });
  if (input.starsOption)
    embed.addFields({
      name: 'Stars filter',
      value: formatStarsOption(input.starsOption),
      inline: true,
    });
  if (input.attemptOption)
    embed.addFields({
      name: 'Attempt filter',
      value: formatAttemptOption(input.attemptOption),
      inline: true,
    });
  if (input.user)
    embed.setAuthor({ name: input.user.displayName, iconURL: input.user.displayAvatarURL() });
  return embed;
}

function formatStatsRows(rows: readonly StatsWarAttackHistoryRow[]): string {
  return rows
    .map((row, index) => {
      const label = row.attackerName?.trim() || row.attackerTag;
      return `${index + 1}. **${escapeMarkdown(label)}** (\`${row.attackerTag}\`) · ${row.attackCount} attacks · ${row.averageStars.toFixed(2)} avg ⭐ · ${row.averageDestruction.toFixed(2)}% avg · ${row.freshAttackCount} fresh · ${time(row.lastAttackedAt, 'R')}`;
    })
    .join('\n');
}

function buildSourceNote(stars: StarsOption | null, attempt: AttemptOption | null): string {
  const notes = [
    'Values are based only on persisted war attack history for linked/configured clans.',
  ];
  if (stars) {
    notes.push(
      'Star filtering is shown as a label only because stored rows are attacker aggregates, not exact per-hit star buckets.',
    );
  }
  if (attempt) {
    notes.push(
      'Attempt filtering uses aggregate fresh-hit counts conservatively; displayed averages still come from stored attacker totals.',
    );
  }
  return notes.join(' ');
}

function buildStatsFooter(shown: number, total: number, days: number | null): string {
  const window = days ? ` from the last ${days} days` : '';
  return `Showing ${shown}/${total} attackers${window} from stored events`;
}

function readStarsOption(value: string | null): StarsOption | null {
  return value && STARS_OPTIONS.includes(value as StarsOption) ? (value as StarsOption) : null;
}

function readAttemptOption(value: string | null): AttemptOption | null {
  return value === 'fresh' || value === 'cleanup' ? value : null;
}

function formatStarsOption(value: StarsOption): string {
  return value.replace('==', '').replace('>=', '>= ');
}

function formatAttemptOption(value: AttemptOption): string {
  return value === 'fresh' ? 'Fresh' : 'Cleanup';
}

function formatNoLinkedPlayersMessage(user: User): string {
  return `**${escapeMarkdown(user.displayName)}** does not have linked player accounts. Use \`/link create\` first.`;
}

export function resolveStatsClan(
  clans: readonly StatsLinkedClan[],
  query: string,
): StatsLinkedClan | undefined {
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

function clanMatchesQuery(clan: StatsLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: StatsLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function truncateEmbedDescription(text: string): string {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…`;
}
