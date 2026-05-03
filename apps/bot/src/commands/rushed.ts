import type { ClashPlayer } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
} from 'discord.js';
import {
  filterPlayerTagAutocompleteChoices,
  formatNoLinkedPlayerMessage,
  PLAYER_NOT_FOUND_MESSAGE,
  type PlayerCocApi,
  type PlayerLinkStore,
  resolvePlayerTag,
} from './player.js';

export const RUSHED_COMMAND_NAME = 'rushed';
export const RUSHED_COMMAND_DESCRIPTION = 'Show likely rushed or incomplete player units.';

const EMBED_FIELD_VALUE_LIMIT = 1024;
const EMBED_MAX_FIELDS = 25;
const EMBED_DESCRIPTION_LIMIT = 4096;

export const rushedCommandData = new SlashCommandBuilder()
  .setName(RUSHED_COMMAND_NAME)
  .setDescription(RUSHED_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('player').setDescription('Player tag to look up.').setAutocomplete(true),
  )
  .addUserOption((option) =>
    option.setName('user').setDescription('Discord user whose linked account to show.'),
  );

export interface RushedCommandOptions {
  readonly coc: PlayerCocApi;
  readonly links: Pick<PlayerLinkStore, 'listPlayerTagsForUser'>;
}

export interface RushedUnit {
  readonly name: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly village: string | null;
}

export interface RushedUnitGroups {
  readonly troops: readonly RushedUnit[];
  readonly spells: readonly RushedUnit[];
  readonly heroes: readonly RushedUnit[];
  readonly heroEquipment: readonly RushedUnit[];
  readonly builderBase: readonly RushedUnit[];
}

export interface RushedSummary {
  readonly incompleteLevels: number;
  readonly maxLevels: number;
  readonly incompleteUnits: number;
  readonly totalUnits: number;
}

export function createRushedSlashCommand(options: RushedCommandOptions): SlashCommandDefinition {
  return {
    name: RUSHED_COMMAND_NAME,
    data: rushedCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== RUSHED_COMMAND_NAME) return;
      await executeRushed(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== RUSHED_COMMAND_NAME) return;
      await autocompleteRushed(interaction, options);
    },
  };
}

export async function autocompleteRushed(
  interaction: AutocompleteInteraction,
  options: Pick<RushedCommandOptions, 'links'>,
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

export async function executeRushed(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: RushedCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/rushed` can only be used in a server.',
      ephemeral: true,
    });
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
    await interaction.reply({ content: PLAYER_NOT_FOUND_MESSAGE, ephemeral: true });
    return;
  }

  if (resolution.status === 'no_link') {
    await interaction.reply({ content: formatNoLinkedPlayerMessage(resolution), ephemeral: true });
    return;
  }

  await interaction.deferReply();

  let player: ClashPlayer;
  try {
    player = await options.coc.getPlayer(resolution.playerTag);
  } catch {
    await interaction.editReply(PLAYER_NOT_FOUND_MESSAGE);
    return;
  }

  await interaction.editReply({ embeds: [buildRushedEmbed(player)] });
}

export function buildRushedEmbed(player: ClashPlayer): EmbedBuilder {
  const groups = collectRushedUnits(player);
  const summary = summarizeRushedGroups(groups);
  const data = readRecord(player.data) ?? {};
  const townHall = readNumber(readValue(data, 'townHallLevel'));
  const builderHall = readNumber(readValue(data, 'builderHallLevel'));
  const incompletePercent = calculateIncompletePercent(summary);

  const embed = new EmbedBuilder()
    .setTitle(`Rushed Units: ${escapeMarkdown(player.name)} (${player.tag})`)
    .setURL(
      `https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${encodeURIComponent(player.tag)}`,
    )
    .setDescription(
      truncateEmbedText(
        [
          `Likely rushed or incomplete units${townHall ? ` for TH ${townHall}` : ''}${builderHall ? ` / BH ${builderHall}` : ''}.`,
          'First pass uses public API `maxLevel` values and does not include ClashPerk static previous-town-hall max tables yet.',
          'This may include upgrades above the current hall level and should be treated as an incomplete-units summary.',
          `Incomplete: **${summary.incompleteUnits.toLocaleString('en-US')}/${summary.totalUnits.toLocaleString('en-US')}** units • **${incompletePercent}%** of API max levels remaining.`,
        ].join('\n'),
        EMBED_DESCRIPTION_LIMIT,
        'Likely rushed or incomplete units from public API maxLevel values.',
      ),
    );

  for (const field of buildRushedFields(groups)) embed.addFields(field);
  if (summary.incompleteUnits === 0) {
    embed.addFields({
      name: 'Rushed Units',
      value: 'No incomplete units found from API maxLevel values.',
      inline: false,
    });
  }

  return embed;
}

export function collectRushedUnits(player: ClashPlayer): RushedUnitGroups {
  const data = readRecord(player.data) ?? {};
  const troops = readRushedUnits(readValue(data, 'troops'));

  return {
    troops: troops.filter((unit) => unit.village !== 'builderBase'),
    spells: readRushedUnits(readValue(data, 'spells')),
    heroes: readRushedUnits(readValue(data, 'heroes')),
    heroEquipment: readRushedUnits(readValue(data, 'heroEquipment')),
    builderBase: troops.filter((unit) => unit.village === 'builderBase'),
  };
}

export function summarizeRushedGroups(groups: RushedUnitGroups): RushedSummary {
  const units = Object.values(groups).flat();
  return units.reduce<RushedSummary>(
    (summary, unit) => ({
      incompleteLevels: summary.incompleteLevels + Math.max(0, unit.maxLevel - unit.level),
      maxLevels: summary.maxLevels + unit.maxLevel,
      incompleteUnits: summary.incompleteUnits + 1,
      totalUnits: summary.totalUnits + 1,
    }),
    { incompleteLevels: 0, maxLevels: 0, incompleteUnits: 0, totalUnits: 0 },
  );
}

export function calculateIncompletePercent(summary: RushedSummary): string {
  if (summary.maxLevels === 0) return '0.00';
  return ((summary.incompleteLevels * 100) / summary.maxLevels).toFixed(2);
}

function buildRushedFields(
  groups: RushedUnitGroups,
): Array<{ name: string; value: string; inline: false }> {
  const definitions = [
    ['Troops', groups.troops],
    ['Spells', groups.spells],
    ['Heroes', groups.heroes],
    ['Hero Equipment', groups.heroEquipment],
    ['Builder Base', groups.builderBase],
  ] as const;
  const fields: Array<{ name: string; value: string; inline: false }> = [];

  for (const [name, units] of definitions) {
    if (!units.length || fields.length >= EMBED_MAX_FIELDS) continue;
    for (const value of chunkUnitRows(units)) {
      if (fields.length >= EMBED_MAX_FIELDS) break;
      fields.push({
        name: fields.some((field) => field.name === name) ? `${name} (continued)` : name,
        value,
        inline: false,
      });
    }
  }

  return fields;
}

function chunkUnitRows(units: readonly RushedUnit[]): string[] {
  const chunks: string[] = [];
  let rows: string[] = [];
  let length = 0;

  for (const row of units.map(formatRushedUnit)) {
    const nextLength = length === 0 ? row.length : length + 1 + row.length;
    if (rows.length && nextLength > EMBED_FIELD_VALUE_LIMIT) {
      chunks.push(rows.join('\n'));
      rows = [];
      length = 0;
    }
    rows.push(row);
    length = length === 0 ? row.length : length + 1 + row.length;
  }

  if (rows.length) chunks.push(rows.join('\n'));
  return chunks;
}

function formatRushedUnit(unit: RushedUnit): string {
  const remaining = Math.max(0, unit.maxLevel - unit.level);
  return `**${escapeMarkdown(unit.name)}** ${unit.level}/${unit.maxLevel} (${remaining} short)`;
}

function readRushedUnits(value: unknown): RushedUnit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = readString(readValue(item, 'name'));
    const level = readNumber(readValue(item, 'level'));
    const maxLevel = readNumber(readValue(item, 'maxLevel'));
    const village = readString(readValue(item, 'village'));
    if (!name || level === null || maxLevel === null || level >= maxLevel) return [];
    return [{ name, level, maxLevel, village }];
  });
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
