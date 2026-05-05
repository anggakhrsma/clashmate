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
    name: 'alias',
    usage: '/alias create|list|delete',
    description: 'Manage aliases for linked clans on this server.',
    category: 'Setup & Logs',
    details: [
      'Create, list, or delete aliases stored on linked clan records.',
      'Requires Manage Server permission.',
    ],
  },
  {
    name: 'army',
    usage: '/army link:<copy army link> [army_name] [tips]',
    description: 'Share a Clash of Clans army copy link.',
    category: 'Player & Clan',
    details: [
      'Parses public Clash of Clans Copy Army links and summarizes troop, spell, and siege counts.',
      'Does not track players, clans, or armies after the command response.',
    ],
  },
  {
    name: 'attacks',
    usage: '/attacks [clan] [user] [season]',
    description: 'Show attack and defense wins for a linked clan.',
    category: 'Player & Clan',
    details: [
      'Uses a one-off Clash API clan lookup, then one-off player lookups for up to 50 current clan members.',
      "When `clan` is omitted, `user` can select a linked clan that contains one of that user's linked player tags.",
      'The `season` option is accepted for parity, but output shows current public API attack/defense wins only.',
    ],
  },
  {
    name: 'autorole',
    usage: '/autorole clan-roles|town-hall|leagues|family|list|disable|refresh|config',
    description: 'Store first-pass autorole mappings and flags for this server.',
    category: 'Setup & Logs',
    details: [
      'Requires Manage Server permission or a configured bot manager role for configuration changes.',
      'Stores role IDs and behavior flags in guild settings with audit logs.',
      '`/autorole refresh` returns an ephemeral dry-run preview only.',
      'Does not mutate Discord roles, refresh members, call the Clash API, or enroll polling.',
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
    name: 'capital',
    usage: '/capital raids|contribution [clan] [user] [week]',
    description: 'Show Clan Capital data from persisted snapshots.',
    category: 'Player & Clan',
    details: [
      'Reads current linked-clan and member snapshots without querying the Clash API.',
      '`/capital raids user:<user>` filters clans using linked player tags and persisted member snapshots.',
      'Raid-week attack logs are not persisted yet, so raids shows a compact capital overview/ranking.',
      'Contribution shows a no-data message until member snapshots include capital contribution fields.',
    ],
  },
  {
    name: 'caller',
    usage:
      '/caller assign defense_target:<1-50> offense_target:<1-50> [notes] [hours] or /caller clear defense_target:<1-50>',
    description: 'Manage persisted war base calls from latest stored war snapshots.',
    category: 'Player & Clan',
    details: [
      'Reads the latest persisted current-war snapshot for a linked clan and never performs a live Clash API lookup.',
      '`hours` accepts a positive runtime-bounded expiry up to 30 days and responses show expiry feedback.',
      'Stores assignments in guild settings by guild, war key, clan tag, and defensive map position.',
      'Use clear to remove a defensive target assignment.',
    ],
  },
  {
    name: 'category',
    usage: '/category create|list|edit|delete',
    description: 'Manage linked clan categories on this server.',
    category: 'Setup & Logs',
    details: [
      'Create, list, rename, or delete categories used by linked clans.',
      'Requires Manage Server permission. Reorder UI is not available in the first pass.',
    ],
  },
  {
    name: 'config',
    usage: '/config [bot_manager_role] [links_manager_role] [color_code] [webhook_limit]',
    description: 'Configure ClashMate server diagnostics and safe settings.',
    category: 'Setup & Logs',
    details: [
      'Requires Manage Server permission.',
      'Bot manager roles bypass command whitelists; links manager roles can manage player links for other users.',
      'Stores embed color and webhook limit using normal guild configuration.',
    ],
  },
  {
    name: 'whitelist',
    usage: '/whitelist [user_or_role] [command] [clear] [list]',
    description: 'Restrict slash commands to specific users or roles.',
    category: 'Setup & Logs',
    details: [
      'Requires Manage Server permission.',
      'When a command has whitelist entries, bot owners, Manage Server members, configured bot manager roles, whitelisted users, and whitelisted roles may use it.',
    ],
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
      'Uses linked-clan member snapshots and capped one-off player lookups through the ClashMate Clash API client.',
      'Reports scan coverage, skipped members, and failed lookups without enrolling additional polling.',
    ],
  },
  {
    name: 'compo',
    usage: '/compo [clan] [user]',
    description: 'Show town hall composition for a linked clan.',
    category: 'Player & Clan',
    details: [
      'Uses a one-off Clash API clan lookup for a server-linked clan.',
      'When `clan` is omitted, `user` can resolve a linked clan containing one of that user’s linked players.',
      'Shows a no-data message if the Clash API response does not include member town hall levels.',
    ],
  },
  {
    name: 'clan-games',
    usage: '/clan-games [clan] [user] [season]',
    description: 'Show Clan Games progress for a linked clan.',
    category: 'Player & Clan',
    details: [
      'Reads only persisted Clan Games snapshots collected for configured clans without querying the Clash API.',
      'No-data responses echo accepted clan, user, and season filters for troubleshooting.',
    ],
  },
  {
    name: 'cwl',
    usage: '/cwl roster|round|lineup|stars|attacks|stats|members [clan] [user] [season]',
    description: 'Show first-pass CWL views from persisted war data.',
    category: 'Player & Clan',
    details: [
      'Reads retained/current war snapshots for roster, round, lineup, and members views.',
      'Reads persisted war attack history for stars, attacks, and stats views.',
      'Does not query the Clash API; CWL-only filtering is approximate until stored events include CWL metadata.',
    ],
  },
  {
    name: 'summary',
    usage: '/summary clans|donations|activity|attacks|compo|capital-raids [clans] [week]',
    description: 'Show persisted summaries for linked clans.',
    category: 'Player & Clan',
    details: [
      'Reads existing linked clan, member, donation, war attack, and capital snapshot data without querying the Clash API.',
      'Capital raids summarizes the latest persisted capital snapshots; `week` is accepted as a display label only.',
      'First pass returns compact embeds with totals and top rows instead of image charts.',
    ],
  },
  {
    name: 'remaining',
    usage: '/remaining [clan] [player] [user]',
    description: 'Show remaining war attacks from tracked war data.',
    category: 'Player & Clan',
    details: ['Works with linked clans and player links where available.'],
  },
  {
    name: 'reminders',
    usage: '/reminders create|edit|list|delete|now|config',
    description: 'Manage reminders and send immediate snapshot-based reminder pings.',
    category: 'Setup & Logs',
    details: [
      'Create and edit validate reminder durations before storing schedules.',
      'Reminder channels are constrained to supported guild text, announcement, and thread channels.',
      'Scheduled delivery runs in the worker from persisted member snapshots; no live Clash API lookup is performed.',
      '`/reminders now` reads persisted linked-clan member snapshots and player links without calling the Clash API.',
      'Requires Manage Server permission.',
    ],
  },
  {
    name: 'lineup',
    usage: '/lineup [clan] [user]',
    description: 'Show current war lineup from tracked war snapshots.',
    category: 'Player & Clan',
    details: [
      'Reads persisted war snapshots for linked clans without querying the Clash API.',
      'Shows clan and opponent members sorted by war map position.',
    ],
  },
  {
    name: 'layout',
    usage:
      '/layout post screenshot:<image> layout_link:<link> [notes] or /layout config [allow_voting] [allow_tracking]',
    description: 'Share Clash of Clans layout screenshots and public OpenLayout links.',
    category: 'Player & Clan',
    details: [
      'Post validates public Clash of Clans OpenLayout links and image screenshots.',
      'Post shows parsed OpenLayout metadata when the link exposes it.',
      'Config requires Manage Server and persists saved voting/tracking preferences plus submission tracking when enabled.',
      'Posted layouts include an Open Layout button; vote collection is not active yet.',
      'Does not add collectors, webhooks, Clash API calls, or polling enrollment.',
    ],
  },
  {
    name: 'war',
    usage: '/war [clan] [user] [war_id]',
    description: 'Show current or historical war status for a linked clan.',
    category: 'Player & Clan',
    details: [
      'Reads current and retained war snapshots for linked clans without querying the Clash API.',
      '`war_id` autocompletes from persisted retained war snapshots when historical wars are available.',
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
    usage: '/lastseen [clan] [player] [user]',
    description: 'Show when linked players were last seen in tracked clans.',
    category: 'Player & Clan',
    details: [
      'Reads existing linked-clan polling snapshots and can filter to one linked clan without querying the Clash API.',
    ],
  },
  {
    name: 'leaderboard',
    usage: '/leaderboard clans|players|capital [location] [season]',
    description: 'Show linked-clan leaderboards from stored snapshots.',
    category: 'Player & Clan',
    details: [
      'Reads linked clan and current member snapshots without querying the Clash API.',
      'Location and season options are accepted for parity, but first-pass output uses current persisted snapshots only.',
    ],
  },
  {
    name: 'legend',
    usage: '/legend attacks|days|leaderboard|stats',
    description: 'Show persisted Legend League views for linked clans.',
    category: 'Player & Clan',
    details: [
      'Leaderboard and stats read linked-clan member snapshots without querying the Clash API.',
      '`/legend stats reference_date:<YYYY-MM-DD>` accepts and displays the date, but current persisted snapshots are still used.',
      'Attacks and days return honest no-data messages with accepted filter context until Legend attack/day data is persisted.',
      'No exports, auto-updating boards, external feeds, or polling enrollment are used.',
    ],
  },
  {
    name: 'members',
    usage: '/members [clan] [user] [option]',
    description: 'Show tracked clan members from polling snapshots.',
    category: 'Player & Clan',
    details: [
      'Reads stored clan member snapshots for linked clans without querying the Clash API.',
      'Options include overview, tags, trophies, donations, heroes, links, war preferences, join date, progress, attacks, and clan overview.',
      'Progress-style views are limited to fields present in persisted member snapshots.',
    ],
  },
  {
    name: 'donations',
    usage: '/donations [clan] [user] [sort] [season] [start_date] [end_date]',
    description: 'Show donation totals from tracked snapshots or history.',
    category: 'Player & Clan',
    details: [
      'Reads stored donation counters for linked clans without querying the Clash API.',
      'When valid season, start_date, or end_date filters are supplied, uses persisted donation history instead of latest snapshots.',
      '`end_date` filters persisted history through the end of that UTC day.',
      'Sort by donated, received, difference, or ratio.',
    ],
  },
  {
    name: 'history',
    usage:
      '/history option:donations|war-attacks|cwl-attacks|join-leave|clan-games|capital-raids|capital-contribution|attacks|loot|legend-attacks|eos-trophies [clans] [player] [user]',
    description: 'Show tracked historical activity from stored ClashMate data.',
    category: 'Player & Clan',
    details: [
      'Reads persisted donation delta, war attack, clan member join/leave, and Clan Games snapshot history for linked clans without querying the Clash API.',
      'CWL attacks reuse stored war attack history with approximate CWL-only classification until separate CWL metadata is stored.',
      'Unsupported filters return honest no-data embeds that echo accepted clan, player, user, season, and date context where applicable.',
      'Capital raids, capital contribution, loot, Legend attacks, EOS trophies, and multiplayer attacks remain unavailable until those snapshots are stored.',
    ],
  },
  {
    name: 'stats',
    usage: '/stats attacks [clan] [user] [stars] [season] [days] [attempt] or /stats defense',
    description: 'Show war attack stats from stored history.',
    category: 'Player & Clan',
    details: [
      'Reads persisted war attack history for linked clans without querying the Clash API.',
      'The `season` option filters stored attacks since the selected season boundary.',
      'Responses show data source, active filters, rows considered, and visible rows for troubleshooting.',
      'Defense stats echo accepted clan, user, stars, season, days, and attempt filters but remain unavailable until defense events are stored.',
      'Star and attempt filters are conservative because first-pass history rows are stored as attacker aggregates.',
    ],
  },
  {
    name: 'profile',
    usage: '/profile [user] [player]',
    description: 'Show linked Clash player accounts for a Discord user.',
    category: 'Player & Clan',
    details: [
      'Reads existing ClashMate player links without querying the Clash API.',
      'Shows the saved guild timezone preference for the target user when one is present.',
    ],
  },
  {
    name: 'units',
    usage: '/units [player] [user]',
    description: 'Show current unit levels for a Clash of Clans player.',
    category: 'Player & Clan',
    details: [
      'Performs a one-off public Clash API lookup and groups API-provided unit levels.',
      'Includes a compact progress summary with maxed, incomplete, and level totals.',
    ],
  },
  {
    name: 'upgrades',
    usage: '/upgrades [player] [user]',
    description: 'Show remaining player unit upgrades from public Clash API maxLevel data.',
    category: 'Player & Clan',
    details: [
      'Performs a one-off player lookup without tracking the player.',
      'Includes compact progress by unit group using public API maxLevel values instead of static town-hall max tables.',
    ],
  },
  {
    name: 'rushed',
    usage: '/rushed [player] [user] [clan]',
    description:
      'Show likely rushed or incomplete player units from public Clash API maxLevel data.',
    category: 'Player & Clan',
    details: [
      'Performs one-off player lookups without tracking players.',
      '`clan` mode uses a linked clan member snapshot and caps analyzed current members for a compact summary.',
      'Uses public API maxLevel values instead of ClashPerk static previous-town-hall max tables.',
    ],
  },
  {
    name: 'nickname',
    usage:
      '/nickname config [family_nickname_format] [non_family_nickname_format] [change_nicknames] [account_preference_for_naming]',
    description: 'Configure server nickname preferences.',
    category: 'Setup & Logs',
    details: [
      'Requires Manage Server permission.',
      'Stores preferences only; Discord nickname mutation and autorole refresh are not implemented yet.',
    ],
  },
  {
    name: 'link',
    usage: '/link create|list|delete',
    description: 'Manage Discord user links to Clash player or clan tags.',
    category: 'Setup & Logs',
    details: [
      'Create player links, list linked accounts, or remove stale links.',
      'Manage Server members and configured links manager roles can manage links for other users.',
    ],
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
    usage: '/setup clan ... or /setup clan-logs ... or /setup list [clans]',
    description: 'Configure and list linked clans and clan log channels.',
    category: 'Setup & Logs',
    details: [
      'Server setup command for clan tracking, linked clan listing, and persisted log notifications.',
      '`/setup clan-logs` can configure Join/Leave Log along with the other supported clan log channels.',
      '`/setup enable` and `/setup disable` are legacy stubs that point to current setup flows.',
    ],
  },
  {
    name: 'events',
    usage: '/events',
    description: 'Show upcoming Clash of Clans game events.',
    category: 'Utility',
    details: [
      'Shows approximate active and upcoming recurring UTC windows for Clan Games, CWL, Raid Weekend, and season reset.',
      'This is a recurring calendar, not a live event feed.',
    ],
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
    description: 'Show the current time and save your server timezone preference.',
    category: 'Utility',
    details: [
      'Accepts IANA timezone identifiers such as UTC, America/New_York, or Asia/Jakarta.',
      "Persists the invoking user's timezone preference for this server.",
      'Does not geocode free-form city or place names.',
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
    details: [
      'Bot owner command for usage and growth metrics.',
      '`/usage chart` includes a built-in text growth chart fallback for server metrics.',
    ],
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
