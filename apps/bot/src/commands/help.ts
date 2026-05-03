import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import {
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';

export const HELP_COMMAND_NAME = 'help';
export const HELP_COMMAND_DESCRIPTION = 'Show ClashMate help.';
export const DEFAULT_HELP_EMBED_COLOR = 0x5865f2;

export const helpCommandData = new SlashCommandBuilder()
  .setName(HELP_COMMAND_NAME)
  .setDescription(HELP_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('command')
      .setDescription('Show help for a specific command.')
      .setRequired(false),
  );

export type HelpCategory = 'Player & Clan' | 'Setup & Logs' | 'Utility' | 'Owner';

export interface HelpCatalogEntry {
  name: string;
  usage: string;
  description: string;
  category: HelpCategory;
  details: readonly string[];
}

export interface HelpView {
  botName: string;
  botAvatarUrl?: string;
  color?: ColorResolvable;
}

export const HELP_CATALOG: readonly HelpCatalogEntry[] = [
  {
    name: 'activity',
    usage: '/activity [clans] [days] [limit] [timezone]',
    description: 'Show active members from tracked clan snapshots.',
    category: 'Player & Clan',
    details: [
      'Reads persisted last-seen member snapshots for linked clans without querying the Clash API.',
      'First pass returns an embed summary instead of ClashPerk image charts.',
    ],
  },
  {
    name: 'army',
    usage: '/army link:<copy army link> [army_name] [tips]',
    description: 'Share a Clash of Clans army copy link.',
    category: 'Player & Clan',
    details: [
      'Parses public Clash of Clans Copy Army links and summarizes IDs and counts.',
      'Does not track players, clans, or armies after the command response.',
    ],
  },
  {
    name: 'player',
    usage: '/player tag:<tag> or user:<user>',
    description: 'Look up a Clash of Clans player or linked Discord user.',
    category: 'Player & Clan',
    details: [
      'Shows a compact player profile from the Clash API.',
      'Use linked accounts with the `user` option.',
    ],
  },
  {
    name: 'clan',
    usage: '/clan tag:<tag>',
    description: 'View a Clash of Clans clan profile.',
    category: 'Player & Clan',
    details: ['Performs a one-off public Clash API lookup without tracking the clan.'],
  },
  {
    name: 'clans',
    usage: '/clans [category]',
    description: 'List ClashMate clans linked to this server.',
    category: 'Player & Clan',
    details: ['Filter by configured category when your server tracks multiple clan groups.'],
  },
  {
    name: 'search',
    usage: '/search [name]',
    description: 'Search for Clash of Clans clans by name.',
    category: 'Player & Clan',
    details: ['Performs a one-off public Clash API search without tracking returned clans.'],
  },
  {
    name: 'boosts',
    usage: '/boosts [clan]',
    description: 'Show currently boosted Super Troops for a linked clan.',
    category: 'Player & Clan',
    details: [
      'Uses linked-clan member snapshots and one-off player lookups through the ClashMate Clash API client.',
      'Does not enroll players or clans into additional polling.',
    ],
  },
  {
    name: 'compo',
    usage: '/compo [clan] [user]',
    description: 'Show town hall composition for a linked clan.',
    category: 'Player & Clan',
    details: [
      'Uses a one-off Clash API clan lookup for a server-linked clan.',
      'The `user` option is accepted for parity but first-pass clan resolution uses the explicit clan or first linked clan.',
      'Shows a no-data message if the Clash API response does not include member town hall levels.',
    ],
  },
  {
    name: 'clan-games',
    usage: '/clan-games [clan] [season]',
    description: 'Show Clan Games progress for a linked clan.',
    category: 'Player & Clan',
    details: ['Uses tracked Clan Games data collected for configured clans.'],
  },
  {
    name: 'remaining',
    usage: '/remaining [clan] [player] [user]',
    description: 'Show remaining war attacks from tracked war data.',
    category: 'Player & Clan',
    details: ['Works with linked clans and player links where available.'],
  },
  {
    name: 'war',
    usage: '/war [clan] [user] [war_id]',
    description: 'Show current or historical war status for a linked clan.',
    category: 'Player & Clan',
    details: [
      'Reads current and retained war snapshots for linked clans without querying the Clash API.',
    ],
  },
  {
    name: 'warlog',
    usage: '/warlog [clan] [user]',
    description: 'Show recent wars from tracked war history.',
    category: 'Player & Clan',
    details: [
      'Reads retained completed-war snapshots for linked clans without querying the Clash API.',
    ],
  },
  {
    name: 'lastseen',
    usage: '/lastseen [player] [user]',
    description: 'Show when linked players were last seen in tracked clans.',
    category: 'Player & Clan',
    details: ['Reads existing linked-clan polling snapshots without querying the Clash API.'],
  },
  {
    name: 'members',
    usage: '/members [clan] [user] [option]',
    description: 'Show tracked clan members from polling snapshots.',
    category: 'Player & Clan',
    details: [
      'Reads stored clan member snapshots for linked clans without querying the Clash API.',
    ],
  },
  {
    name: 'donations',
    usage: '/donations [clan] [user] [sort]',
    description: 'Show donation totals from tracked clan snapshots.',
    category: 'Player & Clan',
    details: [
      'Reads stored donation counters for linked clans without querying the Clash API.',
      'Sort by donated, received, difference, or ratio.',
    ],
  },
  {
    name: 'history',
    usage: '/history option:donations|war-attacks|join-leave|clan-games [clans] [player] [user]',
    description:
      'Show tracked historical donation, war attack, join/leave, or Clan Games activity.',
    category: 'Player & Clan',
    details: [
      'Reads persisted donation delta, war attack, clan member join/leave, and Clan Games snapshot history for linked clans without querying the Clash API.',
      'Only donation, war attack, join/leave, and Clan Games history are available right now.',
    ],
  },
  {
    name: 'profile',
    usage: '/profile [user] [player]',
    description: 'Show linked Clash player accounts for a Discord user.',
    category: 'Player & Clan',
    details: ['Reads existing ClashMate player links without querying the Clash API.'],
  },
  {
    name: 'units',
    usage: '/units [player] [user]',
    description: 'Show current unit levels for a Clash of Clans player.',
    category: 'Player & Clan',
    details: ['Performs a one-off public Clash API lookup and groups API-provided unit levels.'],
  },
  {
    name: 'upgrades',
    usage: '/upgrades [player] [user]',
    description: 'Show remaining player unit upgrades from public Clash API maxLevel data.',
    category: 'Player & Clan',
    details: [
      'Performs a one-off player lookup without tracking the player.',
      'First pass uses public API maxLevel values instead of static town-hall max tables.',
    ],
  },
  {
    name: 'rushed',
    usage: '/rushed [player] [user]',
    description:
      'Show likely rushed or incomplete player units from public Clash API maxLevel data.',
    category: 'Player & Clan',
    details: [
      'Performs a one-off player lookup without tracking the player.',
      'First pass supports player/user mode only; clan mode is not included yet.',
      'Uses public API maxLevel values instead of ClashPerk static previous-town-hall max tables.',
    ],
  },
  {
    name: 'link',
    usage: '/link create|list|delete',
    description: 'Manage Discord user links to Clash player or clan tags.',
    category: 'Setup & Logs',
    details: ['Create player links, list linked accounts, or remove stale links.'],
  },
  {
    name: 'verify',
    usage: '/verify player:<tag> token:<api token>',
    description: 'Verify ownership of a Clash account token.',
    category: 'Setup & Logs',
    details: ['Uses your Clash API token to confirm account ownership.'],
  },
  {
    name: 'setup',
    usage: '/setup clan ... or /setup clan-logs ...',
    description: 'Configure linked clans and clan log channels.',
    category: 'Setup & Logs',
    details: ['Server setup command for clan tracking and log notifications.'],
  },
  {
    name: 'help',
    usage: '/help [command]',
    description: 'Show ClashMate help.',
    category: 'Utility',
    details: ['Use `/help command:<name>` for command details.'],
  },
  {
    name: 'invite',
    usage: '/invite',
    description: 'Get an invite link for ClashMate.',
    category: 'Utility',
    details: ['Shows the bot invite, source, and support links.'],
  },
  {
    name: 'debug',
    usage: '/debug',
    description: 'Show bot diagnostics for this server.',
    category: 'Utility',
    details: ['Displays ClashMate configuration diagnostics for troubleshooting.'],
  },
  {
    name: 'timezone',
    usage: '/timezone location:<IANA timezone identifier>',
    description: 'Show the current time for an IANA timezone.',
    category: 'Utility',
    details: [
      'Accepts IANA timezone identifiers such as UTC, America/New_York, or Asia/Jakarta.',
      'First pass does not persist preferences or geocode free-form city names.',
    ],
  },
  {
    name: 'status',
    usage: '/status',
    description: 'Show owner-only runtime and bot status metrics.',
    category: 'Owner',
    details: ['Bot owner command for operational status.'],
  },
  {
    name: 'usage',
    usage: '/usage [chart] [limit]',
    description: 'Show owner-only command usage metrics.',
    category: 'Owner',
    details: ['Bot owner command for usage and growth metrics.'],
  },
  {
    name: 'blacklist',
    usage: '/blacklist',
    description: 'Manage global user access blocks.',
    category: 'Owner',
    details: ['Bot owner command for blocking or unblocking users.'],
  },
  {
    name: 'guild-ban',
    usage: '/guild-ban',
    description: 'Manage global server access blocks.',
    category: 'Owner',
    details: ['Bot owner command for blocking or unblocking servers.'],
  },
];

const CATEGORY_ORDER: readonly HelpCategory[] = [
  'Player & Clan',
  'Setup & Logs',
  'Utility',
  'Owner',
];

export function createHelpSlashCommand(): SlashCommandDefinition {
  return {
    name: HELP_COMMAND_NAME,
    data: helpCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      await executeHelpInteraction(interaction, context);
    },
  };
}

export async function executeHelpInteraction(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  const commandName = interaction.options.getString('command')?.trim();
  const view = collectHelpView(interaction, context);
  const entry = commandName ? findHelpCatalogEntry(commandName) : undefined;

  if (commandName && !entry) {
    await interaction.reply({ content: formatUnknownHelpCommand(commandName), ephemeral: true });
    return;
  }

  await interaction.reply({
    embeds: [entry ? buildHelpCommandEmbed(view, entry) : buildHelpOverviewEmbed(view)],
    ephemeral: false,
  });
}

export function collectHelpView(
  source: Pick<ChatInputCommandInteraction, 'guild'>,
  context: CommandContext,
): HelpView {
  const botAvatarUrl = context.client.user?.displayAvatarURL({ extension: 'png' });

  return {
    botName: context.client.user?.displayName ?? context.client.user?.username ?? 'ClashMate',
    ...(botAvatarUrl ? { botAvatarUrl } : {}),
    color: source.guild?.members.me?.displayColor || DEFAULT_HELP_EMBED_COLOR,
  };
}

export function buildHelpOverviewEmbed(view: HelpView): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(view.color ?? DEFAULT_HELP_EMBED_COLOR)
    .setTitle('ClashMate Help')
    .setDescription('Use `/help command:<name>` for command details.')
    .setAuthor(
      view.botAvatarUrl
        ? { name: view.botName, iconURL: view.botAvatarUrl }
        : { name: view.botName },
    );

  for (const category of CATEGORY_ORDER) {
    const commands = HELP_CATALOG.filter((entry) => entry.category === category);
    embed.addFields({
      name: category,
      value: commands.map((entry) => `\`/${entry.name}\` — ${entry.description}`).join('\n'),
      inline: false,
    });
  }

  return embed;
}

export function buildHelpCommandEmbed(view: HelpView, entry: HelpCatalogEntry): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(view.color ?? DEFAULT_HELP_EMBED_COLOR)
    .setTitle(`/${entry.name}`)
    .setDescription(entry.description)
    .setAuthor(
      view.botAvatarUrl
        ? { name: view.botName, iconURL: view.botAvatarUrl }
        : { name: view.botName },
    )
    .addFields(
      { name: 'Usage', value: entry.usage, inline: false },
      { name: 'Category', value: entry.category, inline: false },
      { name: 'Details', value: entry.details.join('\n'), inline: false },
    );
}

export function findHelpCatalogEntry(commandName: string): HelpCatalogEntry | undefined {
  const normalized = commandName.trim().toLowerCase().replace(/^\//, '');
  return HELP_CATALOG.find((entry) => entry.name === normalized);
}

export function formatUnknownHelpCommand(commandName: string): string {
  return `I do not have help for \`${commandName}\`. Use \`/help\` to see available ClashMate commands.`;
}
