import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
} from 'discord.js';

export const ARMY_COMMAND_NAME = 'army';
export const ARMY_COMMAND_DESCRIPTION = 'Share a Clash of Clans army copy link.';
export const INVALID_ARMY_LINK_MESSAGE =
  'Please provide a valid public Clash of Clans Copy Army link.';

const COPY_ARMY_HOST = 'link.clashofclans.com';
const MAX_FIELD_VALUE_LENGTH = 1024;
const MAX_LIST_LINES = 20;

export const armyCommandData = new SlashCommandBuilder()
  .setName(ARMY_COMMAND_NAME)
  .setDescription(ARMY_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('link').setDescription('Clash of Clans Copy Army link.').setRequired(true),
  )
  .addStringOption((option) =>
    option.setName('army_name').setDescription('Optional name to show for this army.'),
  )
  .addStringOption((option) =>
    option
      .setName('tips')
      .setDescription('Optional tips to show with this army.')
      .setMaxLength(600),
  );

export interface ParsedArmyUnit {
  readonly id: number;
  readonly quantity: number;
}

export interface ParsedArmyHero {
  readonly id: number;
  readonly components: readonly string[];
}

export interface ParsedArmyLink {
  readonly url: string;
  readonly troops: readonly ParsedArmyUnit[];
  readonly spells: readonly ParsedArmyUnit[];
  readonly heroes: readonly ParsedArmyHero[];
  readonly clanCastleTroops: readonly ParsedArmyUnit[];
  readonly clanCastleSpells: readonly ParsedArmyUnit[];
}

export function createArmySlashCommand(): SlashCommandDefinition {
  return {
    name: ARMY_COMMAND_NAME,
    data: armyCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== ARMY_COMMAND_NAME) return;
      await executeArmy(interaction, context);
    },
  };
}

export async function executeArmy(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: '`/army` can only be used in a server.', ephemeral: true });
    return;
  }

  const parsed = parseArmyLink(interaction.options.getString('link', true));
  if (!parsed) {
    await interaction.reply({ content: INVALID_ARMY_LINK_MESSAGE, ephemeral: true });
    return;
  }

  await interaction.reply(
    buildArmyReply({
      army: parsed,
      armyName: interaction.options.getString('army_name'),
      tips: interaction.options.getString('tips'),
    }),
  );
}

export function parseArmyLink(input: string): ParsedArmyLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (!['https:', 'http:'].includes(url.protocol)) return null;
  if (url.hostname.toLowerCase() !== COPY_ARMY_HOST) return null;
  if (url.searchParams.get('action') !== 'CopyArmy') return null;

  const payload = url.searchParams.get('army');
  if (!payload || /\s/.test(payload)) return null;

  const parsed = parseArmyPayload(payload);
  if (!parsed) return null;

  return { url: url.toString(), ...parsed };
}

export function parseArmyPayload(payload: string): Omit<ParsedArmyLink, 'url'> | null {
  const groups = payload.split(/(?=[ushid])/).filter(Boolean);
  if (!groups.length || groups.some((group) => !/^[ushid]/.test(group))) return null;

  const result = {
    troops: [] as ParsedArmyUnit[],
    spells: [] as ParsedArmyUnit[],
    heroes: [] as ParsedArmyHero[],
    clanCastleTroops: [] as ParsedArmyUnit[],
    clanCastleSpells: [] as ParsedArmyUnit[],
  };

  for (const group of groups) {
    const type = group[0];
    const body = group.slice(1).replace(/-$/, '');
    if (!body) return null;

    if (type === 'h') {
      const heroes = parseHeroGroup(body);
      if (!heroes) return null;
      result.heroes.push(...heroes);
      continue;
    }

    const units = parseUnitGroup(body);
    if (!units) return null;

    if (type === 'u') result.troops.push(...units);
    if (type === 's') result.spells.push(...units);
    if (type === 'i') result.clanCastleTroops.push(...units);
    if (type === 'd') result.clanCastleSpells.push(...units);
  }

  const hasArmy = result.troops.length > 0 || result.spells.length > 0;
  return hasArmy ? result : null;
}

export function buildArmyReply(input: {
  readonly army: ParsedArmyLink;
  readonly armyName: string | null;
  readonly tips: string | null;
}): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const embed = buildArmyEmbed(input);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(input.army.url)
      .setLabel('Copy Army Link'),
  );

  return { embeds: [embed], components: [row] };
}

export function buildArmyEmbed(input: {
  readonly army: ParsedArmyLink;
  readonly armyName: string | null;
  readonly tips: string | null;
}): EmbedBuilder {
  const title = input.armyName?.trim() || 'Shared Army Composition';
  const totals = calculateArmyTotals(input.army);
  const embed = new EmbedBuilder()
    .setTitle(escapeMarkdown(title).slice(0, 256))
    .setURL(input.army.url)
    .setDescription(
      [
        `Troops **${totals.troops}**`,
        `Spells **${totals.spells}**`,
        `Heroes **${totals.heroes}**`,
      ].join(' • '),
    );

  addListField(embed, 'Troops', formatUnits(input.army.troops));
  addListField(embed, 'Spells', formatUnits(input.army.spells));
  addListField(embed, 'Heroes', formatHeroes(input.army.heroes));
  addListField(embed, 'Clan Castle Troops', formatUnits(input.army.clanCastleTroops));
  addListField(embed, 'Clan Castle Spells', formatUnits(input.army.clanCastleSpells));

  const tips = input.tips?.trim();
  if (tips) addListField(embed, 'Tips', [escapeMarkdown(tips)]);

  return embed;
}

export function calculateArmyTotals(army: ParsedArmyLink): {
  readonly troops: number;
  readonly spells: number;
  readonly heroes: number;
} {
  return {
    troops: sumQuantities(army.troops),
    spells: sumQuantities(army.spells),
    heroes: army.heroes.length,
  };
}

function parseUnitGroup(body: string): ParsedArmyUnit[] | null {
  const parts = body.split('-').filter(Boolean);
  if (!parts.length) return null;

  const units: ParsedArmyUnit[] = [];
  for (const part of parts) {
    const match = /^(\d+)x(\d+)$/.exec(part);
    if (!match) return null;
    const quantity = Number(match[1]);
    const id = Number(match[2]);
    if (!isPositiveSafeInteger(quantity) || !isPositiveSafeInteger(id)) return null;
    units.push({ id, quantity });
  }
  return units;
}

function parseHeroGroup(body: string): ParsedArmyHero[] | null {
  const parts = body.split('-').filter(Boolean);
  if (!parts.length) return null;

  const heroes: ParsedArmyHero[] = [];
  for (const part of parts) {
    const match = /^(\d+)((?:[mpe]\d+(?:_\d+)*)*)$/.exec(part);
    if (!match) return null;
    const id = Number(match[1]);
    if (!isPositiveSafeInteger(id)) return null;
    const components = match[2] ? match[2].split(/(?=[mpe])/).filter(Boolean) : [];
    heroes.push({ id, components });
  }
  return heroes;
}

function formatUnits(units: readonly ParsedArmyUnit[]): string[] {
  return units.map((unit) => `\`${unit.quantity}x\` ID ${unit.id}`);
}

function formatHeroes(heroes: readonly ParsedArmyHero[]): string[] {
  return heroes.map((hero) => {
    const components = hero.components.length ? ` (${hero.components.join(', ')})` : '';
    return `Hero ID ${hero.id}${components}`;
  });
}

function addListField(embed: EmbedBuilder, name: string, lines: readonly string[]): void {
  if (!lines.length) return;
  const capped = lines.slice(0, MAX_LIST_LINES);
  const suffix = lines.length > capped.length ? `\n…and ${lines.length - capped.length} more` : '';
  const value = `${capped.join('\n')}${suffix}`.slice(0, MAX_FIELD_VALUE_LENGTH);
  embed.addFields({ name, value, inline: false });
}

function sumQuantities(units: readonly ParsedArmyUnit[]): number {
  return units.reduce((total, unit) => total + unit.quantity, 0);
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
