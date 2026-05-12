import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const WHITELIST_COMMAND_NAME = 'whitelist';
export const WHITELIST_COMMAND_DESCRIPTION = 'Whitelist a role or user to use specific commands.';

export interface CommandWhitelistEntry {
  commandName: string;
  userOrRoleId: string;
  isRole: boolean;
}

export interface WhitelistStore {
  listCommandWhitelist: (guildId: string) => Promise<CommandWhitelistEntry[]>;
  addCommandWhitelistEntry: (input: {
    guildId: string;
    guildName: string | null;
    actorDiscordUserId: string;
    entry: CommandWhitelistEntry;
  }) => Promise<CommandWhitelistEntry[]>;
  clearCommandWhitelistEntry: (input: {
    guildId: string;
    guildName: string | null;
    actorDiscordUserId: string;
    commandName: string;
    userOrRoleId: string;
  }) => Promise<{ removed: boolean; entries: CommandWhitelistEntry[] }>;
}

export interface WhitelistCommandOptions {
  store: WhitelistStore;
  loadedCommandNames: readonly string[];
}

export const whitelistCommandData = new SlashCommandBuilder()
  .setName(WHITELIST_COMMAND_NAME)
  .setDescription(WHITELIST_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addMentionableOption((option) =>
    option.setName('user_or_role').setDescription('User or role to whitelist.'),
  )
  .addStringOption((option) =>
    option.setName('command').setDescription('Command to whitelist.').setAutocomplete(true),
  )
  .addBooleanOption((option) => option.setName('clear').setDescription('Clear the whitelist.'))
  .addBooleanOption((option) =>
    option.setName('list').setDescription('List all whitelisted users and roles.'),
  );

export function createWhitelistSlashCommand(
  options: WhitelistCommandOptions,
): SlashCommandDefinition {
  return {
    name: WHITELIST_COMMAND_NAME,
    data: whitelistCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== WHITELIST_COMMAND_NAME) return;
      await executeWhitelistInteraction(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== WHITELIST_COMMAND_NAME) return;
      await interaction.respond(
        filterCommandChoices(options.loadedCommandNames, interaction.options.getFocused()),
      );
    },
  };
}

export async function autocompleteWhitelist(
  interaction: AutocompleteInteraction,
  loadedCommandNames: readonly string[],
): Promise<void> {
  await interaction.respond(
    filterCommandChoices(loadedCommandNames, interaction.options.getFocused()),
  );
}

export async function executeWhitelistInteraction(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: WhitelistCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/whitelist` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'You need the Manage Server permission to use `/whitelist`.',
      ephemeral: true,
    });
    return;
  }

  const shouldList = interaction.options.getBoolean('list') ?? false;
  const mentionable = interaction.options.getMentionable('user_or_role');
  const commandName = normalizeCommandName(interaction.options.getString('command'));

  if (shouldList || (!mentionable && !commandName)) {
    const entries = await options.store.listCommandWhitelist(interaction.guildId);
    await interaction.reply({
      content: formatWhitelistList(entries),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (!mentionable || !commandName) {
    await interaction.reply({
      content: 'You must provide a user or role and a command to whitelist.',
      ephemeral: true,
    });
    return;
  }

  if (!isLoadedCommandName(commandName, options.loadedCommandNames)) {
    await interaction.reply({
      content: formatUnknownCommandFeedback(commandName, options.loadedCommandNames),
      ephemeral: true,
    });
    return;
  }

  const isRole = 'permissions' in mentionable;
  const isBot = !isRole && 'bot' in mentionable && mentionable.bot;
  if (isBot) {
    await interaction.reply({ content: 'You cannot whitelist a bot.', ephemeral: true });
    return;
  }

  const existingEntries = await options.store.listCommandWhitelist(interaction.guildId);
  const existingEntry = existingEntries.find(
    (entry) => entry.commandName === commandName && entry.userOrRoleId === mentionable.id,
  );

  if (interaction.options.getBoolean('clear') ?? false) {
    const commandEntryCount = existingEntries.filter(
      (entry) => entry.commandName === commandName,
    ).length;
    const result = await options.store.clearCommandWhitelistEntry({
      guildId: interaction.guildId,
      guildName: interaction.guild.name,
      actorDiscordUserId: interaction.user.id,
      commandName,
      userOrRoleId: mentionable.id,
    });
    await interaction.reply({
      content: result.removed
        ? [
            `### Successfully cleared the whitelist for ${formatMention(mentionable.id, isRole)} on \`/${commandName}\``,
            '',
            `The change was saved for this server and an audit entry was recorded. Remaining \`/${commandName}\` whitelist entries: \`${Math.max(commandEntryCount - 1, 0)}\`.`,
          ].join('\n')
        : [
            `No matching whitelist entry existed for ${formatMention(mentionable.id, isRole)} on \`/${commandName}\`. Nothing changed.`,
            commandEntryCount === 0
              ? `\`/${commandName}\` is not currently restricted by command whitelist entries.`
              : `\`/${commandName}\` still has \`${commandEntryCount}\` other whitelist entr${commandEntryCount === 1 ? 'y' : 'ies'}.`,
          ].join('\n'),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (existingEntry) {
    await interaction.reply({
      content: [
        `${formatMention(mentionable.id, isRole)} is already whitelisted for \`/${commandName}\`. Nothing changed.`,
        '',
        `When a command has whitelist entries, only whitelisted users, whitelisted roles, server members with Manage Server, configured bot manager roles, and bot owners can use it.`,
      ].join('\n'),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await options.store.addCommandWhitelistEntry({
    guildId: interaction.guildId,
    guildName: interaction.guild.name,
    actorDiscordUserId: interaction.user.id,
    entry: { commandName, userOrRoleId: mentionable.id, isRole },
  });

  await interaction.reply({
    content: [
      `### Successfully whitelisted ${formatMention(mentionable.id, isRole)} for \`/${commandName}\``,
      '',
      '- This entry was saved for this server and an audit entry was recorded.',
      '- Once a command has whitelist entries, only whitelisted users, whitelisted roles, server members with Manage Server, configured bot manager roles, and bot owners can use it.',
      '- The whitelist is limited to slash commands and does not extend to buttons or select menus.',
    ].join('\n'),
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

export function filterCommandChoices(
  commandNames: readonly string[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalized = normalizeCommandName(query) ?? '';
  return normalizedLoadedCommandNames(commandNames)
    .filter((name) => !normalized || name.includes(normalized))
    .slice(0, 25)
    .map((name) => ({ name: `/${name}`, value: name }));
}

export function formatWhitelistList(entries: readonly CommandWhitelistEntry[]): string {
  if (entries.length === 0) {
    return [
      '### Whitelisted Commands, Users and Roles',
      '',
      'Total entries: `0` • Commands: `0` • Users: `0` • Roles: `0`',
      '',
      'No whitelisted users or roles.',
      '',
      'Commands are unrestricted until at least one whitelist entry is saved for that command.',
    ].join('\n');
  }

  const commandNames = [...new Set(entries.map((entry) => entry.commandName))].sort((a, b) =>
    a.localeCompare(b),
  );
  const userCount = entries.filter((entry) => !entry.isRole).length;
  const roleCount = entries.length - userCount;
  const lines = commandNames.flatMap((commandName) => {
    const commandEntries = entries
      .filter((entry) => entry.commandName === commandName)
      .sort((a, b) => {
        if (a.isRole !== b.isRole) return a.isRole ? 1 : -1;
        return a.userOrRoleId.localeCompare(b.userOrRoleId);
      });
    return [
      `**\`/${escapeInlineCode(commandName)}\`** (${commandEntries.length})`,
      ...commandEntries.map(
        (entry) =>
          `- ${entry.isRole ? 'Role' : 'User'}: ${formatMention(entry.userOrRoleId, entry.isRole)}`,
      ),
    ];
  });

  return truncateDiscordContent(
    [
      '### Whitelisted Commands, Users and Roles',
      '',
      `Total entries: \`${entries.length}\` • Commands: \`${commandNames.length}\` • Users: \`${userCount}\` • Roles: \`${roleCount}\``,
      '',
      lines.join('\n'),
      '',
      'Command checks use these saved entries: if a command is listed here, access is limited to matching users/roles plus Manage Server members, configured bot manager roles, and bot owners.',
    ].join('\n'),
  );
}

export function normalizeCommandName(value: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase().replace(/^\//, '');
  return normalized || undefined;
}

function formatMention(id: string, isRole: boolean): string {
  return isRole ? `<@&${id}>` : `<@${id}>`;
}

function isLoadedCommandName(commandName: string, loadedCommandNames: readonly string[]): boolean {
  return normalizedLoadedCommandNames(loadedCommandNames).includes(commandName);
}

export function formatUnknownCommandFeedback(
  commandName: string,
  loadedCommandNames: readonly string[],
): string {
  const suggestions = findClosestCommandNames(commandName, loadedCommandNames);
  const suggestionText = suggestions.length
    ? ` Did you mean ${suggestions.map((name) => `\`/${name}\``).join(', ')}?`
    : ' Use autocomplete to select a loaded command.';
  return `Unknown command: \`/${escapeInlineCode(commandName)}\`.${suggestionText}`;
}

export function findClosestCommandNames(
  commandName: string,
  loadedCommandNames: readonly string[],
): string[] {
  const normalized = commandName.trim().toLowerCase().replace(/^\//, '');
  return normalizedLoadedCommandNames(loadedCommandNames)
    .map((name) => ({ name, score: commandSuggestionScore(normalized, name) }))
    .filter((candidate) => candidate.score < Number.POSITIVE_INFINITY)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map((candidate) => candidate.name);
}

function normalizedLoadedCommandNames(commandNames: readonly string[]): string[] {
  return [...new Set(commandNames.map((name) => normalizeCommandName(name)).filter(isString))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}

function commandSuggestionScore(query: string, commandName: string): number {
  if (!query) return Number.POSITIVE_INFINITY;
  if (commandName === query) return 0;
  if (commandName.startsWith(query)) return 1;
  if (commandName.includes(query)) return 2;
  const distance = levenshteinDistance(query, commandName);
  const threshold = Math.max(2, Math.floor(Math.max(query.length, commandName.length) / 3));
  return distance <= threshold ? 10 + distance : Number.POSITIVE_INFINITY;
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      current[rightIndex + 1] = Math.min(
        (current[rightIndex] ?? 0) + 1,
        (previous[rightIndex + 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}

function escapeInlineCode(value: string): string {
  return value.replaceAll('`', '\u02cb');
}

function truncateDiscordContent(content: string): string {
  const maxLength = 1900;
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength - 40)}\n… output truncated. Use filters later.`;
}
