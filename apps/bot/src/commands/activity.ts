import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  time,
} from 'discord.js';

export const ACTIVITY_COMMAND_NAME = 'activity';
export const ACTIVITY_COMMAND_DESCRIPTION = 'Show active members from tracked clan snapshots.';
export const ACTIVITY_NO_SNAPSHOT_MESSAGE =
  'No activity snapshot is available yet. Link/configure a clan and wait for clan polling to observe members.';

const ACTIVITY_DAYS = [1, 3, 7, 15, 30] as const;
export type ActivityDays = (typeof ACTIVITY_DAYS)[number];
const DEFAULT_ACTIVITY_DAYS: ActivityDays = 1;
const DEFAULT_ACTIVITY_LIMIT = 10;
const MAX_ACTIVITY_LIMIT = 20;
const EMBED_DESCRIPTION_LIMIT = 4096;

export const activityCommandData = new SlashCommandBuilder()
  .setName(ACTIVITY_COMMAND_NAME)
  .setDescription(ACTIVITY_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('clans')
      .setDescription('Linked clan tag, name, or alias.')
      .setAutocomplete(true)
      .setRequired(false),
  )
  .addIntegerOption((option) =>
    option
      .setName('days')
      .setDescription('Activity window in days.')
      .setRequired(false)
      .addChoices(
        { name: '1', value: 1 },
        { name: '3', value: 3 },
        { name: '7', value: 7 },
        { name: '15', value: 15 },
        { name: '30', value: 30 },
      ),
  )
  .addIntegerOption((option) =>
    option
      .setName('limit')
      .setDescription('Recent members to show per clan.')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(MAX_ACTIVITY_LIMIT),
  )
  .addStringOption((option) =>
    option
      .setName('timezone')
      .setDescription('IANA timezone used for display, for example Asia/Jakarta.')
      .setRequired(false),
  );

export interface ActivityLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface ActivitySnapshotRow {
  readonly playerTag: string;
  readonly name: string;
  readonly lastSeenAt: Date;
  readonly lastFetchedAt: Date;
}

export interface ActivityClanSnapshots {
  readonly clan: ActivityLinkedClan;
  readonly members: readonly ActivitySnapshotRow[];
}

export interface ActivityStore {
  readonly listLinkedClans: (guildId: string) => Promise<ActivityLinkedClan[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<ActivityClanSnapshots[]>;
}

export interface ActivityCommandOptions {
  readonly store: ActivityStore;
}

export function createActivitySlashCommand(
  options: ActivityCommandOptions,
): SlashCommandDefinition {
  return {
    name: ACTIVITY_COMMAND_NAME,
    data: activityCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== ACTIVITY_COMMAND_NAME) return;
      await executeActivity(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== ACTIVITY_COMMAND_NAME) return;
      await autocompleteActivity(interaction, options);
    },
  };
}

async function autocompleteActivity(
  interaction: AutocompleteInteraction,
  options: ActivityCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'clans') {
    await interaction.respond([]);
    return;
  }
  try {
    const clans = await options.store.listLinkedClans(interaction.guildId);
    await interaction.respond(filterActivityClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterActivityClanChoices(
  clans: readonly ActivityLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export async function executeActivity(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: ActivityCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/activity` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const timezone = interaction.options.getString('timezone')?.trim();
  if (timezone && !isValidTimeZone(timezone)) {
    await interaction.reply({
      content: 'That timezone is not a valid IANA timezone.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const days = parseActivityDays(interaction.options.getInteger('days'));
  const limit = clampActivityLimit(interaction.options.getInteger('limit'));
  const clanOption = interaction.options.getString('clans');
  const clans = await options.store.listLinkedClans(interaction.guildId);

  if (clanOption) {
    const clan = resolveActivityClan(clans, clanOption);
    if (!clan) {
      await interaction.editReply({ content: 'No linked clan was found for that clans option.' });
      return;
    }
    const snapshots = await options.store.listClanMemberSnapshotsForGuild({
      guildId: interaction.guildId,
      clanTag: clan.clanTag,
    });
    await replyWithActivity(interaction, snapshots, buildActivityOptions(days, limit, timezone));
    return;
  }

  const snapshots = await options.store.listClanMemberSnapshotsForGuild({
    guildId: interaction.guildId,
  });
  await replyWithActivity(interaction, snapshots, buildActivityOptions(days, limit, timezone));
}

async function replyWithActivity(
  interaction: ChatInputCommandInteraction,
  snapshots: readonly ActivityClanSnapshots[],
  options: BuildActivityOptions,
): Promise<void> {
  if (snapshots.length === 0 || snapshots.every((entry) => entry.members.length === 0)) {
    await interaction.editReply({ content: ACTIVITY_NO_SNAPSHOT_MESSAGE });
    return;
  }
  await interaction.editReply({ embeds: [buildActivityEmbed(snapshots, options)] });
}

interface BuildActivityOptions {
  readonly days: ActivityDays;
  readonly limit: number;
  readonly timezone?: string;
  readonly now?: Date;
}

function buildActivityOptions(
  days: ActivityDays,
  limit: number,
  timezone: string | undefined,
): BuildActivityOptions {
  return {
    days,
    limit,
    ...(timezone ? { timezone } : {}),
  };
}

export function buildActivityEmbed(
  snapshots: readonly ActivityClanSnapshots[],
  options: BuildActivityOptions,
): EmbedBuilder {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.days * 24 * 60 * 60 * 1000);
  const summaries = snapshots
    .map((snapshot) => summarizeClanActivity(snapshot, cutoff, options.limit))
    .filter((summary) => summary.totalMembers > 0)
    .sort((a, b) => b.activeMembers - a.activeMembers || a.clanName.localeCompare(b.clanName));

  const embed = new EmbedBuilder()
    .setTitle('Clan Activity')
    .setDescription(truncateEmbedDescription(formatActivityDescription(summaries)))
    .addFields({
      name: 'Snapshot source',
      value:
        'First pass uses persisted ClashMate last-seen member snapshots, not ClashPerk ClickHouse chart data or live Clash API calls.',
      inline: false,
    })
    .setFooter({
      text: `Window: ${options.days} day(s)${options.timezone ? ` · ${options.timezone}` : ''}`,
    });

  if (options.timezone) {
    embed.addFields({ name: 'Display timezone', value: options.timezone, inline: false });
  }

  return embed;
}

export function summarizeClanActivity(
  snapshot: ActivityClanSnapshots,
  cutoff: Date,
  limit: number,
): ActivityClanSummary {
  const totalMembers = snapshot.members.length;
  const activeMembers = snapshot.members.filter((member) => member.lastSeenAt >= cutoff).length;
  const clanName = snapshot.clan.alias ?? snapshot.clan.name ?? 'Linked Clan';
  return {
    clanTag: snapshot.clan.clanTag,
    clanName,
    totalMembers,
    activeMembers,
    activePercentage: totalMembers === 0 ? 0 : Math.round((activeMembers / totalMembers) * 100),
    recentMembers: [...snapshot.members]
      .sort(
        (a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime() || a.name.localeCompare(b.name),
      )
      .slice(0, limit),
  };
}

interface ActivityClanSummary {
  readonly clanTag: string;
  readonly clanName: string;
  readonly totalMembers: number;
  readonly activeMembers: number;
  readonly activePercentage: number;
  readonly recentMembers: readonly ActivitySnapshotRow[];
}

function formatActivityDescription(summaries: readonly ActivityClanSummary[]): string {
  if (summaries.length === 0)
    return 'No member activity snapshots are available for linked clans yet.';
  return summaries
    .map((summary) => {
      const recent = summary.recentMembers.length
        ? summary.recentMembers
            .map(
              (member, index) =>
                `${index + 1}. ${escapeMarkdown(member.name)} (\`${member.playerTag}\`) · last seen ${time(member.lastSeenAt, 'R')}`,
            )
            .join('\n')
        : 'No recent member rows in the stored snapshot.';
      return [
        `**${escapeMarkdown(summary.clanName)}** (${summary.clanTag})`,
        `${summary.activeMembers}/${summary.totalMembers} active · ${summary.activePercentage}% active`,
        recent,
      ].join('\n');
    })
    .join('\n\n');
}

function parseActivityDays(value: number | null): ActivityDays {
  return ACTIVITY_DAYS.includes(value as ActivityDays)
    ? (value as ActivityDays)
    : DEFAULT_ACTIVITY_DAYS;
}

function clampActivityLimit(value: number | null): number {
  if (!value) return DEFAULT_ACTIVITY_LIMIT;
  return Math.min(MAX_ACTIVITY_LIMIT, Math.max(1, value));
}

export function resolveActivityClan(
  clans: readonly ActivityLinkedClan[],
  query: string,
): ActivityLinkedClan | undefined {
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

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function clanMatchesQuery(clan: ActivityLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: ActivityLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function truncateEmbedDescription(text: string): string {
  if (text.length <= EMBED_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…`;
}
