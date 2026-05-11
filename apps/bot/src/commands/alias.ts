import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const ALIAS_COMMAND_NAME = 'alias';
export const ALIAS_COMMAND_DESCRIPTION = 'Create, delete or view clan aliases.';
const MAX_ALIAS_LENGTH = 15;
const MAX_ALIAS_LIST_LENGTH = 1900;
const ALIAS_SCOPE_NOTE =
  'Aliases are saved on this server’s linked-clan configuration only; they do not perform live Clash API lookups or enroll new clans for polling.';

export const aliasCommandData = new SlashCommandBuilder()
  .setName(ALIAS_COMMAND_NAME)
  .setDescription(ALIAS_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('create')
      .setDescription('Creates a clan alias (short code or abbreviation) or clan nickname.')
      .addStringOption((option) =>
        option
          .setName('clan')
          .setDescription('Clan tag or name or alias.')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('alias_name')
          .setDescription('Name of the alias.')
          .setMaxLength(MAX_ALIAS_LENGTH),
      )
      .addStringOption((option) =>
        option
          .setName('clan_nickname')
          .setDescription('Clan nickname to use as the alias.')
          .setMaxLength(MAX_ALIAS_LENGTH),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('list').setDescription('List all clan aliases.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('delete')
      .setDescription('Deletes a clan alias.')
      .addStringOption((option) =>
        option
          .setName('alias')
          .setDescription('Tag of a clan or name of an alias')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

export interface AliasTrackedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string;
  readonly alias: string | null;
}

export interface AliasStore {
  listLinkedClans: (guildId: string) => Promise<AliasTrackedClan[]>;
  setAlias: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
    alias: string;
  }) => Promise<{ status: 'updated'; clan: AliasTrackedClan } | { status: 'not_found' }>;
  clearAlias: (input: {
    guildId: string;
    actorDiscordUserId: string;
    clanTag: string;
  }) => Promise<{ status: 'cleared'; clan: AliasTrackedClan } | { status: 'not_found' }>;
}

export interface AliasCommandOptions {
  store: AliasStore;
}

export function createAliasSlashCommand(options: AliasCommandOptions): SlashCommandDefinition {
  return {
    name: ALIAS_COMMAND_NAME,
    data: aliasCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== ALIAS_COMMAND_NAME) return;
      await executeAlias(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== ALIAS_COMMAND_NAME) return;
      await autocompleteAlias(interaction, options);
    },
  };
}

export async function autocompleteAlias(
  interaction: AutocompleteInteraction,
  options: AliasCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  let clans: AliasTrackedClan[];
  try {
    clans = await options.store.listLinkedClans(interaction.guildId);
  } catch {
    await interaction.respond([]);
    return;
  }
  if (focused.name === 'clan') {
    await interaction.respond(
      filterAliasChoices(clans, String(focused.value ?? ''), {
        label: formatAliasCreateChoiceName,
        value: (clan) => clan.clanTag,
      }),
    );
    return;
  }
  if (focused.name === 'alias') {
    await interaction.respond(
      filterAliasChoices(
        clans.filter((clan) => Boolean(clan.alias?.trim())),
        String(focused.value ?? ''),
        {
          label: formatAliasDeleteChoiceName,
          value: (clan) => clan.alias ?? clan.clanTag,
        },
      ),
    );
    return;
  }
  await interaction.respond([]);
}

async function executeAlias(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: AliasCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: '`/alias` can only be used in a server.', ephemeral: true });
    return;
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content:
        'You need the Manage Server permission to change this server’s linked-clan alias configuration with `/alias`.',
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'list') {
    const clans = await options.store.listLinkedClans(interaction.guildId);
    await interaction.reply({ content: formatAliasList(clans), ephemeral: true });
    return;
  }

  const clans = await options.store.listLinkedClans(interaction.guildId);
  if (subcommand === 'create') {
    if (clans.length === 0) {
      await interaction.reply({ content: formatNoLinkedClansMessage('create'), ephemeral: true });
      return;
    }

    const aliasInput =
      interaction.options.getString('alias_name') ?? interaction.options.getString('clan_nickname');
    const alias = parseAliasValue(aliasInput);
    if (alias.status !== 'valid') {
      await interaction.reply({
        content: formatInvalidAliasMessage(alias),
        ephemeral: true,
      });
      return;
    }

    const clan = resolveAliasClan(clans, interaction.options.getString('clan', true));
    if (!clan) {
      await interaction.reply({
        content: formatAliasLookupFailureMessage(
          interaction.options.getString('clan', true),
          'create',
        ),
        ephemeral: true,
      });
      return;
    }

    if (/^none$/i.test(alias.value)) {
      const result = await options.store.clearAlias({
        guildId: interaction.guildId,
        actorDiscordUserId: interaction.user.id,
        clanTag: clan.clanTag,
      });
      await interaction.reply({ content: formatClearAliasMessage(result), ephemeral: true });
      return;
    }

    const duplicate = findDuplicateAlias(clans, clan.clanTag, alias.value);
    if (duplicate) {
      await interaction.reply({
        content: `An alias with the name ${inlineCode(alias.value)} already exists for **${escapeDiscordText(duplicate.name)}** (${inlineCode(duplicate.clanTag)}). Alias names are exact, server-scoped configuration values; delete or change that alias first.`,
        ephemeral: true,
      });
      return;
    }

    const result = await options.store.setAlias({
      guildId: interaction.guildId,
      actorDiscordUserId: interaction.user.id,
      clanTag: clan.clanTag,
      alias: alias.value,
    });
    await interaction.reply({
      content: formatSetAliasMessage(result, alias.value),
      ephemeral: true,
    });
    return;
  }

  if (subcommand === 'delete') {
    if (clans.length === 0) {
      await interaction.reply({ content: formatNoLinkedClansMessage('delete'), ephemeral: true });
      return;
    }

    const clan = resolveAliasClan(clans, interaction.options.getString('alias', true));
    if (!clan) {
      await interaction.reply({
        content: formatAliasLookupFailureMessage(
          interaction.options.getString('alias', true),
          'delete',
        ),
        ephemeral: true,
      });
      return;
    }
    if (!clan.alias?.trim()) {
      await interaction.reply({
        content: `Matched linked clan **${escapeDiscordText(clan.name)}** (${inlineCode(clan.clanTag)}), but it does not have an alias to delete. Choose an existing alias from autocomplete or create one with \`/alias create\` first.`,
        ephemeral: true,
      });
      return;
    }
    const result = await options.store.clearAlias({
      guildId: interaction.guildId,
      actorDiscordUserId: interaction.user.id,
      clanTag: clan.clanTag,
    });
    await interaction.reply({ content: formatClearAliasMessage(result), ephemeral: true });
  }
}

export type ParsedAliasValue =
  | { readonly status: 'valid'; readonly value: string }
  | { readonly status: 'blank' }
  | { readonly status: 'hash_prefix' }
  | { readonly status: 'whitespace' }
  | { readonly status: 'overlong'; readonly length: number; readonly maxLength: number };

export function parseAliasValue(value: string | null): ParsedAliasValue {
  const trimmed = value?.trim();
  if (!trimmed) return { status: 'blank' };
  if (trimmed.startsWith('#')) return { status: 'hash_prefix' };
  if (/\s/u.test(trimmed)) return { status: 'whitespace' };
  if (trimmed.length > MAX_ALIAS_LENGTH) {
    return { status: 'overlong', length: trimmed.length, maxLength: MAX_ALIAS_LENGTH };
  }
  return { status: 'valid', value: trimmed };
}

export function resolveAliasClan(
  clans: readonly AliasTrackedClan[],
  query: string,
): AliasTrackedClan | undefined {
  const normalized = query.trim().toLowerCase();
  const normalizedTag = normalizePossibleTag(query);
  return clans.find((clan) => {
    const values = [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name, clan.alias ?? ''];
    return (
      values.some((value) => value.trim().toLowerCase() === normalized) ||
      clan.clanTag === normalizedTag
    );
  });
}

export function filterAliasClanChoices(
  clans: readonly AliasTrackedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  return filterAliasChoices(clans, query, {
    label: formatAliasCreateChoiceName,
    value: (clan) => clan.clanTag,
  });
}

export function filterAliasDeleteChoices(
  clans: readonly AliasTrackedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  return filterAliasChoices(
    clans.filter((clan) => Boolean(clan.alias?.trim())),
    query,
    {
      label: formatAliasDeleteChoiceName,
      value: (clan) => clan.alias ?? clan.clanTag,
    },
  );
}

interface AliasChoiceFormat {
  readonly label: (clan: AliasTrackedClan) => string;
  readonly value: (clan: AliasTrackedClan) => string;
}

function filterAliasChoices(
  clans: readonly AliasTrackedClan[],
  query: string,
  format: AliasChoiceFormat,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => {
      if (!normalizedQuery) return true;
      return [clan.clanTag, clan.name, clan.alias]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    })
    .toSorted(compareAliasChoices)
    .slice(0, 25)
    .map((clan) => ({ name: format.label(clan), value: format.value(clan) }));
}

export function formatAliasList(clans: readonly AliasTrackedClan[]): string {
  const aliasedClans = clans
    .filter((clan) => clan.alias?.trim())
    .toSorted((left, right) => {
      const leftAlias = left.alias?.trim().toLowerCase() ?? '';
      const rightAlias = right.alias?.trim().toLowerCase() ?? '';
      return leftAlias.localeCompare(rightAlias) || left.name.localeCompare(right.name);
    });
  const header = [
    '**Clan Aliases**',
    `Linked clans: **${clans.length}** • Aliases: **${aliasedClans.length}**`,
    `${ALIAS_SCOPE_NOTE} Changes are audited with the user who changed them.`,
    'Autocomplete filters the same linked clans by tag, exact saved alias, or linked clan name; delete choices only show clans that currently have aliases.',
  ];
  if (clans.length === 0) {
    return [
      ...header,
      '',
      'No clans are linked to this server yet. Link a clan before creating aliases; `/alias` will not look up or add clans by itself.',
    ].join('\n');
  }
  if (aliasedClans.length === 0) {
    return [
      ...header,
      '',
      'No linked clan aliases are configured yet. Use `/alias create` with a linked clan tag, exact linked clan name, or autocomplete choice to add one.',
    ].join('\n');
  }

  const rows = aliasedClans.map(
    (clan) =>
      `- ${inlineCode(clan.alias?.trim() ?? '')} → ${escapeDiscordText(clan.name)} (${inlineCode(clan.clanTag)})`,
  );
  return truncateLines([...header, '', ...rows], MAX_ALIAS_LIST_LENGTH);
}

export function formatInvalidAliasMessage(
  result: Exclude<ParsedAliasValue, { status: 'valid' }>,
): string {
  if (result.status === 'blank') {
    return 'Provide `alias_name` or `clan_nickname` with a non-blank alias.';
  }
  if (result.status === 'hash_prefix') {
    return 'A clan alias must not start with `#`. Use the clan option for clan tags and enter only the short alias name.';
  }
  if (result.status === 'whitespace') {
    return 'A clan alias must not contain whitespace. Use a short code such as `main`, `mini`, or `war`.';
  }
  return `Alias names can be at most ${result.maxLength} characters; your alias is ${result.length} characters.`;
}

export function formatSetAliasMessage(
  result: Awaited<ReturnType<AliasStore['setAlias']>>,
  alias: string,
): string {
  if (result.status === 'not_found') return 'That clan is no longer linked to this server.';
  return `Clan alias or nickname updated: ${inlineCode(alias)} now points to **${escapeDiscordText(result.clan.name)}** (${inlineCode(result.clan.clanTag)}). This server configuration change was saved and audited; it does not change polling enrollment beyond the already linked clan.`;
}

export function formatClearAliasMessage(
  result: Awaited<ReturnType<AliasStore['clearAlias']>>,
): string {
  if (result.status === 'not_found') return 'That clan is no longer linked to this server.';
  return `Successfully deleted the clan alias for **${escapeDiscordText(result.clan.name)}** (${inlineCode(result.clan.clanTag)}). This server configuration change was saved and audited; the linked clan remains configured.`;
}

function formatNoLinkedClansMessage(action: 'create' | 'delete'): string {
  const verb = action === 'create' ? 'create aliases for' : 'delete aliases from';
  return `No clans are linked to this server yet. Link a clan before using \`/alias ${action}\`; aliases can only ${verb} linked clans and never perform live Clash API fallback lookups.`;
}

function formatAliasLookupFailureMessage(query: string, action: 'create' | 'delete'): string {
  const value = inlineCode(query.trim() || query);
  if (action === 'create') {
    return `No linked clan matched ${value}. Aliases can only be created for clans already linked to this server; choose a linked clan from autocomplete or enter its exact tag or exact linked clan name. No live Clash API fallback is used.`;
  }
  return `No linked clan alias matched ${value}. Choose an existing alias from autocomplete, or enter the exact saved alias, linked clan tag, or exact linked clan name for a clan that currently has an alias. No live Clash API fallback is used.`;
}

function findDuplicateAlias(
  clans: readonly AliasTrackedClan[],
  clanTag: string,
  alias: string,
): AliasTrackedClan | undefined {
  const normalizedAlias = alias.trim().toLowerCase();
  return clans.find(
    (clan) => clan.clanTag !== clanTag && clan.alias?.trim().toLowerCase() === normalizedAlias,
  );
}

function compareAliasChoices(left: AliasTrackedClan, right: AliasTrackedClan): number {
  const leftAlias = left.alias?.trim().toLowerCase() ?? '';
  const rightAlias = right.alias?.trim().toLowerCase() ?? '';
  return (
    leftAlias.localeCompare(rightAlias) ||
    left.name.localeCompare(right.name) ||
    left.clanTag.localeCompare(right.clanTag)
  );
}

function formatAliasCreateChoiceName(clan: AliasTrackedClan): string {
  const alias = clan.alias?.trim();
  return truncateChoiceName(
    alias
      ? `Clan: ${clan.name} | Tag: ${clan.clanTag} | Alias: ${alias}`
      : `Clan: ${clan.name} | Tag: ${clan.clanTag} | Alias: none`,
  );
}

function formatAliasDeleteChoiceName(clan: AliasTrackedClan): string {
  return truncateChoiceName(
    `Alias: ${clan.alias?.trim() ?? ''} | Clan: ${clan.name} | Tag: ${clan.clanTag}`,
  );
}

function truncateChoiceName(value: string): string {
  if (value.length <= 100) return value;
  return `${value.slice(0, 99)}…`;
}

function normalizePossibleTag(value: string): string {
  return value.trim().toUpperCase().replace(/^#?/, '#').replace(/O/g, '0');
}

function inlineCode(value: string): string {
  return `\`${value.replace(/`/g, 'ˋ')}\``;
}

function escapeDiscordText(value: string): string {
  return value.replace(/([\\_*~|>])/g, '\\$1').replace(/`/g, 'ˋ');
}

function truncateLines(lines: readonly string[], maxLength: number): string {
  const visible: string[] = [];
  for (const line of lines) {
    const candidate = [...visible, line].join('\n');
    if (candidate.length > maxLength) break;
    visible.push(line);
  }
  const hiddenCount = lines.length - visible.length;
  if (hiddenCount <= 0) return visible.join('\n');
  return [...visible, `…and ${hiddenCount} more alias row${hiddenCount === 1 ? '' : 's'}.`].join(
    '\n',
  );
}
