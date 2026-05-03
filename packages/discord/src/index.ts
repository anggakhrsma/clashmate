import type {
  ApplicationCommandDataResolvable,
  AutocompleteInteraction,
  Awaitable,
  ChatInputCommandInteraction,
  Client,
  ContextMenuCommandInteraction,
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

export class CommandRegistry {
  readonly slashCommands = new Map<string, SlashCommandDefinition>();

  registerSlash(command: SlashCommandDefinition): void {
    const name = command.name.trim();
    if (name.length === 0 || name !== command.name) {
      throw new Error('Slash command name must be a non-empty trimmed string.');
    }
    if (this.slashCommands.has(command.name)) {
      throw new Error(`Duplicate slash command name registered: ${command.name}`);
    }

    this.slashCommands.set(command.name, command);
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
