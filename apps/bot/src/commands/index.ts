import { CommandRegistry } from '@clashmate/discord';
import {
  type BlacklistCommandOptions,
  createBlacklistMessageCommand,
  createBlacklistSlashCommand,
} from './blacklist.js';
import { type ClansCommandOptions, createClansSlashCommand } from './clans.js';
import { createDebugSlashCommand, type DebugCommandOptions } from './debug.js';
import {
  createGuildBanMessageCommand,
  createGuildBanSlashCommand,
  type GuildBanCommandOptions,
} from './guild-ban.js';
import { createSetupClanSlashCommand, type SetupClanCommandOptions } from './setup-clan.js';
import {
  createStatusMessageCommand,
  createStatusSlashCommand,
  type StatusCommandOptions,
} from './status.js';
import { createUsageSlashCommand, type UsageCommandOptions } from './usage.js';

export interface BotCommandRegistryOptions {
  blacklist: BlacklistCommandOptions;
  clans: ClansCommandOptions;
  debug: DebugCommandOptions;
  guildBan: GuildBanCommandOptions;
  setupClan: SetupClanCommandOptions;
  status: StatusCommandOptions;
  usage: UsageCommandOptions;
}

export function createBotCommandRegistry(options: BotCommandRegistryOptions): CommandRegistry {
  const registry = new CommandRegistry();

  registry.registerSlash(createBlacklistSlashCommand(options.blacklist));
  registry.registerSlash(createClansSlashCommand(options.clans));
  registry.registerSlash(createDebugSlashCommand(options.debug));
  registry.registerSlash(createGuildBanSlashCommand(options.guildBan));
  registry.registerSlash(createSetupClanSlashCommand(options.setupClan));
  registry.registerSlash(createStatusSlashCommand(options.status));
  registry.registerSlash(createUsageSlashCommand(options.usage));
  registry.registerMessage(createBlacklistMessageCommand(options.blacklist));
  registry.registerMessage(createGuildBanMessageCommand(options.guildBan));
  registry.registerMessage(createStatusMessageCommand(options.status));

  return registry;
}
