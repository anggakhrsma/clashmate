import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  type User,
} from 'discord.js';

export const PROFILE_COMMAND_NAME = 'profile';
export const PROFILE_COMMAND_DESCRIPTION = 'Show linked Clash player accounts for a Discord user.';

const EMBED_TITLE_LIMIT = 256;
const EMBED_DESCRIPTION_LIMIT = 4096;
const EMBED_FIELD_NAME_LIMIT = 256;
const EMBED_FIELD_VALUE_LIMIT = 1024;
const EMBED_MAX_FIELDS = 25;

const PROFILE_EMBED_TITLE = truncateEmbedText('ClashMate Profile', EMBED_TITLE_LIMIT, 'Profile');
const PROFILE_EMBED_DESCRIPTION = truncateEmbedText(
  'Based on ClashMate player links already stored for this bot.',
  EMBED_DESCRIPTION_LIMIT,
  'Stored player links.',
);

export const profileCommandData = new SlashCommandBuilder()
  .setName(PROFILE_COMMAND_NAME)
  .setDescription(PROFILE_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addUserOption((option) => option.setName('user').setDescription('Discord user to inspect.'))
  .addStringOption((option) =>
    option.setName('player').setDescription('Player tag to inspect.').setAutocomplete(true),
  );

export interface ProfilePlayerLinkRecord {
  readonly discordUserId: string;
  readonly playerTag: string;
  readonly isVerified: boolean;
  readonly isDefault: boolean;
}

export interface ProfilePlayerLinkStore {
  readonly listPlayerTagsForUser: (guildId: string, discordUserId: string) => Promise<string[]>;
  readonly listPlayerLinksByTags: (
    playerTags: readonly string[],
  ) => Promise<ProfilePlayerLinkRecord[]>;
}

export interface ProfileCommandOptions {
  readonly links: ProfilePlayerLinkStore;
}

type ProfileResolution =
  | {
      readonly status: 'user_links';
      readonly targetUser: User;
      readonly links: readonly ProfilePlayerLinkRecord[];
    }
  | {
      readonly status: 'player_link';
      readonly playerTag: string;
      readonly link: ProfilePlayerLinkRecord;
    }
  | { readonly status: 'invalid_tag' }
  | { readonly status: 'no_user_links'; readonly targetUser: User; readonly isSelf: boolean }
  | { readonly status: 'no_player_link'; readonly playerTag: string };

export function createProfileSlashCommand(options: ProfileCommandOptions): SlashCommandDefinition {
  return {
    name: PROFILE_COMMAND_NAME,
    data: profileCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== PROFILE_COMMAND_NAME) return;
      await executeProfile(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== PROFILE_COMMAND_NAME) return;
      await autocompleteProfile(interaction, options);
    },
  };
}

export async function autocompleteProfile(
  interaction: AutocompleteInteraction,
  options: Pick<ProfileCommandOptions, 'links'>,
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
    const tags = await options.links.listPlayerTagsForUser(
      interaction.guildId,
      interaction.user.id,
    );
    await interaction.respond(filterProfilePlayerChoices(tags, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterProfilePlayerChoices(
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

export async function executeProfile(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: ProfileCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/profile` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const resolution = await resolveProfile({
    guildId: interaction.guildId,
    invokingUser: interaction.user,
    userOption: interaction.options.getUser('user'),
    playerOption: interaction.options.getString('player'),
    links: options.links,
  });

  if (resolution.status === 'invalid_tag') {
    await interaction.reply({ content: 'That player tag is not valid.', ephemeral: true });
    return;
  }

  if (resolution.status === 'no_user_links') {
    await interaction.reply({ content: formatNoUserLinksMessage(resolution), ephemeral: true });
    return;
  }

  if (resolution.status === 'no_player_link') {
    await interaction.reply({
      content: `No ClashMate player link was found for **${resolution.playerTag}**. Use \`/link create\` to link it first.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({ embeds: [buildProfileEmbed(resolution)] });
}

async function resolveProfile(input: {
  readonly guildId: string;
  readonly invokingUser: User;
  readonly userOption: User | null;
  readonly playerOption: string | null;
  readonly links: ProfilePlayerLinkStore;
}): Promise<ProfileResolution> {
  if (input.playerOption) {
    let playerTag: string;
    try {
      playerTag = normalizeClashTag(input.playerOption);
    } catch {
      return { status: 'invalid_tag' };
    }

    const [link] = await input.links.listPlayerLinksByTags([playerTag]);
    if (!link) return { status: 'no_player_link', playerTag };
    return { status: 'player_link', playerTag, link };
  }

  const targetUser = input.userOption ?? input.invokingUser;
  const playerTags = await input.links.listPlayerTagsForUser(input.guildId, targetUser.id);
  if (playerTags.length === 0) {
    return {
      status: 'no_user_links',
      targetUser,
      isSelf: targetUser.id === input.invokingUser.id,
    };
  }

  const links = await input.links.listPlayerLinksByTags(playerTags);
  const orderedLinks = orderLinksByRequestedTags(playerTags, links);
  if (orderedLinks.length === 0) {
    return {
      status: 'no_user_links',
      targetUser,
      isSelf: targetUser.id === input.invokingUser.id,
    };
  }

  return { status: 'user_links', targetUser, links: orderedLinks };
}

function orderLinksByRequestedTags(
  playerTags: readonly string[],
  links: readonly ProfilePlayerLinkRecord[],
): ProfilePlayerLinkRecord[] {
  const byTag = new Map(links.map((link) => [link.playerTag.toUpperCase(), link]));
  return playerTags
    .map((tag) => byTag.get(tag.toUpperCase()))
    .filter((link): link is ProfilePlayerLinkRecord => Boolean(link));
}

function formatNoUserLinksMessage(
  result: Extract<ProfileResolution, { status: 'no_user_links' }>,
): string {
  if (result.isSelf) return 'You do not have linked player accounts. Use `/link create` first.';
  return `**${sanitizeEmbedText(result.targetUser.displayName, 'This user')}** does not have linked player accounts. Use \`/link create\` to add one.`;
}

export function buildProfileEmbed(
  resolution: Extract<ProfileResolution, { status: 'user_links' | 'player_link' }>,
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(PROFILE_EMBED_TITLE);

  if (resolution.status === 'player_link') {
    embed.setDescription(PROFILE_EMBED_DESCRIPTION).addFields(
      {
        name: formatEmbedFieldName('Discord User'),
        value: truncateEmbedText(
          `<@${resolution.link.discordUserId}>`,
          EMBED_FIELD_VALUE_LIMIT,
          'Unknown',
        ),
        inline: true,
      },
      {
        name: formatEmbedFieldName('Player Tag'),
        value: truncateEmbedText(
          formatLinkedPlayerTag(resolution.link),
          EMBED_FIELD_VALUE_LIMIT,
          '**Unknown Tag**',
        ),
        inline: true,
      },
    );
    return embed;
  }

  const accountFields = buildLinkedAccountFields(resolution.links);

  embed
    .setAuthor({
      name: truncateEmbedText(
        `${sanitizeEmbedText(resolution.targetUser.displayName, 'Discord User')} (${resolution.targetUser.id})`,
        EMBED_FIELD_NAME_LIMIT,
        `Discord User (${resolution.targetUser.id})`,
      ),
      iconURL: resolution.targetUser.displayAvatarURL(),
    })
    .setDescription(PROFILE_EMBED_DESCRIPTION)
    .addFields(
      {
        name: formatEmbedFieldName('Discord User'),
        value: truncateEmbedText(
          `<@${resolution.targetUser.id}>`,
          EMBED_FIELD_VALUE_LIMIT,
          'Unknown',
        ),
        inline: false,
      },
      ...accountFields,
    );

  return embed;
}

function formatLinkedPlayerTag(link: ProfilePlayerLinkRecord): string {
  const markers = [link.isVerified ? 'verified' : null, link.isDefault ? 'default' : null]
    .filter((marker): marker is string => Boolean(marker))
    .join(', ');
  const markerText = markers ? ` (${markers})` : '';
  return `**${sanitizeEmbedText(link.playerTag, 'Unknown Tag')}**${markerText}`;
}

function buildLinkedAccountFields(
  links: readonly ProfilePlayerLinkRecord[],
): Array<{ name: string; value: string; inline: false }> {
  const fields: Array<{ name: string; value: string; inline: false }> = [];
  let currentRows: string[] = [];
  let currentLength = 0;

  for (const row of links.map(formatLinkedPlayerTag)) {
    const nextLength = currentLength === 0 ? row.length : currentLength + 1 + row.length;
    if (currentRows.length > 0 && nextLength > EMBED_FIELD_VALUE_LIMIT) {
      fields.push(createLinkedAccountField(fields.length, links.length, currentRows.join('\n')));
      currentRows = [];
      currentLength = 0;
      if (fields.length >= EMBED_MAX_FIELDS - 1) break;
    }

    const safeRow = truncateEmbedText(row, EMBED_FIELD_VALUE_LIMIT, '**Unknown Tag**');
    currentRows.push(safeRow);
    currentLength = currentLength === 0 ? safeRow.length : currentLength + 1 + safeRow.length;
  }

  if (currentRows.length > 0 && fields.length < EMBED_MAX_FIELDS - 1) {
    fields.push(createLinkedAccountField(fields.length, links.length, currentRows.join('\n')));
  }

  return fields.length
    ? fields
    : [createLinkedAccountField(0, links.length, 'No linked player accounts were found.')];
}

function createLinkedAccountField(
  index: number,
  totalLinks: number,
  value: string,
): { name: string; value: string; inline: false } {
  const suffix = index === 0 ? '' : ` (${index + 1})`;
  return {
    name: formatEmbedFieldName(`Linked Player Accounts (${totalLinks})${suffix}`),
    value: truncateEmbedText(
      value,
      EMBED_FIELD_VALUE_LIMIT,
      'No linked player accounts were found.',
    ),
    inline: false,
  };
}

function formatEmbedFieldName(value: string): string {
  return truncateEmbedText(sanitizeEmbedText(value, 'Field'), EMBED_FIELD_NAME_LIMIT, 'Field');
}

function sanitizeEmbedText(value: string, fallback: string): string {
  const trimmed = value.trim();
  const safeText = trimmed.length ? trimmed : fallback;
  return escapeMarkdown(safeText).replaceAll('@', '@\u200b');
}

function truncateEmbedText(value: string, limit: number, fallback: string): string {
  const text = value.trim() || fallback;
  if (text.length <= limit) return text;
  if (limit <= 1) return text.slice(0, limit);
  return `${text.slice(0, limit - 1)}…`;
}
