import { BaseInteraction, Interaction } from 'discord.js';
import { Command, Listener } from '../../lib/handlers.js';
import { CommandHandlerEvents } from '../../lib/util.js';

export default class CommandStartedListener extends Listener {
  public constructor() {
    super(CommandHandlerEvents.COMMAND_STARTED, {
      event: CommandHandlerEvents.COMMAND_STARTED,
      emitter: 'commandHandler',
      category: 'commandHandler'
    });
  }

  public exec(interaction: Interaction, command: Command, args: Record<string, unknown>) {
    const label = interaction.guild
      ? `${interaction.guild.name}/${interaction.user.displayName}`
      : `${interaction.user.displayName}`;
    this.client.logger.log(`${command.id}`, { label });
    return this.counter(interaction, command);
  }

  private counter(interaction: BaseInteraction, command: Command) {
    if (!interaction.inCachedGuild()) return;
    this.client.stats.interactions(interaction, command.id);
    if (command.category === 'owner') return;
    if (this.client.isOwner(interaction.user.id)) return;
    this.client.stats.users(interaction);
    this.client.stats.commands(command.id);
    if (interaction.inCachedGuild()) this.client.stats.guilds(interaction.guild);
  }
}
