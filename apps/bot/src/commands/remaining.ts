import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  time,
} from 'discord.js';

export const REMAINING_COMMAND_NAME = 'remaining';
export const REMAINING_COMMAND_DESCRIPTION = 'Shows remaining or missed war hits of a clan.';

const WAR_ATTACKS_TYPE = 'war-attacks';
const BLUE_NUMBERS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export const remainingCommandData = new SlashCommandBuilder()
  .setName(REMAINING_COMMAND_NAME)
  .setDescription(REMAINING_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('clan').setDescription('Clan tag or name or alias.').setAutocomplete(true),
  )
  .addStringOption((option) =>
    option
      .setName('type')
      .setDescription('The type of remaining tasks to show.')
      .addChoices({ name: 'War Attacks', value: WAR_ATTACKS_TYPE }),
  )
  .addStringOption((option) =>
    option.setName('player').setDescription('Remaining attacks of a player.').setAutocomplete(true),
  )
  .addUserOption((option) =>
    option.setName('user').setDescription('Remaining attacks of a linked user.'),
  )
  .addStringOption((option) => option.setName('war_id').setDescription('Historical war id.'));

export interface RemainingTrackedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface RemainingLatestWarSnapshot {
  readonly clanTag: string;
  readonly state: string;
  readonly snapshot: unknown;
  readonly fetchedAt: Date;
  readonly updatedAt?: Date;
  readonly trackedClan?: RemainingTrackedClan;
}

export interface RemainingMissedWarAttack {
  readonly playerTag: string;
  readonly playerName: string;
  readonly attacksUsed: number;
  readonly attacksAvailable: number;
}

export interface RemainingStore {
  readonly listLinkedClans: (guildId: string) => Promise<RemainingTrackedClan[]>;
  readonly getLatestWarSnapshot: (clanTag: string) => Promise<RemainingLatestWarSnapshot | null>;
  readonly getLatestWarSnapshotsForGuild: (
    guildId: string,
  ) => Promise<RemainingLatestWarSnapshot[]>;
  readonly getRetainedWarSnapshotsForGuild: (input: {
    guildId: string;
    warKey: string;
    clanTag?: string;
  }) => Promise<RemainingLatestWarSnapshot[]>;
  readonly getLinkedPlayerTags: (guildId: string, discordUserId: string) => Promise<string[]>;
  readonly listMissedWarAttacksForWar?: (
    guildId: string,
    clanTag: string,
    warKey: string,
  ) => Promise<RemainingMissedWarAttack[]>;
}

export interface RemainingCommandOptions {
  readonly store: RemainingStore;
}

export interface RemainingWarData {
  readonly state?: string;
  readonly clan?: WarClan;
  readonly opponent?: WarClan;
  readonly attacksPerMember?: number;
  readonly startTime?: string;
  readonly endTime?: string;
}

interface WarClan {
  readonly tag?: string;
  readonly name?: string;
  readonly badgeUrls?: {
    readonly small?: string;
    readonly medium?: string;
    readonly large?: string;
  };
  readonly members?: readonly WarMember[];
}

interface WarMember {
  readonly tag?: string;
  readonly name?: string;
  readonly mapPosition?: number;
  readonly attacks?: readonly unknown[];
}

export interface RemainingMemberRow {
  readonly tag: string;
  readonly name: string;
  readonly mapPosition: number;
  readonly attacksUsed: number;
  readonly remaining: number;
}

export interface RemainingWarSummary {
  readonly state: string;
  readonly clan: WarClan;
  readonly opponent: WarClan;
  readonly attacksPerMember: number;
  readonly endTime: Date | null;
  readonly rows: RemainingMemberRow[];
  readonly source?: RemainingWarSourceContext;
}

export interface RemainingWarSourceContext {
  readonly fetchedAt: Date;
  readonly updatedAt?: Date;
  readonly snapshotState: string;
  readonly missedAttackEventsUsed: boolean;
  readonly selectedSource: string;
  readonly rosterMembers: number;
  readonly attacksUsed: number;
  readonly attacksPossible: number;
  readonly clanFilter?: string;
  readonly userFilter?: string;
  readonly playerFilter?: string;
}

export interface RemainingPlayerRow extends RemainingMemberRow {
  readonly clanName: string;
  readonly clanTag: string;
  readonly attacksPerMember: number;
  readonly endTime: Date;
}

export interface RemainingPlayerEmbedContext {
  readonly scannedSnapshots: number;
  readonly persistedOnly: boolean;
  readonly selectedSource: string;
  readonly rosterMembers: number;
  readonly attacksUsed: number;
  readonly attacksPossible: number;
  readonly clanFilter?: string;
  readonly userFilter?: string;
  readonly playerFilter?: string;
}

export function createRemainingSlashCommand(
  options: RemainingCommandOptions,
): SlashCommandDefinition {
  return {
    name: REMAINING_COMMAND_NAME,
    data: remainingCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== REMAINING_COMMAND_NAME) return;
      await executeRemaining(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== REMAINING_COMMAND_NAME) return;
      await autocompleteRemaining(interaction, options);
    },
  };
}

async function autocompleteRemaining(
  interaction: AutocompleteInteraction,
  options: RemainingCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  const query = String(focused.value ?? '').trim();
  if (focused.name !== 'clan' && focused.name !== 'player') {
    await interaction.respond([]);
    return;
  }

  if (focused.name === 'player') {
    await interaction.respond(query ? [{ name: query, value: query }] : []);
    return;
  }

  const clans = await options.store.listLinkedClans(interaction.guildId);
  await interaction.respond(filterRemainingClanChoices(clans, query));
}

export function filterRemainingClanChoices(
  clans: readonly RemainingTrackedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalized = query.toLowerCase();
  const choices = clans
    .filter((clan) => {
      if (!normalized) return true;
      return [clan.clanTag, clan.name, clan.alias]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalized));
    })
    .slice(0, 25)
    .map((clan) => ({
      name: `${clan.name ?? clan.clanTag} (${clan.clanTag})`,
      value: clan.clanTag,
    }));

  if (choices.length === 0 && query.trim()) return [{ name: query.trim(), value: query.trim() }];
  return choices;
}

async function executeRemaining(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: RemainingCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/remaining` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const type = interaction.options.getString('type') ?? WAR_ATTACKS_TYPE;
  if (type !== WAR_ATTACKS_TYPE) {
    await interaction.reply({
      content: 'Only war-attack remaining tasks are available right now.',
      ephemeral: true,
    });
    return;
  }

  const warKey = normalizeWarIdOption(interaction.options.getString('war_id'));

  await interaction.deferReply();

  const user = interaction.options.getUser('user');
  const player = interaction.options.getString('player');
  const clanOption = interaction.options.getString('clan');

  if (warKey) {
    await executeHistoricalRemaining(interaction, options, { warKey, clanOption, user, player });
    return;
  }

  if (user || player) {
    const playerTags = player
      ? normalizePlayerTagOption(player)
      : user
        ? await options.store.getLinkedPlayerTags(interaction.guildId, user.id)
        : [];
    if (playerTags.length === 0) {
      await interaction.editReply(
        formatNoPlayerTagsMessage({ hasPlayerFilter: Boolean(player), userId: user?.id }),
      );
      return;
    }

    const snapshots = await options.store.getLatestWarSnapshotsForGuild(interaction.guildId);
    const rows = buildPlayerRemainingRows(snapshots, playerTags, new Date());
    await interaction.editReply({
      embeds: [
        buildPlayerRemainingEmbed(rows, user ?? undefined, {
          scannedSnapshots: snapshots.length,
          persistedOnly: true,
          selectedSource: 'current',
          ...buildSnapshotCoverage(snapshots),
          ...(clanOption ? { clanFilter: clanOption } : {}),
          ...(user ? { userFilter: user.id } : {}),
          ...(player ? { playerFilter: player } : {}),
        }),
      ],
    });
    return;
  }

  const clan = await resolveRemainingClan(interaction.guildId, clanOption, options.store);
  if (!clan) {
    await interaction.editReply(
      'No linked/configured clan was found for this server. Link one with `/setup clan` or provide a clan tag/alias already tracked by this server; `/remaining` only reads stored war snapshots for linked clans.',
    );
    return;
  }

  const snapshot = await options.store.getLatestWarSnapshot(clan.clanTag);
  if (!snapshot) {
    await interaction.editReply(
      `No persisted current war/CWL snapshot is available for **${clan.name ?? clan.clanTag} (${clan.clanTag})** yet. Selected: current; filters: clan=${clanOption ?? clan.clanTag}; roster/attacks unavailable. Link/configure this clan and let the war poller run first; \`/remaining\` has no live fallback or on-demand polling.`,
    );
    return;
  }

  const war = extractWarData(snapshot.snapshot);
  if (!war) {
    await interaction.editReply(
      'The stored war/CWL snapshot is not readable yet. Please try again after the next war poll refreshes the persisted snapshot; no live Clash API fallback is used.',
    );
    return;
  }

  if (normalizeWarState(snapshot.state || war.state) === 'notinwar') {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setAuthor({ name: `${clan.name ?? clan.clanTag} (${clan.clanTag})` })
          .setDescription(
            'No active war was found in the latest persisted snapshot for this linked clan. If the clan just entered war/CWL, wait for the war poller to refresh; `/remaining` does not perform a live Clash API lookup.',
          ),
      ],
    });
    return;
  }

  const summary = withWarSourceContext(
    buildRemainingWarSummary(war, clan.clanTag),
    snapshot,
    false,
    { selectedSource: 'current', ...(clanOption ? { clanFilter: clanOption } : {}) },
  );
  if (!summary) {
    await interaction.editReply(
      'The stored war/CWL snapshot does not include clan war members, so remaining attacks cannot be calculated yet. Wait for the next poller refresh or verify the clan is linked/configured for war polling.',
    );
    return;
  }

  if (summary.state === 'warended' && options.store.listMissedWarAttacksForWar) {
    const missedEvents = await options.store.listMissedWarAttacksForWar(
      interaction.guildId,
      clan.clanTag,
      buildWarKey(clan.clanTag, war),
    );
    if (missedEvents.length > 0) {
      await interaction.editReply({
        embeds: [
          buildClanRemainingEmbed(
            withMissedAttackEventSource(applyMissedWarAttackEvents(summary, missedEvents), true),
          ),
        ],
      });
      return;
    }
  }

  await interaction.editReply({ embeds: [buildClanRemainingEmbed(summary)] });
}

async function executeHistoricalRemaining(
  interaction: ChatInputCommandInteraction<'cached'>,
  options: RemainingCommandOptions,
  input: {
    warKey: string;
    clanOption: string | null;
    user: ReturnType<ChatInputCommandInteraction['options']['getUser']>;
    player: string | null;
  },
): Promise<void> {
  const clan = input.clanOption
    ? await resolveRemainingClan(interaction.guildId, input.clanOption, options.store)
    : null;
  if (input.clanOption && !clan) {
    await interaction.editReply(
      `No linked/configured clan matches \`${input.clanOption}\`. Historical lookups are persisted-only and can only filter retained war/CWL snapshots for clans tracked by this server.`,
    );
    return;
  }

  const snapshots = await options.store.getRetainedWarSnapshotsForGuild({
    guildId: interaction.guildId,
    warKey: input.warKey,
    ...(clan ? { clanTag: clan.clanTag } : {}),
  });
  if (snapshots.length === 0) {
    await interaction.editReply(formatNoHistoricalWarMessage(input.warKey, input.clanOption));
    return;
  }

  if (input.user || input.player) {
    const playerTags = input.player
      ? normalizePlayerTagOption(input.player)
      : input.user
        ? await options.store.getLinkedPlayerTags(interaction.guildId, input.user.id)
        : [];
    if (playerTags.length === 0) {
      await interaction.editReply(
        formatNoPlayerTagsMessage({
          hasPlayerFilter: Boolean(input.player),
          userId: input.user?.id,
        }),
      );
      return;
    }

    const rows = buildPlayerRemainingRows(snapshots, playerTags, new Date(0), {
      includeEndedWars: true,
    });
    await interaction.editReply({
      embeds: [
        buildPlayerRemainingEmbed(rows, input.user ?? undefined, {
          scannedSnapshots: snapshots.length,
          persistedOnly: true,
          selectedSource: formatSelectedHistoricalSource(input.warKey),
          ...buildSnapshotCoverage(snapshots),
          ...(input.clanOption ? { clanFilter: input.clanOption } : {}),
          ...(input.user ? { userFilter: input.user.id } : {}),
          ...(input.player ? { playerFilter: input.player } : {}),
        }),
      ],
    });
    return;
  }

  const snapshot = snapshots[0];
  if (!snapshot) {
    await interaction.editReply('No historical war snapshot was found for that war id.');
    return;
  }

  const war = extractWarData(snapshot.snapshot);
  if (!war) {
    await interaction.editReply(
      'The stored historical war/CWL snapshot is not readable yet. Please try again after a poller refresh or choose another retained war_id; no live Clash API fallback is used.',
    );
    return;
  }

  const summary = withWarSourceContext(
    buildRemainingWarSummary(war, snapshot.trackedClan?.clanTag ?? snapshot.clanTag),
    snapshot,
    false,
    {
      selectedSource: formatSelectedHistoricalSource(input.warKey),
      ...(input.clanOption ? { clanFilter: input.clanOption } : {}),
    },
  );
  if (!summary) {
    await interaction.editReply(
      'The stored historical war/CWL snapshot does not include clan war members, so remaining or missed attacks cannot be calculated from it.',
    );
    return;
  }

  await interaction.editReply({ embeds: [buildClanRemainingEmbed(summary)] });
}

async function resolveRemainingClan(
  guildId: string,
  clanOption: string | null,
  store: RemainingStore,
): Promise<RemainingTrackedClan | null> {
  const clans = await store.listLinkedClans(guildId);
  if (!clanOption) return clans[0] ?? null;

  let normalizedTag: string | null = null;
  try {
    normalizedTag = normalizeClashTag(clanOption);
  } catch {
    normalizedTag = null;
  }

  const query = clanOption.trim().toLowerCase();
  return (
    clans.find((clan) => clan.clanTag === normalizedTag) ??
    clans.find(
      (clan) => clan.alias?.toLowerCase() === query || clan.name?.toLowerCase() === query,
    ) ??
    null
  );
}

function normalizeWarIdOption(warId: string | null): string | null {
  const normalized = warId?.trim().toLowerCase() ?? '';
  return normalized || null;
}

function normalizePlayerTagOption(player: string): string[] {
  try {
    return [normalizeClashTag(player)];
  } catch {
    return [];
  }
}

export function extractWarData(snapshot: unknown): RemainingWarData | null {
  const candidate = unwrapSnapshot(snapshot);
  if (!candidate || typeof candidate !== 'object') return null;
  if (!('clan' in candidate) && !('data' in candidate)) return null;
  return candidate as RemainingWarData;
}

function unwrapSnapshot(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if ('data' in snapshot && typeof (snapshot as { data?: unknown }).data === 'object') {
    return (snapshot as { data?: unknown }).data;
  }
  if ('snapshot' in snapshot && typeof (snapshot as { snapshot?: unknown }).snapshot === 'object') {
    return unwrapSnapshot((snapshot as { snapshot?: unknown }).snapshot);
  }
  return snapshot;
}

export function buildRemainingWarSummary(
  war: RemainingWarData,
  perspectiveClanTag: string,
): RemainingWarSummary | null {
  const clan = choosePerspectiveClan(war, perspectiveClanTag);
  const opponent = clan === war.clan ? war.opponent : war.clan;
  if (!clan?.members || !opponent) return null;

  const attacksPerMember = getAttacksPerMember(war);
  const rows = clan.members
    .map((member, index) => buildRemainingMemberRow(member, index + 1, attacksPerMember))
    .filter((row): row is RemainingMemberRow => row !== null && row.remaining > 0)
    .sort((a, b) => a.mapPosition - b.mapPosition);

  return {
    state: normalizeWarState(war.state),
    clan,
    opponent,
    attacksPerMember,
    endTime: parseWarDate(war.endTime),
    rows,
  };
}

function withWarSourceContext(
  summary: RemainingWarSummary | null,
  snapshot: RemainingLatestWarSnapshot,
  missedAttackEventsUsed: boolean,
  context: {
    selectedSource: string;
    clanFilter?: string;
    userFilter?: string;
    playerFilter?: string;
  },
): RemainingWarSummary | null {
  if (!summary) return null;
  const coverage = buildWarCoverage(summary.clan.members ?? [], summary.attacksPerMember);
  return {
    ...summary,
    source: {
      fetchedAt: snapshot.fetchedAt,
      ...(snapshot.updatedAt ? { updatedAt: snapshot.updatedAt } : {}),
      snapshotState: normalizeWarState(snapshot.state || summary.state),
      missedAttackEventsUsed,
      selectedSource: context.selectedSource,
      ...coverage,
      ...(context.clanFilter ? { clanFilter: context.clanFilter } : {}),
      ...(context.userFilter ? { userFilter: context.userFilter } : {}),
      ...(context.playerFilter ? { playerFilter: context.playerFilter } : {}),
    },
  };
}

function withMissedAttackEventSource(
  summary: RemainingWarSummary,
  missedAttackEventsUsed: boolean,
): RemainingWarSummary {
  if (!summary.source) return summary;
  return {
    ...summary,
    source: { ...summary.source, missedAttackEventsUsed },
  };
}

function choosePerspectiveClan(war: RemainingWarData, clanTag: string): WarClan | undefined {
  const normalized = clanTag.trim().toUpperCase();
  if (war.clan?.tag?.trim().toUpperCase() === normalized) return war.clan;
  if (war.opponent?.tag?.trim().toUpperCase() === normalized) return war.opponent;
  return war.clan;
}

function buildRemainingMemberRow(
  member: WarMember,
  fallbackMapPosition: number,
  attacksPerMember: number,
): RemainingMemberRow | null {
  if (!member.tag || !member.name) return null;
  const attacksUsed = member.attacks?.length ?? 0;
  return {
    tag: member.tag,
    name: member.name,
    mapPosition: member.mapPosition ?? fallbackMapPosition,
    attacksUsed,
    remaining: Math.max(0, attacksPerMember - attacksUsed),
  };
}

export function applyMissedWarAttackEvents(
  summary: RemainingWarSummary,
  missedEvents: readonly RemainingMissedWarAttack[],
): RemainingWarSummary {
  const positionByTag = new Map(summary.rows.map((row) => [row.tag, row.mapPosition]));
  return {
    ...summary,
    rows: missedEvents
      .map((event, index) => ({
        tag: event.playerTag,
        name: event.playerName,
        mapPosition: positionByTag.get(event.playerTag) ?? index + 1,
        attacksUsed: event.attacksUsed,
        remaining: Math.max(0, event.attacksAvailable - event.attacksUsed),
      }))
      .filter((row) => row.remaining > 0)
      .sort((a, b) => a.mapPosition - b.mapPosition),
  };
}

export function buildWarKey(clanTag: string, war: RemainingWarData): string {
  const start = war.startTime ?? 'unknown-start';
  const opponentTag =
    choosePerspectiveClan(war, clanTag) === war.clan ? war.opponent?.tag : war.clan?.tag;
  return `current:${clanTag.trim().toUpperCase()}:${(opponentTag ?? 'unknown-opponent').trim().toUpperCase()}:${start}`.toLowerCase();
}

export function buildPlayerRemainingRows(
  snapshots: readonly RemainingLatestWarSnapshot[],
  playerTags: readonly string[],
  now: Date,
  options: { includeEndedWars?: boolean } = {},
): RemainingPlayerRow[] {
  const tagSet = new Set(playerTags.map((tag) => tag.trim().toUpperCase()));
  const rows: RemainingPlayerRow[] = [];

  for (const snapshot of snapshots) {
    const war = extractWarData(snapshot.snapshot);
    const state = normalizeWarState(war?.state ?? snapshot.state);
    if (!war || (state !== 'inwar' && !(options.includeEndedWars && state === 'warended')))
      continue;
    const endTime = parseWarDate(war.endTime) ?? snapshot.fetchedAt;
    if (!options.includeEndedWars && endTime.getTime() < now.getTime()) continue;
    const attacksPerMember = getAttacksPerMember(war);

    for (const clan of [war.clan, war.opponent]) {
      if (!clan?.members) continue;
      for (const [index, member] of clan.members.entries()) {
        if (!member.tag || !tagSet.has(member.tag.trim().toUpperCase())) continue;
        const row = buildRemainingMemberRow(member, index + 1, attacksPerMember);
        if (row && row.remaining > 0) {
          rows.push({
            ...row,
            clanName: clan.name ?? clan.tag ?? 'Unknown Clan',
            clanTag: clan.tag ?? snapshot.clanTag,
            attacksPerMember,
            endTime,
          });
        }
      }
    }
  }

  return rows.sort((a, b) => a.endTime.getTime() - b.endTime.getTime());
}

function buildSnapshotCoverage(snapshots: readonly RemainingLatestWarSnapshot[]): {
  rosterMembers: number;
  attacksUsed: number;
  attacksPossible: number;
} {
  return snapshots.reduce(
    (coverage, snapshot) => {
      const war = extractWarData(snapshot.snapshot);
      if (!war) return coverage;
      const attacksPerMember = getAttacksPerMember(war);
      for (const clan of [war.clan, war.opponent]) {
        const clanCoverage = buildWarCoverage(clan?.members ?? [], attacksPerMember);
        coverage.rosterMembers += clanCoverage.rosterMembers;
        coverage.attacksUsed += clanCoverage.attacksUsed;
        coverage.attacksPossible += clanCoverage.attacksPossible;
      }
      return coverage;
    },
    { rosterMembers: 0, attacksUsed: 0, attacksPossible: 0 },
  );
}

function buildWarCoverage(
  members: readonly WarMember[],
  attacksPerMember: number,
): { rosterMembers: number; attacksUsed: number; attacksPossible: number } {
  const rosterMembers = members.filter((member) => member.tag && member.name).length;
  const attacksUsed = members.reduce((sum, member) => sum + (member.attacks?.length ?? 0), 0);
  return {
    rosterMembers,
    attacksUsed,
    attacksPossible: rosterMembers * attacksPerMember,
  };
}

function formatSelectedHistoricalSource(warKey: string): string {
  return `${warKey.includes('cwl') ? 'cwl' : 'historical'} war_id:${warKey}`;
}

export function buildClanRemainingEmbed(summary: RemainingWarSummary): EmbedBuilder {
  const embed = new EmbedBuilder().setAuthor(buildWarAuthor(summary.clan));
  const state = summary.state;
  const stateLabel =
    state === 'preparation' ? 'Preparation' : state === 'warended' ? 'War Ended' : 'Battle Day';
  const description = [
    '**War Against**',
    `${summary.opponent.name ?? 'Unknown Clan'} (${summary.opponent.tag ?? 'unknown'})`,
    '',
    '**War State**',
    stateLabel,
  ];

  if (state !== 'preparation' && summary.endTime) {
    description.push(
      '',
      state === 'warended' ? '**Ended**' : '**End Time**',
      time(summary.endTime, 'R'),
    );
  }

  if (state !== 'preparation') {
    const label = state === 'warended' ? 'Missed' : 'Remaining';
    const grouped = groupRowsByRemaining(summary.rows);
    for (const [remaining, rows] of grouped) {
      description.push('', `**${remaining} ${label} ${remaining === 1 ? 'Attack' : 'Attacks'}**`);
      description.push(...rows.map((row) => `${formatMapPosition(row.mapPosition)} ${row.name}`));
    }
  }

  if (summary.source) {
    const missedEventsLabel =
      summary.state === 'warended'
        ? summary.source.missedAttackEventsUsed
          ? 'used'
          : 'not used'
        : 'not applicable';
    embed.addFields({
      name: 'Source',
      value: [
        `Selected: ${summary.source.selectedSource}; fetched ${time(summary.source.fetchedAt, 'R')}${summary.source.updatedAt ? `; updated ${time(summary.source.updatedAt, 'R')}` : ''}.`,
        `Roster: ${summary.source.rosterMembers}; attacks: ${summary.source.attacksUsed}/${summary.source.attacksPossible}; state: ${formatWarStateLabel(summary.source.snapshotState || summary.state)}.`,
        formatFilterContext(summary.source),
        'Persisted snapshots only; no live fallback or on-demand polling.',
        `Ended-war missed events: ${missedEventsLabel}`,
      ].join('\n'),
      inline: false,
    });
  }

  return embed.setDescription(description.join('\n'));
}

function buildWarAuthor(clan: WarClan): { name: string; iconURL?: string } {
  const name = `${clan.name ?? 'Unknown Clan'} (${clan.tag ?? 'unknown'})`;
  const iconURL = clan.badgeUrls?.medium ?? clan.badgeUrls?.small ?? clan.badgeUrls?.large;
  return iconURL ? { name, iconURL } : { name };
}

function groupRowsByRemaining(
  rows: readonly RemainingMemberRow[],
): Array<[number, RemainingMemberRow[]]> {
  const grouped = new Map<number, RemainingMemberRow[]>();
  for (const row of rows) grouped.set(row.remaining, [...(grouped.get(row.remaining) ?? []), row]);
  return [...grouped.entries()].sort((a, b) => b[0] - a[0]);
}

export function buildPlayerRemainingEmbed(
  rows: readonly RemainingPlayerRow[],
  user?: { displayName: string; id: string; displayAvatarURL: () => string },
  context?: RemainingPlayerEmbedContext,
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle('Remaining Clan War Attacks');
  if (user)
    embed.setAuthor({ name: `${user.displayName} (${user.id})`, iconURL: user.displayAvatarURL() });

  const clans = new Map<string, RemainingPlayerRow[]>();
  for (const row of rows) clans.set(row.clanTag, [...(clans.get(row.clanTag) ?? []), row]);
  const description = [...clans.values()]
    .map((clanRows) => {
      const [first] = clanRows;
      if (!first) return '';
      return [
        `### ${first.clanName} (${first.clanTag})`,
        ...clanRows.map(
          (row) =>
            `- ${row.name} (${row.tag})\n - ${row.remaining} remaining (${time(row.endTime, 'R')})`,
        ),
      ].join('\n');
    })
    .join('\n');

  const total = rows.reduce((sum, row) => sum + row.remaining, 0);
  if (context) {
    embed.addFields({
      name: 'Source',
      value: [
        `Scanned ${context.scannedSnapshots} stored war/CWL snapshot${context.scannedSnapshots === 1 ? '' : 's'} from this server's linked/configured clans.`,
        `Selected: ${context.selectedSource}; roster: ${context.rosterMembers}; attacks: ${context.attacksUsed}/${context.attacksPossible}.`,
        formatFilterContext(context),
        context.persistedOnly
          ? 'Persisted snapshots only; no live fallback or on-demand polling.'
          : 'Live lookup status unknown.',
      ].join('\n'),
      inline: false,
    });
  }
  return embed
    .setDescription(
      description ||
        'No remaining attacks were found in stored war/CWL snapshots for the accepted player/user filter. If this looks stale, confirm the player is linked or the tag is valid, ensure the clan is linked/configured here, and wait for the war poller to refresh.',
    )
    .setFooter({ text: `${total} Remaining` });
}

function getAttacksPerMember(war: RemainingWarData): number {
  return Number.isInteger(war.attacksPerMember) && Number(war.attacksPerMember) > 0
    ? Number(war.attacksPerMember)
    : 2;
}

function parseWarDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeWarState(state: string | undefined): string {
  return (state ?? '').trim().toLowerCase();
}

function formatWarStateLabel(state: string): string {
  return state === 'preparation'
    ? 'Preparation'
    : state === 'warended'
      ? 'War Ended'
      : state === 'inwar'
        ? 'Battle Day'
        : state || 'Unknown';
}

function formatFilterContext(input: {
  readonly clanFilter?: string;
  readonly userFilter?: string;
  readonly playerFilter?: string;
}): string {
  const filters = [
    input.clanFilter ? `clan=${input.clanFilter}` : null,
    input.userFilter ? `user=${input.userFilter}` : null,
    input.playerFilter ? `player=${input.playerFilter}` : null,
  ].filter((filter): filter is string => Boolean(filter));
  return filters.length > 0 ? `Filters: ${filters.join(', ')}.` : 'Filters: server linked clans.';
}

function formatNoPlayerTagsMessage(input: {
  hasPlayerFilter: boolean;
  userId?: string | undefined;
}): string {
  if (input.hasPlayerFilter) {
    return 'No valid player tag was provided. Player-filtered `/remaining` only scans persisted war/CWL snapshots and does not perform live player lookups; provide a Clash player tag already present in stored war data.';
  }
  return `No linked player tags were found${input.userId ? ` for <@${input.userId}>` : ''}. User-filtered \`/remaining\` only scans stored links and persisted war/CWL snapshots; link a player account first and wait for tracked clan war polling to collect data.`;
}

function formatNoHistoricalWarMessage(warKey: string, clanOption: string | null): string {
  const clanText = clanOption ? ` for clan filter \`${clanOption}\`` : '';
  return `No persisted historical war/CWL snapshot was found for war_id \`${warKey}\`${clanText}. Selected: ${formatSelectedHistoricalSource(warKey)}; roster/attacks unavailable. This command only searches retained stored snapshots for linked/configured clans; no live fallback or on-demand polling is used. Verify the war_id, clan filter, and that polling captured/retained that war.`;
}

function formatMapPosition(position: number): string {
  return BLUE_NUMBERS[position] ?? `#${position}`;
}
