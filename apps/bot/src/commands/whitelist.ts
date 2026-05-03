import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const WHITELIST_COMMAND_NAME = 'whitelist';
export const WHITELIST_COMMAND_DESCRIPTION = 'Manage command whitelist restrictions.';

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
    option.setName('user_or_role').setDescription('User or role to whitelist for a command.'),
  )
  .addStringOption((option) =>
    option.setName('command').setDescription('Command to whitelist.').setAutocomplete(true),
  )
  .addBooleanOption((option) =>
    option.setName('clear').setDescription('Clear the matching whitelist entry.'),
  )
  .addBooleanOption((option) =>
    option.setName('list').setDescription('List current whitelist entries.'),
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

  if (!options.loadedCommandNames.includes(commandName)) {
    await interaction.reply({ content: `Unknown command: \`${commandName}\`.`, ephemeral: true });
    return;
  }

  const isRole = 'permissions' in mentionable;
  const isBot = !isRole && 'bot' in mentionable && mentionable.bot;
  if (isBot) {
    await interaction.reply({ content: 'You cannot whitelist a bot.', ephemeral: true });
    return;
  }

  if (interaction.options.getBoolean('clear') ?? false) {
    await options.store.clearCommandWhitelistEntry({
      guildId: interaction.guildId,
      guildName: interaction.guild.name,
      actorDiscordUserId: interaction.user.id,
      commandName,
      userOrRoleId: mentionable.id,
    });
    await interaction.reply({
      content: `### Successfully cleared the whitelist for ${formatMention(mentionable.id, isRole)} on /${commandName}`,
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
      `### Successfully whitelisted ${formatMention(mentionable.id, isRole)} for /${commandName}`,
      '',
      '- You can whitelist a role or a user. Once you whitelist a command, only that role or user will be able to use it. The command will be restricted for others, blocking them from using it unless they have other managerial roles or permissions.',
      '- The whitelist is limited to commands and does not extend to buttons or select menus.',
    ].join('\n'),
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

export function filterCommandChoices(
  commandNames: readonly string[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalized = query.trim().toLowerCase().replace(/^\//, '');
  return commandNames
    .filter((name) => !normalized || name.includes(normalized))
    .slice(0, 25)
    .map((name) => ({ name: `/${name}`, value: name }));
}

export function formatWhitelistList(entries: readonly CommandWhitelistEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.commandName.localeCompare(b.commandName));
  const lines = sorted.map(
    (entry) => `**/${entry.commandName}** - ${formatMention(entry.userOrRoleId, entry.isRole)}`,
  );
  return [
    '### Whitelisted Commands, Users and Roles',
    '',
    lines.join('\n') || 'No whitelisted users or roles.',
  ].join('\n');
}

export function normalizeCommandName(value: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase().replace(/^\//, '');
  return normalized || undefined;
}

function formatMention(id: string, isRole: boolean): string {
  return isRole ? `<@&${id}>` : `<@${id}>`;
}
