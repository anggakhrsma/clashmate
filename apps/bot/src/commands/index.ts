import { CommandRegistry } from '@clashmate/discord';
import { type BlacklistCommandOptions, createBlacklistSlashCommand } from './blacklist.js';
import { type ClanCommandOptions, createClanSlashCommand } from './clan.js';
import { type ClanGamesCommandOptions, createClanGamesSlashCommand } from './clan-games.js';
import { type ClansCommandOptions, createClansSlashCommand } from './clans.js';
import { createDebugSlashCommand, type DebugCommandOptions } from './debug.js';
import { createGuildBanSlashCommand, type GuildBanCommandOptions } from './guild-ban.js';
import { createHelpSlashCommand } from './help.js';
import { createInviteSlashCommand } from './invite.js';
import { createLinkSlashCommand, type LinkCommandOptions } from './link.js';
import { createPlayerSlashCommand, type PlayerCommandOptions } from './player.js';
import { createRemainingSlashCommand, type RemainingCommandOptions } from './remaining.js';
import { createSetupClanSlashCommand, type SetupClanCommandOptions } from './setup-clan.js';
import { createStatusSlashCommand, type StatusCommandOptions } from './status.js';
import { createUsageSlashCommand, type UsageCommandOptions } from './usage.js';
import { createVerifySlashCommand, type VerifyCommandOptions } from './verify.js';

export interface BotCommandRegistryOptions {
  blacklist: BlacklistCommandOptions;
  clanGames: ClanGamesCommandOptions;
  clan: ClanCommandOptions;
  clans: ClansCommandOptions;
  debug: DebugCommandOptions;
  guildBan: GuildBanCommandOptions;
  link: LinkCommandOptions;
  player: PlayerCommandOptions;
  remaining: RemainingCommandOptions;
  setupClan: SetupClanCommandOptions;
  status: StatusCommandOptions;
  usage: UsageCommandOptions;
  verify: VerifyCommandOptions;
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
  registry.registerSlash(createLinkSlashCommand(options.link));
  registry.registerSlash(createPlayerSlashCommand(options.player));
  registry.registerSlash(createRemainingSlashCommand(options.remaining));
  registry.registerSlash(createSetupClanSlashCommand(options.setupClan));
  registry.registerSlash(createStatusSlashCommand(options.status));
  registry.registerSlash(createUsageSlashCommand(options.usage));
  registry.registerSlash(createVerifySlashCommand(options.verify));

  return registry;
}
