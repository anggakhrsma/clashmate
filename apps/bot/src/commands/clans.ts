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
  SlashCommandBuilder,
} from 'discord.js';

export const CLANS_COMMAND_NAME = 'clans';
export const CLANS_COMMAND_DESCRIPTION = 'Show all linked clans.';
const GENERAL_CATEGORY_ID = 'general';
const GENERAL_CATEGORY_NAME = 'General';
const EMBED_DESCRIPTION_LIMIT = 4096;
const EMBED_FIELD_VALUE_LIMIT = 1024;

export const clansCommandData = new SlashCommandBuilder()
  .setName(CLANS_COMMAND_NAME)
  .setDescription(CLANS_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('category').setDescription('Filter clans by category.').setAutocomplete(true),
  );

export interface ClansCategory {
  readonly id: string;
  readonly displayName: string;
  readonly sortOrder?: number;
}

export interface ClansLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
  readonly categoryId: string | null;
  readonly sortOrder: number;
  readonly snapshot?: unknown;
}

export interface ClansStore {
  listClanCategories: (guildId: string) => Promise<ClansCategory[]>;
  listClansForGuild: (guildId: string) => Promise<ClansLinkedClan[]>;
}

export interface ClansCommandOptions {
  clans: ClansStore;
}

export interface RenderedClansPayload {
  readonly content?: string;
  readonly embeds?: EmbedBuilder[];
}

export function createClansSlashCommand(options: ClansCommandOptions): SlashCommandDefinition {
  return {
    name: CLANS_COMMAND_NAME,
    data: clansCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== CLANS_COMMAND_NAME) return;

      await executeClans(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== CLANS_COMMAND_NAME) return;
      await autocompleteClans(interaction, options);
    },
  };
}

export function createClansMessageCommand(options: ClansCommandOptions): MessageCommandDefinition {
  return {
    name: CLANS_COMMAND_NAME,
    aliases: ['clan-list'],
    execute: async (message) => {
      if (!message.guildId || !message.guild) {
        await message.reply('`clans` can only be used in a server.');
        return;
      }

      if (!message.channel.isSendable()) {
        await message.reply('I cannot send the linked clans list in this channel.');
        return;
      }

      const categoryId = parseClansMessageCommand(message.content).categoryId;
      const [categories, clans] = await Promise.all([
        options.clans.listClanCategories(message.guildId),
        options.clans.listClansForGuild(message.guildId),
      ]);
      const guildIconUrl = message.guild.iconURL() ?? undefined;
      const payload = buildClansPayload({
        categories,
        clans,
        guildName: message.guild.name,
        ...(categoryId ? { categoryId } : {}),
        ...(guildIconUrl ? { guildIconUrl } : {}),
      });

      await message.channel.send(payload);
    },
  };
}

export interface ClansMessageQuery {
  readonly categoryId?: string;
}

export function parseClansMessageCommand(content: string): ClansMessageQuery {
  const [, categoryId] = content.trim().split(/\s+/, 2);
  return categoryId ? { categoryId } : {};
}

export async function autocompleteClans(
  interaction: AutocompleteInteraction,
  options: ClansCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'category') {
    await interaction.respond([]);
    return;
  }

  const categories = await options.clans.listClanCategories(interaction.guildId);
  await interaction.respond(filterClansCategoryChoices(categories, String(focused.value ?? '')));
}

export function filterClansCategoryChoices(
  categories: readonly ClansCategory[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return categories
    .filter((category) => category.displayName.toLowerCase().includes(normalizedQuery))
    .slice(0, 25)
    .map((category) => ({ name: category.displayName, value: category.id }));
}

async function executeClans(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: ClansCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: '`/clans` can only be used in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const [categories, clans] = await Promise.all([
    options.clans.listClanCategories(interaction.guildId),
    options.clans.listClansForGuild(interaction.guildId),
  ]);

  const categoryId = interaction.options.getString('category') ?? undefined;
  const guildIconUrl = interaction.guild.iconURL() ?? undefined;
  const payload = buildClansPayload({
    categories,
    clans,
    guildName: interaction.guild.name,
    ...(categoryId ? { categoryId } : {}),
    ...(guildIconUrl ? { guildIconUrl } : {}),
  });

  await interaction.editReply(payload);
}

export function buildClansPayload(input: {
  readonly categories: readonly ClansCategory[];
  readonly clans: readonly ClansLinkedClan[];
  readonly categoryId?: string;
  readonly guildName: string;
  readonly guildIconUrl?: string;
}): RenderedClansPayload {
  if (input.clans.length === 0) {
    return { content: 'No clans are linked to this server yet. Use `/setup clan` to link one.' };
  }

  const hasCategoryFilter = Boolean(input.categoryId);
  const clans = hasCategoryFilter
    ? input.clans.filter((clan) => clan.categoryId === input.categoryId)
    : [...input.clans];

  if (hasCategoryFilter && clans.length === 0) {
    return { content: 'No clans found for the specified category.' };
  }

  const description = formatClanGroups(groupClansByCategory(clans, input.categories));
  const [firstChunk = '', ...chunks] = splitText(description, EMBED_DESCRIPTION_LIMIT);
  const embed = new EmbedBuilder()
    .setAuthor({
      name: `${input.guildName} Clans`,
      ...(input.guildIconUrl ? { iconURL: input.guildIconUrl } : {}),
    })
    .setFooter({ text: `Total ${clans.length}` });

  embed.setDescription(firstChunk || 'No clans found.');
  for (const chunk of chunks.flatMap((value) => splitText(value, EMBED_FIELD_VALUE_LIMIT))) {
    embed.addFields({ name: '\u200b', value: chunk });
  }

  return { embeds: [embed] };
}

export function groupClansByCategory(
  clans: readonly ClansLinkedClan[],
  categories: readonly ClansCategory[],
): Array<{ category: ClansCategory; clans: ClansLinkedClan[] }> {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const groups = new Map<string, { category: ClansCategory; clans: ClansLinkedClan[] }>();

  for (const clan of clans) {
    const category = clan.categoryId ? categoryMap.get(clan.categoryId) : undefined;
    const resolved = category ?? {
      id: GENERAL_CATEGORY_ID,
      displayName: GENERAL_CATEGORY_NAME,
      sortOrder: -1,
    };
    const group = groups.get(resolved.id) ?? { category: resolved, clans: [] };
    group.clans.push(clan);
    groups.set(resolved.id, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      clans: [...group.clans].sort(
        (a, b) => a.sortOrder - b.sortOrder || labelForClan(a).localeCompare(labelForClan(b)),
      ),
    }))
    .sort(
      (a, b) =>
        (a.category.sortOrder ?? 0) - (b.category.sortOrder ?? 0) ||
        a.category.displayName.localeCompare(b.category.displayName),
    );
}

export function formatClanGroups(
  groups: readonly { category: ClansCategory; clans: readonly ClansLinkedClan[] }[],
): string {
  return groups
    .map((group) =>
      [`**${group.category.displayName}**`, ...group.clans.map(formatClanLine)].join('\n'),
    )
    .join('\n\n');
}

export function formatClanLine(clan: ClansLinkedClan): string {
  const members = getSnapshotNumber(clan.snapshot, 'members');
  const level = getSnapshotNumber(clan.snapshot, 'clanLevel');
  const stats = [
    typeof members === 'number' ? `${members} members` : undefined,
    typeof level === 'number' ? `Level ${level}` : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  const suffix = stats ? ` - ${stats}` : ' - Unknown';
  return `[${labelForClan(clan)} (${clan.clanTag})${suffix}](${clanProfileUrl(clan.clanTag)})`;
}

export function labelForClan(clan: Pick<ClansLinkedClan, 'alias' | 'name' | 'clanTag'>): string {
  return clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
}

export function clanProfileUrl(clanTag: string): string {
  return `https://link.clashofclans.com/en?action=OpenClanProfile&tag=${encodeURIComponent(clanTag)}`;
}

function getSnapshotNumber(snapshot: unknown, key: 'members' | 'clanLevel'): number | undefined {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const breakAt = Math.max(
      remaining.lastIndexOf('\n\n', maxLength),
      remaining.lastIndexOf('\n', maxLength),
    );
    const index = breakAt > 0 ? breakAt : maxLength;
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index).replace(/^\n+/, '');
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
