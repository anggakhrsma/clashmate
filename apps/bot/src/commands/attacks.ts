import type { ClashClan, ClashPlayer } from '@clashmate/coc';
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

export const ATTACKS_COMMAND_NAME = 'attacks';
export const ATTACKS_COMMAND_DESCRIPTION = 'Show attack and defense wins for a linked clan.';
export const ATTACKS_NO_LINKED_CLANS_MESSAGE =
  'No clans are linked to this server yet. Use `/setup clan` to link one.';
export const ATTACKS_NO_DATA_MESSAGE =
  'No attack or defense win data is available from the current public Clash API response.';

const MAX_PLAYER_FETCHES = 50;
const EMBED_DESCRIPTION_LIMIT = 4096;

export const attacksCommandData = new SlashCommandBuilder()
  .setName(ATTACKS_COMMAND_NAME)
  .setDescription(ATTACKS_COMMAND_DESCRIPTION)
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
      .setDescription('Discord user whose linked clan should be shown when available.')
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('season')
      .setDescription('Season to show when historical data is available.')
      .setRequired(false),
  );

export interface AttacksLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface AttacksStore {
  readonly listLinkedClans: (guildId: string) => Promise<AttacksLinkedClan[]>;
}

export interface AttacksCocApi {
  readonly getClan: (clanTag: string) => Promise<ClashClan>;
  readonly getPlayer: (playerTag: string) => Promise<ClashPlayer>;
}

export interface AttacksCommandOptions {
  readonly store: AttacksStore;
  readonly coc: AttacksCocApi;
}

export interface AttackWinsRow {
  readonly name: string;
  readonly tag: string;
  readonly attackWins: number;
  readonly defenseWins: number;
}

export function createAttacksSlashCommand(options: AttacksCommandOptions): SlashCommandDefinition {
  return {
    name: ATTACKS_COMMAND_NAME,
    data: attacksCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== ATTACKS_COMMAND_NAME) return;
      await executeAttacks(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== ATTACKS_COMMAND_NAME) return;
      await autocompleteAttacks(interaction, options);
    },
  };
}

async function autocompleteAttacks(
  interaction: AutocompleteInteraction,
  options: AttacksCommandOptions,
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
    await interaction.respond(filterAttacksClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterAttacksClanChoices(
  clans: readonly AttacksLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export async function executeAttacks(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: AttacksCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/attacks` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const clans = await options.store.listLinkedClans(interaction.guildId);
  if (clans.length === 0) {
    await interaction.editReply({ content: ATTACKS_NO_LINKED_CLANS_MESSAGE });
    return;
  }

  const clanOption = interaction.options.getString('clan');
  const clan = clanOption ? resolveAttacksClan(clans, clanOption) : clans[0];
  if (!clan) {
    await interaction.editReply({ content: 'No linked clan was found for that clan option.' });
    return;
  }

  let clashClan: ClashClan;
  try {
    clashClan = await options.coc.getClan(clan.clanTag);
  } catch {
    await interaction.editReply({ content: 'This clan tag is not valid or was not found.' });
    return;
  }

  const memberTags = readClanMemberTags(clashClan.data).slice(0, MAX_PLAYER_FETCHES);
  if (memberTags.length === 0) {
    await interaction.editReply({ content: ATTACKS_NO_DATA_MESSAGE });
    return;
  }

  const players = await fetchPlayersForAttacks(memberTags, options.coc);
  const rows = collectAttackWins(players);
  if (rows.length === 0) {
    await interaction.editReply({ content: ATTACKS_NO_DATA_MESSAGE });
    return;
  }

  const season = interaction.options.getString('season');
  await interaction.editReply({ embeds: [buildAttacksEmbed(clashClan, rows, { season })] });
}

async function fetchPlayersForAttacks(
  memberTags: readonly string[],
  coc: AttacksCocApi,
): Promise<ClashPlayer[]> {
  const players: ClashPlayer[] = [];
  for (const tag of memberTags) {
    try {
      players.push(await coc.getPlayer(tag));
    } catch {
      // Ignore individual one-off lookup failures so one unavailable player does not fail the command.
    }
  }
  return players;
}

export function collectAttackWins(players: readonly ClashPlayer[]): AttackWinsRow[] {
  return players
    .flatMap((player) => {
      const attackWins = readNumber(readValue(readRecord(player.data), 'attackWins'));
      const defenseWins = readNumber(readValue(readRecord(player.data), 'defenseWins'));
      if (attackWins === null && defenseWins === null) return [];
      return [
        {
          name: player.name,
          tag: player.tag,
          attackWins: attackWins ?? 0,
          defenseWins: defenseWins ?? 0,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.attackWins - left.attackWins ||
        right.defenseWins - left.defenseWins ||
        left.name.localeCompare(right.name) ||
        left.tag.localeCompare(right.tag),
    );
}

export function buildAttacksEmbed(
  clan: Pick<ClashClan, 'name' | 'tag' | 'data'>,
  rows: readonly AttackWinsRow[],
  options: { readonly season?: string | null } = {},
): EmbedBuilder {
  const badgeUrl = readBadgeUrl(clan.data);
  const embed = new EmbedBuilder()
    .setAuthor({ name: `${clan.name} (${clan.tag})`, ...(badgeUrl ? { iconURL: badgeUrl } : {}) })
    .setTitle('Attack Wins')
    .setDescription(formatAttacksTable(rows))
    .setFooter({
      text: options.season
        ? 'Current public API attack/defense wins only; historical seasons are not available yet.'
        : 'Current public API attack/defense wins.',
    })
    .setTimestamp();

  if (badgeUrl) embed.setThumbnail(badgeUrl);
  return embed;
}

export function resolveAttacksClan(
  clans: readonly AttacksLinkedClan[],
  query: string,
): AttacksLinkedClan | undefined {
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

function formatAttacksTable(rows: readonly AttackWinsRow[]): string {
  const lines = [
    `\u200e ${'#'}  ${'ATK'}  ${'DEF'}  ${'NAME'.padEnd(15, ' ')}`,
    ...rows.map((row, index) => {
      const rank = (index + 1).toString().padStart(2, ' ');
      const attackWins = row.attackWins.toString().padStart(3, ' ');
      const defenseWins = row.defenseWins.toString().padStart(3, ' ');
      const name = escapeMarkdown(row.name.replace(/`/g, '\\`')).slice(0, 15).padEnd(15, ' ');
      return `${rank}  ${attackWins}  ${defenseWins}  \u200e${name} ${row.tag}`;
    }),
  ];
  const table = `\`\`\`\n${lines.join('\n')}\n\`\`\``;
  if (table.length <= EMBED_DESCRIPTION_LIMIT) return table;
  return `${table.slice(0, EMBED_DESCRIPTION_LIMIT - 5)}\n\`\`\``;
}

function readClanMemberTags(data: unknown): string[] {
  const memberList = readValue(readRecord(data), 'memberList');
  if (!Array.isArray(memberList)) return [];
  return memberList.flatMap((member) => {
    const tag = readValue(readRecord(member), 'tag');
    return typeof tag === 'string' ? [tag] : [];
  });
}

function clanMatchesQuery(clan: AttacksLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: AttacksLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${escapeMarkdown(label)} (${clan.clanTag})`.slice(0, 100);
}

function readBadgeUrl(data: unknown): string | undefined {
  const badgeUrls = readValue(readRecord(data), 'badgeUrls');
  const small = readValue(readRecord(badgeUrls), 'small');
  const medium = readValue(readRecord(badgeUrls), 'medium');
  if (typeof medium === 'string') return medium;
  if (typeof small === 'string') return small;
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
