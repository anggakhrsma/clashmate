import type { ClanGamesScoreboardReader, ClanGamesScoreboardSnapshot } from '@clashmate/database';
import type {
  CommandContext,
  MessageCommandDefinition,
  SlashCommandDefinition,
} from '@clashmate/discord';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  time,
} from 'discord.js';

export const CLAN_GAMES_COMMAND_NAME = 'clan-games';
export const CLAN_GAMES_COMMAND_DESCRIPTION = 'Show a Clan Games scoreboard.';
export const CLAN_GAMES_NO_DATA_MESSAGE =
  'Clan Games data is not available yet. Link/configure the clan and wait for Clan Games polling to store a snapshot.';

const SCOREBOARD_MEMBER_LIMIT = 55;
const EMBED_DESCRIPTION_LIMIT = 4096;

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
  .addStringOption((option) => option.setName('season').setDescription('Clan Games season id.'));

export interface ClanGamesCommandOptions {
  readonly reader: ClanGamesScoreboardReader;
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

export function createClanGamesMessageCommand(
  options: ClanGamesCommandOptions,
): MessageCommandDefinition {
  return {
    name: CLAN_GAMES_COMMAND_NAME,
    aliases: ['clangames'],
    execute: async (message) => {
      if (!message.guildId) {
        await message.reply('`clan-games` can only be used in a server.');
        return;
      }

      if (!message.channel.isSendable()) {
        await message.reply('I cannot send Clan Games scoreboards in this channel.');
        return;
      }

      const query = parseClanGamesMessageCommand(message.content);
      const scoreboard = await options.reader.getLatestScoreboard({
        guildId: message.guildId,
        ...(query.clanTag ? { clanTag: query.clanTag } : {}),
        ...(query.seasonId ? { seasonId: query.seasonId } : {}),
      });

      if (!scoreboard) {
        await message.channel.send(CLAN_GAMES_NO_DATA_MESSAGE);
        return;
      }

      await message.channel.send({ embeds: [buildClanGamesEmbed(scoreboard, !query.clanTag)] });
    },
  };
}

export interface ClanGamesMessageQuery {
  readonly clanTag?: string;
  readonly seasonId?: string;
}

export function parseClanGamesMessageCommand(content: string): ClanGamesMessageQuery {
  const [, firstArg, secondArg] = content.trim().split(/\s+/, 3);

  if (!firstArg) return {};
  if (isSeasonId(firstArg)) return { seasonId: firstArg };

  return {
    clanTag: firstArg,
    ...(secondArg && isSeasonId(secondArg) ? { seasonId: secondArg } : {}),
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

  await interaction.reply({ embeds: [buildClanGamesEmbed(scoreboard, !clan)] });
}

export function buildClanGamesEmbed(
  scoreboard: ClanGamesScoreboardSnapshot,
  mentionSelectedClan: boolean,
): EmbedBuilder {
  const clanLabel = `${scoreboard.clanName ?? scoreboard.clanTag} (${scoreboard.clanTag})`;
  const visibleMembers = scoreboard.members.slice(0, SCOREBOARD_MEMBER_LIMIT);
  const descriptionLines = [
    mentionSelectedClan
      ? `Using latest stored snapshot for **${escapeMarkdown(clanLabel)}**.`
      : null,
    `Season: **${escapeMarkdown(scoreboard.seasonId)}**`,
    `Source fetched: ${time(scoreboard.sourceFetchedAt, 'R')}`,
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

function isSeasonId(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
