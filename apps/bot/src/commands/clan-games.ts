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
  'Clan Games data is not available yet. Link/configure the clan and wait for Clan Games polling to store a snapshot.';

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
  const currentMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return Array.from({ length: SEASON_CHOICE_LIMIT }, (_, index) => {
    const seasonDate = new Date(currentMonth);
    seasonDate.setUTCMonth(seasonDate.getUTCMonth() - index);
    const seasonId = seasonDate.toISOString().slice(0, 7);
    return {
      name: formatClanGamesSeasonChoiceName(seasonDate),
      value: seasonId,
    };
  });
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
  const seasonId = interaction.options.getString('season') ?? undefined;
  const scoreboard = await options.reader.getLatestScoreboard({
    guildId: interaction.guildId,
    ...(clan ? { clanTag: clan } : {}),
    ...(seasonId ? { seasonId } : {}),
  });

  if (!scoreboard) {
    await interaction.reply({
      content: CLAN_GAMES_NO_DATA_MESSAGE,
      ephemeral: true,
    });
    return;
  }

  if (!user) {
    await interaction.reply({ embeds: [buildClanGamesEmbed(scoreboard, !clan)] });
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
    embeds: [buildClanGamesEmbed(filterScoreboardForUser(scoreboard, user, playerTags), !clan)],
  });
}

function filterScoreboardForUser(
  scoreboard: ClanGamesScoreboardSnapshot,
  user: User,
  playerTags: readonly string[],
): ClanGamesScoreboardSnapshot & { readonly userFilterNote: string } {
  const linkedTags = new Set(playerTags.map((tag) => tag.toUpperCase()));
  const members = scoreboard.members.filter((member) =>
    linkedTags.has(member.playerTag.toUpperCase()),
  );
  return {
    ...scoreboard,
    members,
    totalPoints: members.reduce((total, member) => total + member.points, 0),
    userFilterNote:
      members.length === 0
        ? `Filtered to linked players for **${escapeMarkdown(user.displayName)}**; no linked players are present in this stored scoreboard.`
        : `Filtered to linked players for **${escapeMarkdown(user.displayName)}**.`,
  };
}

export function buildClanGamesEmbed(
  scoreboard: ClanGamesScoreboardSnapshot & { readonly userFilterNote?: string },
  mentionSelectedClan: boolean,
): EmbedBuilder {
  const clanLabel = `${scoreboard.clanName ?? scoreboard.clanTag} (${scoreboard.clanTag})`;
  const seasonChoice = clanGamesSeasonChoices.find(
    (choice) => choice.value === scoreboard.seasonId,
  );
  const seasonLabel = seasonChoice
    ? `${scoreboard.seasonId} (${seasonChoice.name})`
    : scoreboard.seasonId;
  const visibleMembers = scoreboard.members.slice(0, SCOREBOARD_MEMBER_LIMIT);
  const descriptionLines = [
    mentionSelectedClan
      ? `Using latest stored snapshot for **${escapeMarkdown(clanLabel)}**.`
      : null,
    `Season: **${escapeMarkdown(seasonLabel)}**`,
    `Source fetched: ${time(scoreboard.sourceFetchedAt, 'R')}`,
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
    )
    .setFooter({
      text: `Showing top ${visibleMembers.length} of ${scoreboard.members.length}${scoreboard.eventMaxPoints > 0 ? ` · Event max ${scoreboard.eventMaxPoints.toLocaleString()}` : ''}`,
    })
    .setTimestamp(scoreboard.updatedAt);

  return embed;
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
