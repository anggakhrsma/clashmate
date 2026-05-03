import { CommandRegistry } from '@clashmate/discord';
import { type BlacklistCommandOptions, createBlacklistSlashCommand } from './blacklist.js';
import { type ClanCommandOptions, createClanSlashCommand } from './clan.js';
import { type ClanGamesCommandOptions, createClanGamesSlashCommand } from './clan-games.js';
import { type ClansCommandOptions, createClansSlashCommand } from './clans.js';
import { createDebugSlashCommand, type DebugCommandOptions } from './debug.js';
import { createGuildBanSlashCommand, type GuildBanCommandOptions } from './guild-ban.js';
import { createHelpSlashCommand } from './help.js';
import { createInviteSlashCommand } from './invite.js';
import { createLastSeenSlashCommand, type LastSeenCommandOptions } from './lastseen.js';
import { createLinkSlashCommand, type LinkCommandOptions } from './link.js';
import { createMembersSlashCommand, type MembersCommandOptions } from './members.js';
import { createPlayerSlashCommand, type PlayerCommandOptions } from './player.js';
import { createProfileSlashCommand, type ProfileCommandOptions } from './profile.js';
import { createRemainingSlashCommand, type RemainingCommandOptions } from './remaining.js';
import { createSetupClanSlashCommand, type SetupClanCommandOptions } from './setup-clan.js';
import { createStatusSlashCommand, type StatusCommandOptions } from './status.js';
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
  guildBan: GuildBanCommandOptions;
  lastSeen: LastSeenCommandOptions;
  link: LinkCommandOptions;
  members: MembersCommandOptions;
  player: PlayerCommandOptions;
  profile: ProfileCommandOptions;
  remaining: RemainingCommandOptions;
  setupClan: SetupClanCommandOptions;
  status: StatusCommandOptions;
  usage: UsageCommandOptions;
  verify: VerifyCommandOptions;
  war: WarCommandOptions;
  warlog: WarlogCommandOptions;
}

export function createBotCommandRegistry(options: BotCommandRegistryOptions): CommandRegistry {
  const registry = new CommandRegistry();

  registry.registerSlash(createBlacklistSlashCommand(options.blacklist));
  registry.registerSlash(createClanGamesSlashCommand(options.clanGames));
  registry.registerSlash(createClanSlashCommand(options.clan));
  registry.registerSlash(createClansSlashCommand(options.clans));
  registry.registerSlash(createDebugSlashCommand(options.debug));
  registry.registerSlash(createGuildBanSlashCommand(options.guildBan));
  registry.registerSlash(createHelpSlashCommand());
  registry.registerSlash(createInviteSlashCommand());
  registry.registerSlash(createLastSeenSlashCommand(options.lastSeen));
  registry.registerSlash(createLinkSlashCommand(options.link));
  registry.registerSlash(createMembersSlashCommand(options.members));
  registry.registerSlash(createPlayerSlashCommand(options.player));
  registry.registerSlash(createProfileSlashCommand(options.profile));
  registry.registerSlash(createRemainingSlashCommand(options.remaining));
  registry.registerSlash(createSetupClanSlashCommand(options.setupClan));
  registry.registerSlash(createStatusSlashCommand(options.status));
  registry.registerSlash(createUsageSlashCommand(options.usage));
  registry.registerSlash(createVerifySlashCommand(options.verify));
  registry.registerSlash(createWarSlashCommand(options.war));
  registry.registerSlash(createWarlogSlashCommand(options.warlog));

  return registry;
}
