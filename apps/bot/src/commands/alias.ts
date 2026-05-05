import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const ALIAS_COMMAND_NAME = 'alias';
export const ALIAS_COMMAND_DESCRIPTION = 'Manage aliases for linked clans.';
const MAX_ALIAS_LENGTH = 15;
const MAX_ALIAS_LIST_LENGTH = 1900;

export const aliasCommandData = new SlashCommandBuilder()
  .setName(ALIAS_COMMAND_NAME)
  .setDescription(ALIAS_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('create')
      .setDescription('Create or update a linked clan alias.')
      .addStringOption((option) =>
        option
          .setName('clan')
          .setDescription('Clan tag or name or alias.')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option.setName('alias_name').setDescription('Alias name.').setMaxLength(MAX_ALIAS_LENGTH),
      )
      .addStringOption((option) =>
        option
          .setName('clan_nickname')
          .setDescription('Clan nickname to use as the alias.')
          .setMaxLength(MAX_ALIAS_LENGTH),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('list').setDescription('List linked clans with aliases.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('delete')
      .setDescription('Delete a linked clan alias.')
      .addStringOption((option) =>
        option
          .setName('alias')
          .setDescription('Alias, clan tag, or clan name.')
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
  const clans = await options.store.listLinkedClans(interaction.guildId);
  if (focused.name === 'clan') {
    await interaction.respond(filterAliasClanChoices(clans, String(focused.value ?? '')));
    return;
  }
  if (focused.name === 'alias') {
    await interaction.respond(filterAliasDeleteChoices(clans, String(focused.value ?? '')));
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
      content: 'You need the Manage Server permission to use `/alias`.',
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
        content:
          'No linked clan matched that value. Aliases can only be created for clans already linked to this server.',
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
    const clan = resolveAliasClan(clans, interaction.options.getString('alias', true));
    if (!clan) {
      await interaction.reply({
        content: 'No linked clan matched that alias, clan tag, or clan name.',
        ephemeral: true,
      });
      return;
    }
    if (!clan.alias?.trim()) {
      await interaction.reply({
        content: `Matched linked clan **${escapeDiscordText(clan.name)}** (${inlineCode(clan.clanTag)}), but it does not have an alias to delete.`,
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
  | { readonly status: 'overlong'; readonly length: number; readonly maxLength: number };

export function parseAliasValue(value: string | null): ParsedAliasValue {
  const trimmed = value?.trim();
  if (!trimmed) return { status: 'blank' };
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
  return filterAliasChoices(clans, query, (clan) => clan.clanTag);
}

export function filterAliasDeleteChoices(
  clans: readonly AliasTrackedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  return filterAliasChoices(
    clans.filter((clan) => Boolean(clan.alias?.trim())),
    query,
    (clan) => clan.alias ?? clan.clanTag,
  );
}

function filterAliasChoices(
  clans: readonly AliasTrackedClan[],
  query: string,
  valueForClan: (clan: AliasTrackedClan) => string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => {
      if (!normalizedQuery) return true;
      return [clan.clanTag, clan.name, clan.alias]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    })
    .slice(0, 25)
    .map((clan) => ({ name: formatAliasChoiceName(clan), value: valueForClan(clan) }));
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
    'Aliases are stored only for clans linked to this server.',
  ];
  if (aliasedClans.length === 0) {
    return [...header, '', 'No linked clan aliases are configured yet.'].join('\n');
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
  return `Alias names can be at most ${result.maxLength} characters; your alias is ${result.length} characters.`;
}

export function formatSetAliasMessage(
  result: Awaited<ReturnType<AliasStore['setAlias']>>,
  alias: string,
): string {
  if (result.status === 'not_found') return 'That clan is no longer linked to this server.';
  return `Set alias ${inlineCode(alias)} for **${escapeDiscordText(result.clan.name)}** (${inlineCode(result.clan.clanTag)}).`;
}

export function formatClearAliasMessage(
  result: Awaited<ReturnType<AliasStore['clearAlias']>>,
): string {
  if (result.status === 'not_found') return 'That clan is no longer linked to this server.';
  return `Cleared alias for **${escapeDiscordText(result.clan.name)}** (${inlineCode(result.clan.clanTag)}).`;
}

function formatAliasChoiceName(clan: AliasTrackedClan): string {
  const alias = clan.alias?.trim();
  return alias ? `${alias} — ${clan.name} (${clan.clanTag})` : `${clan.name} (${clan.clanTag})`;
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
