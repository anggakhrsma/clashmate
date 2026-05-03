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

  await interaction.editReply({ embeds: [buildUnitsEmbed(player)] });
}

export function buildUnitsEmbed(player: ClashPlayer): EmbedBuilder {
  const data = isRecord(player.data) ? player.data : {};
  const townHallLevel = readNumber(readValue(data, 'townHallLevel'));
  const builderHallLevel = readNumber(readValue(data, 'builderHallLevel'));
  const embed = new EmbedBuilder()
    .setAuthor({ name: `${sanitize(player.name)} (${player.tag})` })
    .setDescription(
      `Units for TH${townHallLevel ?? 'Unknown'}${builderHallLevel ? ` and BH${builderHallLevel}` : ''}`,
    );

  const groups = [
    ['Home Troops', readUnits(readValue(data, 'troops'), { village: 'home' })],
    ['Builder Base Troops', readUnits(readValue(data, 'troops'), { village: 'builderBase' })],
    ['Spells', readUnits(readValue(data, 'spells'))],
    ['Heroes', readUnits(readValue(data, 'heroes'))],
    ['Hero Equipment', readUnits(readValue(data, 'heroEquipment'))],
  ] as const;

  let fieldCount = 0;
  for (const [title, units] of groups) {
    if (units.length === 0 || fieldCount >= EMBED_MAX_FIELDS) continue;
    for (const [index, chunk] of chunkUnits(units).entries()) {
      if (fieldCount >= EMBED_MAX_FIELDS) break;
      embed.addFields({
        name: index === 0 ? title : `${title} (${index + 1})`,
        value: formatUnitRows(chunk),
        inline: false,
      });
      fieldCount += 1;
    }
  }

  if (fieldCount === 0) {
    embed.addFields({
      name: 'Units',
      value: 'No public unit level data was found.',
      inline: false,
    });
  }

  return embed;
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
