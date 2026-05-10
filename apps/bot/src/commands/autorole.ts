import { type CommandContext, isOwner, type SlashCommandDefinition } from '@clashmate/discord';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  PermissionFlagsBits,
  Role,
  SlashCommandBuilder,
} from 'discord.js';

export const AUTOROLE_COMMAND_NAME = 'autorole';
export const AUTOROLE_COMMAND_DESCRIPTION = 'Configure automatic role mappings.';
export const AUTOROLE_FIRST_PASS_NOTE =
  'ClashMate stores autorole configuration only. Automated Discord role assignment and refresh are not implemented yet.';
const AUTOROLE_INCLUDED_GROUPS_NOTE =
  'Included groups: clan roles, Town Hall, leagues/trophy ranges, and family/guest/verified roles.';
const AUTOROLE_EXCLUDED_GROUPS_NOTE =
  'Excluded groups: builder hall, builder leagues, wars, and EOS push roles are intentionally not supported in ClashMate.';
const AUTOROLE_DATA_SOURCE_NOTE =
  'Future refreshes will use linked Discord accounts, linked clans, and persisted clan/member snapshots from polling. This command does not call the live Clash API as a fallback.';

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

export type AutoroleRefreshTargetKind = 'server' | 'role' | 'user';

export interface AutoroleRefreshPlanTarget {
  readonly kind: AutoroleRefreshTargetKind;
  readonly id: string;
  readonly label: string;
  readonly memberEstimate: string;
}

export interface AutoroleRefreshPlanOptions {
  readonly isTestRun: boolean | null;
  readonly forceRefresh: boolean | null;
}

export interface AutoroleClanMemberSnapshot {
  readonly clan: {
    readonly clanTag: string;
  };
  readonly members: readonly {
    readonly playerTag: string;
    readonly lastFetchedAt: Date;
  }[];
}

export interface AutoroleSnapshotCoverage {
  readonly linkedClanSnapshotCount: number;
  readonly snapshotMemberCount: number;
  readonly distinctPlayerCount: number;
  readonly latestSnapshotAt: Date | null;
  readonly latestSnapshotAge: string;
}

export interface AutoroleRefreshPlanCounts {
  readonly clanRoleGroups: number;
  readonly clanRoleMappings: number;
  readonly townHallRoles: number;
  readonly leagueRoles: number;
  readonly familyRoles: number;
}

export interface AutoroleRefreshPlanMappings {
  readonly clanRoles: boolean;
  readonly townHallRoles: boolean;
  readonly leagueRoles: boolean;
  readonly familyRoles: boolean;
  readonly any: boolean;
}

export interface AutoroleRefreshPlan {
  readonly counts: AutoroleRefreshPlanCounts;
  readonly mappingsExist: AutoroleRefreshPlanMappings;
  readonly snapshotCoverage: AutoroleSnapshotCoverage;
  readonly target: AutoroleRefreshPlanTarget;
  readonly requested: AutoroleRefreshPlanOptions;
  readonly prerequisites: readonly string[];
  readonly actionabilityNotes: readonly string[];
}

export interface AutoroleLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface AutoroleConfigView {
  readonly botManagerRoleIds: readonly string[];
}

export interface AutoroleCommandOptions {
  store: AutoroleSettingsStore & {
    readonly listLinkedClans: (guildId: string) => Promise<AutoroleLinkedClan[]>;
    readonly listClanMemberSnapshotsForGuild?: (input: {
      guildId: string;
    }) => Promise<AutoroleClanMemberSnapshot[]>;
  };
  readonly getGuildConfig?: (guildId: string) => Promise<AutoroleConfigView>;
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
            .setAutocomplete(true)
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
      .setName('refresh')
      .setDescription('Preview an autorole refresh without changing Discord roles or nicknames.')
      .addMentionableOption((option) =>
        option.setName('user_or_role').setDescription('User or role to preview refresh scope for.'),
      )
      .addBooleanOption((option) =>
        option.setName('is_test_run').setDescription('Preview as a test run.'),
      )
      .addBooleanOption((option) =>
        option.setName('force_refresh').setDescription('Preview with force refresh requested.'),
      ),
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
    autocomplete: async (interaction) => {
      if (interaction.commandName !== AUTOROLE_COMMAND_NAME) return;
      await autocompleteAutorole(interaction, options);
    },
  };
}

async function autocompleteAutorole(
  interaction: AutocompleteInteraction,
  options: AutoroleCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  const subcommand = interaction.options.getSubcommand(false);
  if (subcommand !== 'clan-roles' || focused.name !== 'clans') {
    await interaction.respond([]);
    return;
  }

  try {
    const clans = await options.store.listLinkedClans(interaction.guildId);
    await interaction.respond(filterAutoroleClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export async function executeAutoroleInteraction(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
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
  if (subcommand !== 'list' && !(await canManageAutorole(interaction, context, options))) {
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
  if (subcommand === 'refresh') {
    const [view, snapshots] = await Promise.all([
      options.store.getAutoroleSettings(interaction.guildId),
      options.store.listClanMemberSnapshotsForGuild?.({ guildId: interaction.guildId }) ??
        Promise.resolve([]),
    ]);
    await interaction.reply({
      embeds: [buildAutoroleRefreshPreviewEmbed(view, interaction, snapshots)],
      ephemeral: true,
    });
    return;
  }
  const patch = buildPatch(interaction, subcommand);
  const hasChanges = patch
    ? patch.action === 'disabled' || hasAutorolePatchChanges(patch.patch)
    : false;
  const view =
    patch && hasChanges
      ? await options.store.updateAutoroleSettings({ ...guildInput, ...patch })
      : await options.store.getAutoroleSettings(interaction.guildId);

  await interaction.reply({
    embeds: [buildAutoroleSettingsEmbed(view, subcommand, Boolean(patch && !hasChanges))],
    ephemeral: true,
  });
}

async function canManageAutorole(
  interaction: ChatInputCommandInteraction<'cached'>,
  context: CommandContext,
  options: AutoroleCommandOptions,
): Promise<boolean> {
  if (isOwner(interaction.user.id, context.ownerIds)) return true;
  if (interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!options.getGuildConfig) return false;

  const config = await options.getGuildConfig(interaction.guildId);
  return config.botManagerRoleIds.some((roleId) => interaction.member.roles.cache.has(roleId));
}

export function filterAutoroleClanChoices(
  clans: readonly AutoroleLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
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
  viewedOnly = false,
): EmbedBuilder {
  const counts = getAutoroleConfigCounts(view);
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Autorole Configuration')
    .setDescription(AUTOROLE_FIRST_PASS_NOTE)
    .addFields(
      {
        name: 'Summary',
        value: [
          `Clan role groups: ${counts.clanRoleGroups}`,
          `Clan role mappings: ${counts.clanRoleMappings}`,
          `Town Hall roles: ${counts.townHallRoles}`,
          `League/trophy roles: ${counts.leagueRoles}`,
          `Family roles: ${counts.familyRoles}`,
          'No Discord role or nickname changes are made by this first-pass preview.',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Supported role groups',
        value: [AUTOROLE_INCLUDED_GROUPS_NOTE, AUTOROLE_EXCLUDED_GROUPS_NOTE].join('\n'),
        inline: false,
      },
      { name: 'Clan roles', value: formatNestedRoles(view.clanRoles), inline: false },
      { name: 'Town Hall roles', value: formatRoles(view.townHallRoles), inline: false },
      { name: 'League roles', value: formatRoles(view.leagueRoles), inline: false },
      { name: 'Family roles', value: formatRoles(view.familyRoles), inline: false },
      { name: 'Config', value: formatConfig(view), inline: false },
      { name: 'Data sources', value: AUTOROLE_DATA_SOURCE_NOTE, inline: false },
      { name: 'No data?', value: formatNoDataActionability(counts), inline: false },
      {
        name: 'Last action',
        value: viewedOnly
          ? `/${AUTOROLE_COMMAND_NAME} ${subcommand} viewed stored config; no changes were submitted.`
          : `/${AUTOROLE_COMMAND_NAME} ${subcommand}`,
        inline: false,
      },
    );
}

export function buildAutoroleRefreshPreviewEmbed(
  view: AutoroleSettingsView,
  interaction: ChatInputCommandInteraction,
  snapshots: readonly AutoroleClanMemberSnapshot[] = [],
): EmbedBuilder {
  const target = interaction.options.getMentionable('user_or_role');
  const plan = buildAutoroleRefreshPlan(view, {
    target: buildAutoroleRefreshPlanTarget(interaction, target),
    options: {
      isTestRun: interaction.options.getBoolean('is_test_run'),
      forceRefresh: interaction.options.getBoolean('force_refresh'),
    },
    snapshots,
  });

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Autorole Refresh Preview')
    .setDescription(
      'Dry run only: ClashMate did not change Discord roles or nicknames. Autorole mutation is not implemented yet.',
    )
    .addFields(
      {
        name: 'Target scope',
        value: [
          `Kind: ${formatAutoroleRefreshTargetKind(plan.target.kind)}`,
          `Target: ${plan.target.label}`,
          `Target ID: ${plan.target.id}`,
          `Estimated members: ${plan.target.memberEstimate}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Requested options',
        value: [
          `Test run flag: ${formatProvidedBoolean(plan.requested.isTestRun)}`,
          `Force refresh flag: ${formatProvidedBoolean(plan.requested.forceRefresh)}`,
          'Result: Previewed stored config only; no Discord role or nickname changes were made.',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Stored config counts',
        value: [
          `Clan role groups: ${plan.counts.clanRoleGroups}`,
          `Clan role mappings: ${plan.counts.clanRoleMappings}`,
          `Town Hall roles: ${plan.counts.townHallRoles}`,
          `League/trophy roles: ${plan.counts.leagueRoles}`,
          `Family roles: ${plan.counts.familyRoles}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Snapshot coverage',
        value: [
          `Linked clan snapshots: ${plan.snapshotCoverage.linkedClanSnapshotCount}`,
          `Snapshot members: ${plan.snapshotCoverage.snapshotMemberCount}`,
          `Distinct players: ${plan.snapshotCoverage.distinctPlayerCount}`,
          `Latest snapshot age: ${plan.snapshotCoverage.latestSnapshotAge}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Supported role groups',
        value: [AUTOROLE_INCLUDED_GROUPS_NOTE, AUTOROLE_EXCLUDED_GROUPS_NOTE].join('\n'),
        inline: false,
      },
      {
        name: 'Future refresh would consider',
        value: plan.prerequisites.join('\n'),
        inline: false,
      },
      { name: 'No data?', value: plan.actionabilityNotes.join('\n'), inline: false },
      { name: 'Last action', value: `/${AUTOROLE_COMMAND_NAME} refresh`, inline: false },
    );
}

export function buildAutoroleRefreshPlan(
  view: AutoroleSettingsView,
  input: {
    readonly target: AutoroleRefreshPlanTarget;
    readonly options: AutoroleRefreshPlanOptions;
    readonly snapshots?: readonly AutoroleClanMemberSnapshot[];
    readonly now?: Date;
  },
): AutoroleRefreshPlan {
  const counts = getAutoroleConfigCounts(view);
  const snapshotCoverage = getAutoroleSnapshotCoverage(
    input.snapshots ?? [],
    input.now ?? new Date(),
  );
  const mappingsExist = {
    clanRoles: counts.clanRoleMappings > 0,
    townHallRoles: counts.townHallRoles > 0,
    leagueRoles: counts.leagueRoles > 0,
    familyRoles: counts.familyRoles > 0,
    any:
      counts.clanRoleMappings > 0 ||
      counts.townHallRoles > 0 ||
      counts.leagueRoles > 0 ||
      counts.familyRoles > 0,
  };

  return {
    counts,
    mappingsExist,
    snapshotCoverage,
    target: input.target,
    requested: input.options,
    prerequisites: [
      'Linked Discord accounts for the selected members.',
      'Linked clans configured for this server.',
      'Stored clan and member snapshots already collected by polling.',
      'Saved clan, Town Hall, league/trophy, and family role mappings above.',
      'No live Clash API fallback is used by this preview.',
    ],
    actionabilityNotes: formatRefreshActionability(counts, snapshotCoverage),
  };
}

function buildAutoroleRefreshPlanTarget(
  interaction: ChatInputCommandInteraction,
  target: ReturnType<ChatInputCommandInteraction['options']['getMentionable']>,
): AutoroleRefreshPlanTarget {
  if (!target) {
    return {
      kind: 'server',
      label: interaction.guild?.name ?? 'This server',
      id: interaction.guildId ?? 'Unknown',
      memberEstimate: interaction.guild?.memberCount?.toString() ?? 'Unknown',
    };
  }

  if (target instanceof Role) {
    return {
      kind: 'role',
      label: target.toString(),
      id: target.id,
      memberEstimate: `${target.members.size} cached member${target.members.size === 1 ? '' : 's'}`,
    };
  }

  return {
    kind: 'user',
    label: target.toString(),
    id: getMentionableUserId(target),
    memberEstimate: '1 member',
  };
}

function formatAutoroleRefreshTargetKind(kind: AutoroleRefreshTargetKind): string {
  if (kind === 'server') return 'Whole server';
  if (kind === 'role') return 'Role';
  return 'User';
}

function getMentionableUserId(
  target: Exclude<ReturnType<ChatInputCommandInteraction['options']['getMentionable']>, null>,
): string {
  return 'id' in target ? target.id : 'Unknown';
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
    'Persistence: saved for this Discord server; manager permissions control who can update it.',
  ].join('\n');
}

function formatNoDataActionability(counts: ReturnType<typeof getAutoroleConfigCounts>): string {
  if (
    counts.clanRoleMappings > 0 ||
    counts.townHallRoles > 0 ||
    counts.leagueRoles > 0 ||
    counts.familyRoles > 0
  ) {
    return 'Stored mappings are present. If refresh previews still show no eligible members later, link accounts and clans, then wait for polling snapshots to update.';
  }

  return 'No stored mappings yet. Configure an included autorole group, link the relevant clans/accounts, and wait for polling snapshots before expecting eligible members.';
}

function formatRefreshActionability(
  counts: ReturnType<typeof getAutoroleConfigCounts>,
  coverage: AutoroleSnapshotCoverage,
): string[] {
  const notes = [formatNoDataActionability(counts)];
  if (coverage.linkedClanSnapshotCount === 0) {
    notes.push('No linked clan member snapshots are available for this server yet.');
  } else if (coverage.snapshotMemberCount === 0) {
    notes.push('Linked clan snapshots exist, but they do not contain members yet.');
  } else {
    notes.push(
      `Refresh planning can evaluate ${coverage.distinctPlayerCount} distinct player snapshot${coverage.distinctPlayerCount === 1 ? '' : 's'} once role mutation is implemented.`,
    );
  }
  return notes;
}

function getAutoroleSnapshotCoverage(
  snapshots: readonly AutoroleClanMemberSnapshot[],
  now: Date,
): AutoroleSnapshotCoverage {
  const playerTags = new Set<string>();
  let snapshotMemberCount = 0;
  let latestSnapshotAt: Date | null = null;

  for (const snapshot of snapshots) {
    snapshotMemberCount += snapshot.members.length;
    for (const member of snapshot.members) {
      playerTags.add(member.playerTag);
      if (!latestSnapshotAt || member.lastFetchedAt > latestSnapshotAt) {
        latestSnapshotAt = member.lastFetchedAt;
      }
    }
  }

  return {
    linkedClanSnapshotCount: snapshots.length,
    snapshotMemberCount,
    distinctPlayerCount: playerTags.size,
    latestSnapshotAt,
    latestSnapshotAge: formatSnapshotAge(latestSnapshotAt, now),
  };
}

function formatSnapshotAge(snapshotAt: Date | null, now: Date): string {
  if (!snapshotAt) return 'No snapshots';
  const ageMs = Math.max(0, now.getTime() - snapshotAt.getTime());
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'Less than 1 minute';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function formatBool(value: boolean | null): string {
  return value === null ? 'Not set' : value ? 'Yes' : 'No';
}

function formatProvidedBoolean(value: boolean | null): string {
  return value === null ? 'Not provided' : value ? 'Provided: yes' : 'Provided: no';
}

function countRoles(roles: Record<string, string>): number {
  return Object.values(roles).filter(Boolean).length;
}

function countNestedRoles(roles: Record<string, Record<string, string>>): number {
  return Object.values(roles).reduce((total, mapping) => total + countRoles(mapping), 0);
}

function getAutoroleConfigCounts(view: AutoroleSettingsView): {
  clanRoleGroups: number;
  clanRoleMappings: number;
  townHallRoles: number;
  leagueRoles: number;
  familyRoles: number;
} {
  return {
    clanRoleGroups: Object.values(view.clanRoles).filter((mapping) => countRoles(mapping) > 0)
      .length,
    clanRoleMappings: countNestedRoles(view.clanRoles),
    townHallRoles: countRoles(view.townHallRoles),
    leagueRoles: countRoles(view.leagueRoles),
    familyRoles: countRoles(view.familyRoles),
  };
}

function hasAutorolePatchChanges(patch: Partial<AutoroleSettingsView>): boolean {
  return Object.values(patch).some((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value !== 'object') return true;
    return Object.values(value).some((nestedValue) => {
      if (nestedValue === null || nestedValue === undefined || nestedValue === '') return false;
      if (typeof nestedValue !== 'object') return true;
      return Object.values(nestedValue).some(Boolean);
    });
  });
}

function clanMatchesQuery(clan: AutoroleLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: AutoroleLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${escapeMarkdown(label)} (${clan.clanTag})`.slice(0, 100);
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
