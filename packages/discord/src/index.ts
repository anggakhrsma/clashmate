import type {
  ApplicationCommandDataResolvable,
  AutocompleteInteraction,
  Awaitable,
  ChatInputCommandInteraction,
  Client,
  ContextMenuCommandInteraction,
  Message,
} from 'discord.js';

export type CommandInteraction = ChatInputCommandInteraction | ContextMenuCommandInteraction;

export interface CommandContext {
  client: Client;
  ownerIds: readonly string[];
}

export interface SlashCommandDefinition {
  readonly name: string;
  readonly data: ApplicationCommandDataResolvable;
  readonly execute: (interaction: CommandInteraction, context: CommandContext) => Awaitable<void>;
  readonly autocomplete?: (
    interaction: AutocompleteInteraction,
    context: CommandContext,
  ) => Awaitable<void>;
}

export interface MessageCommandDefinition {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly ownerOnly?: boolean;
  readonly execute: (message: Message, context: CommandContext) => Awaitable<void>;
}

export interface MessageCommandRouteResult {
  readonly routed: boolean;
  readonly commandName?: string;
  readonly blocked?: 'user' | 'guild' | 'owner';
}

export interface MessageCommandAccessChecks {
  readonly isUserBlacklisted: (userId: string) => Awaitable<boolean>;
  readonly isGuildBlacklisted: (guildId: string) => Awaitable<boolean>;
}

export class CommandRegistry {
  readonly slashCommands = new Map<string, SlashCommandDefinition>();
  readonly messageCommands = new Map<string, MessageCommandDefinition>();

  registerSlash(command: SlashCommandDefinition): void {
    this.slashCommands.set(command.name, command);
  }

  registerMessage(command: MessageCommandDefinition): void {
    this.messageCommands.set(command.name.toLowerCase(), command);
    for (const alias of command.aliases ?? []) {
      this.messageCommands.set(alias.toLowerCase(), command);
    }
  }

  getSlashCommand(name: string): SlashCommandDefinition | undefined {
    return this.slashCommands.get(name);
  }

  getMessageCommand(name: string): MessageCommandDefinition | undefined {
    return this.messageCommands.get(name.toLowerCase());
  }
}

export function parseMessageCommandToken(content: string): string | undefined {
  return content.trim().split(/\s+/, 1)[0]?.toLowerCase();
}

export async function routeMessageCommand(
  registry: CommandRegistry,
  message: Message,
  context: CommandContext,
  accessChecks?: MessageCommandAccessChecks,
): Promise<MessageCommandRouteResult> {
  if (message.author.bot || message.system || message.webhookId) return { routed: false };

  const commandToken = parseMessageCommandToken(message.content);
  if (!commandToken) return { routed: false };

  const command = registry.getMessageCommand(commandToken);
  if (!command) return { routed: false };

  const commandName = command.name;
  const owner = isOwner(message.author.id, context.ownerIds);
  if (command.ownerOnly && !owner) return { routed: true, commandName, blocked: 'owner' };

  if (!owner && accessChecks) {
    if (await accessChecks.isUserBlacklisted(message.author.id)) {
      return { routed: true, commandName, blocked: 'user' };
    }

    if (message.guildId && (await accessChecks.isGuildBlacklisted(message.guildId))) {
      return { routed: true, commandName, blocked: 'guild' };
    }
  }

  await command.execute(message, context);
  return { routed: true, commandName };
}

export async function routeAutocompleteInteraction(
  registry: CommandRegistry,
  interaction: AutocompleteInteraction,
  context: CommandContext,
): Promise<boolean> {
  const command = registry.getSlashCommand(interaction.commandName);
  if (!command?.autocomplete) return false;

  await command.autocomplete(interaction, context);
  return true;
}

export function isOwner(userId: string, ownerIds: readonly string[]): boolean {
  return ownerIds.includes(userId);
}
