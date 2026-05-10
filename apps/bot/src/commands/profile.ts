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

import { formatLocalDateTime } from './timezone.js';

export const PROFILE_COMMAND_NAME = 'profile';
export const PROFILE_COMMAND_DESCRIPTION = 'Show linked Clash player accounts for a Discord user.';

const EMBED_TITLE_LIMIT = 256;
const EMBED_DESCRIPTION_LIMIT = 4096;
const EMBED_FIELD_NAME_LIMIT = 256;
const EMBED_FIELD_VALUE_LIMIT = 1024;
const EMBED_MAX_FIELDS = 25;

const PROFILE_EMBED_TITLE = truncateEmbedText('ClashMate Profile', EMBED_TITLE_LIMIT, 'Profile');
const PROFILE_EMBED_DESCRIPTION = truncateEmbedText(
  'Based on ClashMate player links and profile preferences already stored for this server; linked player tags open their in-game profiles.',
  EMBED_DESCRIPTION_LIMIT,
  'Stored player links.',
);

const PROFILE_SOURCE_DETAILS = [
  'Source: saved ClashMate player links and profile preferences for this server.',
  'Live API: `/profile` does not call the Clash API; player names, Town Hall, clan, heroes, and live stats are intentionally not fetched here.',
  'Links: stored player tags link to the in-game player profile. Clan profile links only appear in commands that fetch live clan/player data.',
  'Tracking: one-off profile lookups do not enroll players or clans into polling; only linked/configured resources are tracked elsewhere.',
  'Add data: use `/link create` to add an account before it can appear in `/profile`.',
].join('\n');

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

export interface ProfileTimezonePreferenceRecord {
  readonly timezone: string;
  readonly updatedAt: string;
}

export interface ProfileTimezonePreferenceStore {
  readonly getUserTimezonePreference: (
    guildId: string,
    discordUserId: string,
  ) => Promise<ProfileTimezonePreferenceRecord | null>;
}

export interface ProfileCommandOptions {
  readonly links: ProfilePlayerLinkStore;
  readonly timezones: ProfileTimezonePreferenceStore;
}

type ProfileResolution =
  | {
      readonly status: 'user_links';
      readonly targetUser: User;
      readonly links: readonly ProfilePlayerLinkRecord[];
      readonly timezone: ProfileTimezonePreferenceRecord | null;
    }
  | {
      readonly status: 'player_link';
      readonly playerTag: string;
      readonly link: ProfilePlayerLinkRecord;
      readonly timezone: ProfileTimezonePreferenceRecord | null;
    }
  | { readonly status: 'invalid_tag' }
  | {
      readonly status: 'no_user_links';
      readonly targetUser: User;
      readonly isSelf: boolean;
      readonly timezone: ProfileTimezonePreferenceRecord | null;
    }
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
    timezones: options.timezones,
  });

  if (resolution.status === 'invalid_tag') {
    await interaction.reply({
      content:
        'That player tag is not valid. Enter a full Clash player tag such as `#2PP`, or choose one of your stored links from autocomplete.',
      ephemeral: true,
    });
    return;
  }

  if (resolution.status === 'no_user_links') {
    if (resolution.timezone) {
      await interaction.reply({ embeds: [buildProfileEmbed(resolution)] });
      return;
    }

    await interaction.reply({ content: formatNoUserLinksMessage(resolution), ephemeral: true });
    return;
  }

  if (resolution.status === 'no_player_link') {
    await interaction.reply({
      content: `No stored ClashMate player link was found for **${resolution.playerTag}**. \`/profile\` resolves the \`player\` option from saved links only and never searches the Clash API, so this is not a live API lookup or outage. Use \`/link create\` to link it first, or use a live player lookup command when you need current player/clan details.`,
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
  readonly timezones: ProfileTimezonePreferenceStore;
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
    const timezone = await input.timezones.getUserTimezonePreference(
      input.guildId,
      link.discordUserId,
    );
    return { status: 'player_link', playerTag, link, timezone };
  }

  const targetUser = input.userOption ?? input.invokingUser;
  const timezone = await input.timezones.getUserTimezonePreference(input.guildId, targetUser.id);
  const playerTags = await input.links.listPlayerTagsForUser(input.guildId, targetUser.id);
  if (playerTags.length === 0) {
    return {
      status: 'no_user_links',
      targetUser,
      isSelf: targetUser.id === input.invokingUser.id,
      timezone,
    };
  }

  const links = await input.links.listPlayerLinksByTags(playerTags);
  const orderedLinks = orderLinksByRequestedTags(playerTags, links);
  if (orderedLinks.length === 0) {
    return {
      status: 'no_user_links',
      targetUser,
      isSelf: targetUser.id === input.invokingUser.id,
      timezone,
    };
  }

  return { status: 'user_links', targetUser, links: orderedLinks, timezone };
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
  const storedOnlyNote =
    '`/profile` only reads stored ClashMate links/profile preferences for this server and never searches the Clash API, so there is no live player/clan data to show yet.';
  if (result.isSelf) {
    return `You do not have linked player accounts. ${storedOnlyNote} Use \`/link create\` first so your accounts can appear here; this one-off check will not start polling any player or clan.`;
  }
  return `**${sanitizeEmbedText(result.targetUser.displayName, 'This user')}** does not have linked player accounts. ${storedOnlyNote} Ask them to use \`/link create\` to add one; this one-off check will not start polling any player or clan.`;
}

export function buildProfileEmbed(
  resolution: Extract<
    ProfileResolution,
    { status: 'user_links' | 'player_link' | 'no_user_links' }
  >,
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(PROFILE_EMBED_TITLE);

  if (resolution.status === 'player_link') {
    embed.setDescription(PROFILE_EMBED_DESCRIPTION).addFields(
      buildProfileSourceField('player'),
      buildProfileSummaryField({ links: [resolution.link], timezone: resolution.timezone }),
      {
        name: formatEmbedFieldName('Discord User'),
        value: truncateEmbedText(
          `<@${resolution.link.discordUserId}>\nID: \`${sanitizeEmbedText(resolution.link.discordUserId, 'Unknown')}\``,
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
      {
        name: formatEmbedFieldName('Link Status'),
        value: truncateEmbedText(
          formatLinkStatus(resolution.link),
          EMBED_FIELD_VALUE_LIMIT,
          'Not verified, not default',
        ),
        inline: true,
      },
    );
    const timezoneField = buildTimezoneField(resolution.timezone);
    if (timezoneField) embed.addFields(timezoneField);
    return embed;
  }

  const accountFields = buildLinkedAccountFields(
    resolution.status === 'user_links' ? resolution.links : [],
  );

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
      buildProfileSourceField('user'),
      {
        name: formatEmbedFieldName('Discord User'),
        value: truncateEmbedText(
          `<@${resolution.targetUser.id}>`,
          EMBED_FIELD_VALUE_LIMIT,
          'Unknown',
        ),
        inline: false,
      },
      buildProfileSummaryField({
        links: resolution.status === 'user_links' ? resolution.links : [],
        timezone: resolution.timezone,
      }),
      ...buildOptionalTimezoneFields(resolution.timezone),
      ...accountFields,
    );

  return embed;
}

function buildProfileSourceField(target: 'user' | 'player'): {
  name: string;
  value: string;
  inline: false;
} {
  const targetDetails =
    target === 'player'
      ? 'Target: the `player` option is normalized as a Clash tag, then matched to an existing stored link. The `user` option is not used when `player` is provided.'
      : 'Target: the `user` option selects a Discord member; without it, `/profile` shows your own saved profile data.';

  return {
    name: formatEmbedFieldName('Source and Coverage'),
    value: truncateEmbedText(
      `${targetDetails}\n${PROFILE_SOURCE_DETAILS}`,
      EMBED_FIELD_VALUE_LIMIT,
      'Stored ClashMate profile data only.',
    ),
    inline: false,
  };
}

function buildProfileSummaryField(input: {
  readonly links: readonly ProfilePlayerLinkRecord[];
  readonly timezone: ProfileTimezonePreferenceRecord | null;
}): { name: string; value: string; inline: false } {
  const verifiedCount = input.links.filter((link) => link.isVerified).length;
  const hasDefault = input.links.some((link) => link.isDefault);
  const rows = [
    `Linked accounts: **${input.links.length}**`,
    `Verified: **${verifiedCount}**`,
    `Default account: **${hasDefault ? 'yes' : 'no'}**`,
    `Timezone: **${input.timezone ? 'saved' : 'not saved'}**`,
  ];

  return {
    name: formatEmbedFieldName('Stored Link Summary'),
    value: truncateEmbedText(rows.join(' • '), EMBED_FIELD_VALUE_LIMIT, 'No stored profile data.'),
    inline: false,
  };
}

function buildOptionalTimezoneFields(
  timezone: ProfileTimezonePreferenceRecord | null,
): Array<{ name: string; value: string; inline: false }> {
  const field = buildTimezoneField(timezone);
  return field ? [field] : [];
}

function buildTimezoneField(
  timezone: ProfileTimezonePreferenceRecord | null,
): { name: string; value: string; inline: false } | null {
  if (!timezone) return null;
  const rows = [
    `Timezone: \`${sanitizeEmbedText(timezone.timezone, 'Unknown')}\``,
    `Current local time: ${sanitizeEmbedText(formatLocalDateTime(timezone.timezone), 'Unknown')}`,
    `Saved: ${formatSavedTimestamp(timezone.updatedAt)}`,
  ];
  return {
    name: formatEmbedFieldName('Timezone Preference'),
    value: truncateEmbedText(rows.join('\n'), EMBED_FIELD_VALUE_LIMIT, 'Timezone saved.'),
    inline: false,
  };
}

function formatSavedTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return sanitizeEmbedText(value, 'Unknown');
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

function formatLinkedPlayerTag(link: ProfilePlayerLinkRecord): string {
  const markers = [link.isVerified ? 'verified' : null, link.isDefault ? 'default' : null]
    .filter((marker): marker is string => Boolean(marker))
    .join(', ');
  const markerText = markers ? ` (${markers})` : '';
  const tag = sanitizeEmbedText(link.playerTag, 'Unknown Tag');
  return `**[${tag}](${formatPlayerProfileUrl(link.playerTag)})**${markerText}`;
}

function formatPlayerProfileUrl(playerTag: string): string {
  return `https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${encodeURIComponent(
    playerTag,
  )}`;
}

function formatLinkStatus(link: ProfilePlayerLinkRecord): string {
  return [
    `Verified: **${link.isVerified ? 'yes' : 'no'}**`,
    `Default: **${link.isDefault ? 'yes' : 'no'}**`,
  ].join('\n');
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
