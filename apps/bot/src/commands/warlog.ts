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
  const clans = await options.store.listLinkedClans(interaction.guildId);
  await interaction.respond(filterWarlogClanChoices(clans, String(focused.value ?? '')));
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
      name: `${clan.name ?? clan.clanTag} (${clan.clanTag})`,
      value: clan.clanTag,
    }));
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
  const clan = clanOption
    ? await resolveWarlogClan(interaction.guildId, clanOption, options.store)
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

  const snapshots = await options.store.listRetainedEndedWarSnapshotsForGuild({
    guildId: interaction.guildId,
    ...(clan ? { clanTag: clan.clanTag } : {}),
    limit: user ? 50 : WARLOG_LIMIT,
  });
  const entries = snapshots
    .map((snapshot) => ({ snapshot, war: extractWarData(snapshot.snapshot) }))
    .filter((entry): entry is WarlogEntry => Boolean(entry.war))
    .filter((entry) => playerTags.length === 0 || warIncludesPlayer(entry.war, playerTags))
    .slice(0, WARLOG_LIMIT);

  if (entries.length === 0) {
    await interaction.editReply(
      'No retained war log is available yet. Link/configure a clan and wait for completed wars to be polled.',
    );
    return;
  }

  await interaction.editReply({ embeds: [buildWarlogEmbed(entries, user ?? undefined)] });
}

async function resolveWarlogClan(
  guildId: string,
  clanOption: string,
  store: WarlogStore,
): Promise<WarlogTrackedClan | null> {
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
  user?: { id: string; displayName: string; displayAvatarURL: () => string },
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle('Retained War Log');
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
        `Ended: ${time(endedAt, 'R')} · war_id: \`${entry.snapshot.warKey}\``,
      ].join('\n'),
      inline: false,
    });
  }

  return embed;
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
