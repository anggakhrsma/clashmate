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

export const HISTORY_COMMAND_NAME = 'history';
export const HISTORY_COMMAND_DESCRIPTION = 'Show tracked historical activity.';
export const HISTORY_NO_DONATION_EVENTS_MESSAGE =
  'No donation history is available yet. Link/configure a clan and wait for donation events to be detected.';

const HISTORY_OPTIONS = ['donations'] as const;
type HistoryOption = (typeof HISTORY_OPTIONS)[number];
const MAX_HISTORY_ROWS = 15;
const EMBED_DESCRIPTION_LIMIT = 4096;

export const historyCommandData = new SlashCommandBuilder()
  .setName(HISTORY_COMMAND_NAME)
  .setDescription(HISTORY_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('option')
      .setDescription('Select a historical activity view.')
      .setRequired(true)
      .addChoices({ name: 'Donations', value: 'donations' }),
  )
  .addStringOption((option) =>
    option
      .setName('clans')
      .setDescription('Clan tag, name, or alias filter.')
      .setAutocomplete(true)
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('player')
      .setDescription('Player tag to filter.')
      .setAutocomplete(true)
      .setRequired(false),
  )
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('Discord user whose linked players should be matched.')
      .setRequired(false),
  );

export interface HistoryLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface DonationHistoryRow {
  readonly playerTag: string;
  readonly playerName: string;
  readonly donated: number;
  readonly received: number;
  readonly eventCount: number;
  readonly lastDetectedAt: Date;
}

export interface HistoryStore {
  readonly listLinkedClans: (guildId: string) => Promise<HistoryLinkedClan[]>;
  readonly listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
  readonly listDonationHistoryForGuild: (input: {
    guildId: string;
    clanTags?: readonly string[];
    playerTags?: readonly string[];
    since?: Date;
  }) => Promise<DonationHistoryRow[]>;
}

export interface HistoryCommandOptions {
  readonly store: HistoryStore;
}

export function createHistorySlashCommand(options: HistoryCommandOptions): SlashCommandDefinition {
  return {
    name: HISTORY_COMMAND_NAME,
    data: historyCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== HISTORY_COMMAND_NAME) return;
      await executeHistory(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== HISTORY_COMMAND_NAME) return;
      await autocompleteHistory(interaction, options);
    },
  };
}

async function autocompleteHistory(
  interaction: AutocompleteInteraction,
  options: HistoryCommandOptions,
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
    await interaction.respond(filterHistoryClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterHistoryClanChoices(
  clans: readonly HistoryLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export async function executeHistory(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: HistoryCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/history` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const option = interaction.options.getString('option', true);
  if (!isHistoryOption(option)) {
    await interaction.editReply({ content: 'Only donation history is available right now.' });
    return;
  }

  const clanOption = interaction.options.getString('clans');
  const playerOption = interaction.options.getString('player');
  const userOption = interaction.options.getUser('user');
  const clans = await options.store.listLinkedClans(interaction.guildId);

  let clanTags: string[] | undefined;
  let clanLabel: string | undefined;
  if (clanOption) {
    const clan = resolveHistoryClan(clans, clanOption);
    if (!clan) {
      await interaction.editReply({ content: 'No linked clan was found for that clan option.' });
      return;
    }
    clanTags = [clan.clanTag];
    clanLabel = `${clan.alias ?? clan.name ?? 'Linked Clan'} (${clan.clanTag})`;
  }

  let playerTags: string[] | undefined;
  if (playerOption) {
    try {
      playerTags = [normalizeClashTag(playerOption)];
    } catch {
      await interaction.editReply({ content: 'That player tag is not valid.' });
      return;
    }
  } else if (userOption) {
    playerTags = await options.store.listPlayerTagsForUser(interaction.guildId, userOption.id);
    if (playerTags.length === 0) {
      await interaction.editReply({ content: formatNoLinkedPlayersMessage(userOption) });
      return;
    }
  }

  const rows = await options.store.listDonationHistoryForGuild({
    guildId: interaction.guildId,
    ...(clanTags ? { clanTags } : {}),
    ...(playerTags ? { playerTags } : {}),
  });

  if (rows.length === 0) {
    await interaction.editReply({ content: HISTORY_NO_DONATION_EVENTS_MESSAGE });
    return;
  }

  await interaction.editReply({ embeds: [buildDonationHistoryEmbed(rows, clanLabel, userOption)] });
}

function isHistoryOption(value: string): value is HistoryOption {
  return HISTORY_OPTIONS.includes(value as HistoryOption);
}

function formatNoLinkedPlayersMessage(user: User): string {
  return `**${escapeMarkdown(user.displayName)}** does not have linked player accounts. Use \`/link create\` first.`;
}

export function resolveHistoryClan(
  clans: readonly HistoryLinkedClan[],
  query: string,
): HistoryLinkedClan | undefined {
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

export function buildDonationHistoryEmbed(
  rows: readonly DonationHistoryRow[],
  clanLabel: string | undefined,
  user: User | null,
): EmbedBuilder {
  const selectedRows = rows.slice(0, MAX_HISTORY_ROWS);
  const totals = rows.reduce(
    (acc, row) => ({ donated: acc.donated + row.donated, received: acc.received + row.received }),
    { donated: 0, received: 0 },
  );
  const embed = new EmbedBuilder()
    .setTitle('Donation History')
    .setDescription(truncateEmbedDescription(formatDonationHistoryRows(selectedRows)))
    .addFields(
      {
        name: 'Totals',
        value: `${totals.donated} donated · ${totals.received} received · ${formatDifference(
          totals.donated - totals.received,
        )} difference`,
        inline: false,
      },
      {
        name: 'Source',
        value: 'Values are based on detected donation delta events over the recent history window.',
        inline: false,
      },
    )
    .setFooter({
      text: `Showing ${selectedRows.length}/${rows.length} players from stored events`,
    });

  if (clanLabel) embed.addFields({ name: 'Clan filter', value: clanLabel, inline: false });
  if (user) embed.setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() });
  return embed;
}

function formatDonationHistoryRows(rows: readonly DonationHistoryRow[]): string {
  return rows
    .map((row, index) => {
      const diff = row.donated - row.received;
      return `${index + 1}. **${escapeMarkdown(row.playerName)}** (\`${row.playerTag}\`) · ${row.donated} donated · ${row.received} received · ${formatDifference(diff)} diff · ${row.eventCount} events · ${time(row.lastDetectedAt, 'R')}`;
    })
    .join('\n');
}

function clanMatchesQuery(clan: HistoryLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: HistoryLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function truncateEmbedDescription(text: string): string {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…`;
}

function formatDifference(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
