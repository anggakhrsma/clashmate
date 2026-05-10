import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const NICKNAME_COMMAND_NAME = 'nickname';
export const NICKNAME_COMMAND_DESCRIPTION = 'Manage automatic nickname settings.';
export const NICKNAME_FIRST_PASS_NOTE =
  'ClashMate stores these nickname preferences only. This command never changes Discord nicknames; nickname mutation and refresh are not implemented yet.';
export const DISCORD_NICKNAME_MAX_LENGTH = 32;
export const SUPPORTED_NICKNAME_PLACEHOLDERS = [
  '{NAME}',
  '{PLAYER_NAME}',
  '{CLAN}',
  '{CLAN_NAME}',
  '{ALIAS}',
  '{CLAN_ALIAS}',
  '{TH}',
  '{TOWN_HALL}',
  '{ROLE}',
  '{CLAN_ROLE}',
  '{DISCORD_NAME}',
  '{DISCORD_USERNAME}',
] as const;
export const NICKNAME_PLACEHOLDER_GUIDANCE = `Supported placeholders: ${SUPPORTED_NICKNAME_PLACEHOLDERS.map((placeholder) => `\`${placeholder}\``).join(', ')}.`;

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
      .setDescription('Configure automatic server nickname settings.')
      .addStringOption((option) =>
        option
          .setName('family_nickname_format')
          .setDescription(
            'Set family nickname format (e.g. {CLAN} | {ALIAS} | {TH} | {ROLE} | {NAME})',
          )
          .setMaxLength(DISCORD_NICKNAME_MAX_LENGTH),
      )
      .addStringOption((option) =>
        option
          .setName('non_family_nickname_format')
          .setDescription('Set non-family nickname format (e.g. {NAME} | {TH})')
          .setMaxLength(DISCORD_NICKNAME_MAX_LENGTH),
      )
      .addStringOption((option) =>
        option
          .setName('change_nicknames')
          .setDescription('Whether to update nicknames automatically.')
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
    ? await updateNicknameConfigWithExistingValues(interaction, options.store, input.view)
    : await options.store.getNicknameConfig(interaction.guildId);

  await interaction.reply({
    embeds: [buildNicknameConfigEmbed(view, input.warnings)],
    ephemeral: true,
  });
}

async function updateNicknameConfigWithExistingValues(
  interaction: ChatInputCommandInteraction<'cached'>,
  store: NicknameConfigStore,
  updates: NicknameConfigView,
): Promise<NicknameConfigView> {
  const existing = await store.getNicknameConfig(interaction.guildId);

  return store.updateNicknameConfig({
    guildId: interaction.guildId,
    guildName: interaction.guild.name,
    actorDiscordUserId: interaction.user.id,
    familyNicknameFormat: updates.familyNicknameFormat ?? existing.familyNicknameFormat,
    nonFamilyNicknameFormat: updates.nonFamilyNicknameFormat ?? existing.nonFamilyNicknameFormat,
    changeNicknames: updates.changeNicknames ?? existing.changeNicknames,
    accountPreferenceForNaming:
      updates.accountPreferenceForNaming ?? existing.accountPreferenceForNaming,
  });
}

export function parseNicknameConfigOptions(input: {
  familyNicknameFormat: string | null;
  nonFamilyNicknameFormat: string | null;
  changeNicknames: string | null;
  accountPreferenceForNaming: string | null;
}):
  | { ok: true; hasUpdates: boolean; view: NicknameConfigView; warnings: string[] }
  | { ok: false; error: string } {
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
    warnings: [
      formatMissingPlaceholderWarning('family_nickname_format', familyNicknameFormat.value),
      formatMissingPlaceholderWarning('non_family_nickname_format', nonFamilyNicknameFormat.value),
    ].filter((warning): warning is string => warning !== null),
  };
}

export function buildNicknameConfigEmbed(
  view: NicknameConfigView,
  warnings: readonly string[] = [],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Nickname Preferences')
    .setDescription(`${NICKNAME_FIRST_PASS_NOTE}\n\n${NICKNAME_PLACEHOLDER_GUIDANCE}`)
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
        value: formatAccountPreference(view.accountPreferenceForNaming),
        inline: true,
      },
      {
        name: 'Supported placeholders',
        value: [
          '`{NAME}` / `{PLAYER_NAME}` — linked player name',
          '`{CLAN}` / `{CLAN_NAME}` — linked family clan name',
          '`{ALIAS}` / `{CLAN_ALIAS}` — linked clan alias/nickname when configured',
          '`{TH}` / `{TOWN_HALL}` — linked account town hall level, such as `TH16`',
          '`{ROLE}` / `{CLAN_ROLE}` — linked family clan role, such as `Leader` or `Member`',
          '`{DISCORD_NAME}` / `{DISCORD_USERNAME}` — Discord display name or username',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Requirements',
        value:
          'Nickname previews assume members have linked Clash accounts. Clan, alias, and role placeholders only resolve for linked accounts in linked family clans with aliases configured where needed. Preferences are persisted per server and omitted options keep their existing values.',
        inline: false,
      },
      {
        name: 'Preview only',
        value: formatNicknamePreview(view),
        inline: false,
      },
    );

  if (warnings.length > 0) {
    embed.addFields({
      name: 'Format warnings',
      value: warnings.join('\n'),
      inline: false,
    });
  }

  return embed;
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
      error: `\`${optionName}\` cannot be empty. Provide a nickname format up to ${DISCORD_NICKNAME_MAX_LENGTH} characters. ${NICKNAME_PLACEHOLDER_GUIDANCE}`,
    };
  }

  if (trimmed.length > DISCORD_NICKNAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `\`${optionName}\` is too long (${trimmed.length}/${DISCORD_NICKNAME_MAX_LENGTH} characters). Discord nicknames can be at most ${DISCORD_NICKNAME_MAX_LENGTH} characters. ${NICKNAME_PLACEHOLDER_GUIDANCE}`,
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

function formatAccountPreference(value: NicknameAccountPreference | null): string {
  switch (value) {
    case 'default-account':
      return 'Default Account';
    case 'best-account':
      return 'Best Account';
    case 'default-or-best-account':
      return 'Default or Best Account';
    default:
      return 'Not set';
  }
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
  const preview = buildNicknamePreview(format, label === 'Family' ? 'family' : 'non-family');
  return `${label}: \`${preview}\` (${preview.length}/${DISCORD_NICKNAME_MAX_LENGTH} characters)`;
}

export function buildNicknamePreview(
  format: string,
  example: 'family' | 'non-family' = 'family',
): string {
  const values =
    example === 'family'
      ? {
          name: 'PlayerOne',
          tag: '#2PP',
          clan: 'ClanMate',
          alias: 'CM',
          townHall: 'TH16',
          role: 'Leader',
        }
      : {
          name: 'PlayerTwo',
          tag: '#8QQ',
          clan: 'No Clan',
          alias: 'Solo',
          townHall: 'TH13',
          role: 'Member',
        };

  return format
    .replaceAll('{NAME}', values.name)
    .replaceAll('{PLAYER}', values.name)
    .replaceAll('{PLAYER_NAME}', values.name)
    .replaceAll('{player}', values.name)
    .replaceAll('{player_name}', values.name)
    .replaceAll('{playerName}', values.name)
    .replaceAll('{name}', values.name)
    .replaceAll('{TAG}', values.tag)
    .replaceAll('{tag}', values.tag)
    .replaceAll('{CLAN}', values.clan)
    .replaceAll('{CLAN_NAME}', values.clan)
    .replaceAll('{clan}', values.clan)
    .replaceAll('{ALIAS}', values.alias)
    .replaceAll('{CLAN_ALIAS}', values.alias)
    .replaceAll('{alias}', values.alias)
    .replaceAll('{TH}', values.townHall)
    .replaceAll('{TOWN_HALL}', values.townHall)
    .replaceAll('{townHall}', values.townHall)
    .replaceAll('{town_hall}', values.townHall)
    .replaceAll('{th}', values.townHall)
    .replaceAll('{ROLE}', values.role)
    .replaceAll('{CLAN_ROLE}', values.role)
    .replaceAll('{DISCORD}', values.name)
    .replaceAll('{DISCORD_NAME}', values.name)
    .replaceAll('{USERNAME}', values.name)
    .replaceAll('{DISCORD_USERNAME}', values.name)
    .replaceAll('{role}', values.role);
}

function formatMissingPlaceholderWarning(optionName: string, value: string | null): string | null {
  if (!value || hasRecognizedNicknamePlaceholder(value)) return null;
  return `\`${optionName}\` has no recognized placeholders, so every previewed nickname will be the same static text. ${NICKNAME_PLACEHOLDER_GUIDANCE}`;
}

function hasRecognizedNicknamePlaceholder(value: string): boolean {
  return /\{(?:NAME|PLAYER|PLAYER_NAME|player|player_name|playerName|name|TAG|tag|CLAN|CLAN_NAME|clan|ALIAS|CLAN_ALIAS|alias|TH|TOWN_HALL|townHall|town_hall|th|ROLE|CLAN_ROLE|role|DISCORD|DISCORD_NAME|USERNAME|DISCORD_USERNAME)\}/.test(
    value,
  );
}
