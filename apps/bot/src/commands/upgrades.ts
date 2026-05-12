import type { ClashPlayer } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  type User,
} from 'discord.js';
import { filterPlayerTagAutocompleteChoices, formatNoLinkedPlayerMessage } from './player.js';

export const UPGRADES_COMMAND_NAME = 'upgrades';
export const UPGRADES_COMMAND_DESCRIPTION = 'Show remaining player unit upgrades.';
export const UPGRADES_NOT_FOUND_MESSAGE = [
  'I could not load that player from the Clash of Clans API.',
  'Check that the tag is correct and public, then try again. If the tag is valid, the API may be temporarily unavailable.',
].join(' ');

const EMBED_FIELD_VALUE_LIMIT = 1024;
const EMBED_MAX_FIELDS = 25;
const EMBED_DESCRIPTION_LIMIT = 4096;

export const upgradesCommandData = new SlashCommandBuilder()
  .setName(UPGRADES_COMMAND_NAME)
  .setDescription(UPGRADES_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('player').setDescription('Player tag to look up.').setAutocomplete(true),
  )
  .addUserOption((option) =>
    option.setName('user').setDescription('Discord user whose linked account to show.'),
  );

export interface UpgradesCocApi {
  getPlayer: (playerTag: string) => Promise<ClashPlayer>;
}

export interface UpgradesPlayerLinkStore {
  listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
}

export interface UpgradesCommandOptions {
  readonly coc: UpgradesCocApi;
  readonly links: UpgradesPlayerLinkStore;
}

type UpgradesResolutionResult =
  | {
      readonly status: 'resolved';
      readonly playerTag: string;
      readonly targetUser: User | null;
      readonly source: 'player_option' | 'linked_user' | 'linked_default';
    }
  | { readonly status: 'invalid_tag' }
  | { readonly status: 'no_link'; readonly targetUser: User; readonly isSelf: boolean };

interface UpgradesEmbedContext {
  readonly source: 'player_option' | 'linked_user' | 'linked_default';
  readonly targetUser: User | null;
}

export interface UpgradeUnit {
  readonly name: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly village: string | null;
}

export interface UpgradeGroups {
  readonly troops: readonly UpgradeUnit[];
  readonly spells: readonly UpgradeUnit[];
  readonly heroes: readonly UpgradeUnit[];
  readonly heroEquipment: readonly UpgradeUnit[];
  readonly builderBase: readonly UpgradeUnit[];
}

interface UpgradeProgressSummary {
  readonly label: string;
  readonly incompleteUnits: number;
  readonly remainingLevels: number;
  readonly currentLevels: number;
  readonly maxLevels: number;
}

interface UpgradeFieldResult {
  readonly fields: Array<{ name: string; value: string; inline: false }>;
  readonly rowsShown: number;
  readonly rowsAvailable: number;
}

export function createUpgradesSlashCommand(
  options: UpgradesCommandOptions,
): SlashCommandDefinition {
  return {
    name: UPGRADES_COMMAND_NAME,
    data: upgradesCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== UPGRADES_COMMAND_NAME) return;
      await executeUpgrades(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== UPGRADES_COMMAND_NAME) return;
      await autocompleteUpgrades(interaction, options);
    },
  };
}

export async function autocompleteUpgrades(
  interaction: AutocompleteInteraction,
  options: Pick<UpgradesCommandOptions, 'links'>,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'player') {
    await interaction.respond([]);
    return;
  }

  try {
    const tags = await options.links.listPlayerTagsForUser(
      interaction.guildId,
      interaction.user.id,
    );
    await interaction.respond(filterUpgradesPlayerChoices(tags, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterUpgradesPlayerChoices(
  tags: readonly string[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  return filterPlayerTagAutocompleteChoices(tags, query);
}

export async function executeUpgrades(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: UpgradesCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/upgrades` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const resolution = await resolveUpgradesPlayerTag({
    guildId: interaction.guildId,
    invokingUser: interaction.user,
    playerOption: interaction.options.getString('player'),
    userOption: interaction.options.getUser('user'),
    links: options.links,
  });

  if (resolution.status === 'invalid_tag') {
    await interaction.reply({
      content:
        'That player filter is not a valid Clash player tag. Use `player:#TAG` or omit it to use your linked account; `user` accepts a Discord member with linked accounts.',
      ephemeral: true,
    });
    return;
  }

  if (resolution.status === 'no_link') {
    await interaction.reply({ content: formatUpgradesNoLinkMessage(resolution), ephemeral: true });
    return;
  }

  await interaction.deferReply();

  let player: ClashPlayer;
  try {
    player = await options.coc.getPlayer(resolution.playerTag);
  } catch {
    await interaction.editReply(formatUpgradesNotFoundMessage(resolution));
    return;
  }

  await interaction.editReply({
    embeds: [
      buildUpgradesEmbed(player, {
        source: resolution.source,
        targetUser: resolution.targetUser,
      }),
    ],
  });
}

export async function resolveUpgradesPlayerTag(input: {
  readonly guildId: string;
  readonly invokingUser: User;
  readonly playerOption: string | null;
  readonly userOption: User | null;
  readonly links: Pick<UpgradesPlayerLinkStore, 'listPlayerTagsForUser'>;
}): Promise<UpgradesResolutionResult> {
  if (input.playerOption) {
    try {
      return {
        status: 'resolved',
        playerTag: normalizeClashTag(input.playerOption),
        targetUser: input.userOption,
        source: 'player_option',
      };
    } catch {
      return { status: 'invalid_tag' };
    }
  }

  const targetUser = input.userOption ?? input.invokingUser;
  const [playerTag] = await input.links.listPlayerTagsForUser(input.guildId, targetUser.id);
  if (!playerTag)
    return { status: 'no_link', targetUser, isSelf: targetUser.id === input.invokingUser.id };
  return {
    status: 'resolved',
    playerTag,
    targetUser,
    source: input.userOption ? 'linked_user' : 'linked_default',
  };
}

export function buildUpgradesEmbed(
  player: ClashPlayer,
  context: UpgradesEmbedContext = { source: 'player_option', targetUser: null },
): EmbedBuilder {
  const progress = collectUpgradeProgress(player);
  const groups = collectRemainingUpgrades(player);
  const remainingLevels = countRemainingLevels(groups);
  const remainingUnits = countRemainingUnits(groups);
  const fieldResult = buildUpgradeFields(groups);
  const data = readRecord(player.data) ?? {};
  const townHall = readNumber(readValue(data, 'townHallLevel'));
  const builderHall = readNumber(readValue(data, 'builderHallLevel'));

  const embed = new EmbedBuilder()
    .setTitle(`Remaining Upgrades: ${escapeMarkdown(player.name)} (${player.tag})`)
    .setURL(
      `https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${encodeURIComponent(player.tag)}`,
    )
    .setDescription(
      truncateEmbedText(
        [
          `First pass using public API \`maxLevel\` values${townHall ? ` for TH ${townHall}` : ''}${builderHall ? ` / BH ${builderHall}` : ''}.`,
          formatUpgradesLookupSource(context),
          'Freshness: current Clash API response only; no cached snapshots or persisted upgrade history are used.',
          "Accepted filters: `player` for an exact Clash tag, or `user` for that member's first linked account when no player tag is supplied.",
          'Tracking: this one-off lookup does not enroll the player for polling or long-lived tracking.',
          'Recommendation limits: ClashMate currently uses public API unit `maxLevel` data and simple remaining-level heuristics, not full TH/BH cost/time tables, lab availability, books, hammers, builders, or magic item planning. Some rows can include levels above the current hall until static hall caps are added.',
          `Totals: **${remainingUnits.toLocaleString('en-US')}** upgrade rows with **${remainingLevels.toLocaleString('en-US')}** remaining levels/units.`,
          `Rows shown: **${fieldResult.rowsShown.toLocaleString('en-US')}** of **${fieldResult.rowsAvailable.toLocaleString('en-US')}** available${fieldResult.rowsShown < fieldResult.rowsAvailable ? ' due to Discord embed limits' : ''}.`,
          formatRemainingCategoryCounts(groups),
          formatUpgradeProgressSummary(progress),
        ].join('\n'),
        EMBED_DESCRIPTION_LIMIT,
        'Remaining upgrades from public API maxLevel values.',
      ),
    );

  for (const field of fieldResult.fields) embed.addFields(field);
  if (remainingLevels === 0)
    embed.addFields({
      name: 'Upgrades',
      value:
        'No remaining unit upgrades found from current API maxLevel values. If this looks wrong, retry with `player:#TAG`; ClashMate has no persisted upgrade history for this one-off lookup.',
      inline: false,
    });
  return embed;
}

function formatUpgradesNoLinkMessage(
  resolution: Extract<UpgradesResolutionResult, { status: 'no_link' }>,
): string {
  return [
    formatNoLinkedPlayerMessage(resolution),
    resolution.isSelf
      ? 'Lookup source: your default linked account was requested because no `player` tag or `user` was supplied.'
      : `Lookup source: ${escapeMarkdown(resolution.targetUser.username)}'s first linked account was requested because no \`player\` tag was supplied.`,
    'Freshness: `/upgrades` is a current-only Clash API lookup; it does not use persisted upgrade history or enroll players for polling.',
    'Try `player:#TAG` for a one-off lookup, or link an account before using the default/user source.',
  ].join('\n');
}

function formatUpgradesNotFoundMessage(
  resolution: Extract<UpgradesResolutionResult, { status: 'resolved' }>,
): string {
  return [
    UPGRADES_NOT_FOUND_MESSAGE,
    formatUpgradesLookupSource(resolution),
    'Freshness: looked up the current Clash API response only; no cached snapshots or persisted upgrade history were used.',
    'Tracking: this failed one-off lookup did not enroll the player for polling.',
  ].join('\n');
}

function formatUpgradesLookupSource(context: UpgradesEmbedContext): string {
  if (context.source === 'linked_default') {
    return 'Lookup source: your default linked player account because no `player` tag or `user` was supplied.';
  }

  if (context.source === 'linked_user') {
    const user = context.targetUser
      ? `${escapeMarkdown(context.targetUser.username)}'s`
      : "the selected user's";
    return `Lookup source: ${user} first linked player account.`;
  }

  if (context.targetUser) {
    return `Lookup source: explicit player tag; the selected user filter (${escapeMarkdown(context.targetUser.username)}) is ignored when \`player\` is provided.`;
  }

  return 'Lookup source: explicit player tag.';
}

function formatRemainingCategoryCounts(groups: UpgradeGroups): string {
  const rows = [
    ['Troops', groups.troops.length],
    ['Spells', groups.spells.length],
    ['Heroes', groups.heroes.length],
    ['Equipment', groups.heroEquipment.length],
    ['Builder', groups.builderBase.length],
  ] as const;
  return `Remaining categories: ${rows
    .map(([label, count]) => `${label} ${count.toLocaleString('en-US')}`)
    .join(' • ')}`;
}

export function collectRemainingUpgrades(player: ClashPlayer): UpgradeGroups {
  const data = readRecord(player.data) ?? {};
  const troops = readIncompleteUpgradeUnits(readValue(data, 'troops'));
  const spells = readIncompleteUpgradeUnits(readValue(data, 'spells'));
  const heroes = readIncompleteUpgradeUnits(readValue(data, 'heroes'));
  const equipment = readIncompleteUpgradeUnits(readValue(data, 'heroEquipment'));

  return {
    troops: troops.filter((unit) => unit.village !== 'builderBase'),
    spells,
    heroes,
    heroEquipment: equipment,
    builderBase: troops.filter((unit) => unit.village === 'builderBase'),
  };
}

export function collectUpgradeProgress(player: ClashPlayer): UpgradeProgressSummary[] {
  const data = readRecord(player.data) ?? {};
  const troops = readUpgradeUnits(readValue(data, 'troops'));
  const spells = readUpgradeUnits(readValue(data, 'spells'));
  const heroes = readUpgradeUnits(readValue(data, 'heroes'));
  const equipment = readUpgradeUnits(readValue(data, 'heroEquipment'));

  return [
    summarizeUpgradeProgress('Home', [
      ...troops.filter((unit) => unit.village !== 'builderBase'),
      ...spells,
    ]),
    summarizeUpgradeProgress(
      'Builder',
      troops.filter((unit) => unit.village === 'builderBase'),
    ),
    summarizeUpgradeProgress('Heroes', heroes),
    summarizeUpgradeProgress('Equipment', equipment),
  ];
}

export function countRemainingLevels(groups: UpgradeGroups): number {
  return Object.values(groups)
    .flat()
    .reduce((sum, unit) => sum + Math.max(0, unit.maxLevel - unit.level), 0);
}

export function countRemainingUnits(groups: UpgradeGroups): number {
  return Object.values(groups).flat().length;
}

function buildUpgradeFields(groups: UpgradeGroups): UpgradeFieldResult {
  const definitions = [
    ['Troops', groups.troops],
    ['Spells', groups.spells],
    ['Heroes', groups.heroes],
    ['Hero Equipment', groups.heroEquipment],
    ['Builder Base', groups.builderBase],
  ] as const;
  const fields: Array<{ name: string; value: string; inline: false }> = [];
  let rowsShown = 0;
  const rowsAvailable = definitions.reduce((sum, [, units]) => sum + units.length, 0);

  for (const [name, units] of definitions) {
    if (!units.length || fields.length >= EMBED_MAX_FIELDS) continue;
    for (const chunk of chunkUnitRows(units)) {
      if (fields.length >= EMBED_MAX_FIELDS) break;
      fields.push({
        name: fields.some((field) => field.name === name) ? `${name} (continued)` : name,
        value: chunk.value,
        inline: false,
      });
      rowsShown += chunk.rows;
    }
  }
  return { fields, rowsShown, rowsAvailable };
}

function chunkUnitRows(units: readonly UpgradeUnit[]): Array<{ value: string; rows: number }> {
  const chunks: Array<{ value: string; rows: number }> = [];
  let rows: string[] = [];
  let length = 0;
  for (const row of units.map(formatUpgradeUnit)) {
    const nextLength = length === 0 ? row.length : length + 1 + row.length;
    if (rows.length && nextLength > EMBED_FIELD_VALUE_LIMIT) {
      chunks.push({ value: rows.join('\n'), rows: rows.length });
      rows = [];
      length = 0;
    }
    rows.push(row);
    length = length === 0 ? row.length : length + 1 + row.length;
  }
  if (rows.length) chunks.push({ value: rows.join('\n'), rows: rows.length });
  return chunks;
}

function formatUpgradeUnit(unit: UpgradeUnit): string {
  const remaining = Math.max(0, unit.maxLevel - unit.level);
  return `**${escapeMarkdown(unit.name)}** ${unit.level}/${unit.maxLevel} (${remaining} left)`;
}

function readUpgradeUnits(value: unknown): UpgradeUnit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = readString(readValue(item, 'name'));
    const level = readNumber(readValue(item, 'level'));
    const maxLevel = readNumber(readValue(item, 'maxLevel'));
    const village = readString(readValue(item, 'village'));
    if (!name || level === null || maxLevel === null || maxLevel <= 0) return [];
    return [{ name, level, maxLevel, village }];
  });
}

function readIncompleteUpgradeUnits(value: unknown): UpgradeUnit[] {
  return readUpgradeUnits(value).filter((unit) => unit.level < unit.maxLevel);
}

function summarizeUpgradeProgress(
  label: string,
  units: readonly UpgradeUnit[],
): UpgradeProgressSummary {
  return units.reduce<UpgradeProgressSummary>(
    (summary, unit) => {
      const currentLevel = Math.max(0, Math.min(unit.level, unit.maxLevel));
      const remainingLevels = Math.max(0, unit.maxLevel - currentLevel);
      return {
        label: summary.label,
        incompleteUnits: summary.incompleteUnits + (remainingLevels > 0 ? 1 : 0),
        remainingLevels: summary.remainingLevels + remainingLevels,
        currentLevels: summary.currentLevels + currentLevel,
        maxLevels: summary.maxLevels + unit.maxLevel,
      };
    },
    { label, incompleteUnits: 0, remainingLevels: 0, currentLevels: 0, maxLevels: 0 },
  );
}

function formatUpgradeProgressSummary(summaries: readonly UpgradeProgressSummary[]): string {
  const rows = summaries.map((summary) => {
    const percent =
      summary.maxLevels > 0 ? (summary.currentLevels / summary.maxLevels) * 100 : null;
    const ratio = `${summary.currentLevels.toLocaleString('en-US')}/${summary.maxLevels.toLocaleString('en-US')}`;
    const percentage = percent === null ? 'n/a' : `${percent.toFixed(1)}%`;
    return `**${summary.label}:** ${summary.incompleteUnits.toLocaleString('en-US')} units, ${summary.remainingLevels.toLocaleString('en-US')} levels left (${ratio}, ${percentage})`;
  });
  return `Progress: ${rows.join(' • ')}`;
}

function truncateEmbedText(value: string, limit: number, fallback: string): string {
  const text = value.trim() || fallback;
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
