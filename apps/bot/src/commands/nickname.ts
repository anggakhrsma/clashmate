import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const NICKNAME_COMMAND_NAME = 'nickname';
export const NICKNAME_COMMAND_DESCRIPTION = 'Configure ClashMate nickname preferences.';
export const NICKNAME_FIRST_PASS_NOTE =
  'First pass: ClashMate stores these nickname preferences only. Discord nickname mutation and autorole refresh are not implemented yet.';
export const DISCORD_NICKNAME_MAX_LENGTH = 32;

export type NicknameChangePreference = 'true' | 'false';
export type NicknameAccountPreference =
  | 'default-account'
  | 'best-account'
  | 'default-or-best-account';

export interface NicknameConfigView {
  familyNicknameFormat: string | null;
  nonFamilyNicknameFormat: string | null;
  changeNicknames: NicknameChangePreference | null;
  accountPreferenceForNaming: NicknameAccountPreference | null;
}

export interface UpdateNicknameConfigInput extends NicknameConfigView {
  guildId: string;
  guildName: string | null;
  actorDiscordUserId: string;
}

export interface NicknameConfigStore {
  getNicknameConfig: (guildId: string) => Promise<NicknameConfigView>;
  updateNicknameConfig: (input: UpdateNicknameConfigInput) => Promise<NicknameConfigView>;
}

export interface NicknameCommandOptions {
  store: NicknameConfigStore;
}

export const nicknameCommandData = new SlashCommandBuilder()
  .setName(NICKNAME_COMMAND_NAME)
  .setDescription(NICKNAME_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('config')
      .setDescription('Configure server nickname preferences.')
      .addStringOption((option) =>
        option
          .setName('family_nickname_format')
          .setDescription('Nickname format for family clan members.')
          .setMaxLength(DISCORD_NICKNAME_MAX_LENGTH),
      )
      .addStringOption((option) =>
        option
          .setName('non_family_nickname_format')
          .setDescription('Nickname format for non-family clan members.')
          .setMaxLength(DISCORD_NICKNAME_MAX_LENGTH),
      )
      .addStringOption((option) =>
        option
          .setName('change_nicknames')
          .setDescription('Whether ClashMate should change nicknames when mutation is implemented.')
          .addChoices({ name: 'Yes', value: 'true' }, { name: 'No', value: 'false' }),
      )
      .addStringOption((option) =>
        option
          .setName('account_preference_for_naming')
          .setDescription('Which linked account should be used for nickname formatting.')
          .addChoices(
            { name: 'Default Account', value: 'default-account' },
            { name: 'Best Account', value: 'best-account' },
            { name: 'Default or Best Account', value: 'default-or-best-account' },
          ),
      ),
  );

export function createNicknameSlashCommand(
  options: NicknameCommandOptions,
): SlashCommandDefinition {
  return {
    name: NICKNAME_COMMAND_NAME,
    data: nicknameCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== NICKNAME_COMMAND_NAME) return;
      await executeNicknameInteraction(interaction, context, options);
    },
  };
}

export async function executeNicknameInteraction(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: NicknameCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/nickname config` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'You need the Manage Server permission to use `/nickname config`.',
      ephemeral: true,
    });
    return;
  }

  if (interaction.options.getSubcommand() !== 'config') return;

  const input = parseNicknameConfigOptions({
    familyNicknameFormat: interaction.options.getString('family_nickname_format'),
    nonFamilyNicknameFormat: interaction.options.getString('non_family_nickname_format'),
    changeNicknames: interaction.options.getString('change_nicknames'),
    accountPreferenceForNaming: interaction.options.getString('account_preference_for_naming'),
  });

  if (!input.ok) {
    await interaction.reply({ content: input.error, ephemeral: true });
    return;
  }

  const view = input.hasUpdates
    ? await options.store.updateNicknameConfig({
        guildId: interaction.guildId,
        guildName: interaction.guild.name,
        actorDiscordUserId: interaction.user.id,
        ...input.view,
      })
    : await options.store.getNicknameConfig(interaction.guildId);

  await interaction.reply({ embeds: [buildNicknameConfigEmbed(view)], ephemeral: true });
}

export function parseNicknameConfigOptions(input: {
  familyNicknameFormat: string | null;
  nonFamilyNicknameFormat: string | null;
  changeNicknames: string | null;
  accountPreferenceForNaming: string | null;
}): { ok: true; hasUpdates: boolean; view: NicknameConfigView } | { ok: false; error: string } {
  const familyNicknameFormat = validateNicknameFormat(
    input.familyNicknameFormat,
    'family_nickname_format',
  );
  if (!familyNicknameFormat.ok) return familyNicknameFormat;

  const nonFamilyNicknameFormat = validateNicknameFormat(
    input.nonFamilyNicknameFormat,
    'non_family_nickname_format',
  );
  if (!nonFamilyNicknameFormat.ok) return nonFamilyNicknameFormat;

  return {
    ok: true,
    hasUpdates: Object.values(input).some((value) => value !== null),
    view: {
      familyNicknameFormat: familyNicknameFormat.value,
      nonFamilyNicknameFormat: nonFamilyNicknameFormat.value,
      changeNicknames: parseChangePreference(input.changeNicknames),
      accountPreferenceForNaming: parseAccountPreference(input.accountPreferenceForNaming),
    },
  };
}

export function buildNicknameConfigEmbed(view: NicknameConfigView): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Nickname Preferences')
    .setDescription(NICKNAME_FIRST_PASS_NOTE)
    .addFields(
      {
        name: 'Family nickname format',
        value: formatStoredValue(view.familyNicknameFormat),
        inline: false,
      },
      {
        name: 'Non-family nickname format',
        value: formatStoredValue(view.nonFamilyNicknameFormat),
        inline: false,
      },
      {
        name: 'Change nicknames',
        value:
          view.changeNicknames === null
            ? 'Not set'
            : view.changeNicknames === 'true'
              ? 'Yes'
              : 'No',
        inline: true,
      },
      {
        name: 'Account preference for naming',
        value: view.accountPreferenceForNaming ?? 'Not set',
        inline: true,
      },
      {
        name: 'Preview only',
        value: formatNicknamePreview(view),
        inline: false,
      },
    );
}

export function validateNicknameFormat(
  value: string | null,
  optionName: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };

  const trimmed = value.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: `\`${optionName}\` cannot be empty. Provide a nickname format up to ${DISCORD_NICKNAME_MAX_LENGTH} characters.`,
    };
  }

  if (trimmed.length > DISCORD_NICKNAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `\`${optionName}\` is too long (${trimmed.length}/${DISCORD_NICKNAME_MAX_LENGTH} characters). Discord nicknames can be at most ${DISCORD_NICKNAME_MAX_LENGTH} characters.`,
    };
  }

  return { ok: true, value: trimmed };
}

function parseChangePreference(value: string | null): NicknameChangePreference | null {
  return value === 'true' || value === 'false' ? value : null;
}

function parseAccountPreference(value: string | null): NicknameAccountPreference | null {
  if (
    value === 'default-account' ||
    value === 'best-account' ||
    value === 'default-or-best-account'
  ) {
    return value;
  }
  return null;
}

function formatStoredValue(value: string | null): string {
  return value ? `\`${value}\`` : 'Not set';
}

function formatNicknamePreview(view: NicknameConfigView): string {
  const previews = [
    formatPreviewLine('Family', view.familyNicknameFormat),
    formatPreviewLine('Non-family', view.nonFamilyNicknameFormat),
  ].filter((line) => line !== null);

  return previews.length > 0
    ? `${previews.join('\n')}\nNo Discord nicknames are changed by this command.`
    : 'Set a nickname format to see an example. No Discord nicknames are changed by this command.';
}

function formatPreviewLine(label: string, format: string | null): string | null {
  if (!format) return null;
  return `${label}: \`${buildNicknamePreview(format)}\``;
}

export function buildNicknamePreview(format: string): string {
  return format
    .replaceAll('{player}', 'PlayerOne')
    .replaceAll('{player_name}', 'PlayerOne')
    .replaceAll('{playerName}', 'PlayerOne')
    .replaceAll('{name}', 'PlayerOne')
    .replaceAll('{tag}', '#2PP')
    .replaceAll('{clan}', 'ClanMate')
    .replaceAll('{townHall}', 'TH16')
    .replaceAll('{town_hall}', 'TH16')
    .replaceAll('{th}', 'TH16');
}
