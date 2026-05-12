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

export type CommandRegistrationFailureCode =
  | 'invalid_slash_command_name'
  | 'duplicate_slash_command_name';

export class CommandRegistrationError extends Error {
  constructor(
    readonly code: CommandRegistrationFailureCode,
    message: string,
    readonly diagnostics: Readonly<Record<string, string | readonly string[]>> = {},
  ) {
    super(message);
    this.name = 'CommandRegistrationError';
  }
}

export type AutocompleteRouteDiagnostic =
  | {
      readonly handled: true;
      readonly commandName: string;
    }
  | {
      readonly handled: false;
      readonly commandName: string;
      readonly reason: 'command_not_registered' | 'autocomplete_not_registered';
      readonly registeredCommandNames: readonly string[];
    };

export function getRegisteredSlashCommandNames(registry: CommandRegistry): readonly string[] {
  return Array.from(registry.slashCommands.keys()).sort((left, right) => left.localeCompare(right));
}

export function validateSlashCommandName(name: string): string {
  const trimmedName = name.trim();
  if (trimmedName.length === 0 || trimmedName !== name) {
    throw new CommandRegistrationError(
      'invalid_slash_command_name',
      'Slash command name must be a non-empty trimmed string.',
      { commandName: name },
    );
  }

  return trimmedName;
}

export class CommandRegistry {
  readonly slashCommands = new Map<string, SlashCommandDefinition>();

  registerSlash(command: SlashCommandDefinition): void {
    const name = validateSlashCommandName(command.name);
    const existingCommand = this.slashCommands.get(name);
    if (existingCommand) {
      throw new CommandRegistrationError(
        'duplicate_slash_command_name',
        `Duplicate slash command name registered: ${name}`,
        {
          commandName: name,
          registeredCommandNames: getRegisteredSlashCommandNames(this),
          duplicateDescription: String(existingCommand.data),
        },
      );
    }

    this.slashCommands.set(name, command);
  }

  getSlashCommand(name: string): SlashCommandDefinition | undefined {
    return this.slashCommands.get(name);
  }
}

export function getAutocompleteRouteDiagnostic(
  registry: CommandRegistry,
  commandName: string,
): AutocompleteRouteDiagnostic {
  const command = registry.getSlashCommand(commandName);
  if (!command) {
    return {
      handled: false,
      commandName,
      reason: 'command_not_registered',
      registeredCommandNames: getRegisteredSlashCommandNames(registry),
    };
  }

  if (!command.autocomplete) {
    return {
      handled: false,
      commandName,
      reason: 'autocomplete_not_registered',
      registeredCommandNames: getRegisteredSlashCommandNames(registry),
    };
  }

  return { handled: true, commandName };
}

export async function routeAutocompleteInteraction(
  registry: CommandRegistry,
  interaction: AutocompleteInteraction,
  context: CommandContext,
): Promise<boolean> {
  const diagnostic = getAutocompleteRouteDiagnostic(registry, interaction.commandName);
  if (!diagnostic.handled) return false;

  const command = registry.getSlashCommand(interaction.commandName);
  if (!command?.autocomplete) return false;

  await command.autocomplete(interaction, context);
  return true;
}

export function isOwner(userId: string, ownerIds: readonly string[]): boolean {
  return ownerIds.includes(userId);
}
