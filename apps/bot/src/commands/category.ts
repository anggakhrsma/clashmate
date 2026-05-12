import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  escapeMarkdown,
  inlineCode,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const CATEGORY_COMMAND_NAME = 'category';
export const CATEGORY_COMMAND_DESCRIPTION = 'Manage linked clan categories.';
const MAX_CATEGORY_NAME_LENGTH = 36;
const MAX_CATEGORY_LIST_ROWS = 20;

export const categoryCommandData = new SlashCommandBuilder()
  .setName(CATEGORY_COMMAND_NAME)
  .setDescription(CATEGORY_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('create')
      .setDescription('Create a linked clan category.')
      .addStringOption((option) =>
        option
          .setName('category_name')
          .setDescription('Category name.')
          .setRequired(true)
          .setMaxLength(MAX_CATEGORY_NAME_LENGTH),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('list').setDescription('List linked clan categories.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('edit')
      .setDescription('Edit a linked clan category.')
      .addStringOption((option) =>
        option
          .setName('category')
          .setDescription('Category to edit.')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('category_name')
          .setDescription('New category name.')
          .setMaxLength(MAX_CATEGORY_NAME_LENGTH),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('delete')
      .setDescription('Delete a linked clan category.')
      .addStringOption((option) =>
        option
          .setName('category')
          .setDescription('Category to delete.')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

export interface CategoryRecord {
  readonly id: string;
  readonly displayName: string;
  readonly sortOrder?: number;
}

export interface CategoryStore {
  listClanCategories: (guildId: string) => Promise<CategoryRecord[]>;
  createClanCategory: (input: {
    guildId: string;
    actorDiscordUserId: string;
    displayName: string;
  }) => Promise<{ status: 'created'; category: CategoryRecord } | { status: 'duplicate' }>;
  updateClanCategory: (input: {
    guildId: string;
    actorDiscordUserId: string;
    categoryId: string;
    displayName: string;
  }) => Promise<
    | { status: 'updated'; category: CategoryRecord }
    | { status: 'duplicate' }
    | { status: 'not_found' }
  >;
  deleteClanCategory: (input: {
    guildId: string;
    actorDiscordUserId: string;
    categoryId: string;
  }) => Promise<{ status: 'deleted'; category: CategoryRecord } | { status: 'not_found' }>;
}

export interface CategoryCommandOptions {
  store: CategoryStore;
}

export function createCategorySlashCommand(
  options: CategoryCommandOptions,
): SlashCommandDefinition {
  return {
    name: CATEGORY_COMMAND_NAME,
    data: categoryCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== CATEGORY_COMMAND_NAME) return;
      await executeCategory(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== CATEGORY_COMMAND_NAME) return;
      await autocompleteCategory(interaction, options);
    },
  };
}

export async function autocompleteCategory(
  interaction: AutocompleteInteraction,
  options: CategoryCommandOptions,
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

  try {
    const categories = await options.store.listClanCategories(interaction.guildId);
    await interaction.respond(filterCategoryChoices(categories, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

async function executeCategory(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: CategoryCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/category` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content:
        'You need the Discord Manage Server permission to use `/category`; this changes saved ClashMate server configuration.',
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'list') {
    const categories = await options.store.listClanCategories(interaction.guildId);
    await interaction.reply({
      content: formatCategoryList(categories),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === 'create') {
    const validation = validateCategoryDisplayName(
      interaction.options.getString('category_name', true),
    );
    if (validation.status !== 'valid') {
      await interaction.reply({
        content: formatCategoryNameValidationMessage(validation),
        ephemeral: true,
      });
      return;
    }
    const result = await options.store.createClanCategory({
      guildId: interaction.guildId,
      actorDiscordUserId: interaction.user.id,
      displayName: validation.displayName,
    });
    await interaction.reply({ content: formatCreateCategoryMessage(result), ephemeral: true });
    return;
  }

  if (subcommand === 'edit') {
    const rawDisplayName = interaction.options.getString('category_name');
    if (rawDisplayName === null) {
      await interaction.reply({
        content:
          'Choose a new category name to rename this saved clan category. Category reordering is not available in ClashMate yet; `/category list` shows the current saved order.',
        ephemeral: true,
      });
      return;
    }
    const validation = validateCategoryDisplayName(rawDisplayName);
    if (validation.status !== 'valid') {
      await interaction.reply({
        content: formatCategoryNameValidationMessage(validation),
        ephemeral: true,
      });
      return;
    }
    const categoryLookup = await resolveCategoryLookup(
      options.store,
      interaction.guildId,
      interaction.options.getString('category', true),
    );
    if (categoryLookup.status !== 'found') {
      await interaction.reply({
        content: formatCategoryLookupFailureMessage(categoryLookup),
        ephemeral: true,
      });
      return;
    }
    const { category } = categoryLookup;
    if (
      normalizeCategoryName(category.displayName) === normalizeCategoryName(validation.displayName)
    ) {
      await interaction.reply({ content: 'That category already has this name.', ephemeral: true });
      return;
    }
    const result = await options.store.updateClanCategory({
      guildId: interaction.guildId,
      actorDiscordUserId: interaction.user.id,
      categoryId: category.id,
      displayName: validation.displayName,
    });
    await interaction.reply({
      content: [
        formatCategoryLookupContext(categoryLookup),
        formatUpdateCategoryMessage(result),
      ].join('\n'),
      ephemeral: true,
    });
    return;
  }

  if (subcommand === 'delete') {
    const categoryLookup = await resolveCategoryLookup(
      options.store,
      interaction.guildId,
      interaction.options.getString('category', true),
    );
    if (categoryLookup.status !== 'found') {
      await interaction.reply({
        content: formatCategoryLookupFailureMessage(categoryLookup),
        ephemeral: true,
      });
      return;
    }
    const { category } = categoryLookup;
    const result = await options.store.deleteClanCategory({
      guildId: interaction.guildId,
      actorDiscordUserId: interaction.user.id,
      categoryId: category.id,
    });
    await interaction.reply({
      content: [
        formatCategoryLookupContext(categoryLookup),
        formatDeleteCategoryMessage(result),
      ].join('\n'),
      ephemeral: true,
    });
  }
}

export function parseCategoryDisplayName(value: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > MAX_CATEGORY_NAME_LENGTH) return undefined;
  return trimmed;
}

export type CategoryNameValidationResult =
  | { readonly status: 'valid'; readonly displayName: string }
  | { readonly status: 'blank' }
  | { readonly status: 'too_long'; readonly maxLength: number; readonly actualLength: number };

export function validateCategoryDisplayName(value: string): CategoryNameValidationResult {
  const trimmed = value.trim();
  if (!trimmed) return { status: 'blank' };
  if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
    return {
      status: 'too_long',
      maxLength: MAX_CATEGORY_NAME_LENGTH,
      actualLength: trimmed.length,
    };
  }
  return { status: 'valid', displayName: trimmed };
}

export function formatCategoryNameValidationMessage(
  result: Exclude<CategoryNameValidationResult, { readonly status: 'valid' }>,
): string {
  if (result.status === 'too_long') {
    return `Category names must be ${result.maxLength} characters or fewer; your trimmed name is ${result.actualLength} characters.`;
  }
  return 'Provide a non-blank category name.';
}

export function normalizeCategoryName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

export function filterCategoryChoices(
  categories: readonly CategoryRecord[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  const seenCategoryIds = new Set<string>();
  const choices = [...categories]
    .sort(compareCategoriesForList)
    .filter((category) => category.displayName.toLowerCase().includes(normalizedQuery))
    .flatMap((category) => {
      if (seenCategoryIds.has(category.id)) return [];
      seenCategoryIds.add(category.id);
      return [{ name: formatCategoryChoiceName(category), value: category.id }];
    })
    .slice(0, 25);
  if (choices.length > 0 || normalizedQuery.length === 0) return choices;

  return [{ name: 'No matching stored category', value: '__no_matching_category__' }];
}

function formatCategoryChoiceName(category: CategoryRecord): string {
  return `${category.displayName} (Category)`;
}

export function formatCategoryList(categories: readonly CategoryRecord[]): string {
  const note =
    'Persisted-only: categories come from saved linked-clan configuration and do not call the live Clash API or enroll extra polling.';
  if (categories.length === 0) {
    return [
      'Stored clan categories: 0',
      note,
      'No clan categories are configured for this server yet, so linked clans use Uncategorized.',
      'Use `/category create` first, then assign the category when linking or updating a linked clan.',
    ].join('\n');
  }

  const sortedCategories = [...categories].sort(compareCategoriesForList);
  const visibleCategories = sortedCategories.slice(0, MAX_CATEGORY_LIST_ROWS);
  const rows = visibleCategories.map(
    (category, index) =>
      `${index + 1}. ${escapeMarkdown(category.displayName)} — id ${inlineCode(category.id)}`,
  );
  const hiddenCount = sortedCategories.length - visibleCategories.length;

  return [
    `Stored clan categories: ${categories.length}`,
    `Showing ${visibleCategories.length} of ${categories.length}; sorted by saved configuration order, then name.`,
    note,
    ...rows,
    ...(hiddenCount > 0
      ? [`${hiddenCount} more saved categories are hidden here to keep the response concise.`]
      : []),
  ].join('\n');
}

function compareCategoriesForList(left: CategoryRecord, right: CategoryRecord): number {
  const orderDiff =
    (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
  if (orderDiff !== 0) return orderDiff;
  const nameDiff = left.displayName.localeCompare(right.displayName, undefined, {
    sensitivity: 'base',
  });
  if (nameDiff !== 0) return nameDiff;
  return left.id.localeCompare(right.id, undefined, { sensitivity: 'base' });
}

export async function resolveCategory(
  store: Pick<CategoryStore, 'listClanCategories'>,
  guildId: string,
  value: string,
): Promise<CategoryRecord | undefined> {
  const result = await resolveCategoryLookup(store, guildId, value);
  return result.status === 'found' ? result.category : undefined;
}

type CategoryLookupResult =
  | {
      readonly status: 'found';
      readonly category: CategoryRecord;
      readonly totalCategories: number;
      readonly duplicateNameMatches: number;
    }
  | { readonly status: 'no_categories' }
  | { readonly status: 'not_found'; readonly totalCategories: number };

async function resolveCategoryLookup(
  store: Pick<CategoryStore, 'listClanCategories'>,
  guildId: string,
  value: string,
): Promise<CategoryLookupResult> {
  const categories = await store.listClanCategories(guildId);
  if (categories.length === 0) return { status: 'no_categories' };

  const normalizedValue = normalizeCategoryName(value);
  const idMatch = categories.find((category) => category.id === value);
  const nameMatches = categories.filter(
    (category) => normalizeCategoryName(category.displayName) === normalizedValue,
  );
  const category = idMatch ?? nameMatches[0];
  return category
    ? {
        status: 'found',
        category,
        totalCategories: categories.length,
        duplicateNameMatches: idMatch ? 0 : Math.max(0, nameMatches.length - 1),
      }
    : { status: 'not_found', totalCategories: categories.length };
}

function formatCategoryLookupFailureMessage(
  result: Exclude<CategoryLookupResult, { readonly status: 'found' }>,
): string {
  if (result.status === 'no_categories') {
    return 'No stored categories exist for this server yet. Use `/category create` before editing or deleting a category; ClashMate will not search the live Clash API for categories.';
  }

  return `No stored category matched that value across ${result.totalCategories} saved categories. Pick a saved category from autocomplete or run \`/category list\`; autocomplete filters persisted server categories by name only.`;
}

function formatCategoryLookupContext(
  result: Extract<CategoryLookupResult, { readonly status: 'found' }>,
): string {
  const duplicateHint =
    result.duplicateNameMatches > 0
      ? ` ${result.duplicateNameMatches} other saved categories share that normalized name; autocomplete IDs disambiguate duplicates.`
      : '';
  return `Selected category: ${escapeMarkdown(result.category.displayName)} (${inlineCode(result.category.id)}) from ${result.totalCategories} saved categories.${duplicateHint}`;
}

export function formatCreateCategoryMessage(
  result: Awaited<ReturnType<CategoryStore['createClanCategory']>>,
): string {
  if (result.status === 'duplicate') {
    return 'A stored category with this name already exists for this server.';
  }
  return `Category created: ${escapeMarkdown(result.category.displayName)}. This saved server configuration is audit logged and can now be assigned to linked clans.`;
}

export function formatUpdateCategoryMessage(
  result: Awaited<ReturnType<CategoryStore['updateClanCategory']>>,
): string {
  if (result.status === 'duplicate') {
    return 'A stored category with this name already exists for this server.';
  }
  if (result.status === 'not_found') return 'No stored category matched that value.';
  return `Category name was updated to ${escapeMarkdown(result.category.displayName)}. Linked clans keep this category assignment, and the configuration change is audit logged.`;
}

export function formatDeleteCategoryMessage(
  result: Awaited<ReturnType<CategoryStore['deleteClanCategory']>>,
): string {
  if (result.status === 'not_found') return 'No stored category matched that value.';
  return `Successfully deleted category: ${escapeMarkdown(result.category.displayName)}. Linked clans assigned to it fall back to Uncategorized; this does not remove clans or change polling enrollment.`;
}
