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
const RAID_WEEK_CHOICE_LIMIT = 6;
const RAID_WEEK_CHOICES = getRecentRaidWeekChoices(new Date());
const RAID_WEEK_LABELS = new Map(RAID_WEEK_CHOICES.map((choice) => [choice.value, choice.name]));

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
        .setRequired(false)
        .addChoices(...RAID_WEEK_CHOICES),
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
    const raidClans = clan ? [clan] : clans;
    if (user && playerTags) {
      const snapshots = await options.store.listClanMemberSnapshotsForGuild({
        guildId: interaction.guildId,
        ...(clan ? { clanTag: clan.clanTag } : {}),
      });
      const linkedTags = new Set(playerTags.map((tag) => tag.toUpperCase()));
      const matchedClanTags = new Set(
        snapshots
          .filter((snapshot) =>
            snapshot.members.some((member) => linkedTags.has(member.playerTag.toUpperCase())),
          )
          .map((snapshot) => snapshot.clan.clanTag),
      );

      if (matchedClanTags.size === 0) {
        await interaction.editReply({
          embeds: [
            buildCapitalRaidsEmbed([], {
              linkedClansConsidered: raidClans.length,
              latestMemberSnapshotAt: latestMemberSnapshotDate(snapshots),
              ...(clan ? { clanLabel: labelForClan(clan) } : {}),
              week,
              userId: user.id,
            }),
          ],
        });
        return;
      }

      await interaction.editReply({
        embeds: [
          buildCapitalRaidsEmbed(
            raidClans.filter((linkedClan) => matchedClanTags.has(linkedClan.clanTag)),
            {
              linkedClansConsidered: raidClans.length,
              latestMemberSnapshotAt: latestMemberSnapshotDate(snapshots),
              ...(clan ? { clanLabel: labelForClan(clan) } : {}),
              week,
              userId: user.id,
            },
          ),
        ],
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        buildCapitalRaidsEmbed(raidClans, {
          linkedClansConsidered: raidClans.length,
          ...(clan ? { clanLabel: labelForClan(clan) } : {}),
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
        linkedClansConsidered: clan ? 1 : clans.length,
        ...(clan ? { clanLabel: labelForClan(clan) } : {}),
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
  filters: {
    readonly week: string | null;
    readonly userId?: string;
    readonly clanLabel?: string;
    readonly linkedClansConsidered?: number;
    readonly latestMemberSnapshotAt?: Date | null;
  },
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

  const embed = baseCapitalEmbed('Capital Raids', {
    ...filters,
    linkedClanSnapshots: clans.filter((clan) => hasSnapshotRecord(clan.snapshot)).length,
    usableRows: rows.length,
  });
  if (rows.length === 0) {
    return embed.setDescription(
      formatCapitalNoDataMessage(
        'No stored clan capital snapshot rows match the accepted filters.',
        filters,
        'Link/configure a clan and wait for clan polling to store capital hall, league, or trophy data.',
      ),
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
    readonly clanLabel?: string;
    readonly linkedClansConsidered?: number;
  },
): EmbedBuilder {
  const tagFilter = filters.playerTags ? new Set(filters.playerTags) : undefined;
  const members = snapshots.flatMap((snapshot) =>
    snapshot.members.map((member) => ({ member, clan: snapshot.clan })),
  );
  const filteredMembers = members.filter(
    (row) => !tagFilter || tagFilter.has(row.member.playerTag),
  );
  const rows = filteredMembers
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

  const embed = baseCapitalEmbed('Capital Contribution', {
    ...filters,
    latestMemberSnapshotAt: latestMemberSnapshotDate(snapshots),
    memberSnapshotRows: members.length,
    filteredMemberRows: filteredMembers.length,
    usableRows: rows.length,
  });
  if (members.length === 0) {
    return embed.setDescription(
      formatCapitalNoDataMessage(
        'No stored member snapshot rows match the accepted clan/week filters.',
        filters,
        'Link/configure a clan and wait for clan polling to observe members.',
      ),
    );
  }
  if (filteredMembers.length === 0) {
    return embed.setDescription(
      formatCapitalNoDataMessage(
        'No stored member snapshot rows match the accepted user filter.',
        filters,
        'The selected Discord user has linked Clash accounts, but they were not found in the current linked-clan member snapshots.',
      ),
    );
  }
  if (rows.length === 0) {
    return embed.setDescription(
      formatCapitalNoDataMessage(
        'No stored member snapshot rows with usable capital contribution data match the accepted filters.',
        filters,
        'Existing member snapshots do not include capital contribution or capital gold fields.',
      ),
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
  filters: {
    readonly week: string | null;
    readonly userId?: string;
    readonly clanLabel?: string;
    readonly linkedClansConsidered?: number;
    readonly latestMemberSnapshotAt?: Date | null;
    readonly linkedClanSnapshots?: number;
    readonly memberSnapshotRows?: number;
    readonly filteredMemberRows?: number;
    readonly usableRows?: number;
  },
): EmbedBuilder {
  const notes = [
    'Persisted-only: uses current stored linked-clan/member snapshots; no Clash API lookup.',
  ];
  if (typeof filters.linkedClansConsidered === 'number')
    notes.push(
      `Linked clans considered: ${filters.linkedClansConsidered.toLocaleString('en-US')}.`,
    );
  if (typeof filters.linkedClanSnapshots === 'number')
    notes.push(
      `Linked-clan snapshots with stored payloads: ${filters.linkedClanSnapshots.toLocaleString(
        'en-US',
      )}.`,
    );
  if (typeof filters.memberSnapshotRows === 'number')
    notes.push(`Member snapshot rows read: ${filters.memberSnapshotRows.toLocaleString('en-US')}.`);
  if (typeof filters.filteredMemberRows === 'number')
    notes.push(`Member rows after filters: ${filters.filteredMemberRows.toLocaleString('en-US')}.`);
  if (typeof filters.usableRows === 'number')
    notes.push(`Rows with usable capital data: ${filters.usableRows.toLocaleString('en-US')}.`);
  if (filters.latestMemberSnapshotAt)
    notes.push(
      `Latest member snapshot: ${formatRelativeSnapshotAge(filters.latestMemberSnapshotAt)}.`,
    );
  if (filters.week?.trim())
    notes.push(
      `Week label only: ${formatRaidWeekFilter(filters.week)}; raid logs are not persisted or filtered.`,
    );
  if (filters.userId)
    notes.push('User filter uses linked Clash account tags where member data exists.');
  notes.push('Raid-week logs are not persisted yet; week filters cannot load attack-log history.');
  return new EmbedBuilder().setTitle(title).addFields({ name: 'Source', value: notes.join('\n') });
}

function formatCapitalNoDataMessage(
  summary: string,
  filters: { readonly week: string | null; readonly userId?: string; readonly clanLabel?: string },
  nextStep: string,
): string {
  const acceptedFilters = [
    'clanLabel' in filters && filters.clanLabel
      ? `clan:${escapeMarkdown(filters.clanLabel)}`
      : undefined,
    filters.userId ? `user:<@${filters.userId}>` : undefined,
    filters.week?.trim() ? `week:${formatRaidWeekFilter(filters.week)}` : undefined,
  ].filter((value): value is string => Boolean(value));
  return [
    summary,
    acceptedFilters.length > 0 ? `Accepted filters: ${acceptedFilters.join(', ')}.` : undefined,
    nextStep,
    'This command is persisted-only; raid-week logs are not stored yet, so the week option is a display/parity label and does not load attack-log history.',
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n');
}

function latestMemberSnapshotDate(snapshots: readonly CapitalClanMemberSnapshots[]): Date | null {
  let latest: Date | null = null;
  for (const snapshot of snapshots) {
    for (const member of snapshot.members) {
      if (member.lastFetchedAt && (!latest || member.lastFetchedAt.getTime() > latest.getTime())) {
        latest = member.lastFetchedAt;
      }
    }
  }
  return latest;
}

function formatRelativeSnapshotAge(date: Date): string {
  const milliseconds = Date.now() - date.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return date.toISOString();
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getRecentRaidWeekChoices(now: Date): ApplicationCommandOptionChoiceData<string>[] {
  const choices: ApplicationCommandOptionChoiceData<string>[] = [];
  const cursor = startOfUtcDay(now);
  const daysSinceFriday = (cursor.getUTCDay() + 2) % 7;
  cursor.setUTCDate(cursor.getUTCDate() - daysSinceFriday);

  while (choices.length < RAID_WEEK_CHOICE_LIMIT) {
    if (cursor.getTime() < now.getTime()) {
      choices.push({
        name: formatRaidWeekChoiceName(cursor),
        value: formatRaidWeekChoiceValue(cursor),
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }

  return choices;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatRaidWeekChoiceName(date: Date): string {
  return `${date.getUTCDate().toString().padStart(2, '0')} ${date.toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  })}, ${date.getUTCFullYear()}`;
}

function formatRaidWeekChoiceValue(date: Date): string {
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function formatRaidWeekFilter(week: string): string {
  const trimmed = week.trim();
  const label = RAID_WEEK_LABELS.get(trimmed);
  return label ? `${label} (${trimmed})` : trimmed;
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

function hasSnapshotRecord(snapshot: unknown): boolean {
  return isRecord(snapshot) && Object.keys(snapshot).length > 0;
}
