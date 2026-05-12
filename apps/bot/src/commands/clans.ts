import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
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
const CATEGORY_SUMMARY_LIMIT = 5;

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
  readonly snapshotFetchedAt?: Date | string | null;
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

  let categories: ClansCategory[];
  try {
    categories = await options.clans.listClanCategories(interaction.guildId);
  } catch {
    await interaction.respond([]);
    return;
  }

  await interaction.respond(filterClansCategoryChoices(categories, String(focused.value ?? '')));
}

export function filterClansCategoryChoices(
  categories: readonly ClansCategory[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  const choicesById = new Map<string, ClansCategory>();

  for (const category of [...categories].sort(compareCategoriesForAutocomplete)) {
    if (!choicesById.has(category.id)) choicesById.set(category.id, category);
  }

  return [...choicesById.values()]
    .filter((category) => categoryMatchesQuery(category, normalizedQuery))
    .map((category) => ({ name: formatCategoryChoiceName(category), value: category.id }))
    .slice(0, 25);
}

function compareCategoriesForAutocomplete(a: ClansCategory, b: ClansCategory): number {
  return (
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
    a.displayName.localeCompare(b.displayName) ||
    a.id.localeCompare(b.id)
  );
}

function categoryMatchesQuery(category: ClansCategory, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return (
    category.displayName.toLowerCase().includes(normalizedQuery) ||
    category.id.toLowerCase().includes(normalizedQuery)
  );
}

function formatCategoryChoiceName(category: ClansCategory): string {
  return category.displayName.length <= 100
    ? category.displayName
    : `${category.displayName.slice(0, 99)}…`;
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
  const filteredCategory = hasCategoryFilter
    ? input.categories.find((category) => category.id === input.categoryId)
    : undefined;

  if (hasCategoryFilter && !filteredCategory) {
    return {
      content: [
        `Category filter: \`${input.categoryId}\` (not found).`,
        ...buildClansDiagnosticLines({
          categories: input.categories,
          clans: input.clans,
          shownClans: [],
          categoryFilterLabel: 'not resolved',
          isTruncated: false,
        }),
        'Use category autocomplete to choose a stored category for this server. No live Clash API fallback is attempted, and no polling enrollment changes are made.',
      ].join('\n'),
    };
  }

  const clans = filteredCategory
    ? input.clans.filter((clan) => clan.categoryId === filteredCategory.id)
    : [...input.clans];

  if (hasCategoryFilter && clans.length === 0) {
    return {
      content: [
        `No clans found for category ${filteredCategory?.displayName ?? input.categoryId}.`,
        ...buildClansDiagnosticLines({
          categories: input.categories,
          clans: input.clans,
          shownClans: clans,
          categoryFilterLabel: filteredCategory?.displayName ?? 'not resolved',
          isTruncated: false,
        }),
      ].join('\n'),
    };
  }

  const description = formatClanGroups(groupClansByCategory(clans, input.categories));
  const baseCoverageContext = buildClansDiagnosticLines({
    categories: input.categories,
    clans: input.clans,
    shownClans: clans,
    categoryFilterLabel: filteredCategory?.displayName ?? 'all linked clans',
    isTruncated: false,
  });
  const baseDiagnosticText = baseCoverageContext.join('\n');
  const descriptionBudget = Math.max(1, EMBED_DESCRIPTION_LIMIT - baseDiagnosticText.length - 2);
  const [firstChunk = '', ...chunks] = splitText(description, descriptionBudget);
  const isTruncated = chunks.length > 0;
  const coverageContext = isTruncated
    ? buildClansDiagnosticLines({
        categories: input.categories,
        clans: input.clans,
        shownClans: clans,
        categoryFilterLabel: filteredCategory?.displayName ?? 'all linked clans',
        isTruncated,
      })
    : baseCoverageContext;
  const diagnosticText = coverageContext.join('\n');
  const finalDescriptionBudget = EMBED_DESCRIPTION_LIMIT - diagnosticText.length - 2;
  const visibleDescription =
    firstChunk.length > finalDescriptionBudget
      ? `${firstChunk.slice(0, Math.max(0, finalDescriptionBudget - 1))}…`
      : firstChunk;
  const embed = new EmbedBuilder()
    .setAuthor({
      name: `${input.guildName} Clans`,
      ...(input.guildIconUrl ? { iconURL: input.guildIconUrl } : {}),
    })
    .setFooter({
      text: filteredCategory
        ? `Filtered ${clans.length} of ${input.clans.length} linked clans`
        : `Total ${input.clans.length}`,
    });

  embed.setDescription([visibleDescription || 'No clans found.', diagnosticText].join('\n\n'));
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

function hasSnapshotStats(clan: ClansLinkedClan): boolean {
  return (
    typeof getSnapshotNumber(clan.snapshot, 'members') === 'number' ||
    typeof getSnapshotNumber(clan.snapshot, 'clanLevel') === 'number'
  );
}

function countClansWithSnapshotStats(clans: readonly ClansLinkedClan[]): number {
  return clans.filter(hasSnapshotStats).length;
}

function buildClansDiagnosticLines(input: {
  readonly categories: readonly ClansCategory[];
  readonly clans: readonly ClansLinkedClan[];
  readonly shownClans: readonly ClansLinkedClan[];
  readonly categoryFilterLabel: string;
  readonly isTruncated: boolean;
}): string[] {
  const aliases = input.clans.filter((clan) => Boolean(clan.alias?.trim())).length;
  const snapshotPayloads = input.clans.filter((clan) => clan.snapshot != null).length;
  const snapshotStats = countClansWithSnapshotStats(input.clans);
  const categorySummary = formatCategorySummary(input.categories);

  return [
    `Filter: ${input.categoryFilterLabel}; shown ${input.shownClans.length}/${input.clans.length} linked clans.`,
    `Configured categories: ${input.categories.length}${categorySummary}; aliases present: ${aliases}/${input.clans.length}.`,
    `Snapshots: payloads ${snapshotPayloads}/${input.clans.length}; member/level stats ${snapshotStats}/${input.clans.length}; latest ${formatLatestSnapshotAge(input.clans)}.`,
    `Truncation: ${input.isTruncated ? 'additional clan rows continue in fields below' : 'none'}.`,
    'Limitation: persisted linked-clan/category/snapshot metadata only; no live Clash API lookup or polling enrollment changes.',
  ];
}

function formatCategorySummary(categories: readonly ClansCategory[]): string {
  if (categories.length === 0) return '';
  const names = [...categories]
    .sort(compareCategoriesForAutocomplete)
    .slice(0, CATEGORY_SUMMARY_LIMIT)
    .map((category) => category.displayName);
  const remaining = categories.length - names.length;
  return ` (${names.join(', ')}${remaining > 0 ? `, +${remaining} more` : ''})`;
}

function formatLatestSnapshotAge(clans: readonly ClansLinkedClan[]): string {
  const latestFetchedAt = clans
    .map((clan) => parseSnapshotFetchedAt(clan.snapshotFetchedAt))
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  if (!latestFetchedAt) return 'unavailable';
  const ageMs = Math.max(0, Date.now() - latestFetchedAt.getTime());
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (ageMs < minuteMs) return 'less than 1m ago';
  if (ageMs < hourMs) return `${Math.floor(ageMs / minuteMs)}m ago`;
  if (ageMs < dayMs) return `${Math.floor(ageMs / hourMs)}h ago`;
  return `${Math.floor(ageMs / dayMs)}d ago`;
}

function parseSnapshotFetchedAt(value: Date | string | null | undefined): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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
