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
  type User,
} from 'discord.js';

export const LASTSEEN_COMMAND_NAME = 'lastseen';
export const LASTSEEN_COMMAND_DESCRIPTION =
  'Show when linked players were last seen in tracked clans.';
export const LASTSEEN_NO_DATA_MESSAGE =
  'No last-seen data is available yet. Link/configure a clan and wait for polling to observe the player.';

export const lastSeenCommandData = new SlashCommandBuilder()
  .setName(LASTSEEN_COMMAND_NAME)
  .setDescription(LASTSEEN_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('player').setDescription('Player tag to check.').setAutocomplete(true),
  )
  .addUserOption((option) =>
    option.setName('user').setDescription('Discord user whose linked players to check.'),
  );

export interface LastSeenSnapshotRecord {
  readonly playerTag: string;
  readonly playerName: string;
  readonly clanTag: string;
  readonly clanName: string | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly lastFetchedAt: Date;
}

export interface LastSeenStore {
  readonly listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
  readonly listLastSeenSnapshots: (
    guildId: string,
    playerTags: readonly string[],
  ) => Promise<LastSeenSnapshotRecord[]>;
}

export interface LastSeenCommandOptions {
  readonly store: LastSeenStore;
}

type LastSeenResolution =
  | {
      readonly status: 'resolved';
      readonly playerTags: readonly string[];
      readonly targetUser: User | null;
    }
  | { readonly status: 'invalid_tag' }
  | { readonly status: 'no_link'; readonly targetUser: User; readonly isSelf: boolean };

export function createLastSeenSlashCommand(
  options: LastSeenCommandOptions,
): SlashCommandDefinition {
  return {
    name: LASTSEEN_COMMAND_NAME,
    data: lastSeenCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== LASTSEEN_COMMAND_NAME) return;
      await executeLastSeen(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== LASTSEEN_COMMAND_NAME) return;
      await autocompleteLastSeen(interaction, options);
    },
  };
}

async function autocompleteLastSeen(
  interaction: AutocompleteInteraction,
  options: LastSeenCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'player') {
    await interaction.respond([]);
    return;
  }

  try {
    const tags = await options.store.listPlayerTagsForUser(
      interaction.guildId,
      interaction.user.id,
    );
    await interaction.respond(filterLastSeenPlayerChoices(tags, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterLastSeenPlayerChoices(
  tags: readonly string[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toUpperCase();
  const queryWithoutHash = normalizedQuery.startsWith('#')
    ? normalizedQuery.slice(1)
    : normalizedQuery;

  return tags
    .filter((tag) => {
      const normalizedTag = tag.toUpperCase();
      const tagWithoutHash = normalizedTag.startsWith('#') ? normalizedTag.slice(1) : normalizedTag;
      return (
        normalizedTag.includes(normalizedQuery) ||
        tagWithoutHash.includes(queryWithoutHash) ||
        `#${tagWithoutHash}`.includes(normalizedQuery)
      );
    })
    .slice(0, 25)
    .map((tag) => ({ name: tag, value: tag }));
}

export async function executeLastSeen(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: LastSeenCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/lastseen` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const resolution = await resolveLastSeenPlayers({
    guildId: interaction.guildId,
    invokingUser: interaction.user,
    playerOption: interaction.options.getString('player'),
    userOption: interaction.options.getUser('user'),
    store: options.store,
  });

  if (resolution.status === 'invalid_tag') {
    await interaction.reply({ content: 'That player tag is not valid.', ephemeral: true });
    return;
  }

  if (resolution.status === 'no_link') {
    await interaction.reply({
      content: formatNoLinkedLastSeenMessage(resolution),
      ephemeral: true,
    });
    return;
  }

  const snapshots = await options.store.listLastSeenSnapshots(
    interaction.guildId,
    resolution.playerTags,
  );
  const latestRows = selectLatestLastSeenRows(resolution.playerTags, snapshots);

  if (latestRows.length === 0) {
    await interaction.reply({ content: LASTSEEN_NO_DATA_MESSAGE, ephemeral: true });
    return;
  }

  await interaction.reply({ embeds: [buildLastSeenEmbed(latestRows, resolution.targetUser)] });
}

async function resolveLastSeenPlayers(input: {
  readonly guildId: string;
  readonly invokingUser: User;
  readonly playerOption: string | null;
  readonly userOption: User | null;
  readonly store: Pick<LastSeenStore, 'listPlayerTagsForUser'>;
}): Promise<LastSeenResolution> {
  if (input.playerOption) {
    try {
      return {
        status: 'resolved',
        playerTags: [normalizeClashTag(input.playerOption)],
        targetUser: input.userOption,
      };
    } catch {
      return { status: 'invalid_tag' };
    }
  }

  const targetUser = input.userOption ?? input.invokingUser;
  const playerTags = await input.store.listPlayerTagsForUser(input.guildId, targetUser.id);
  if (playerTags.length === 0) {
    return { status: 'no_link', targetUser, isSelf: targetUser.id === input.invokingUser.id };
  }

  return { status: 'resolved', playerTags, targetUser };
}

function formatNoLinkedLastSeenMessage(
  result: Extract<LastSeenResolution, { status: 'no_link' }>,
): string {
  if (result.isSelf) return 'You do not have linked player accounts. Use `/link create` first.';
  return `**${escapeMarkdown(result.targetUser.displayName)}** does not have linked player accounts.`;
}

export function selectLatestLastSeenRows(
  requestedTags: readonly string[],
  snapshots: readonly LastSeenSnapshotRecord[],
): LastSeenSnapshotRecord[] {
  const byTag = new Map<string, LastSeenSnapshotRecord>();
  for (const snapshot of snapshots) {
    const tag = snapshot.playerTag.trim().toUpperCase();
    const current = byTag.get(tag);
    if (!current || compareLastSeen(snapshot, current) > 0) byTag.set(tag, snapshot);
  }

  return requestedTags
    .map((tag) => byTag.get(tag.trim().toUpperCase()))
    .filter((row): row is LastSeenSnapshotRecord => Boolean(row));
}

function compareLastSeen(left: LastSeenSnapshotRecord, right: LastSeenSnapshotRecord): number {
  const lastSeenDiff = left.lastSeenAt.getTime() - right.lastSeenAt.getTime();
  if (lastSeenDiff !== 0) return lastSeenDiff;
  return left.lastFetchedAt.getTime() - right.lastFetchedAt.getTime();
}

export function buildLastSeenEmbed(
  rows: readonly LastSeenSnapshotRecord[],
  targetUser: User | null,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('Last Seen')
    .setDescription('Based on linked-clan polling snapshots already stored by ClashMate.');

  if (targetUser) {
    embed.setAuthor({ name: targetUser.displayName, iconURL: targetUser.displayAvatarURL() });
  }

  embed.addFields(
    rows.slice(0, 25).map((row) => ({
      name: `${escapeMarkdown(row.playerName)} (${row.playerTag})`,
      value: [
        `**Clan:** ${escapeMarkdown(row.clanName ?? 'Unknown Clan')} (${row.clanTag})`,
        `**First seen:** ${time(row.firstSeenAt, 'F')}`,
        `**Last seen:** ${time(row.lastSeenAt, 'R')}`,
        `**Last observed:** ${time(row.lastFetchedAt, 'R')}`,
      ].join('\n'),
      inline: false,
    })),
  );

  return embed;
}
