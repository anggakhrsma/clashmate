import { CommandRegistry } from '@clashmate/discord';

import {
  type BlacklistCommandOptions,
  createBlacklistMessageCommand,
  createBlacklistSlashCommand,
} from './blacklist.js';
import { createDebugSlashCommand, type DebugCommandOptions } from './debug.js';
import {
  createGuildBanMessageCommand,
  createGuildBanSlashCommand,
  type GuildBanCommandOptions,
} from './guild-ban.js';
import {
  createStatusMessageCommand,
  createStatusSlashCommand,
  type StatusCommandOptions,
} from './status.js';

export interface BotCommandRegistryOptions {
  blacklist: BlacklistCommandOptions;
  debug: DebugCommandOptions;
  guildBan: GuildBanCommandOptions;
  status: StatusCommandOptions;
}

export function createBotCommandRegistry(options: BotCommandRegistryOptions): CommandRegistry {
  const registry = new CommandRegistry();

  registry.registerSlash(createBlacklistSlashCommand(options.blacklist));
  registry.registerSlash(createDebugSlashCommand(options.debug));
  registry.registerSlash(createGuildBanSlashCommand(options.guildBan));
  registry.registerSlash(createStatusSlashCommand(options.status));
  registry.registerMessage(createBlacklistMessageCommand(options.blacklist));
  registry.registerMessage(createGuildBanMessageCommand(options.guildBan));
  registry.registerMessage(createStatusMessageCommand(options.status));

  return registry;
}
