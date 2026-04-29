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
  .addStringOption((option) =>
    option
      .setName('war_id')
      .setDescription('Historical war id. Current-war snapshots do not support this yet.'),
  );

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
}

export interface RemainingPlayerRow extends RemainingMemberRow {
  readonly clanName: string;
  readonly clanTag: string;
  readonly attacksPerMember: number;
  readonly endTime: Date;
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

  const warId = interaction.options.getString('war_id');
  if (warId) {
    await interaction.reply({
      content: '`war_id` is not available until ClashMate stores historical war snapshots.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const user = interaction.options.getUser('user');
  const player = interaction.options.getString('player');
  if (user || player) {
    const playerTags = player
      ? normalizePlayerTagOption(player)
      : user
        ? await options.store.getLinkedPlayerTags(interaction.guildId, user.id)
        : [];
    if (playerTags.length === 0) {
      await interaction.editReply('No linked player tags were found for that user.');
      return;
    }

    const snapshots = await options.store.getLatestWarSnapshotsForGuild(interaction.guildId);
    const rows = buildPlayerRemainingRows(snapshots, playerTags, new Date());
    await interaction.editReply({ embeds: [buildPlayerRemainingEmbed(rows, user ?? undefined)] });
    return;
  }

  const clan = await resolveRemainingClan(
    interaction.guildId,
    interaction.options.getString('clan'),
    options.store,
  );
  if (!clan) {
    await interaction.editReply(
      'No clan was found. Link one with `/setup clan` first or provide a linked clan tag.',
    );
    return;
  }

  const snapshot = await options.store.getLatestWarSnapshot(clan.clanTag);
  if (!snapshot) {
    await interaction.editReply(
      `No current war snapshot is available for **${clan.name ?? clan.clanTag} (${clan.clanTag})** yet.`,
    );
    return;
  }

  const war = extractWarData(snapshot.snapshot);
  if (!war) {
    await interaction.editReply(
      'The stored war snapshot is not readable yet. Please try again after the next war poll.',
    );
    return;
  }

  if (normalizeWarState(snapshot.state || war.state) === 'notinwar') {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setAuthor({ name: `${clan.name ?? clan.clanTag} (${clan.clanTag})` })
          .setDescription('The clan is not in a war.'),
      ],
    });
    return;
  }

  const summary = buildRemainingWarSummary(war, clan.clanTag);
  if (!summary) {
    await interaction.editReply('The stored war snapshot does not include clan war members.');
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
        embeds: [buildClanRemainingEmbed(applyMissedWarAttackEvents(summary, missedEvents))],
      });
      return;
    }
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
): RemainingPlayerRow[] {
  const tagSet = new Set(playerTags.map((tag) => tag.trim().toUpperCase()));
  const rows: RemainingPlayerRow[] = [];

  for (const snapshot of snapshots) {
    const war = extractWarData(snapshot.snapshot);
    if (!war || normalizeWarState(war.state ?? snapshot.state) !== 'inwar') continue;
    const endTime = parseWarDate(war.endTime);
    if (!endTime || endTime.getTime() < now.getTime()) continue;
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
  return embed.setDescription(description || null).setFooter({ text: `${total} Remaining` });
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

function formatMapPosition(position: number): string {
  return BLUE_NUMBERS[position] ?? `#${position}`;
}
