import { CommandRegistry } from '@clashmate/discord';
import { createArmySlashCommand } from './army.js';
import { type BlacklistCommandOptions, createBlacklistSlashCommand } from './blacklist.js';
import { type ClanCommandOptions, createClanSlashCommand } from './clan.js';
import { type ClanGamesCommandOptions, createClanGamesSlashCommand } from './clan-games.js';
import { type ClansCommandOptions, createClansSlashCommand } from './clans.js';
import { createDebugSlashCommand, type DebugCommandOptions } from './debug.js';
import { createDonationsSlashCommand, type DonationsCommandOptions } from './donations.js';
import { createGuildBanSlashCommand, type GuildBanCommandOptions } from './guild-ban.js';
import { createHelpSlashCommand } from './help.js';
import { createHistorySlashCommand, type HistoryCommandOptions } from './history.js';
import { createInviteSlashCommand } from './invite.js';
import { createLastSeenSlashCommand, type LastSeenCommandOptions } from './lastseen.js';
import { createLinkSlashCommand, type LinkCommandOptions } from './link.js';
import { createMembersSlashCommand, type MembersCommandOptions } from './members.js';
import { createPlayerSlashCommand, type PlayerCommandOptions } from './player.js';
import { createProfileSlashCommand, type ProfileCommandOptions } from './profile.js';
import { createRemainingSlashCommand, type RemainingCommandOptions } from './remaining.js';
import { createSearchSlashCommand, type SearchCommandOptions } from './search.js';
import { createSetupClanSlashCommand, type SetupClanCommandOptions } from './setup-clan.js';
import { createStatusSlashCommand, type StatusCommandOptions } from './status.js';
import { createUnitsSlashCommand, type UnitsCommandOptions } from './units.js';
import { createUpgradesSlashCommand, type UpgradesCommandOptions } from './upgrades.js';
import { createUsageSlashCommand, type UsageCommandOptions } from './usage.js';
import { createVerifySlashCommand, type VerifyCommandOptions } from './verify.js';
import { createWarSlashCommand, type WarCommandOptions } from './war.js';
import { createWarlogSlashCommand, type WarlogCommandOptions } from './warlog.js';

export interface BotCommandRegistryOptions {
  blacklist: BlacklistCommandOptions;
  clanGames: ClanGamesCommandOptions;
  clan: ClanCommandOptions;
  clans: ClansCommandOptions;
  debug: DebugCommandOptions;
  donations: DonationsCommandOptions;
  guildBan: GuildBanCommandOptions;
  history: HistoryCommandOptions;
  lastSeen: LastSeenCommandOptions;
  link: LinkCommandOptions;
  members: MembersCommandOptions;
  player: PlayerCommandOptions;
  profile: ProfileCommandOptions;
  remaining: RemainingCommandOptions;
  search: SearchCommandOptions;
  setupClan: SetupClanCommandOptions;
  status: StatusCommandOptions;
  units: UnitsCommandOptions;
  upgrades: UpgradesCommandOptions;
  usage: UsageCommandOptions;
  verify: VerifyCommandOptions;
  war: WarCommandOptions;
  warlog: WarlogCommandOptions;
}

export function createBotCommandRegistry(options: BotCommandRegistryOptions): CommandRegistry {
  const registry = new CommandRegistry();

  registry.registerSlash(createArmySlashCommand());
  registry.registerSlash(createBlacklistSlashCommand(options.blacklist));
  registry.registerSlash(createClanGamesSlashCommand(options.clanGames));
  registry.registerSlash(createClanSlashCommand(options.clan));
  registry.registerSlash(createClansSlashCommand(options.clans));
  registry.registerSlash(createDebugSlashCommand(options.debug));
  registry.registerSlash(createDonationsSlashCommand(options.donations));
  registry.registerSlash(createGuildBanSlashCommand(options.guildBan));
  registry.registerSlash(createHelpSlashCommand());
  registry.registerSlash(createHistorySlashCommand(options.history));
  registry.registerSlash(createInviteSlashCommand());
  registry.registerSlash(createLastSeenSlashCommand(options.lastSeen));
  registry.registerSlash(createLinkSlashCommand(options.link));
  registry.registerSlash(createMembersSlashCommand(options.members));
  registry.registerSlash(createPlayerSlashCommand(options.player));
  registry.registerSlash(createProfileSlashCommand(options.profile));
  registry.registerSlash(createRemainingSlashCommand(options.remaining));
  registry.registerSlash(createSearchSlashCommand(options.search));
  registry.registerSlash(createSetupClanSlashCommand(options.setupClan));
  registry.registerSlash(createStatusSlashCommand(options.status));
  registry.registerSlash(createUnitsSlashCommand(options.units));
  registry.registerSlash(createUpgradesSlashCommand(options.upgrades));
  registry.registerSlash(createUsageSlashCommand(options.usage));
  registry.registerSlash(createVerifySlashCommand(options.verify));
  registry.registerSlash(createWarSlashCommand(options.war));
  registry.registerSlash(createWarlogSlashCommand(options.warlog));

  return registry;
}
