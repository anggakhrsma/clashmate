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

  const categories = await options.store.listClanCategories(interaction.guildId);
  await interaction.respond(filterCategoryChoices(categories, String(focused.value ?? '')));
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
      content: 'You need the Manage Server permission to use `/category`.',
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
        content: 'No category name was provided. Reorder UI is not available in ClashMate yet.',
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
    const category = await resolveCategory(
      options.store,
      interaction.guildId,
      interaction.options.getString('category', true),
    );
    if (!category) {
      await interaction.reply({ content: 'No category matched that value.', ephemeral: true });
      return;
    }
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
    await interaction.reply({ content: formatUpdateCategoryMessage(result), ephemeral: true });
    return;
  }

  if (subcommand === 'delete') {
    const category = await resolveCategory(
      options.store,
      interaction.guildId,
      interaction.options.getString('category', true),
    );
    if (!category) {
      await interaction.reply({ content: 'No category matched that value.', ephemeral: true });
      return;
    }
    const result = await options.store.deleteClanCategory({
      guildId: interaction.guildId,
      actorDiscordUserId: interaction.user.id,
      categoryId: category.id,
    });
    await interaction.reply({ content: formatDeleteCategoryMessage(result), ephemeral: true });
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
  | { readonly status: 'too_long'; readonly maxLength: number };

export function validateCategoryDisplayName(value: string): CategoryNameValidationResult {
  const trimmed = value.trim();
  if (!trimmed) return { status: 'blank' };
  if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
    return { status: 'too_long', maxLength: MAX_CATEGORY_NAME_LENGTH };
  }
  return { status: 'valid', displayName: trimmed };
}

export function formatCategoryNameValidationMessage(
  result: Exclude<CategoryNameValidationResult, { readonly status: 'valid' }>,
): string {
  if (result.status === 'too_long') {
    return `Category names must be ${result.maxLength} characters or fewer.`;
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
  return categories
    .filter((category) => category.displayName.toLowerCase().includes(normalizedQuery))
    .slice(0, 25)
    .map((category) => ({ name: category.displayName, value: category.id }));
}

export function formatCategoryList(categories: readonly CategoryRecord[]): string {
  const note =
    'Only real stored categories are shown; synthetic General/Uncategorized choices are not listed.';
  if (categories.length === 0) {
    return `Stored clan categories: 0\n${note}\nNo clan categories are configured for this server yet.`;
  }

  const sortedCategories = [...categories].sort(compareCategoriesForList);
  const rows = sortedCategories.map(
    (category, index) =>
      `${index + 1}. ${escapeMarkdown(category.displayName)} — id ${inlineCode(category.id)}`,
  );

  return [
    `Stored clan categories: ${categories.length}`,
    'Sorted by configured order, then name.',
    note,
    ...rows,
  ].join('\n');
}

function compareCategoriesForList(left: CategoryRecord, right: CategoryRecord): number {
  const orderDiff =
    (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
  if (orderDiff !== 0) return orderDiff;
  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
}

export async function resolveCategory(
  store: Pick<CategoryStore, 'listClanCategories'>,
  guildId: string,
  value: string,
): Promise<CategoryRecord | undefined> {
  const categories = await store.listClanCategories(guildId);
  const normalizedValue = normalizeCategoryName(value);
  return categories.find(
    (category) =>
      category.id === value || normalizeCategoryName(category.displayName) === normalizedValue,
  );
}

export function formatCreateCategoryMessage(
  result: Awaited<ReturnType<CategoryStore['createClanCategory']>>,
): string {
  if (result.status === 'duplicate') return 'A category with this name already exists.';
  return `Category created: ${escapeMarkdown(result.category.displayName)}`;
}

export function formatUpdateCategoryMessage(
  result: Awaited<ReturnType<CategoryStore['updateClanCategory']>>,
): string {
  if (result.status === 'duplicate') return 'A category with this name already exists.';
  if (result.status === 'not_found') return 'No category matched that value.';
  return `Category name was updated to ${escapeMarkdown(result.category.displayName)}.`;
}

export function formatDeleteCategoryMessage(
  result: Awaited<ReturnType<CategoryStore['deleteClanCategory']>>,
): string {
  if (result.status === 'not_found') return 'No category matched that value.';
  return `Successfully deleted category: ${escapeMarkdown(result.category.displayName)}`;
}
