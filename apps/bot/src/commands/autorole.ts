import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  type Role,
  SlashCommandBuilder,
} from 'discord.js';

export const AUTOROLE_COMMAND_NAME = 'autorole';
export const AUTOROLE_COMMAND_DESCRIPTION = 'Configure automatic role mappings.';
export const AUTOROLE_FIRST_PASS_NOTE =
  'First pass: ClashMate stores autorole configuration only. Automated Discord role assignment and refresh are not implemented yet.';

const TOWN_HALL_LEVELS = Array.from({ length: 17 }, (_, index) => index + 1);
const PLAYER_LEAGUES = [
  'bronze',
  'silver',
  'gold',
  'crystal',
  'master',
  'champion',
  'titan',
  'legend',
] as const;
const TROPHY_RANGES = ['0_999', '1000_1999', '2000_2999', '3000_3999', '4000_4999', '5000_5999'];
const FAMILY_ROLE_KEYS = [
  'family_leaders_role',
  'family_role',
  'exclusive_family_role',
  'guest_role',
  'verified_role',
  'account_linked_role',
] as const;
const CLAN_ROLE_KEYS = [
  'leader_role',
  'co_leader_role',
  'elder_role',
  'member_role',
  'everyone_role',
] as const;

export type AutoroleDisableType =
  | 'clan-roles'
  | 'town-hall'
  | 'leagues'
  | 'family-leaders'
  | 'family'
  | 'exclusive-family'
  | 'guest'
  | 'verified'
  | 'account-linked';

export interface AutoroleSettingsView {
  clanRoles: Record<string, Record<string, string>>;
  clanRolesOnlyVerified: boolean | null;
  townHallRoles: Record<string, string>;
  townHallAllowNonFamilyAccounts: boolean | null;
  leagueRoles: Record<string, string>;
  leagueAllowNonFamilyAccounts: boolean | null;
  familyRoles: Record<string, string>;
  config: {
    autoUpdateRoles: boolean | null;
    roleRemovalDelay: string | null;
    roleAdditionDelay: string | null;
    alwaysForceRefreshRoles: boolean | null;
    allowNotLinked: boolean | null;
    verifiedOnlyClanRoles: boolean | null;
  };
}

export interface UpdateAutoroleSettingsInput {
  guildId: string;
  guildName: string | null;
  actorDiscordUserId: string;
  patch: Partial<AutoroleSettingsView>;
  action: 'updated' | 'disabled' | 'configured';
  metadata?: Record<string, unknown>;
}

export interface AutoroleSettingsStore {
  getAutoroleSettings: (guildId: string) => Promise<AutoroleSettingsView>;
  updateAutoroleSettings: (input: UpdateAutoroleSettingsInput) => Promise<AutoroleSettingsView>;
}

export interface AutoroleCommandOptions {
  store: AutoroleSettingsStore;
}

export const autoroleCommandData = new SlashCommandBuilder()
  .setName(AUTOROLE_COMMAND_NAME)
  .setDescription(AUTOROLE_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    CLAN_ROLE_KEYS.reduce(
      (builder, key) =>
        builder.addRoleOption((option) =>
          option.setName(key).setDescription(formatOptionName(key)),
        ),
      subcommand
        .setName('clan-roles')
        .setDescription('Configure roles for members of selected clans.')
        .addStringOption((option) =>
          option
            .setName('clans')
            .setDescription('Clan tags or aliases to store these role mappings for.')
            .setRequired(true),
        ),
    ).addStringOption((option) =>
      option
        .setName('only_verified')
        .setDescription('Only apply clan role mappings to verified accounts when implemented.')
        .addChoices({ name: 'Yes', value: 'true' }, { name: 'No', value: 'false' }),
    ),
  )
  .addSubcommand((subcommand) =>
    TOWN_HALL_LEVELS.reduce(
      (builder, hall) =>
        builder.addRoleOption((option) =>
          option.setName(`th_${hall}`).setDescription(`Town Hall ${hall} role.`),
        ),
      subcommand.setName('town-hall').setDescription('Configure Town Hall level roles.'),
    ).addStringOption((option) =>
      option
        .setName('allow_non_family_accounts')
        .setDescription('Allow non-family accounts to receive these roles when implemented.')
        .addChoices({ name: 'Yes', value: 'true' }, { name: 'No', value: 'false' }),
    ),
  )
  .addSubcommand((subcommand) =>
    [...PLAYER_LEAGUES, ...TROPHY_RANGES]
      .reduce(
        (builder, key) =>
          builder.addRoleOption((option) => option.setName(key).setDescription(`${key} role.`)),
        subcommand.setName('leagues').setDescription('Configure league and trophy range roles.'),
      )
      .addStringOption((option) =>
        option
          .setName('allow_non_family_accounts')
          .setDescription('Allow non-family accounts to receive these roles when implemented.')
          .addChoices({ name: 'Yes', value: 'true' }, { name: 'No', value: 'false' }),
      ),
  )
  .addSubcommand((subcommand) =>
    FAMILY_ROLE_KEYS.reduce(
      (builder, key) =>
        builder.addRoleOption((option) =>
          option.setName(key).setDescription(formatOptionName(key)),
        ),
      subcommand.setName('family').setDescription('Configure family, guest, and verified roles.'),
    ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('list').setDescription('List stored autorole mappings.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('disable')
      .setDescription('Disable stored autorole mappings.')
      .addStringOption((option) =>
        option
          .setName('type')
          .setDescription('Type of roles to disable.')
          .setRequired(true)
          .addChoices(
            { name: 'Clan Roles', value: 'clan-roles' },
            { name: 'Town Hall Roles', value: 'town-hall' },
            { name: 'League Roles', value: 'leagues' },
            { name: 'Family Leaders Role', value: 'family-leaders' },
            { name: 'Family Role', value: 'family' },
            { name: 'Exclusive Family Role', value: 'exclusive-family' },
            { name: 'Guest Role', value: 'guest' },
            { name: 'Verified Role', value: 'verified' },
            { name: 'Account Linked Role', value: 'account-linked' },
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('config')
      .setDescription('Configure stored autorole behavior flags.')
      .addStringOption((option) =>
        option
          .setName('auto_update_roles')
          .setDescription('Store whether automated updates should run when implemented.')
          .addChoices({ name: 'Yes', value: 'true' }, { name: 'No', value: 'false' }),
      )
      .addStringOption((option) =>
        option
          .setName('role_removal_delays')
          .setDescription('Delay before removing roles when implemented.')
          .addChoices(...delayChoices()),
      )
      .addStringOption((option) =>
        option
          .setName('role_addition_delays')
          .setDescription('Delay before adding roles when implemented.')
          .addChoices(...delayChoices()),
      )
      .addBooleanOption((option) =>
        option
          .setName('always_force_refresh_roles')
          .setDescription('Store whether refreshes should always be forced when implemented.'),
      )
      .addBooleanOption((option) =>
        option
          .setName('allow_not_linked')
          .setDescription('Store whether unlinked accounts are allowed.'),
      )
      .addStringOption((option) =>
        option
          .setName('verified_only_clan_roles')
          .setDescription('Only apply clan roles to verified accounts when implemented.')
          .addChoices({ name: 'Yes', value: 'true' }, { name: 'No', value: 'false' }),
      ),
  );

export function createAutoroleSlashCommand(
  options: AutoroleCommandOptions,
): SlashCommandDefinition {
  return {
    name: AUTOROLE_COMMAND_NAME,
    data: autoroleCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== AUTOROLE_COMMAND_NAME) return;
      await executeAutoroleInteraction(interaction, context, options);
    },
  };
}

export async function executeAutoroleInteraction(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: AutoroleCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/autorole` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (
    subcommand !== 'list' &&
    !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: 'You need the Manage Server permission to configure autoroles.',
      ephemeral: true,
    });
    return;
  }

  const guildInput = {
    guildId: interaction.guildId,
    guildName: interaction.guild.name,
    actorDiscordUserId: interaction.user.id,
  };
  const patch = buildPatch(interaction, subcommand);
  const view = patch
    ? await options.store.updateAutoroleSettings({ ...guildInput, ...patch })
    : await options.store.getAutoroleSettings(interaction.guildId);

  await interaction.reply({
    embeds: [buildAutoroleSettingsEmbed(view, subcommand)],
    ephemeral: true,
  });
}

function buildPatch(
  interaction: ChatInputCommandInteraction,
  subcommand: string,
): Pick<UpdateAutoroleSettingsInput, 'patch' | 'action' | 'metadata'> | null {
  if (subcommand === 'list') return null;
  if (subcommand === 'clan-roles') {
    const clans = interaction.options
      .getString('clans', true)
      .split(',')
      .map((clan) => clan.trim())
      .filter(Boolean);
    const roles = readRoleOptions(interaction, CLAN_ROLE_KEYS);
    const clanRoles = Object.fromEntries(clans.map((clan) => [clan, roles]));
    const onlyVerified = parseBooleanString(interaction.options.getString('only_verified'));
    return {
      patch: {
        ...(Object.keys(roles).length > 0 ? { clanRoles } : {}),
        ...(onlyVerified === null ? {} : { clanRolesOnlyVerified: onlyVerified }),
      },
      action: 'updated',
      metadata: { subcommand },
    };
  }
  if (subcommand === 'town-hall') {
    const townHallRoles = readRoleOptions(
      interaction,
      TOWN_HALL_LEVELS.map((hall) => `th_${hall}`),
    );
    const allowNonFamily = parseBooleanString(
      interaction.options.getString('allow_non_family_accounts'),
    );
    return {
      patch: {
        ...(Object.keys(townHallRoles).length > 0 ? { townHallRoles } : {}),
        ...(allowNonFamily === null ? {} : { townHallAllowNonFamilyAccounts: allowNonFamily }),
      },
      action: 'updated',
      metadata: { subcommand },
    };
  }
  if (subcommand === 'leagues') {
    const leagueRoles = readRoleOptions(interaction, [...PLAYER_LEAGUES, ...TROPHY_RANGES]);
    const allowNonFamily = parseBooleanString(
      interaction.options.getString('allow_non_family_accounts'),
    );
    return {
      patch: {
        ...(Object.keys(leagueRoles).length > 0 ? { leagueRoles } : {}),
        ...(allowNonFamily === null ? {} : { leagueAllowNonFamilyAccounts: allowNonFamily }),
      },
      action: 'updated',
      metadata: { subcommand },
    };
  }
  if (subcommand === 'family') {
    const familyRoles = readRoleOptions(interaction, FAMILY_ROLE_KEYS);
    return {
      patch: Object.keys(familyRoles).length > 0 ? { familyRoles } : {},
      action: 'updated',
      metadata: { subcommand },
    };
  }
  if (subcommand === 'disable')
    return disablePatch(interaction.options.getString('type', true) as AutoroleDisableType);
  if (subcommand === 'config') {
    return {
      patch: {
        config: {
          autoUpdateRoles: parseBooleanString(interaction.options.getString('auto_update_roles')),
          roleRemovalDelay: interaction.options.getString('role_removal_delays'),
          roleAdditionDelay: interaction.options.getString('role_addition_delays'),
          alwaysForceRefreshRoles: interaction.options.getBoolean('always_force_refresh_roles'),
          allowNotLinked: interaction.options.getBoolean('allow_not_linked'),
          verifiedOnlyClanRoles: parseBooleanString(
            interaction.options.getString('verified_only_clan_roles'),
          ),
        },
      },
      action: 'configured',
      metadata: { subcommand },
    };
  }
  return null;
}

function disablePatch(
  type: AutoroleDisableType,
): Pick<UpdateAutoroleSettingsInput, 'patch' | 'action' | 'metadata'> {
  const familyKeyByType: Partial<Record<AutoroleDisableType, string>> = {
    'family-leaders': 'family_leaders_role',
    family: 'family_role',
    'exclusive-family': 'exclusive_family_role',
    guest: 'guest_role',
    verified: 'verified_role',
    'account-linked': 'account_linked_role',
  };
  if (type === 'clan-roles')
    return {
      patch: { clanRoles: {}, clanRolesOnlyVerified: null },
      action: 'disabled',
      metadata: { type },
    };
  if (type === 'town-hall')
    return {
      patch: { townHallRoles: {}, townHallAllowNonFamilyAccounts: null },
      action: 'disabled',
      metadata: { type },
    };
  if (type === 'leagues')
    return {
      patch: { leagueRoles: {}, leagueAllowNonFamilyAccounts: null },
      action: 'disabled',
      metadata: { type },
    };
  const key = familyKeyByType[type];
  return {
    patch: { familyRoles: key ? { [key]: '' } : {} },
    action: 'disabled',
    metadata: { type },
  };
}

function readRoleOptions(
  interaction: ChatInputCommandInteraction,
  keys: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const role = interaction.options.getRole(key) as Role | null;
      return role ? [[key, role.id]] : [];
    }),
  );
}

export function buildAutoroleSettingsEmbed(
  view: AutoroleSettingsView,
  subcommand: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Autorole Configuration')
    .setDescription(AUTOROLE_FIRST_PASS_NOTE)
    .addFields(
      { name: 'Clan roles', value: formatNestedRoles(view.clanRoles), inline: false },
      { name: 'Town Hall roles', value: formatRoles(view.townHallRoles), inline: false },
      { name: 'League roles', value: formatRoles(view.leagueRoles), inline: false },
      { name: 'Family roles', value: formatRoles(view.familyRoles), inline: false },
      { name: 'Config', value: formatConfig(view), inline: false },
      { name: 'Last action', value: `/${AUTOROLE_COMMAND_NAME} ${subcommand}`, inline: false },
    );
}

function formatRoles(roles: Record<string, string>): string {
  const entries = Object.entries(roles).filter(([, roleId]) => roleId);
  return entries.length
    ? entries
        .map(([key, roleId]) => `**${key}:** <@&${roleId}>`)
        .join('\n')
        .slice(0, 1024)
    : 'Not configured';
}

function formatNestedRoles(roles: Record<string, Record<string, string>>): string {
  const entries = Object.entries(roles).flatMap(([clan, mapping]) =>
    Object.entries(mapping)
      .filter(([, roleId]) => roleId)
      .map(([key, roleId]) => `**${clan} ${key}:** <@&${roleId}>`),
  );
  return entries.length ? entries.join('\n').slice(0, 1024) : 'Not configured';
}

function formatConfig(view: AutoroleSettingsView): string {
  return [
    `Auto update roles: ${formatBool(view.config.autoUpdateRoles)}`,
    `Removal delay: ${view.config.roleRemovalDelay ?? 'Not set'}`,
    `Addition delay: ${view.config.roleAdditionDelay ?? 'Not set'}`,
    `Always force refresh roles: ${formatBool(view.config.alwaysForceRefreshRoles)}`,
    `Allow not linked: ${formatBool(view.config.allowNotLinked)}`,
    `Verified only clan roles: ${formatBool(view.config.verifiedOnlyClanRoles ?? view.clanRolesOnlyVerified)}`,
  ].join('\n');
}

function formatBool(value: boolean | null): string {
  return value === null ? 'Not set' : value ? 'Yes' : 'No';
}

function parseBooleanString(value: string | null): boolean | null {
  return value === 'true' ? true : value === 'false' ? false : null;
}

function formatOptionName(value: string): string {
  return `${value.replaceAll('_', ' ')}.`;
}

function delayChoices(): { name: string; value: string }[] {
  return [
    '0',
    '1h',
    '2h',
    '4h',
    '6h',
    '8h',
    '12h',
    '18h',
    '24h',
    '36h',
    '48h',
    '72h',
    '7d',
    '12d',
  ].map((value) => ({ name: value === '0' ? 'Off' : value, value }));
}
