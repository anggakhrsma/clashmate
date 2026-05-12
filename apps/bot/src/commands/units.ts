import type { ClashPlayer } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  type User,
} from 'discord.js';
import {
  filterPlayerTagAutocompleteChoices,
  formatNoLinkedPlayerMessage,
  PLAYER_NOT_FOUND_MESSAGE,
  type PlayerCocApi,
  type PlayerLinkStore,
  resolvePlayerTag,
} from './player.js';

export const UNITS_COMMAND_NAME = 'units';
export const UNITS_COMMAND_DESCRIPTION = 'View current unit levels for a Clash of Clans player.';

const EMBED_FIELD_VALUE_LIMIT = 1024;
const EMBED_MAX_FIELDS = 25;
const UNIT_ROWS_PER_FIELD = 18;

export const unitsCommandData = new SlashCommandBuilder()
  .setName(UNITS_COMMAND_NAME)
  .setDescription(UNITS_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('player').setDescription('Player tag to look up.').setAutocomplete(true),
  )
  .addUserOption((option) =>
    option.setName('user').setDescription('Discord user whose linked account to show.'),
  );

export interface UnitsCommandOptions {
  readonly coc: PlayerCocApi;
  readonly links: Pick<PlayerLinkStore, 'listPlayerTagsForUser'>;
}

interface UnitView {
  readonly name: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly village: string | null;
}

interface UnitGroupView {
  readonly title: string;
  readonly summaryTitle: string | null;
  readonly units: readonly UnitView[];
}

interface UnitProgressSummary {
  readonly totalUnits: number;
  readonly maxedUnits: number;
  readonly incompleteUnits: number;
  readonly levelsGained: number;
  readonly maxLevels: number;
  readonly categoryCounts: readonly string[];
  readonly groupCounts: readonly string[];
}

type UnitsLookupResolution = {
  readonly source: 'explicit_tag' | 'stored_user_link';
  readonly targetUser?: User | null;
};

export function createUnitsSlashCommand(options: UnitsCommandOptions): SlashCommandDefinition {
  return {
    name: UNITS_COMMAND_NAME,
    data: unitsCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== UNITS_COMMAND_NAME) return;
      await executeUnits(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== UNITS_COMMAND_NAME) return;
      await autocompleteUnits(interaction, options);
    },
  };
}

export async function autocompleteUnits(
  interaction: AutocompleteInteraction,
  options: Pick<UnitsCommandOptions, 'links'>,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
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
    await interaction.respond(
      filterPlayerTagAutocompleteChoices(tags, String(focused.value ?? '')),
    );
  } catch {
    await interaction.respond([]);
  }
}

export async function executeUnits(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: UnitsCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: '`/units` can only be used in a server.', ephemeral: true });
    return;
  }

  const resolution = await resolvePlayerTag({
    guildId: interaction.guildId,
    invokingUser: interaction.user,
    tagOption: interaction.options.getString('player'),
    userOption: interaction.options.getUser('user'),
    links: options.links,
  });

  if (resolution.status === 'invalid_tag') {
    await interaction.reply({
      content: formatInvalidUnitsLookupMessage(resolution.input),
      ephemeral: true,
    });
    return;
  }

  if (resolution.status === 'no_link') {
    await interaction.reply({
      content: formatUnitsNoLinkedPlayerMessage(resolution),
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  let player: ClashPlayer;
  try {
    player = await options.coc.getPlayer(resolution.playerTag);
  } catch {
    await interaction.editReply(formatUnitsApiErrorMessage(resolution.playerTag, resolution));
    return;
  }

  await interaction.editReply({ embeds: [buildUnitsEmbed(player, resolution)] });
}

export function buildUnitsEmbed(
  player: ClashPlayer,
  resolutionOrSource: UnitsLookupResolution | UnitsLookupResolution['source'],
): EmbedBuilder {
  const resolution =
    typeof resolutionOrSource === 'string'
      ? { source: resolutionOrSource, targetUser: null }
      : resolutionOrSource;
  const data = isRecord(player.data) ? player.data : {};
  const townHallLevel = readNumber(readValue(data, 'townHallLevel'));
  const builderHallLevel = readNumber(readValue(data, 'builderHallLevel'));
  const embed = new EmbedBuilder()
    .setAuthor({ name: `${sanitize(player.name)} (${player.tag})` })
    .setDescription(
      `Units for TH${townHallLevel ?? 'Unknown'}${builderHallLevel ? ` and BH${builderHallLevel}` : ''}`,
    )
    .setFooter({
      text: [
        `Source: ${formatLookupSource(resolution.source, resolution.targetUser)}.`,
        'Live public Clash API snapshot; no polling enrollment or persisted history.',
      ].join(' '),
    });

  const groups: UnitGroupView[] = [
    {
      title: 'Home Troops',
      summaryTitle: 'Home',
      units: readUnits(readValue(data, 'troops'), { village: 'home' }),
    },
    {
      title: 'Builder Base Troops',
      summaryTitle: 'Builder Base',
      units: readUnits(readValue(data, 'troops'), { village: 'builderBase' }),
    },
    { title: 'Spells', summaryTitle: 'Home', units: readUnits(readValue(data, 'spells')) },
    { title: 'Heroes', summaryTitle: 'Heroes', units: readUnits(readValue(data, 'heroes')) },
    {
      title: 'Hero Equipment',
      summaryTitle: 'Hero Equipment',
      units: readUnits(readValue(data, 'heroEquipment')),
    },
  ];

  embed.addFields({
    name: 'Lookup Context',
    value: formatLookupContext(resolution, player.tag),
    inline: false,
  });

  embed.addFields({
    name: 'Progress Summary',
    value: formatProgressSummary(summarizeUnitProgress(groups)),
    inline: false,
  });

  embed.addFields({
    name: 'Display Notes',
    value: [
      'Coverage is derived from categories present in this public API response: troops, spells, heroes, and hero equipment.',
      'Pets, siege machines, and other troop-like units may appear under Home Troops when the API does not expose a separate display category.',
      'Max levels are the values returned by the API for the player snapshot, not a manual ClashMate progression table.',
    ].join('\n'),
    inline: false,
  });

  let fieldCount = 3;
  let unitFieldCount = 0;
  for (const { title, units } of groups) {
    if (units.length === 0 || fieldCount >= EMBED_MAX_FIELDS) continue;
    for (const [index, chunk] of chunkUnits(units).entries()) {
      if (fieldCount >= EMBED_MAX_FIELDS) break;
      embed.addFields({
        name: index === 0 ? title : `${title} (${index + 1})`,
        value: formatUnitRows(chunk),
        inline: false,
      });
      fieldCount += 1;
      unitFieldCount += 1;
    }
  }

  if (unitFieldCount === 0) {
    embed.addFields({
      name: 'Units',
      value: [
        'No public unit, hero, spell, pet, or equipment level data was found in the Clash API response.',
        `Source used: ${formatLookupSource(resolution.source, resolution.targetUser)}.`,
        'This is a live public lookup with no stored history; verify the tag, use `/link create`, or try again later.',
      ].join(' '),
      inline: false,
    });
  }

  return embed;
}

function formatInvalidUnitsLookupMessage(input: string): string {
  return [
    `I could not normalize \`${input.trim() || 'that value'}\` as a Clash player tag.`,
    'Use `player:#ABC123`, choose an autocomplete result from your linked accounts, or use `user:@member` for a stored Discord user link.',
  ].join(' ');
}

function formatUnitsNoLinkedPlayerMessage(
  result: Parameters<typeof formatNoLinkedPlayerMessage>[0],
): string {
  return [
    formatNoLinkedPlayerMessage(result),
    result.isSelf
      ? 'Use `/link create`, or use `player:#ABC123` for a live one-off units lookup.'
      : 'Ask them to use `/link create`, or use `player:#ABC123` for a live one-off units lookup.',
    'Live one-off lookups are not enrolled for polling and do not create stored unit history.',
  ].join(' ');
}

function formatUnitsApiErrorMessage(playerTag: string, resolution: UnitsLookupResolution): string {
  return [
    `Clash API could not return current unit data for \`${playerTag}\` (${formatLookupSource(resolution.source, resolution.targetUser)}).`,
    PLAYER_NOT_FOUND_MESSAGE,
    'This was a live one-off lookup only: no polling enrollment, cached snapshot, or persisted unit history was created. Check the source/tag or try again later if the API is unavailable.',
  ].join(' ');
}

function formatLookupSource(
  source: 'explicit_tag' | 'stored_user_link',
  targetUser?: User | null,
): string {
  if (source === 'explicit_tag') return 'player tag option';
  if (!targetUser) return 'linked Discord user';
  return `linked Discord user ${sanitize(targetUser.displayName)}`;
}

function formatLookupContext(resolution: UnitsLookupResolution, playerTag: string): string {
  const linkedScope =
    resolution.targetUser && resolution.source === 'stored_user_link'
      ? `Stored link scope: this server's link for **${sanitize(resolution.targetUser.displayName)}**.`
      : 'Stored link scope: none; explicit tags bypass Discord account links.';

  const resolutionDetail =
    resolution.source === 'explicit_tag'
      ? 'Resolution: player tag option was normalized directly.'
      : 'Resolution: no player tag was provided, so a stored Discord user link supplied the tag.';

  return [
    resolutionDetail,
    linkedScope,
    `Resolved player: \`${playerTag}\`.`,
    'API source: live public Clash API player endpoint through ClashMate lookup only.',
    'Storage: no polling enrollment, cached snapshot, or persisted unit history is created.',
  ].join('\n');
}

function summarizeUnitProgress(groups: readonly UnitGroupView[]): UnitProgressSummary {
  let totalUnits = 0;
  let maxedUnits = 0;
  let levelsGained = 0;
  let maxLevels = 0;
  const groupedCounts = new Map<string, { total: number; maxed: number }>();
  const categoryCounts: string[] = [];

  for (const group of groups) {
    if (group.units.length > 0) {
      categoryCounts.push(`${group.title}: ${group.units.length}`);
    }
    for (const unit of group.units) {
      totalUnits += 1;
      levelsGained += unit.level;
      maxLevels += unit.maxLevel;
      if (unit.level >= unit.maxLevel) maxedUnits += 1;

      if (group.summaryTitle) {
        const current = groupedCounts.get(group.summaryTitle) ?? { total: 0, maxed: 0 };
        current.total += 1;
        if (unit.level >= unit.maxLevel) current.maxed += 1;
        groupedCounts.set(group.summaryTitle, current);
      }
    }
  }

  return {
    totalUnits,
    maxedUnits,
    incompleteUnits: totalUnits - maxedUnits,
    levelsGained,
    maxLevels,
    categoryCounts,
    groupCounts: Array.from(
      groupedCounts,
      ([name, count]) => `${name}: ${count.maxed}/${count.total} maxed`,
    ),
  };
}

function formatProgressSummary(summary: UnitProgressSummary): string {
  const percentage =
    summary.maxLevels > 0
      ? ` (${Math.floor((summary.levelsGained / summary.maxLevels) * 100)}%)`
      : '';
  const rows = [
    `Shown: **${summary.totalUnits}** units • Maxed: **${summary.maxedUnits}** • Incomplete: **${summary.incompleteUnits}**`,
    `Levels: **${summary.levelsGained}/${summary.maxLevels}**${percentage}`,
  ];

  if (summary.groupCounts.length > 0) {
    rows.push(summary.groupCounts.join(' • '));
  }

  if (summary.categoryCounts.length > 0) {
    rows.push(`Category coverage: ${summary.categoryCounts.join(' • ')}`);
  } else {
    rows.push('Category coverage: no unit categories were present in the public API response.');
  }

  return rows.join('\n');
}

function readUnits(value: unknown, filter?: { readonly village: string }): UnitView[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const village = readString(readValue(item, 'village'));
    if (filter && village !== filter.village) return [];
    const name = readString(readValue(item, 'name'));
    const level = readNumber(readValue(item, 'level'));
    const maxLevel = readNumber(readValue(item, 'maxLevel'));
    if (!name || level === null || maxLevel === null) return [];
    return [{ name, level, maxLevel, village }];
  });
}

function chunkUnits(units: readonly UnitView[]): UnitView[][] {
  const chunks: UnitView[][] = [];
  for (let index = 0; index < units.length; index += UNIT_ROWS_PER_FIELD) {
    chunks.push(units.slice(index, index + UNIT_ROWS_PER_FIELD));
  }
  return chunks;
}

function formatUnitRows(units: readonly UnitView[]): string {
  const rows: string[] = [];
  for (const unit of units) {
    const row = `**${sanitize(unit.name)}** ${unit.level}/${unit.maxLevel}`;
    const next = rows.length ? `${rows.join('\n')}\n${row}` : row;
    if (next.length > EMBED_FIELD_VALUE_LIMIT) break;
    rows.push(row);
  }
  return rows.join('\n') || 'No units in this group.';
}

function sanitize(value: string): string {
  return escapeMarkdown(value.trim() || 'Unknown').replaceAll('@', '@\u200b');
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
