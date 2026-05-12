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
  'Data: saved ClashMate player links/profile preferences for this server only.',
  'Live/current: `/profile` does not call the Clash API; use live lookup commands for current player or clan details.',
  'Tracking: this one-off lookup does not enroll players or clans into polling, and it does not link clans.',
  'Add data: use `/link create` to add player accounts before they appear here.',
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
      readonly isSelf: boolean;
      readonly targetLinkCount: number;
      readonly links: readonly ProfilePlayerLinkRecord[];
      readonly timezone: ProfileTimezonePreferenceRecord | null;
    }
  | {
      readonly status: 'player_link';
      readonly playerTag: string;
      readonly link: ProfilePlayerLinkRecord;
      readonly targetLinkCount: number;
      readonly timezone: ProfileTimezonePreferenceRecord | null;
    }
  | { readonly status: 'invalid_tag' }
  | {
      readonly status: 'no_user_links';
      readonly targetUser: User;
      readonly isSelf: boolean;
      readonly targetLinkCount: number;
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
  const normalizedQuery = normalizeAutocompleteQuery(query);
  const queryWithoutHash = stripLeadingHash(normalizedQuery);

  return dedupeProfilePlayerTags(tags)
    .filter((choice) => {
      const tagWithoutHash = stripLeadingHash(choice.normalizedTag);
      return (
        choice.normalizedTag.includes(normalizedQuery) ||
        tagWithoutHash.includes(queryWithoutHash) ||
        `#${tagWithoutHash}`.includes(normalizedQuery)
      );
    })
    .slice(0, 25)
    .map((choice) => ({ name: choice.storedTag, value: choice.storedTag }));
}

function normalizeAutocompleteQuery(query: string): string {
  return query.trim().toUpperCase();
}

function stripLeadingHash(value: string): string {
  return value.startsWith('#') ? value.slice(1) : value;
}

function dedupeProfilePlayerTags(
  tags: readonly string[],
): Array<{ readonly normalizedTag: string; readonly storedTag: string }> {
  const choices = tags.map((tag) => ({
    normalizedTag: normalizeProfileChoiceTag(tag),
    storedTag: tag,
  }));
  choices.sort((left, right) => {
    const normalizedCompare = left.normalizedTag.localeCompare(right.normalizedTag);
    if (normalizedCompare !== 0) return normalizedCompare;
    return left.storedTag.localeCompare(right.storedTag);
  });

  const uniqueChoices: Array<{ readonly normalizedTag: string; readonly storedTag: string }> = [];
  const seenTags = new Set<string>();
  for (const choice of choices) {
    if (seenTags.has(choice.normalizedTag)) continue;
    seenTags.add(choice.normalizedTag);
    uniqueChoices.push(choice);
  }

  return uniqueChoices;
}

function normalizeProfileChoiceTag(tag: string): string {
  try {
    return normalizeClashTag(tag);
  } catch {
    return tag.trim().toUpperCase().replace(/^#?/, '#');
  }
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
        'That player tag is not valid. Enter a full Clash player tag such as `#2PP`, or choose one of your stored links from autocomplete. `/profile` only checks saved links; it does not call live Clash data, start polling, or link clans.',
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
      content: formatNoPlayerLinkMessage(resolution),
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

    const matchingLinks = await input.links.listPlayerLinksByTags([playerTag]);
    const [link] = matchingLinks;
    if (!link) return { status: 'no_player_link', playerTag };
    const timezone = await input.timezones.getUserTimezonePreference(
      input.guildId,
      link.discordUserId,
    );
    return {
      status: 'player_link',
      playerTag,
      link,
      targetLinkCount: matchingLinks.length,
      timezone,
    };
  }

  const targetUser = input.userOption ?? input.invokingUser;
  const timezone = await input.timezones.getUserTimezonePreference(input.guildId, targetUser.id);
  const playerTags = await input.links.listPlayerTagsForUser(input.guildId, targetUser.id);
  if (playerTags.length === 0) {
    return {
      status: 'no_user_links',
      targetUser,
      isSelf: targetUser.id === input.invokingUser.id,
      targetLinkCount: playerTags.length,
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
      targetLinkCount: playerTags.length,
      timezone,
    };
  }

  return {
    status: 'user_links',
    targetUser,
    isSelf: targetUser.id === input.invokingUser.id,
    targetLinkCount: playerTags.length,
    links: orderedLinks,
    timezone,
  };
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
  const target = result.isSelf
    ? 'self'
    : `user ${sanitizeEmbedText(result.targetUser.displayName, 'This user')}`;
  const context = `Target: **${target}** • linked accounts: **0**.`;
  const timezoneContext = `Timezone: **${result.timezone ? 'saved' : 'not saved'}**.`;
  const storedOnlyNote =
    '`/profile` reads saved ClashMate links/profile preferences only; it is not a live Clash API lookup and does not show current player/clan data.';
  if (result.isSelf) {
    return `${context} ${timezoneContext} You do not have linked player accounts. ${storedOnlyNote} Use \`/link create\` first; this one-off check will not start polling players/clans or link clans.`;
  }
  return `${context} ${timezoneContext} That user has no linked player accounts. ${storedOnlyNote} Ask them to use \`/link create\`; this one-off check will not start polling players/clans or link clans.`;
}

function formatNoPlayerLinkMessage(
  result: Extract<ProfileResolution, { status: 'no_player_link' }>,
): string {
  return `Target: **tag ${sanitizeEmbedText(result.playerTag, 'Unknown')}** • linked accounts: **0**. No stored ClashMate player link was found. \`/profile\` matches the \`player\` option against saved links only; it is not a live Clash API lookup or outage. Use \`/link create\` to link it first, or use a live lookup command for current player/clan details. This one-off check will not start polling players/clans or link clans.`;
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
      buildProfileSourceField({
        target: 'player',
        linkedAccountCount: 1,
        targetLinkCount: resolution.targetLinkCount,
        timezoneAvailable: Boolean(resolution.timezone),
        selected: `tag ${resolution.playerTag}`,
      }),
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
      buildProfileSourceField({
        target: 'user',
        linkedAccountCount: resolution.status === 'user_links' ? resolution.links.length : 0,
        targetLinkCount: resolution.targetLinkCount,
        timezoneAvailable: Boolean(resolution.timezone),
        selected:
          resolution.status === 'user_links' && resolution.isSelf
            ? 'self'
            : `user ${resolution.targetUser.displayName}`,
      }),
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

function buildProfileSourceField(input: {
  readonly target: 'user' | 'player';
  readonly linkedAccountCount: number;
  readonly targetLinkCount: number;
  readonly timezoneAvailable: boolean;
  readonly selected: string;
}): {
  name: string;
  value: string;
  inline: false;
} {
  const targetDetails =
    input.target === 'player'
      ? 'Target source: `player` option; `user` is ignored when `player` is provided.'
      : 'Target source: `user` option, or self when omitted.';
  const selectedDetails = `Selected target: **${sanitizeEmbedText(input.selected, 'unknown')}** • matched links: **${input.linkedAccountCount}/${input.targetLinkCount}** • timezone: **${input.timezoneAvailable ? 'saved' : 'not saved'}**.`;

  return {
    name: formatEmbedFieldName('Source and Coverage'),
    value: truncateEmbedText(
      `${selectedDetails}\n${targetDetails}\n${PROFILE_SOURCE_DETAILS}`,
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
  const defaultCount = input.links.filter((link) => link.isDefault).length;
  const rows = [
    `Linked accounts: **${input.links.length}**`,
    `Verified: **${verifiedCount}**`,
    `Default accounts: **${defaultCount}**`,
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
