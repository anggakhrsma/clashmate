import type { ClanGamesScoreboardReader, ClanGamesScoreboardSnapshot } from '@clashmate/database';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
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

export const CLAN_GAMES_COMMAND_NAME = 'clan-games';
export const CLAN_GAMES_COMMAND_DESCRIPTION = 'Show a Clan Games scoreboard.';
export const CLAN_GAMES_NO_DATA_MESSAGE =
  'No persisted Clan Games scoreboard snapshot matches those filters yet.';

const SCOREBOARD_MEMBER_LIMIT = 55;
const EMBED_DESCRIPTION_LIMIT = 4096;
const SEASON_CHOICE_LIMIT = 18;

export const clanGamesSeasonChoices = createClanGamesSeasonChoices(new Date());

export const clanGamesCommandData = new SlashCommandBuilder()
  .setName(CLAN_GAMES_COMMAND_NAME)
  .setDescription(CLAN_GAMES_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('clan')
      .setDescription('Clan tag or autocomplete selection.')
      .setAutocomplete(true),
  )
  .addUserOption((option) =>
    option.setName('user').setDescription("Filter scoreboard to a Discord user's linked players."),
  )
  .addStringOption((option) =>
    option
      .setName('season')
      .setDescription('Clan Games season id.')
      .addChoices(...clanGamesSeasonChoices),
  );

export function createClanGamesSeasonChoices(
  now: Date,
): ApplicationCommandOptionChoiceData<string>[] {
  const currentSeasonId = getCurrentClanGamesSeasonId(now);
  const year = Number(currentSeasonId.slice(0, 4));
  const month = Number(currentSeasonId.slice(5, 7));
  const currentMonth = Date.UTC(year, month - 1, 1);
  return Array.from({ length: SEASON_CHOICE_LIMIT }, (_, index) => {
    const seasonDate = new Date(currentMonth);
    seasonDate.setUTCMonth(seasonDate.getUTCMonth() - index);
    const seasonId = seasonDate.toISOString().slice(0, 7);
    return {
      name: `${formatClanGamesSeasonChoiceName(seasonDate)}${index === 0 ? ' (current)' : ''}`,
      value: seasonId,
    };
  });
}

export function getCurrentClanGamesSeasonId(now: Date): string {
  const seasonDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (now.getUTCDate() < 20) seasonDate.setUTCMonth(seasonDate.getUTCMonth() - 1);
  return seasonDate.toISOString().slice(0, 7);
}

export interface ClanGamesCommandOptions {
  readonly reader: ClanGamesScoreboardReader;
  readonly links: {
    readonly listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
  };
}

export function createClanGamesSlashCommand(
  options: ClanGamesCommandOptions,
): SlashCommandDefinition {
  return {
    name: CLAN_GAMES_COMMAND_NAME,
    data: clanGamesCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== CLAN_GAMES_COMMAND_NAME) return;
      await executeClanGames(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== CLAN_GAMES_COMMAND_NAME) return;
      await autocompleteClanGames(interaction, options);
    },
  };
}

async function autocompleteClanGames(
  interaction: AutocompleteInteraction,
  options: ClanGamesCommandOptions,
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
    const choices = await options.reader.listScoreboardChoices(
      interaction.guildId,
      String(focused.value ?? ''),
    );
    await interaction.respond(formatClanGamesChoices(choices));
  } catch {
    await interaction.respond([]);
  }
}

type ClanGamesScoreboardChoice = Awaited<
  ReturnType<ClanGamesScoreboardReader['listScoreboardChoices']>
>[number];

export function formatClanGamesChoices(
  choices: Awaited<ReturnType<ClanGamesScoreboardReader['listScoreboardChoices']>>,
): ApplicationCommandOptionChoiceData<string>[] {
  const seen = new Set<string>();
  return [...choices]
    .sort(compareClanGamesChoices)
    .filter((choice) => {
      const value = choice.clanTag.trim();
      if (!value) return false;
      const key = value.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 25)
    .map((choice) => ({
      name: formatClanGamesChoiceName(choice),
      value: choice.clanTag.trim(),
    }));
}

function compareClanGamesChoices(
  left: ClanGamesScoreboardChoice,
  right: ClanGamesScoreboardChoice,
): number {
  const leftLabel = getClanGamesChoiceSortLabel(left);
  const rightLabel = getClanGamesChoiceSortLabel(right);
  return leftLabel.localeCompare(rightLabel, 'en-US', { sensitivity: 'base' });
}

function getClanGamesChoiceSortLabel(choice: ClanGamesScoreboardChoice): string {
  return `${choice.clanName ?? choice.clanAlias ?? ''}\u0000${choice.clanTag}`;
}

function formatClanGamesChoiceName(choice: ClanGamesScoreboardChoice): string {
  const label = choice.clanName?.trim() || choice.clanAlias?.trim() || 'Clan';
  const alias = choice.clanAlias?.trim();
  const context = alias && alias !== label ? `${label} / ${alias}` : label;
  return truncateChoiceName(`${context} · ${choice.clanTag}`);
}

function truncateChoiceName(name: string): string {
  return name.length <= 100 ? name : `${name.slice(0, 99)}…`;
}

async function executeClanGames(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: ClanGamesCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: '`/clan-games` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const clan = interaction.options.getString('clan') ?? undefined;
  const user = interaction.options.getUser('user');
  const requestedSeasonId = interaction.options.getString('season') ?? undefined;
  const seasonId = requestedSeasonId ?? getCurrentClanGamesSeasonId(new Date());
  const coverageChoices = await options.reader.listScoreboardChoices(interaction.guildId, '');
  const coverage = createClanGamesCoverageContext(coverageChoices);
  const scoreboard = await options.reader.getLatestScoreboard({
    guildId: interaction.guildId,
    ...(clan ? { clanTag: clan } : {}),
    ...(seasonId ? { seasonId } : {}),
  });

  if (!scoreboard) {
    await interaction.reply({
      content: formatClanGamesNoDataMessage({
        ...(clan ? { clan } : {}),
        seasonId,
        usedCurrentSeasonDefault: !requestedSeasonId,
        user,
        coverage,
      }),
      ephemeral: true,
    });
    return;
  }

  if (!user) {
    await interaction.reply({
      embeds: [
        buildClanGamesEmbed(scoreboard, !clan, coverage, {
          usedCurrentSeasonDefault: !requestedSeasonId,
        }),
      ],
    });
    return;
  }

  const playerTags = await options.links.listPlayerTagsForUser(interaction.guildId, user.id);
  if (playerTags.length === 0) {
    await interaction.reply({
      content: `**${escapeMarkdown(user.displayName)}** does not have linked player accounts. Use \`/link create\` first.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      buildClanGamesEmbed(filterScoreboardForUser(scoreboard, user, playerTags), !clan, coverage, {
        usedCurrentSeasonDefault: !requestedSeasonId,
      }),
    ],
  });
}

interface ClanGamesCoverageContext {
  readonly linkedClanScoreboardCount: number;
  readonly linkedClanSnapshotCount: number;
  readonly latestSnapshotUpdatedAt: Date | null;
  readonly latestSnapshotSeasonId: string | null;
}

function createClanGamesCoverageContext(
  choices: readonly Awaited<
    ReturnType<ClanGamesScoreboardReader['listScoreboardChoices']>
  >[number][],
): ClanGamesCoverageContext {
  const latestChoice = choices.reduce<(typeof choices)[number] | null>((latest, choice) => {
    if (!choice.updatedAt) return latest;
    if (!latest?.updatedAt) return choice;
    return choice.updatedAt > latest.updatedAt ? choice : latest;
  }, null);

  return {
    linkedClanScoreboardCount: choices.length,
    linkedClanSnapshotCount: choices.filter((choice) => choice.updatedAt).length,
    latestSnapshotUpdatedAt: latestChoice?.updatedAt ?? null,
    latestSnapshotSeasonId: latestChoice?.seasonId ?? null,
  };
}

function filterScoreboardForUser(
  scoreboard: ClanGamesScoreboardSnapshot,
  user: User,
  playerTags: readonly string[],
): ClanGamesScoreboardSnapshot & {
  readonly totalStoredMembers: number;
  readonly userFilterNote: string;
} {
  const linkedTags = new Set(playerTags.map((tag) => tag.toUpperCase()));
  const members = scoreboard.members.filter((member) =>
    linkedTags.has(member.playerTag.toUpperCase()),
  );
  const linkedTagLabel = `${playerTags.length.toLocaleString()} linked player tag${playerTags.length === 1 ? '' : 's'}`;
  const matchedMemberLabel = `${members.length.toLocaleString()} matched member${members.length === 1 ? '' : 's'}`;
  return {
    ...scoreboard,
    members,
    totalPoints: members.reduce((total, member) => total + member.points, 0),
    totalStoredMembers: scoreboard.members.length,
    userFilterNote:
      members.length === 0
        ? `User filter: **${escapeMarkdown(user.displayName)}** resolved to ${linkedTagLabel}; 0 matched members in this stored scoreboard.`
        : `User filter: **${escapeMarkdown(user.displayName)}** resolved to ${linkedTagLabel}; ${matchedMemberLabel}.`,
  };
}

export function buildClanGamesEmbed(
  scoreboard: ClanGamesScoreboardSnapshot & {
    readonly totalStoredMembers?: number;
    readonly userFilterNote?: string;
  },
  mentionSelectedClan: boolean,
  coverage?: ClanGamesCoverageContext,
  context?: {
    readonly usedCurrentSeasonDefault?: boolean;
  },
): EmbedBuilder {
  const clanLabel = `${scoreboard.clanName ?? scoreboard.clanTag} (${scoreboard.clanTag})`;
  const seasonChoice = clanGamesSeasonChoices.find(
    (choice) => choice.value === scoreboard.seasonId,
  );
  const seasonLabel = seasonChoice
    ? `${scoreboard.seasonId} (${seasonChoice.name})`
    : scoreboard.seasonId;
  const visibleMembers = scoreboard.members.slice(0, SCOREBOARD_MEMBER_LIMIT);
  const totalStoredMembers = scoreboard.totalStoredMembers ?? scoreboard.members.length;
  const linkedClanAvailability = formatLinkedClanAvailability(coverage);
  const rowCountContext = formatClanGamesRowCountContext(
    scoreboard,
    visibleMembers,
    totalStoredMembers,
  );
  const descriptionLines = [
    'Persisted Clan Games snapshots only; no live Clash API lookup or on-demand polling enrollment.',
    mentionSelectedClan
      ? `Using latest stored snapshot for **${escapeMarkdown(clanLabel)}**.`
      : null,
    `Season: **${escapeMarkdown(seasonLabel)}**${scoreboard.seasonId === getCurrentClanGamesSeasonId(new Date()) ? ' · current season' : ''}${context?.usedCurrentSeasonDefault ? ' · defaulted because no season was provided' : ''}`,
    `Scoreboard availability: ${linkedClanAvailability}.`,
    `Snapshot coverage: ${formatLinkedClanSnapshotCount(coverage)} · source fetched ${time(scoreboard.sourceFetchedAt, 'R')} · stored update ${time(scoreboard.updatedAt, 'R')}`,
    `Member rows: ${rowCountContext}.`,
    `Points summary: ${formatClanGamesCompletionSummary(scoreboard)}`,
    scoreboard.userFilterNote ?? null,
    '',
    '```txt',
    ...formatScoreboardRows(visibleMembers),
    '```',
  ].filter((line): line is string => line !== null);

  const average =
    scoreboard.members.length === 0 ? 0 : scoreboard.totalPoints / scoreboard.members.length;
  const embed = new EmbedBuilder()
    .setColor(0x2f80ed)
    .setAuthor({ name: `ClashMate Clan Games · ${clanLabel}` })
    .setTitle('Clan Games Scoreboard')
    .setDescription(truncateDescription(descriptionLines.join('\n')))
    .addFields(
      { name: 'Total Points', value: scoreboard.totalPoints.toLocaleString(), inline: true },
      { name: 'Members', value: scoreboard.members.length.toLocaleString(), inline: true },
      { name: 'Average', value: average.toFixed(1), inline: true },
      {
        name: 'Completion',
        value: formatClanGamesCompletionSummary(scoreboard),
        inline: false,
      },
      {
        name: 'Data Source',
        value:
          'Persisted snapshot from linked/configured clan polling only. No live Clash API fallback or on-demand enrollment; link/configure the clan and let worker pollers collect fresh season data.',
      },
    )
    .setFooter({
      text: `Showing top ${visibleMembers.length} of ${scoreboard.members.length}${scoreboard.members.length === totalStoredMembers ? '' : ` filtered · ${totalStoredMembers.toLocaleString()} stored`}${scoreboard.eventMaxPoints > 0 ? ` · Event max ${scoreboard.eventMaxPoints.toLocaleString()}` : ''}`,
    })
    .setTimestamp(scoreboard.updatedAt);

  return embed;
}

function formatClanGamesCompletionSummary(
  scoreboard: Pick<ClanGamesScoreboardSnapshot, 'eventMaxPoints' | 'members' | 'totalPoints'>,
): string {
  if (scoreboard.members.length === 0) return 'No stored member points to summarize.';
  if (scoreboard.eventMaxPoints <= 0) {
    return 'Event max points are unavailable in this stored snapshot; threshold completion cannot be calculated.';
  }

  const completedMembers = scoreboard.members.filter(
    (member) => member.points >= scoreboard.eventMaxPoints,
  ).length;
  const possiblePoints = scoreboard.members.length * scoreboard.eventMaxPoints;
  const remainingPoints = Math.max(0, possiblePoints - scoreboard.totalPoints);
  const completionPercent =
    possiblePoints === 0 ? 0 : (scoreboard.totalPoints / possiblePoints) * 100;

  return `${completedMembers.toLocaleString()} of ${scoreboard.members.length.toLocaleString()} member${scoreboard.members.length === 1 ? '' : 's'} at ${scoreboard.eventMaxPoints.toLocaleString()} points · ${remainingPoints.toLocaleString()} points below stored roster max · ${completionPercent.toFixed(1)}% of stored threshold total.`;
}

function formatClanGamesNoDataMessage(input: {
  readonly clan?: string;
  readonly seasonId?: string;
  readonly usedCurrentSeasonDefault?: boolean;
  readonly user: User | null;
  readonly coverage: ClanGamesCoverageContext;
}): string {
  const seasonLabel = input.seasonId ?? getCurrentClanGamesSeasonId(new Date());
  const seasonDefaultNote = input.usedCurrentSeasonDefault
    ? ' (defaulted to the current season)'
    : '';
  const filters = [
    `clan: ${input.clan ? `\`${escapeMarkdown(input.clan)}\`` : '`latest linked clan`'}`,
    `season: \`${escapeMarkdown(seasonLabel)}\`${seasonDefaultNote}`,
    `user: ${input.user ? `**${escapeMarkdown(input.user.displayName)}**` : '`not filtered`'}`,
  ];

  return [
    CLAN_GAMES_NO_DATA_MESSAGE,
    `Filters checked: ${filters.join(' · ')}.`,
    `Scoreboard availability: ${formatLinkedClanAvailability(input.coverage)}.`,
    `Stored coverage: ${formatLinkedClanSnapshotCount(input.coverage)} · latest snapshot ${formatLatestSnapshotContext(input.coverage)}.`,
    'Data source: persisted Clan Games snapshots for linked/configured clans only; no live Clash API fallback or on-demand enrollment.',
    'Season choice note: before the monthly event window opens, the previous month remains the current season.',
    'Next: link/configure the clan if needed, enable worker polling, then wait for a Clan Games snapshot for the requested season.',
  ].join('\n');
}

function formatLinkedClanAvailability(coverage?: ClanGamesCoverageContext): string {
  const scoreboardCount = coverage?.linkedClanScoreboardCount ?? 0;
  const snapshotCount = coverage?.linkedClanSnapshotCount ?? 0;
  return `${scoreboardCount.toLocaleString()} linked scoreboard${scoreboardCount === 1 ? '' : 's'} · ${snapshotCount.toLocaleString()} with stored snapshots`;
}

function formatLinkedClanSnapshotCount(coverage?: ClanGamesCoverageContext): string {
  const count = coverage?.linkedClanSnapshotCount ?? 0;
  return `${count.toLocaleString()} linked clan snapshot${count === 1 ? '' : 's'}`;
}

function formatLatestSnapshotContext(coverage: ClanGamesCoverageContext): string {
  if (!coverage.latestSnapshotUpdatedAt) return 'unavailable';
  const season = coverage.latestSnapshotSeasonId
    ? `season ${coverage.latestSnapshotSeasonId}, `
    : '';
  return `${season}updated ${time(coverage.latestSnapshotUpdatedAt, 'R')}`;
}

function formatScoreboardRows(
  members: readonly ClanGamesScoreboardSnapshot['members'][number][],
): string[] {
  if (members.length === 0) return ['No valid members in the stored snapshot.'];

  return members.map((member, index) => {
    const rank = String(index + 1).padStart(2, ' ');
    const points = member.points.toLocaleString('en-US').padStart(6, ' ');
    return `${rank}. ${points}  ${member.playerName} (${member.playerTag})`;
  });
}

function formatClanGamesRowCountContext(
  scoreboard: ClanGamesScoreboardSnapshot,
  visibleMembers: readonly ClanGamesScoreboardSnapshot['members'][number][],
  totalStoredMembers: number,
): string {
  const displayedCount = visibleMembers.length;
  const visibleLabel = `${displayedCount.toLocaleString()} visible row${displayedCount === 1 ? '' : 's'}`;
  const storedLabel = `${totalStoredMembers.toLocaleString()} stored member${totalStoredMembers === 1 ? '' : 's'}`;
  const filteredLabel =
    scoreboard.members.length === totalStoredMembers
      ? null
      : `${scoreboard.members.length.toLocaleString()} after user filter`;
  return [visibleLabel, storedLabel, filteredLabel]
    .filter((value): value is string => value !== null)
    .join(' · ');
}

function truncateDescription(description: string): string {
  if (description.length <= EMBED_DESCRIPTION_LIMIT) return description;
  return `${description.slice(0, EMBED_DESCRIPTION_LIMIT - 16)}\n\`\`\`\n…and more`;
}

function formatClanGamesSeasonChoiceName(seasonDate: Date): string {
  return seasonDate.toLocaleString('en-US', {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  });
}
