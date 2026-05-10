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
  'No attack or defense win data is available from the current public Clash API response for the scanned clan members.';

const ATTACKS_FILTER_HELP_TEXT =
  "Accepted clan filters: linked clan tag, saved alias, or exact linked clan name from this server's linked clans only. The `user` filter checks that Discord user's linked player tags against those linked clans, then falls back to the first linked clan.";
const ATTACKS_SOURCE_HELP_TEXT = [
  'Source: live public Clash API clan member list plus one player lookup per scanned member.',
  'This is a one-off public API scan for the selected linked clan; it does not persist history or enroll the clan or players into polling.',
  'Only the first 50 discovered clan members are scanned to limit API usage, and temporary rate limits or unavailable player profiles can produce partial results.',
  'Historical season archives are not available from the public API yet, and ClashMate has no persisted attack-win history fallback, so season choices currently label the request but still show current attack/defense wins.',
].join('\n');

const MAX_PLAYER_FETCHES = 50;
const EMBED_DESCRIPTION_LIMIT = 4096;
const ATTACKS_SEASON_CHOICE_LIMIT = 18;

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

export const ATTACKS_SEASON_CHOICES = createAttacksSeasonChoices();

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
      .setRequired(false)
      .addChoices(...ATTACKS_SEASON_CHOICES),
  );

export interface AttacksLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface AttacksStore {
  readonly listLinkedClans: (guildId: string) => Promise<AttacksLinkedClan[]>;
  readonly listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
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

export interface AttacksScanCoverage {
  readonly clanMembersDiscovered: number;
  readonly playerLookupsAttempted: number;
  readonly playerLookupsAnalyzed: number;
  readonly skippedDueToMaxPlayerFetches: number;
  readonly failedLookups: number;
  readonly rowsWithData: number;
}

export function createAttacksSeasonChoices(
  now: Date = new Date(),
): ApplicationCommandOptionChoiceData<string>[] {
  const monthIndex = now.getUTCMonth();
  const year = now.getUTCFullYear();

  return Array.from({ length: ATTACKS_SEASON_CHOICE_LIMIT }, (_, index) => {
    const monthOffset = monthIndex - index;
    const choiceYear = year + Math.floor(monthOffset / 12);
    const choiceMonthIndex = ((monthOffset % 12) + 12) % 12;
    const seasonId = `${choiceYear}-${(choiceMonthIndex + 1).toString().padStart(2, '0')}`;

    return {
      name: `${MONTH_NAMES[choiceMonthIndex]} ${choiceYear}`,
      value: seasonId,
    };
  });
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
  const userOption = interaction.options.getUser('user');
  const resolution = clanOption
    ? { clan: resolveAttacksClan(clans, clanOption), note: null }
    : await resolveAttacksClanForUser({
        clans,
        coc: options.coc,
        guildId: interaction.guildId,
        store: options.store,
        userId: userOption?.id ?? null,
      });
  const { clan } = resolution;
  if (!clan) {
    await interaction.editReply({
      content: `No linked clan was found for that clan option.\n${ATTACKS_FILTER_HELP_TEXT}`,
    });
    return;
  }

  let clashClan: ClashClan;
  try {
    clashClan = await options.coc.getClan(clan.clanTag);
  } catch {
    await interaction.editReply({ content: 'This clan tag is not valid or was not found.' });
    return;
  }

  const discoveredMemberTags = readClanMemberTags(clashClan.data);
  const season = interaction.options.getString('season');
  const memberTags = discoveredMemberTags.slice(0, MAX_PLAYER_FETCHES);
  if (discoveredMemberTags.length === 0) {
    await interaction.editReply({
      content: `${ATTACKS_NO_DATA_MESSAGE}\n${formatAttacksLimitationsText(season)}\n${formatAttacksCoverageText(
        createAttacksScanCoverage({
          clanMembersDiscovered: 0,
          playerLookupsAttempted: 0,
          playerLookupsAnalyzed: 0,
          failedLookups: 0,
          rowsWithData: 0,
        }),
      )}`,
    });
    return;
  }

  const playerScan = await fetchPlayersForAttacks(memberTags, options.coc);
  const rows = collectAttackWins(playerScan.players);
  const coverage = createAttacksScanCoverage({
    clanMembersDiscovered: discoveredMemberTags.length,
    playerLookupsAttempted: memberTags.length,
    playerLookupsAnalyzed: playerScan.players.length,
    failedLookups: playerScan.failedLookups,
    rowsWithData: rows.length,
  });
  if (rows.length === 0) {
    await interaction.editReply({
      content: `${ATTACKS_NO_DATA_MESSAGE}\n${formatAttacksLimitationsText(season)}\n${formatAttacksCoverageText(
        coverage,
      )}`,
    });
    return;
  }

  await interaction.editReply({
    ...(resolution.note ? { content: resolution.note } : {}),
    embeds: [buildAttacksEmbed(clashClan, rows, { coverage, season })],
  });
}

async function resolveAttacksClanForUser(input: {
  readonly clans: readonly AttacksLinkedClan[];
  readonly coc: AttacksCocApi;
  readonly guildId: string;
  readonly store: AttacksStore;
  readonly userId: string | null;
}): Promise<{ readonly clan: AttacksLinkedClan | undefined; readonly note: string | null }> {
  const fallbackClan = input.clans[0];
  if (!input.userId) return { clan: fallbackClan, note: null };

  const linkedPlayerTags = await input.store.listPlayerTagsForUser(input.guildId, input.userId);
  if (linkedPlayerTags.length === 0) {
    return {
      clan: fallbackClan,
      note: 'That Discord user has no linked players in this server, so I used the first linked clan.',
    };
  }

  const normalizedLinkedTags = new Set(linkedPlayerTags.map(normalizeComparableTag));
  for (const clan of input.clans) {
    try {
      const clashClan = await input.coc.getClan(clan.clanTag);
      const hasLinkedPlayer = readClanMemberTags(clashClan.data)
        .map(normalizeComparableTag)
        .some((memberTag) => normalizedLinkedTags.has(memberTag));
      if (hasLinkedPlayer) return { clan, note: null };
    } catch {
      // Ignore one-off lookup failures while trying other linked clans and the final fallback.
    }
  }

  return {
    clan: fallbackClan,
    note: "I couldn't find that user's linked players in any linked clan, so I used the first linked clan.",
  };
}

async function fetchPlayersForAttacks(
  memberTags: readonly string[],
  coc: AttacksCocApi,
): Promise<{ readonly players: ClashPlayer[]; readonly failedLookups: number }> {
  const players: ClashPlayer[] = [];
  let failedLookups = 0;
  for (const tag of memberTags) {
    try {
      players.push(await coc.getPlayer(tag));
    } catch {
      failedLookups += 1;
      // Ignore individual one-off lookup failures so one unavailable player does not fail the command.
    }
  }
  return { players, failedLookups };
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
  options: {
    readonly coverage?: AttacksScanCoverage | null;
    readonly season?: string | null;
  } = {},
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

  const seasonLabel = options.season ? formatAttacksSeasonLabel(options.season) : null;
  if (seasonLabel) embed.addFields({ name: 'Season', value: seasonLabel, inline: true });
  if (options.coverage) {
    embed.addFields({ name: 'Scan Coverage', value: formatAttacksCoverageText(options.coverage) });
  }
  embed.addFields({ name: 'Source & Limits', value: formatAttacksLimitationsText(options.season) });

  if (badgeUrl) embed.setThumbnail(badgeUrl);
  return embed;
}

export function createAttacksScanCoverage(input: {
  readonly clanMembersDiscovered: number;
  readonly playerLookupsAttempted: number;
  readonly playerLookupsAnalyzed: number;
  readonly failedLookups: number;
  readonly rowsWithData: number;
}): AttacksScanCoverage {
  return {
    ...input,
    skippedDueToMaxPlayerFetches: Math.max(
      0,
      input.clanMembersDiscovered - input.playerLookupsAttempted,
    ),
  };
}

export function formatAttacksCoverageText(coverage: AttacksScanCoverage): string {
  return [
    `Clan members discovered: ${coverage.clanMembersDiscovered}`,
    `Player lookups attempted/analyzed: ${coverage.playerLookupsAttempted}/${coverage.playerLookupsAnalyzed}`,
    `Skipped after scan cap (${MAX_PLAYER_FETCHES}): ${coverage.skippedDueToMaxPlayerFetches}`,
    `Failed lookups: ${coverage.failedLookups}`,
    `Rows with attack/defense data: ${coverage.rowsWithData}`,
  ].join('\n');
}

export function formatAttacksLimitationsText(season: string | null | undefined): string {
  return season
    ? `${ATTACKS_SOURCE_HELP_TEXT}\nRequested season: ${formatAttacksSeasonLabel(season)}.`
    : ATTACKS_SOURCE_HELP_TEXT;
}

export function formatAttacksSeasonLabel(season: string): string {
  const choice = ATTACKS_SEASON_CHOICES.find((entry) => entry.value === season);
  return choice ? `${choice.name} (${season})` : season;
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

function normalizeComparableTag(tag: string): string {
  try {
    return normalizeClashTag(tag).toLowerCase();
  } catch {
    return tag.trim().toLowerCase();
  }
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
