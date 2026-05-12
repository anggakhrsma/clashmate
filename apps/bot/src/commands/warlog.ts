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

export const WARLOG_COMMAND_NAME = 'warlog';
export const WARLOG_COMMAND_DESCRIPTION = 'Show recent wars from tracked war history.';
const WARLOG_LIMIT = 10;

export const warlogCommandData = new SlashCommandBuilder()
  .setName(WARLOG_COMMAND_NAME)
  .setDescription(WARLOG_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('clan').setDescription('Clan tag or name or alias.').setAutocomplete(true),
  )
  .addUserOption((option) =>
    option.setName('user').setDescription('Discord user to filter by linked players.'),
  );

export interface WarlogTrackedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface WarlogRetainedWarSnapshot {
  readonly clanTag: string;
  readonly warKey: string;
  readonly state: string;
  readonly snapshot: unknown;
  readonly fetchedAt: Date;
  readonly trackedClan: WarlogTrackedClan;
}

export interface WarlogStore {
  readonly listLinkedClans: (guildId: string) => Promise<WarlogTrackedClan[]>;
  readonly listRetainedEndedWarSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
    limit?: number;
  }) => Promise<WarlogRetainedWarSnapshot[]>;
  readonly getLinkedPlayerTags: (guildId: string, discordUserId: string) => Promise<string[]>;
}

export interface WarlogCommandOptions {
  readonly store: WarlogStore;
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
  readonly endTime?: string;
}

interface WarlogEntry {
  readonly snapshot: WarlogRetainedWarSnapshot;
  readonly war: WarData;
}

export interface WarlogOutputContext {
  readonly linkedClanCount: number;
  readonly linkedClanLabels: readonly string[];
  readonly retainedSnapshotsScanned: number;
  readonly visibleEntries: number;
  readonly displayLimit: number;
  readonly latestFetchedAt: Date | null;
  readonly latestEndedAt: Date | null;
  readonly clan?: WarlogTrackedClan;
  readonly user?: {
    readonly id: string;
    readonly displayName: string;
    readonly linkedPlayerTagCount: number;
  };
}

export function createWarlogSlashCommand(options: WarlogCommandOptions): SlashCommandDefinition {
  return {
    name: WARLOG_COMMAND_NAME,
    data: warlogCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== WARLOG_COMMAND_NAME) return;
      await executeWarlog(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== WARLOG_COMMAND_NAME) return;
      await autocompleteWarlog(interaction, options);
    },
  };
}

async function autocompleteWarlog(
  interaction: AutocompleteInteraction,
  options: WarlogCommandOptions,
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
    const clans = await options.store.listLinkedClans(interaction.guildId);
    await interaction.respond(filterWarlogClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterWarlogClanChoices(
  clans: readonly WarlogTrackedClan[],
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
      name: formatWarlogClanChoiceName(clan),
      value: clan.clanTag,
    }));
}

function formatWarlogClanChoiceName(clan: WarlogTrackedClan): string {
  const primary = clan.name ?? clan.clanTag;
  const alias = clan.alias?.trim();
  const label = alias && alias !== primary ? `${primary} · ${alias}` : primary;
  return `${label} (${clan.clanTag})`;
}

async function executeWarlog(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: WarlogCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/warlog` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();
  const clanOption = interaction.options.getString('clan');
  const user = interaction.options.getUser('user');
  const linkedClans = await options.store.listLinkedClans(interaction.guildId);
  const clan = clanOption ? resolveWarlogClan(clanOption, linkedClans) : null;
  if (clanOption && !clan) {
    await interaction.editReply(
      `No linked clan matched that clan filter. Considered ${linkedClans.length} linked clan${linkedClans.length === 1 ? '' : 's'} in this server; /warlog uses retained snapshots only and will not live-fetch or backfill unlinked clans.`,
    );
    return;
  }

  const playerTags = user
    ? await options.store.getLinkedPlayerTags(interaction.guildId, user.id)
    : [];
  if (user && playerTags.length === 0) {
    await interaction.editReply(
      [
        'No linked player tags were found for that user, so `/warlog` cannot match retained war snapshots to them.',
        `Coverage: considered ${formatLinkedClanCoverageFromClans(linkedClans)}; retained snapshots were not scanned because the user filter has no linked Clash accounts.`,
        'Guidance: use `/link create` to link a Clash account first, then rerun `/warlog` after linked clans have retained completed regular wars.',
      ].join('\n'),
    );
    return;
  }

  const snapshots = await options.store.listRetainedEndedWarSnapshotsForGuild({
    guildId: interaction.guildId,
    ...(clan ? { clanTag: clan.clanTag } : {}),
    limit: user ? 50 : WARLOG_LIMIT,
  });
  const latestFetchedAt = findLatestFetchedAt(snapshots);
  const parsedEntries = snapshots
    .map((snapshot) => ({ snapshot, war: extractWarData(snapshot.snapshot) }))
    .filter((entry): entry is WarlogEntry => Boolean(entry.war));
  const latestEndedAt = findLatestEndedAt(parsedEntries);
  const entries = parsedEntries
    .filter((entry) => playerTags.length === 0 || warIncludesPlayer(entry.war, playerTags))
    .slice(0, WARLOG_LIMIT);

  const outputContext: WarlogOutputContext = {
    linkedClanCount: linkedClans.length,
    linkedClanLabels: linkedClans.map(formatTrackedClan),
    retainedSnapshotsScanned: snapshots.length,
    visibleEntries: entries.length,
    displayLimit: WARLOG_LIMIT,
    latestFetchedAt,
    latestEndedAt,
    ...(clan ? { clan } : {}),
    ...(user
      ? {
          user: {
            id: user.id,
            displayName: user.displayName,
            linkedPlayerTagCount: playerTags.length,
          },
        }
      : {}),
  };

  if (entries.length === 0) {
    await interaction.editReply(formatWarlogNoDataMessage(outputContext));
    return;
  }

  await interaction.editReply({
    embeds: [buildWarlogEmbed(entries, outputContext, user ?? undefined)],
  });
}

function findLatestFetchedAt(snapshots: readonly WarlogRetainedWarSnapshot[]): Date | null {
  let latest: Date | null = null;
  for (const snapshot of snapshots) {
    if (!latest || snapshot.fetchedAt > latest) latest = snapshot.fetchedAt;
  }
  return latest;
}

function findLatestEndedAt(entries: readonly WarlogEntry[]): Date | null {
  let latest: Date | null = null;
  for (const entry of entries) {
    const endedAt = parseWarDate(entry.war.endTime) ?? entry.snapshot.fetchedAt;
    if (!latest || endedAt > latest) latest = endedAt;
  }
  return latest;
}

function formatWarlogNoDataMessage(context: WarlogOutputContext): string {
  const lines = [
    context.retainedSnapshotsScanned > 0
      ? 'No retained ended-war snapshots matched the accepted filter context.'
      : 'No retained ended-war snapshots are available for the accepted filter context yet.',
    formatWarlogContextLine(context),
    formatWarlogSourceLine(),
    formatWarlogPollingPrerequisiteLine(context),
  ];

  if (context.clan) {
    lines.push(`Clan filter accepted: ${formatTrackedClan(context.clan)}.`);
  }
  if (context.user) {
    lines.push(`User filter accepted: ${context.user.displayName} (${context.user.id}).`);
  }
  lines.push(
    'Guidance: no live fallback, no historical backfill, and no CWL/export-only coverage.',
  );
  return lines.join('\n');
}

function resolveWarlogClan(
  clanOption: string,
  clans: readonly WarlogTrackedClan[],
): WarlogTrackedClan | null {
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

function formatWarlogSourceLine(): string {
  return [
    'Source: persisted retained ended-war snapshots for linked clans only.',
    '`/warlog` does not call live war log fallback, backfill old/untracked wars, or read CWL/export-only data.',
  ].join(' ');
}

function formatWarlogPollingPrerequisiteLine(context: WarlogOutputContext): string {
  if (context.linkedClanCount === 0) {
    return 'Action needed: link or configure at least one clan in this server so the war poller can retain ended-war snapshots.';
  }

  if (context.retainedSnapshotsScanned === 0) {
    return 'Action needed: confirm the linked clan coverage has war polling enabled and wait for the war poller to observe completed regular wars.';
  }

  if (context.visibleEntries === 0) {
    return 'Action needed: broaden the linked clan/user filters or wait for a retained ended-war snapshot containing the linked player tags.';
  }

  return 'Polling prerequisite: entries appear after linked clans have completed regular wars retained by the war poller.';
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
    readonly endTime?: unknown;
  };
  const clan = readWarClan(record.clan);
  const opponent = readWarClan(record.opponent);
  if (!clan || !opponent) return null;

  const state = readNonBlankString(record.state);
  const teamSize = readFiniteNumber(record.teamSize);
  const attacksPerMember = readFiniteNumber(record.attacksPerMember);
  const endTime = readNonBlankString(record.endTime);

  return {
    ...(state ? { state } : {}),
    clan,
    opponent,
    ...(teamSize !== null ? { teamSize } : {}),
    ...(attacksPerMember !== null ? { attacksPerMember } : {}),
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
  const members = readWarMembers(record.members);

  return {
    ...(tag ? { tag } : {}),
    ...(name ? { name } : {}),
    ...(stars !== null ? { stars } : {}),
    ...(destructionPercentage !== null ? { destructionPercentage } : {}),
    ...(attacks !== null ? { attacks } : {}),
    ...(badgeUrls ? { badgeUrls } : {}),
    ...(members.length > 0 ? { members } : {}),
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
  const urls = {
    ...(small ? { small } : {}),
    ...(medium ? { medium } : {}),
    ...(large ? { large } : {}),
  };
  return small || medium || large ? urls : null;
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

export function buildWarlogEmbed(
  entries: readonly WarlogEntry[],
  context: WarlogOutputContext,
  user?: { id: string; displayName: string; displayAvatarURL: () => string },
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('Retained War Log')
    .setDescription(
      [
        formatWarlogContextLine(context),
        formatWarlogSourceLine(),
        formatWarlogPollingPrerequisiteLine(context),
      ].join('\n'),
    );
  if (user)
    embed.setAuthor({ name: `${user.displayName} (${user.id})`, iconURL: user.displayAvatarURL() });

  for (const entry of entries) {
    const trackedTag = entry.snapshot.trackedClan.clanTag;
    const clan = choosePerspectiveClan(entry.war, trackedTag);
    const opponent = clan === entry.war.clan ? entry.war.opponent : entry.war.clan;
    const endedAt = parseWarDate(entry.war.endTime) ?? entry.snapshot.fetchedAt;
    embed.addFields({
      name: `${formatResult(clan, opponent)} ${opponent?.name ?? 'Unknown Clan'} (${opponent?.tag ?? 'unknown'})`,
      value: [
        `Clan: ${clan?.name ?? entry.snapshot.trackedClan.name ?? trackedTag} (${clan?.tag ?? trackedTag})`,
        `Stars: ${formatNumber(clan?.stars)} / ${formatNumber(opponent?.stars)} · Destruction: ${formatPercent(clan?.destructionPercentage)} / ${formatPercent(opponent?.destructionPercentage)}`,
        `Team: ${formatNumber(entry.war.teamSize)} · Attacks: ${formatNumber(clan?.attacks)} / ${formatTotalAttacks(entry.war)}`,
        `Ended: ${time(endedAt, 'R')} · retained snapshot war_id: \`${entry.snapshot.warKey}\``,
      ].join('\n'),
      inline: false,
    });
  }

  return embed;
}

function formatWarlogContextLine(context: WarlogOutputContext): string {
  const filters = [
    context.clan ? `clan ${formatTrackedClan(context.clan)}` : null,
    context.user
      ? `user ${context.user.displayName} (${context.user.id}; ${context.user.linkedPlayerTagCount} linked player tag${context.user.linkedPlayerTagCount === 1 ? '' : 's'})`
      : null,
  ].filter((value): value is string => Boolean(value));
  const latest = context.latestFetchedAt ? time(context.latestFetchedAt, 'R') : 'none';
  const latestEnded = context.latestEndedAt ? time(context.latestEndedAt, 'R') : 'none';

  return `Coverage: considered ${formatLinkedClanCoverageFromContext(context)}; retained snapshots scanned ${context.retainedSnapshotsScanned}; showing ${context.visibleEntries}/${context.displayLimit} rows; latest retained war ended ${latestEnded}; latest retained snapshot fetched ${latest}; filters ${filters.length > 0 ? filters.join(', ') : 'none'}.`;
}

function formatLinkedClanCoverageFromClans(clans: readonly WarlogTrackedClan[]): string {
  return formatLinkedClanCoverage(clans.length, clans.map(formatTrackedClan));
}

function formatLinkedClanCoverageFromContext(
  context: Pick<WarlogOutputContext, 'linkedClanCount' | 'linkedClanLabels'>,
): string {
  return formatLinkedClanCoverage(context.linkedClanCount, context.linkedClanLabels);
}

function formatLinkedClanCoverage(linkedClanCount: number, labels: readonly string[]): string {
  const noun = `linked clan${linkedClanCount === 1 ? '' : 's'}`;
  if (labels.length === 0) return `0 ${noun}`;

  const visibleLabels = labels.slice(0, 3).join(', ');
  const remaining = labels.length - 3;
  return `${linkedClanCount} ${noun} (${visibleLabels}${remaining > 0 ? `, +${remaining} more` : ''})`;
}

function formatTrackedClan(clan: WarlogTrackedClan): string {
  const label = clan.name ?? clan.alias ?? clan.clanTag;
  return `${label} (${clan.clanTag})`;
}

function choosePerspectiveClan(war: WarData, clanTag: string): WarClan | undefined {
  const normalized = clanTag.trim().toUpperCase();
  if (war.clan?.tag?.trim().toUpperCase() === normalized) return war.clan;
  if (war.opponent?.tag?.trim().toUpperCase() === normalized) return war.opponent;
  return war.clan;
}

function formatResult(clan: WarClan | undefined, opponent: WarClan | undefined): string {
  if (typeof clan?.stars !== 'number' || typeof opponent?.stars !== 'number') return 'Unknown';
  const clanDestruction = clan.destructionPercentage ?? 0;
  const opponentDestruction = opponent.destructionPercentage ?? 0;
  if (
    clan.stars > opponent.stars ||
    (clan.stars === opponent.stars && clanDestruction > opponentDestruction)
  )
    return 'Win';
  if (
    clan.stars < opponent.stars ||
    (clan.stars === opponent.stars && clanDestruction < opponentDestruction)
  )
    return 'Loss';
  return 'Tie';
}

function formatNumber(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '?';
}

function formatPercent(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '?';
}

function formatTotalAttacks(war: WarData): string {
  if (typeof war.teamSize !== 'number') return '?';
  const attacksPerMember = typeof war.attacksPerMember === 'number' ? war.attacksPerMember : 2;
  return String(war.teamSize * attacksPerMember);
}

function parseWarDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
