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

  const choices = await options.reader.listScoreboardChoices(
    interaction.guildId,
    String(focused.value ?? ''),
  );
  await interaction.respond(formatClanGamesChoices(choices));
}

export function formatClanGamesChoices(
  choices: Awaited<ReturnType<ClanGamesScoreboardReader['listScoreboardChoices']>>,
): ApplicationCommandOptionChoiceData<string>[] {
  return choices.slice(0, 25).map((choice) => ({
    name: `${choice.clanName ?? choice.clanTag} (${choice.clanTag})`,
    value: choice.clanTag,
  }));
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
    await interaction.reply({ embeds: [buildClanGamesEmbed(scoreboard, !clan, coverage)] });
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
      buildClanGamesEmbed(filterScoreboardForUser(scoreboard, user, playerTags), !clan, coverage),
    ],
  });
}

interface ClanGamesCoverageContext {
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
  return {
    ...scoreboard,
    members,
    totalPoints: members.reduce((total, member) => total + member.points, 0),
    totalStoredMembers: scoreboard.members.length,
    userFilterNote:
      members.length === 0
        ? `Filtered to linked players for **${escapeMarkdown(user.displayName)}** (${playerTags.length.toLocaleString()} linked tag${playerTags.length === 1 ? '' : 's'}, 0 matched members). No linked players are present in this stored scoreboard.`
        : `Filtered to linked players for **${escapeMarkdown(user.displayName)}** (${playerTags.length.toLocaleString()} linked tag${playerTags.length === 1 ? '' : 's'}, ${members.length.toLocaleString()} matched member${members.length === 1 ? '' : 's'}).`,
  };
}

export function buildClanGamesEmbed(
  scoreboard: ClanGamesScoreboardSnapshot & {
    readonly totalStoredMembers?: number;
    readonly userFilterNote?: string;
  },
  mentionSelectedClan: boolean,
  coverage?: ClanGamesCoverageContext,
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
  const descriptionLines = [
    'This scoreboard is built from persisted Clan Games snapshots collected by ClashMate polling; it is not a live Clash API lookup.',
    mentionSelectedClan
      ? `Using latest stored snapshot for **${escapeMarkdown(clanLabel)}**.`
      : null,
    `Season: **${escapeMarkdown(seasonLabel)}**${scoreboard.seasonId === getCurrentClanGamesSeasonId(new Date()) ? ' · current Clan Games season' : ''}`,
    `Snapshot source fetched: ${time(scoreboard.sourceFetchedAt, 'R')} · Persisted update: ${time(scoreboard.updatedAt, 'R')}`,
    `Snapshot coverage: ${formatLinkedClanSnapshotCount(coverage)} · ${totalStoredMembers.toLocaleString()} stored member${totalStoredMembers === 1 ? '' : 's'} · ${visibleMembers.length.toLocaleString()} visible${scoreboard.members.length !== totalStoredMembers ? ` · ${scoreboard.members.length.toLocaleString()} after filters` : ''}`,
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

function formatClanGamesNoDataMessage(input: {
  readonly clan?: string;
  readonly seasonId?: string;
  readonly usedCurrentSeasonDefault?: boolean;
  readonly user: User | null;
  readonly coverage: ClanGamesCoverageContext;
}): string {
  const filters = [
    `clan: ${input.clan ? `\`${escapeMarkdown(input.clan)}\`` : '`latest linked clan`'}`,
    `season: ${input.seasonId ? `\`${escapeMarkdown(input.seasonId)}\`${input.usedCurrentSeasonDefault ? ' (current Clan Games season default)' : ''}` : '`current Clan Games season`'}`,
    `user: ${input.user ? `**${escapeMarkdown(input.user.displayName)}**` : '`not filtered`'}`,
  ];

  return [
    CLAN_GAMES_NO_DATA_MESSAGE,
    `Filters checked: ${filters.join(' · ')}.`,
    `Stored coverage: ${formatLinkedClanSnapshotCount(input.coverage)} · latest snapshot ${formatLatestSnapshotContext(input.coverage)}.`,
    'Data source: persisted Clan Games snapshots for linked/configured clans only; no live Clash API fallback and no on-demand enrollment.',
    'Season choices follow the Clan Games cycle: before the monthly event window, the previous month remains the current season.',
    'Next: link/configure the clan if needed, enable worker polling, then wait for a Clan Games snapshot for the requested season.',
  ].join('\n');
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
