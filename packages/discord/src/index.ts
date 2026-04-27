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

export class CommandRegistry {
  readonly slashCommands = new Map<string, SlashCommandDefinition>();
  readonly messageCommands = new Map<string, MessageCommandDefinition>();

  registerSlash(command: SlashCommandDefinition): void {
    this.slashCommands.set(command.name, command);
  }

  registerMessage(command: MessageCommandDefinition): void {
    this.messageCommands.set(command.name, command);
    for (const alias of command.aliases ?? []) {
      this.messageCommands.set(alias, command);
    }
  }

  getSlashCommand(name: string): SlashCommandDefinition | undefined {
    return this.slashCommands.get(name);
  }
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
