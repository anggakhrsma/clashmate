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
export const UPGRADES_NOT_FOUND_MESSAGE = 'This player tag is not valid or was not found.';

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
  | { readonly status: 'resolved'; readonly playerTag: string; readonly targetUser: User | null }
  | { readonly status: 'invalid_tag' }
  | { readonly status: 'no_link'; readonly targetUser: User; readonly isSelf: boolean };

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
    await interaction.reply({ content: UPGRADES_NOT_FOUND_MESSAGE, ephemeral: true });
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
    await interaction.editReply(UPGRADES_NOT_FOUND_MESSAGE);
    return;
  }

  await interaction.editReply({ embeds: [buildUpgradesEmbed(player)] });
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
      };
    } catch {
      return { status: 'invalid_tag' };
    }
  }

  const targetUser = input.userOption ?? input.invokingUser;
  const [playerTag] = await input.links.listPlayerTagsForUser(input.guildId, targetUser.id);
  if (!playerTag)
    return { status: 'no_link', targetUser, isSelf: targetUser.id === input.invokingUser.id };
  return { status: 'resolved', playerTag, targetUser };
}

export function buildUpgradesEmbed(player: ClashPlayer): EmbedBuilder {
  const groups = collectRemainingUpgrades(player);
  const remainingLevels = countRemainingLevels(groups);
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
          'Static town-hall maximum tables are not included yet, so this may include upgrades above the current hall level.',
          `Total remaining levels: **${remainingLevels.toLocaleString('en-US')}**`,
        ].join('\n'),
        EMBED_DESCRIPTION_LIMIT,
        'Remaining upgrades from public API maxLevel values.',
      ),
    );

  for (const field of buildUpgradeFields(groups)) embed.addFields(field);
  if (remainingLevels === 0)
    embed.addFields({
      name: 'Upgrades',
      value: 'No remaining unit upgrades found from API maxLevel values.',
      inline: false,
    });
  return embed;
}

export function collectRemainingUpgrades(player: ClashPlayer): UpgradeGroups {
  const data = readRecord(player.data) ?? {};
  const troops = readUpgradeUnits(readValue(data, 'troops'));
  const spells = readUpgradeUnits(readValue(data, 'spells'));
  const heroes = readUpgradeUnits(readValue(data, 'heroes'));
  const equipment = readUpgradeUnits(readValue(data, 'heroEquipment'));

  return {
    troops: troops.filter((unit) => unit.village !== 'builderBase'),
    spells,
    heroes,
    heroEquipment: equipment,
    builderBase: troops.filter((unit) => unit.village === 'builderBase'),
  };
}

export function countRemainingLevels(groups: UpgradeGroups): number {
  return Object.values(groups)
    .flat()
    .reduce((sum, unit) => sum + Math.max(0, unit.maxLevel - unit.level), 0);
}

function buildUpgradeFields(
  groups: UpgradeGroups,
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

function chunkUnitRows(units: readonly UpgradeUnit[]): string[] {
  const chunks: string[] = [];
  let rows: string[] = [];
  let length = 0;
  for (const row of units.map(formatUpgradeUnit)) {
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
