import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';

export const CAPITAL_COMMAND_NAME = 'capital';
export const CAPITAL_COMMAND_DESCRIPTION = 'Show Clan Capital data from persisted snapshots.';

const CAPITAL_ROW_LIMIT = 25;

export const capitalCommandData = new SlashCommandBuilder()
  .setName(CAPITAL_COMMAND_NAME)
  .setDescription(CAPITAL_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    addCapitalOptions(
      subcommand
        .setName('raids')
        .setDescription('Show linked-clan capital overview from persisted snapshots.'),
    ),
  )
  .addSubcommand((subcommand) =>
    addCapitalOptions(
      subcommand
        .setName('contribution')
        .setDescription('Show member capital contribution from persisted snapshots.'),
    ),
  );

function addCapitalOptions(builder: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return builder
    .addStringOption((option) =>
      option
        .setName('clan')
        .setDescription('Linked clan tag, name, or alias.')
        .setAutocomplete(true)
        .setRequired(false),
    )
    .addUserOption((option) =>
      option.setName('user').setDescription('Filter to linked accounts for this Discord user.'),
    )
    .addStringOption((option) =>
      option
        .setName('week')
        .setDescription('Raid week label accepted for parity; persisted snapshots are used.')
        .setRequired(false),
    );
}

export interface CapitalLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
  readonly categoryId?: string | null;
  readonly sortOrder?: number;
  readonly snapshot?: unknown;
}

export interface CapitalMemberSnapshotRow {
  readonly playerTag: string;
  readonly name: string;
  readonly lastFetchedAt?: Date;
  readonly capitalContribution?: number | null;
  readonly capitalGold?: number | null;
}

export interface CapitalClanMemberSnapshots {
  readonly clan: Pick<CapitalLinkedClan, 'id' | 'clanTag' | 'name' | 'alias'>;
  readonly members: readonly CapitalMemberSnapshotRow[];
}

export interface CapitalStore {
  readonly listClansForGuild: (guildId: string) => Promise<CapitalLinkedClan[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<CapitalClanMemberSnapshots[]>;
  readonly listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
}

export interface CapitalCommandOptions {
  readonly store: CapitalStore;
}

export type CapitalSubcommand = 'raids' | 'contribution';

export function createCapitalSlashCommand(options: CapitalCommandOptions): SlashCommandDefinition {
  return {
    name: CAPITAL_COMMAND_NAME,
    data: capitalCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== CAPITAL_COMMAND_NAME) return;
      await executeCapital(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== CAPITAL_COMMAND_NAME) return;
      await autocompleteCapital(interaction, options);
    },
  };
}

async function autocompleteCapital(
  interaction: AutocompleteInteraction,
  options: CapitalCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'clan') {
    await interaction.respond([]);
    return;
  }
  try {
    const clans = await options.store.listClansForGuild(interaction.guildId);
    await interaction.respond(filterCapitalClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export async function executeCapital(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: CapitalCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/capital` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const subcommand = interaction.options.getSubcommand() as CapitalSubcommand;
  const clanOption = interaction.options.getString('clan');
  const user = interaction.options.getUser('user');
  const week = interaction.options.getString('week');
  const clans = await options.store.listClansForGuild(interaction.guildId);
  const clan = clanOption ? resolveCapitalClan(clans, clanOption) : undefined;
  if (clanOption && !clan) {
    await interaction.editReply({ content: 'No linked clan was found for that clan option.' });
    return;
  }

  const playerTags = user
    ? await options.store.listPlayerTagsForUser(interaction.guildId, user.id)
    : undefined;
  if (user && playerTags?.length === 0) {
    await interaction.editReply({ content: 'That Discord user has no linked Clash accounts.' });
    return;
  }

  if (subcommand === 'raids') {
    await interaction.editReply({
      embeds: [
        buildCapitalRaidsEmbed(clan ? [clan] : clans, {
          week,
          ...(user ? { userId: user.id } : {}),
        }),
      ],
    });
    return;
  }

  const snapshots = await options.store.listClanMemberSnapshotsForGuild({
    guildId: interaction.guildId,
    ...(clan ? { clanTag: clan.clanTag } : {}),
  });
  await interaction.editReply({
    embeds: [
      buildCapitalContributionEmbed(snapshots, {
        week,
        ...(playerTags ? { playerTags } : {}),
        ...(user ? { userId: user.id } : {}),
      }),
    ],
  });
}

export function filterCapitalClanChoices(
  clans: readonly CapitalLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export function buildCapitalRaidsEmbed(
  clans: readonly CapitalLinkedClan[],
  filters: { readonly week: string | null; readonly userId?: string },
): EmbedBuilder {
  const rows = clans
    .map((clan) => ({
      clan,
      hall: readNestedNumber(clan.snapshot, ['clanCapital', 'capitalHallLevel']),
      league: readNestedString(clan.snapshot, ['capitalLeague', 'name']),
      points: readNumber(clan.snapshot, 'clanCapitalPoints'),
      trophies: readNumber(clan.snapshot, 'clanCapitalTrophies'),
    }))
    .filter(
      (row) =>
        row.hall !== null || row.league !== null || row.points !== null || row.trophies !== null,
    )
    .sort(
      (a, b) =>
        (b.trophies ?? b.points ?? -1) - (a.trophies ?? a.points ?? -1) ||
        (b.hall ?? -1) - (a.hall ?? -1),
    );

  const embed = baseCapitalEmbed('Capital Raids', filters);
  if (rows.length === 0) {
    return embed.setDescription(
      'No clan capital snapshot data is available for linked clans yet. Link/configure a clan and wait for clan polling to store capital hall, league, or trophy data.',
    );
  }

  return embed
    .setDescription(
      rows
        .slice(0, CAPITAL_ROW_LIMIT)
        .map(
          (row, index) =>
            `${index + 1}. ${formatClanLink(row.clan)} · ${formatNumber(row.trophies ?? row.points)} capital trophies · Hall ${formatNumber(row.hall)} · ${escapeMarkdown(row.league ?? 'Unknown league')}`,
        )
        .join('\n'),
    )
    .addFields({
      name: 'Raid Weekend Logs',
      value:
        'Raid-week attack logs are not persisted in ClashMate yet, so this first pass shows linked-clan capital snapshot rankings only.',
    })
    .setFooter({
      text: `Showing ${Math.min(rows.length, CAPITAL_ROW_LIMIT)}/${rows.length} linked clans`,
    });
}

export function buildCapitalContributionEmbed(
  snapshots: readonly CapitalClanMemberSnapshots[],
  filters: {
    readonly week: string | null;
    readonly playerTags?: readonly string[];
    readonly userId?: string;
  },
): EmbedBuilder {
  const tagFilter = filters.playerTags ? new Set(filters.playerTags) : undefined;
  const members = snapshots.flatMap((snapshot) =>
    snapshot.members.map((member) => ({ member, clan: snapshot.clan })),
  );
  const rows = members
    .filter((row) => !tagFilter || tagFilter.has(row.member.playerTag))
    .map((row) => ({
      ...row,
      contribution:
        readMemberCapitalNumber(row.member, 'capitalContribution') ??
        readMemberCapitalNumber(row.member, 'capitalGold'),
    }))
    .filter((row) => row.contribution !== null)
    .sort(
      (a, b) =>
        (b.contribution ?? -1) - (a.contribution ?? -1) ||
        a.member.name.localeCompare(b.member.name),
    );

  const embed = baseCapitalEmbed('Capital Contribution', filters);
  if (members.length === 0) {
    return embed.setDescription(
      'No current member snapshots are available yet. Link/configure a clan and wait for clan polling to observe members.',
    );
  }
  if (rows.length === 0) {
    return embed.setDescription(
      'No per-member capital contribution data is available in current persisted snapshots yet. Existing member snapshots do not include capital contribution or capital gold fields.',
    );
  }

  return embed
    .setDescription(
      rows
        .slice(0, CAPITAL_ROW_LIMIT)
        .map(
          (row, index) =>
            `${index + 1}. **${escapeMarkdown(row.member.name)}** · ${formatNumber(row.contribution)} capital gold · ${escapeMarkdown(labelForClan(row.clan))}`,
        )
        .join('\n'),
    )
    .setFooter({
      text: `Showing ${Math.min(rows.length, CAPITAL_ROW_LIMIT)}/${rows.length} members`,
    });
}

export function resolveCapitalClan(
  clans: readonly CapitalLinkedClan[],
  query: string,
): CapitalLinkedClan | undefined {
  const normalizedQuery = query.trim().toLowerCase();
  let normalizedTag: string | undefined;
  try {
    normalizedTag = normalizeClashTag(query).toLowerCase();
  } catch {
    normalizedTag = undefined;
  }
  return clans.find(
    (clan) =>
      clan.clanTag.toLowerCase() === normalizedTag ||
      clan.clanTag.replace(/^#/, '').toLowerCase() === normalizedQuery.replace(/^#/, '') ||
      clan.alias?.trim().toLowerCase() === normalizedQuery ||
      clan.name?.trim().toLowerCase() === normalizedQuery,
  );
}

function baseCapitalEmbed(
  title: string,
  filters: { readonly week: string | null; readonly userId?: string },
): EmbedBuilder {
  const notes = ['Uses current persisted linked-clan snapshots only.'];
  if (filters.week?.trim())
    notes.push(`Week label accepted but not filtered: ${filters.week.trim()}.`);
  if (filters.userId)
    notes.push('User filter uses linked Clash account tags where member data exists.');
  return new EmbedBuilder().setTitle(title).addFields({ name: 'Source', value: notes.join('\n') });
}

function clanMatchesQuery(clan: CapitalLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: CapitalLinkedClan): string {
  return `${labelForClan(clan)} (${clan.clanTag})`.slice(0, 100);
}

function formatClanLink(clan: CapitalLinkedClan): string {
  return `[${escapeMarkdown(labelForClan(clan))} (${clan.clanTag})](${clanProfileUrl(clan.clanTag)})`;
}

function labelForClan(clan: Pick<CapitalLinkedClan, 'alias' | 'name' | 'clanTag'>): string {
  return clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
}

function clanProfileUrl(clanTag: string): string {
  return `https://link.clashofclans.com/en?action=OpenClanProfile&tag=${encodeURIComponent(clanTag)}`;
}

function formatNumber(value: number | null): string {
  return value === null ? 'Unknown' : value.toLocaleString('en-US');
}

function readMemberCapitalNumber(
  member: CapitalMemberSnapshotRow,
  key: keyof CapitalMemberSnapshotRow,
): number | null {
  const value = member[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNumber(snapshot: unknown, key: string): number | null {
  if (!isRecord(snapshot)) return null;
  const value = snapshot[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNestedNumber(snapshot: unknown, path: readonly string[]): number | null {
  const value = readNestedValue(snapshot, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNestedString(snapshot: unknown, path: readonly string[]): string | null {
  const value = readNestedValue(snapshot, path);
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNestedValue(snapshot: unknown, path: readonly string[]): unknown {
  let value = snapshot;
  for (const key of path) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
