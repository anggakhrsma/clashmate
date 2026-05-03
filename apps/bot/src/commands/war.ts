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

export const WAR_COMMAND_NAME = 'war';
export const WAR_COMMAND_DESCRIPTION = 'Show current or historical war status for a linked clan.';

export const warCommandData = new SlashCommandBuilder()
  .setName(WAR_COMMAND_NAME)
  .setDescription(WAR_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('clan').setDescription('Clan tag or name or alias.').setAutocomplete(true),
  )
  .addUserOption((option) =>
    option.setName('user').setDescription('Discord user whose linked players should be matched.'),
  )
  .addStringOption((option) => option.setName('war_id').setDescription('Historical war id.'));

export interface WarTrackedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface WarSnapshotRecord {
  readonly clanTag: string;
  readonly state: string;
  readonly snapshot: unknown;
  readonly fetchedAt: Date;
  readonly trackedClan?: WarTrackedClan;
  readonly warKey?: string;
}

export interface WarStore {
  readonly listLinkedClans: (guildId: string) => Promise<WarTrackedClan[]>;
  readonly getLatestWarSnapshot: (clanTag: string) => Promise<WarSnapshotRecord | null>;
  readonly getLatestWarSnapshotsForGuild: (guildId: string) => Promise<WarSnapshotRecord[]>;
  readonly getRetainedWarSnapshotsForGuild: (input: {
    guildId: string;
    warKey: string;
    clanTag?: string;
  }) => Promise<WarSnapshotRecord[]>;
  readonly getLinkedPlayerTags: (guildId: string, discordUserId: string) => Promise<string[]>;
}

export interface WarCommandOptions {
  readonly store: WarStore;
}

interface WarClan {
  readonly tag?: string;
  readonly name?: string;
  readonly stars?: number;
  readonly destructionPercentage?: number;
  readonly attacks?: number;
  readonly badgeUrls?: {
    readonly small?: string;
    readonly medium?: string;
    readonly large?: string;
  };
  readonly members?: readonly WarMember[];
}

interface WarMember {
  readonly tag?: string;
}

interface WarData {
  readonly state?: string;
  readonly clan?: WarClan;
  readonly opponent?: WarClan;
  readonly teamSize?: number;
  readonly attacksPerMember?: number;
  readonly preparationStartTime?: string;
  readonly startTime?: string;
  readonly endTime?: string;
}

interface WarEntry {
  readonly snapshot: WarSnapshotRecord;
  readonly war: WarData;
}

export function createWarSlashCommand(options: WarCommandOptions): SlashCommandDefinition {
  return {
    name: WAR_COMMAND_NAME,
    data: warCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== WAR_COMMAND_NAME) return;
      await executeWar(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== WAR_COMMAND_NAME) return;
      await autocompleteWar(interaction, options);
    },
  };
}

async function autocompleteWar(
  interaction: AutocompleteInteraction,
  options: WarCommandOptions,
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
  const clans = await options.store.listLinkedClans(interaction.guildId);
  await interaction.respond(filterWarClanChoices(clans, String(focused.value ?? '')));
}

export function filterWarClanChoices(
  clans: readonly WarTrackedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalized = query.trim().toLowerCase();
  return clans
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
}

async function executeWar(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: WarCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: '`/war` can only be used in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const clanOption = interaction.options.getString('clan');
  const warKey = interaction.options.getString('war_id')?.trim().toLowerCase() || null;
  const user = interaction.options.getUser('user');

  const clan = clanOption
    ? await resolveWarClan(interaction.guildId, clanOption, options.store)
    : null;
  if (clanOption && !clan) {
    await interaction.editReply('No linked clan was found for that clan option.');
    return;
  }

  const playerTags = user
    ? await options.store.getLinkedPlayerTags(interaction.guildId, user.id)
    : [];
  if (user && playerTags.length === 0) {
    await interaction.editReply(
      'No linked player tags were found for that user. Use `/link create` to link a Clash account first.',
    );
    return;
  }

  const snapshots = await loadCandidateSnapshots(interaction.guildId, options.store, {
    clan,
    warKey,
  });
  if (warKey && snapshots.length === 0) {
    await interaction.editReply('No historical war snapshot was found for that war id.');
    return;
  }
  if (snapshots.length === 0) {
    await interaction.editReply(
      'No current war snapshot is available yet. Link/configure a clan and wait for war polling to run.',
    );
    return;
  }

  const entries = snapshots
    .map((snapshot) => ({ snapshot, war: extractWarData(snapshot.snapshot) }))
    .filter((entry): entry is WarEntry => Boolean(entry.war))
    .filter((entry) => playerTags.length === 0 || warIncludesPlayer(entry.war, playerTags));

  if (user && entries.length === 0) {
    await interaction.editReply('No readable war snapshot includes linked players for that user.');
    return;
  }

  const entry = chooseWarEntry(entries);
  if (!entry) {
    await interaction.editReply(
      'No readable war snapshot is available yet. Please try again after the next war poll.',
    );
    return;
  }

  await interaction.editReply({ embeds: [buildWarEmbed(entry)] });
}

async function loadCandidateSnapshots(
  guildId: string,
  store: WarStore,
  input: { clan: WarTrackedClan | null; warKey: string | null },
): Promise<WarSnapshotRecord[]> {
  if (input.warKey) {
    return store.getRetainedWarSnapshotsForGuild({
      guildId,
      warKey: input.warKey,
      ...(input.clan ? { clanTag: input.clan.clanTag } : {}),
    });
  }
  if (input.clan) {
    const snapshot = await store.getLatestWarSnapshot(input.clan.clanTag);
    return snapshot ? [{ ...snapshot, trackedClan: input.clan }] : [];
  }
  return store.getLatestWarSnapshotsForGuild(guildId);
}

async function resolveWarClan(
  guildId: string,
  clanOption: string,
  store: WarStore,
): Promise<WarTrackedClan | null> {
  const clans = await store.listLinkedClans(guildId);
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

function chooseWarEntry(entries: readonly WarEntry[]): WarEntry | null {
  return (
    entries.find(
      (entry) => normalizeWarState(entry.war.state ?? entry.snapshot.state) !== 'notinwar',
    ) ??
    entries[0] ??
    null
  );
}

export function extractWarData(snapshot: unknown): WarData | null {
  const unwrapped = unwrapSnapshot(snapshot);
  if (!isRecord(unwrapped)) return null;
  const record = unwrapped as {
    readonly state?: unknown;
    readonly clan?: unknown;
    readonly opponent?: unknown;
    readonly teamSize?: unknown;
    readonly attacksPerMember?: unknown;
    readonly preparationStartTime?: unknown;
    readonly startTime?: unknown;
    readonly endTime?: unknown;
  };
  const clan = readWarClan(record.clan);
  const opponent = readWarClan(record.opponent);
  if (!clan || !opponent) return null;
  const state = readNonBlankString(record.state);
  const teamSize = readFiniteNumber(record.teamSize);
  const attacksPerMember = readFiniteNumber(record.attacksPerMember);
  const preparationStartTime = readNonBlankString(record.preparationStartTime);
  const startTime = readNonBlankString(record.startTime);
  const endTime = readNonBlankString(record.endTime);
  return {
    clan,
    opponent,
    ...(state ? { state } : {}),
    ...(teamSize !== null ? { teamSize } : {}),
    ...(attacksPerMember !== null ? { attacksPerMember } : {}),
    ...(preparationStartTime ? { preparationStartTime } : {}),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
  };
}

function unwrapSnapshot(snapshot: unknown): unknown {
  if (!isRecord(snapshot)) return null;
  const record = snapshot as { readonly data?: unknown; readonly snapshot?: unknown };
  if (isRecord(record.data)) return record.data;
  if (isRecord(record.snapshot)) return unwrapSnapshot(record.snapshot);
  return snapshot;
}

function readWarClan(value: unknown): WarClan | null {
  if (!isRecord(value)) return null;
  const record = value as {
    readonly tag?: unknown;
    readonly name?: unknown;
    readonly stars?: unknown;
    readonly destructionPercentage?: unknown;
    readonly attacks?: unknown;
    readonly badgeUrls?: unknown;
    readonly members?: unknown;
  };
  const tag = readNonBlankString(record.tag);
  const name = readNonBlankString(record.name);
  const stars = readFiniteNumber(record.stars);
  const destructionPercentage = readFiniteNumber(record.destructionPercentage);
  const attacks = readFiniteNumber(record.attacks);
  const badgeUrls = readBadgeUrls(record.badgeUrls);
  return {
    members: readWarMembers(record.members),
    ...(tag ? { tag } : {}),
    ...(name ? { name } : {}),
    ...(stars !== null ? { stars } : {}),
    ...(destructionPercentage !== null ? { destructionPercentage } : {}),
    ...(attacks !== null ? { attacks } : {}),
    ...(badgeUrls ? { badgeUrls } : {}),
  };
}

function readBadgeUrls(value: unknown): WarClan['badgeUrls'] | null {
  if (!isRecord(value)) return null;
  const record = value as {
    readonly small?: unknown;
    readonly medium?: unknown;
    readonly large?: unknown;
  };
  const small = readNonBlankString(record.small);
  const medium = readNonBlankString(record.medium);
  const large = readNonBlankString(record.large);
  return small || medium || large
    ? { ...(small ? { small } : {}), ...(medium ? { medium } : {}), ...(large ? { large } : {}) }
    : null;
}

function readWarMembers(value: unknown): readonly WarMember[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((member) => {
    if (!isRecord(member)) return [];
    const tag = readNonBlankString((member as { readonly tag?: unknown }).tag);
    return tag ? [{ tag }] : [];
  });
}

function warIncludesPlayer(war: WarData, playerTags: readonly string[]): boolean {
  const tags = new Set(playerTags.map((tag) => tag.trim().toUpperCase()));
  return [war.clan, war.opponent].some((clan) =>
    clan?.members?.some((member) => member.tag && tags.has(member.tag.trim().toUpperCase())),
  );
}

export function buildWarEmbed(entry: WarEntry): EmbedBuilder {
  const war = entry.war;
  const clan = choosePerspectiveClan(
    war,
    entry.snapshot.trackedClan?.clanTag ?? entry.snapshot.clanTag,
  );
  const opponent = clan === war.clan ? war.opponent : war.clan;
  const embed = new EmbedBuilder().setAuthor(buildWarAuthor(clan, entry.snapshot.trackedClan));
  const state = normalizeWarState(war.state ?? entry.snapshot.state);

  if (state === 'notinwar') {
    return embed.setDescription('The clan is not in a war.');
  }

  const description = [
    '**War Against**',
    `${opponent?.name ?? 'Unknown Clan'} (${opponent?.tag ?? 'unknown'})`,
    '',
    '**War State**',
    formatWarState(state),
    '',
    '**War Size**',
    `${formatNumber(war.teamSize)} vs ${formatNumber(war.teamSize)}`,
    '',
    '**War Stats**',
    `Stars: ${formatNumber(clan?.stars)} / ${formatNumber(opponent?.stars)}`,
    `Destruction: ${formatPercent(clan?.destructionPercentage)} / ${formatPercent(opponent?.destructionPercentage)}`,
    `Attacks: ${formatNumber(clan?.attacks)} / ${formatNumber(opponent?.attacks)} of ${formatTotalAttacks(war)}`,
    `Attacks/Member: ${formatNumber(war.attacksPerMember ?? 2)}`,
  ];

  const dates = formatWarDates(war);
  if (dates.length > 0) description.push('', '**Times**', ...dates);
  const warId = entry.snapshot.warKey ?? deriveWarKey(entry.snapshot.clanTag, war);
  if (warId) description.push('', `war_id: \`${warId}\``);

  return embed.setDescription(description.join('\n'));
}

function choosePerspectiveClan(war: WarData, clanTag: string): WarClan | undefined {
  const normalized = clanTag.trim().toUpperCase();
  if (war.clan?.tag?.trim().toUpperCase() === normalized) return war.clan;
  if (war.opponent?.tag?.trim().toUpperCase() === normalized) return war.opponent;
  return war.clan;
}

function buildWarAuthor(
  clan: WarClan | undefined,
  trackedClan: WarTrackedClan | undefined,
): { name: string; iconURL?: string } {
  const name = `${clan?.name ?? trackedClan?.name ?? trackedClan?.clanTag ?? 'Unknown Clan'} (${clan?.tag ?? trackedClan?.clanTag ?? 'unknown'})`;
  const iconURL = clan?.badgeUrls?.medium ?? clan?.badgeUrls?.small ?? clan?.badgeUrls?.large;
  return iconURL ? { name, iconURL } : { name };
}

function formatWarDates(war: WarData): string[] {
  const rows: string[] = [];
  const preparation = parseWarDate(war.preparationStartTime);
  const start = parseWarDate(war.startTime);
  const end = parseWarDate(war.endTime);
  if (preparation) rows.push(`Preparation: ${time(preparation, 'R')}`);
  if (start) rows.push(`Start: ${time(start, 'R')}`);
  if (end) rows.push(`End: ${time(end, 'R')}`);
  return rows;
}

function deriveWarKey(clanTag: string, war: WarData): string | null {
  const start = war.startTime ?? war.preparationStartTime;
  const opponentTag =
    choosePerspectiveClan(war, clanTag) === war.clan ? war.opponent?.tag : war.clan?.tag;
  if (!start || !opponentTag) return null;
  return `current:${clanTag.trim().toUpperCase()}:${opponentTag.trim().toUpperCase()}:${start}`.toLowerCase();
}

function formatWarState(state: string): string {
  if (state === 'preparation') return 'Preparation';
  if (state === 'inwar') return 'Battle Day';
  if (state === 'warended') return 'War Ended';
  return state || 'Unknown';
}

function formatTotalAttacks(war: WarData): string {
  if (typeof war.teamSize !== 'number') return '?';
  return String(war.teamSize * (war.attacksPerMember ?? 2));
}

function normalizeWarState(state: string | undefined): string {
  return (state ?? '').trim().toLowerCase().replaceAll('_', '');
}

function formatNumber(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '?';
}

function formatPercent(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '?';
}

function parseWarDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readNonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
