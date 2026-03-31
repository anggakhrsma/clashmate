import { Listener } from '../../lib/handlers.js';
import { CommandHandlerEvents } from '../../lib/util.js';
export default class CommandStartedListener extends Listener {
    constructor() {
        super(CommandHandlerEvents.COMMAND_STARTED, {
            event: CommandHandlerEvents.COMMAND_STARTED,
            emitter: 'commandHandler',
            category: 'commandHandler'
        });
    }
    exec(interaction, command, args) {
        const label = interaction.guild
            ? `${interaction.guild.name}/${interaction.user.displayName}`
            : `${interaction.user.displayName}`;
        this.client.logger.log(`${command.id}`, { label });
        return this.counter(interaction, command);
    }
    counter(interaction, command) {
        if (!interaction.inCachedGuild())
            return;
        this.client.stats.interactions(interaction, command.id);
        if (command.category === 'owner')
            return;
        if (this.client.isOwner(interaction.user.id))
            return;
        this.client.stats.users(interaction);
        this.client.stats.commands(command.id);
        if (interaction.inCachedGuild())
            this.client.stats.guilds(interaction.guild);
    }
}
//# sourceMappingURL=command-started.js.map