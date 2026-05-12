import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const NICKNAME_COMMAND_NAME = 'nickname';
export const NICKNAME_COMMAND_DESCRIPTION = 'Manage automatic nickname settings.';
export const NICKNAME_FIRST_PASS_NOTE =
  'ClashMate stores these server nickname preferences and previews nickname reconciliation for the invoking member only, using saved config plus the current Discord member record. It changes your nickname only when `change_nicknames` is set to `Yes` in this invocation and every safety check passes.';
export const NICKNAME_REFRESH_NOTE =
  'Stored nickname preferences are used by reconciliation planning diagnostics. This command does not run broad reconciliation or mutate other Discord members; it only self-previews and can change the invoking member when explicitly requested and every safety check passes.';
export const NICKNAME_BACKGROUND_RECONCILIATION_LIMITATION =
  'Diagnostics use only existing saved config, preview values, Discord safety checks, linked accounts, family-clan metadata, and snapshots already stored by ClashMate. Search-only lookups, previews, and omitted options do not enroll players for polling, create leases, call the live Clash API, or create new tracking records.';
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

  const plan = planInvokingMemberNicknameReconciliation(interaction, view, input.view);

  if (plan.shouldRename) {
    await interaction.member.setNickname(
      plan.desiredNickname,
      'ClashMate nickname config opt-in preview',
    );
  }

  await interaction.reply({
    embeds: [buildNicknameConfigEmbed(view, input.warnings, plan)],
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
  reconciliationPlan?: NicknameReconciliationPlan,
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
              ? 'Yes — stored preference saved; this invocation can update only the invoking member when all safety checks pass.'
              : 'No — stored preference saved; nickname updates stay disabled.',
        inline: true,
      },
      {
        name: 'Account preference for naming',
        value: formatAccountPreference(view.accountPreferenceForNaming),
        inline: true,
      },
      {
        name: 'Derived diagnostics',
        value: formatDerivedNicknameDiagnostics(view),
        inline: false,
      },
      {
        name: 'Omitted options',
        value:
          'Any option left blank in `/nickname config` is not cleared or recomputed; ClashMate keeps the existing saved value for that option. To disable nickname changes, set `change_nicknames` to `No`.',
        inline: false,
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
        name: 'Linked player source',
        value:
          'Nickname values are intended to come from Discord users who have linked Clash player accounts in ClashMate. Clan, alias, town hall, and role placeholders require stored linked-player/family-clan data; if no linked data exists for a member, background reconciliation cannot infer it from search results and this command will only show the self-preview values available from Discord.',
        inline: false,
      },
      {
        name: 'Server persistence',
        value:
          'Manage Server is required because these settings are saved for this Discord server and are used by reconciliation planning diagnostics. Omitted options keep their existing saved values.',
        inline: false,
      },
      {
        name: 'Refresh status',
        value: `${NICKNAME_REFRESH_NOTE}\n${NICKNAME_BACKGROUND_RECONCILIATION_LIMITATION}`,
        inline: false,
      },
      {
        name: 'Format preview',
        value: formatNicknamePreview(view),
        inline: false,
      },
    );

  if (reconciliationPlan) {
    embed.addFields({
      name: 'Invoking member reconciliation',
      value: formatReconciliationPlan(reconciliationPlan),
      inline: false,
    });
  }

  if (warnings.length > 0) {
    embed.addFields({
      name: 'Format warnings',
      value: warnings.join('\n'),
      inline: false,
    });
  }

  return embed;
}

export interface NicknameReconciliationPlan {
  currentNickname: string;
  desiredNickname: string | null;
  canRename: boolean;
  shouldRename: boolean;
  blockers: string[];
  reason: string;
}

export interface ScheduledNicknameReconciliationPlan {
  readonly enabled: boolean;
  readonly shouldRun: boolean;
  readonly reason: string;
  readonly format: string | null;
}

export function planScheduledNicknameReconciliation(
  view: NicknameConfigView,
): ScheduledNicknameReconciliationPlan {
  const format = view.familyNicknameFormat ?? view.nonFamilyNicknameFormat;
  const enabled = view.changeNicknames === 'true';
  const shouldRun = enabled && Boolean(format);
  return {
    enabled,
    shouldRun,
    reason: !enabled
      ? 'change_nicknames is disabled'
      : !format
        ? 'no nickname format is configured'
        : 'stored config is ready for reconciliation planning diagnostics when Discord permission and hierarchy checks pass',
    format: format ?? null,
  };
}

function planInvokingMemberNicknameReconciliation(
  interaction: ChatInputCommandInteraction<'cached'>,
  view: NicknameConfigView,
  invocationUpdates: NicknameConfigView,
): NicknameReconciliationPlan {
  const member = interaction.member;
  const blockers: string[] = [];
  const format = view.familyNicknameFormat ?? view.nonFamilyNicknameFormat;
  const desiredNickname = format ? buildMemberNicknamePreview(format, member) : null;

  if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames)) {
    blockers.push('bot is missing Manage Nicknames');
  }

  if (!member.manageable) {
    blockers.push('bot/user hierarchy prevents renaming this member');
  }

  if (view.changeNicknames !== 'true') {
    blockers.push('stored change_nicknames is not Yes');
  }

  if (!desiredNickname) {
    blockers.push(
      'configured format needs linked player/clan data that is not available in this self-preview',
    );
  }

  const canRename = blockers.length === 0;
  const shouldRename = canRename && invocationUpdates.changeNicknames === 'true';

  return {
    currentNickname: member.nickname ?? member.displayName,
    desiredNickname,
    canRename,
    shouldRename,
    blockers,
    reason: formatNicknameReconciliationReason({
      canRename,
      shouldRename,
      blockers,
      invocationOptedIn: invocationUpdates.changeNicknames === 'true',
    }),
  };
}

function formatNicknameReconciliationReason(input: {
  canRename: boolean;
  shouldRename: boolean;
  blockers: readonly string[];
  invocationOptedIn: boolean;
}): string {
  if (input.shouldRename)
    return 'Applied because change_nicknames was set to Yes and all safety checks passed.';
  if (input.blockers.length > 0) return `Not applied: ${input.blockers.join('; ')}.`;
  if (!input.invocationOptedIn) {
    return 'Preview only: set change_nicknames to Yes in this invocation to apply to the invoking member.';
  }
  return input.canRename ? 'Preview only.' : 'Not applied.';
}

function buildMemberNicknamePreview(format: string, member: GuildMember): string | null {
  const preview = format
    .replaceAll('{DISCORD_NAME}', member.displayName)
    .replaceAll('{DISCORD_USERNAME}', member.user.username)
    .replaceAll('{USERNAME}', member.user.username)
    .replaceAll('{DISCORD}', member.displayName);

  if (preview === format || hasUnresolvedNicknamePlaceholder(preview)) return null;
  return preview.slice(0, DISCORD_NICKNAME_MAX_LENGTH);
}

function hasUnresolvedNicknamePlaceholder(value: string): boolean {
  return /\{[^{}]+\}/.test(value);
}

function formatReconciliationPlan(plan: NicknameReconciliationPlan): string {
  const lines = [
    `Current nickname: ${formatPlanValue(plan.currentNickname)}`,
    `Desired nickname preview: ${formatPlanValue(plan.desiredNickname)}`,
    `Could rename invoking member: ${plan.canRename ? 'Yes' : 'No'}`,
    `Actual rename this invocation: ${plan.shouldRename ? 'Yes' : 'No'}`,
    `Result reason: ${plan.reason}`,
  ];

  if (plan.blockers.length > 0) {
    lines.push(`Blockers: ${plan.blockers.join('; ')}`);
  }

  return lines.join('\n');
}

function formatPlanValue(value: string | null): string {
  return value ? `\`${value}\`` : 'Not available';
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

function formatDerivedNicknameDiagnostics(view: NicknameConfigView): string {
  const familyCoverage = formatPlaceholderCoverage('family', view.familyNicknameFormat);
  const nonFamilyCoverage = formatPlaceholderCoverage('non-family', view.nonFamilyNicknameFormat);
  const configuredFormats = [view.familyNicknameFormat, view.nonFamilyNicknameFormat].filter(
    (format): format is string => format !== null,
  ).length;

  return [
    `Configured formats: ${configuredFormats}/2 (${familyCoverage}; ${nonFamilyCoverage}).`,
    `Length budget: ${formatLengthBudget('family', view.familyNicknameFormat)}; ${formatLengthBudget('non-family', view.nonFamilyNicknameFormat)}. Format text is capped at ${DISCORD_NICKNAME_MAX_LENGTH} characters at save time; rendered nicknames can also expand to Discord's ${DISCORD_NICKNAME_MAX_LENGTH}-character nickname limit and are clipped before preview/apply.`,
    `Account preference: ${formatAccountPreference(view.accountPreferenceForNaming)} — ${formatAccountPreferenceDiagnostic(view.accountPreferenceForNaming)}.`,
    `change_nicknames gate: ${formatChangeNicknameGateDiagnostic(view.changeNicknames)}.`,
    'Self-preview/apply safety: the preview uses only the invoking member. Apply requires bot Manage Nicknames permission, Discord role hierarchy, a configured format that can render with available data, stored `change_nicknames: Yes`, and explicit `change_nicknames: Yes` on this invocation.',
    'No-linked-data guidance: player/clan placeholders require existing linked-account and family-clan data. Without that stored data, reconciliation must skip those values rather than search, poll, or guess.',
    'Reconciliation diagnostics limitation: stored config guides planning diagnostics only; this command does not start broad reconciliation, enroll search-only players, create polling leases, call the live Clash API, or perform broad Discord nickname mutation.',
  ].join('\n');
}

function formatPlaceholderCoverage(label: string, format: string | null): string {
  if (!format) return `${label}: not configured`;
  const placeholders = collectRecognizedNicknamePlaceholders(format);
  if (placeholders.length === 0) return `${label}: static text/no recognized placeholders`;
  return `${label}: ${placeholders.map((placeholder) => `\`${placeholder}\``).join(', ')}`;
}

function collectRecognizedNicknamePlaceholders(value: string): string[] {
  const matches = value.matchAll(
    /\{(?:NAME|PLAYER|PLAYER_NAME|player|player_name|playerName|name|TAG|tag|CLAN|CLAN_NAME|clan|ALIAS|CLAN_ALIAS|alias|TH|TOWN_HALL|townHall|town_hall|th|ROLE|CLAN_ROLE|role|DISCORD|DISCORD_NAME|USERNAME|DISCORD_USERNAME)\}/g,
  );
  return [...new Set([...matches].map((match) => match[0]))];
}

function formatLengthBudget(label: string, format: string | null): string {
  if (!format) return `${label}: not configured`;
  return `${label}: ${format.length}/${DISCORD_NICKNAME_MAX_LENGTH}`;
}

function formatAccountPreferenceDiagnostic(value: NicknameAccountPreference | null): string {
  switch (value) {
    case 'default-account':
      return "prefer the user's saved default linked player when stored data is available";
    case 'best-account':
      return 'prefer the highest-value stored linked player data available to ClashMate';
    case 'default-or-best-account':
      return 'try the saved default account first, then fall back to the best stored account';
    default:
      return 'no stored account-selection preference has been configured';
  }
}

function formatChangeNicknameGateDiagnostic(value: NicknameChangePreference | null): string {
  if (value === 'true') {
    return 'enabled in stored config, but applies are still limited to the invoking member and only when this invocation explicitly sets Yes';
  }
  if (value === 'false')
    return 'disabled in stored config; previews are reported without nickname changes';
  return 'not configured; previews are reported without nickname changes';
}

function formatNicknamePreview(view: NicknameConfigView): string {
  const previews = [
    formatPreviewLine('Family', view.familyNicknameFormat),
    formatPreviewLine('Non-family', view.nonFamilyNicknameFormat),
  ].filter((line) => line !== null);

  return previews.length > 0
    ? `${previews.join('\n')}\nExample preview only: placeholders are rendered from sample saved-data values, not live Clash API results. Actual self-apply still requires explicit opt-in plus all Discord safety checks.`
    : 'Set a nickname format to see an example. Preview source only: no live Clash API lookup is made; nickname mutation is limited to explicit safe invocations.';
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
