import { CommandRegistry } from '@clashmate/discord';

import {
  type BlacklistCommandOptions,
  createBlacklistMessageCommand,
  createBlacklistSlashCommand,
} from './blacklist.js';
import { createDebugSlashCommand, type DebugCommandOptions } from './debug.js';
import {
  createStatusMessageCommand,
  createStatusSlashCommand,
  type StatusCommandOptions,
} from './status.js';

export interface BotCommandRegistryOptions {
  blacklist: BlacklistCommandOptions;
  debug: DebugCommandOptions;
  status: StatusCommandOptions;
}

export function createBotCommandRegistry(options: BotCommandRegistryOptions): CommandRegistry {
  const registry = new CommandRegistry();

  registry.registerSlash(createBlacklistSlashCommand(options.blacklist));
  registry.registerSlash(createDebugSlashCommand(options.debug));
  registry.registerSlash(createStatusSlashCommand(options.status));
  registry.registerMessage(createBlacklistMessageCommand(options.blacklist));
  registry.registerMessage(createStatusMessageCommand(options.status));

  return registry;
}
