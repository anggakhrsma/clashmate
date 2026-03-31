import { Listener } from '../../lib/handlers.js';
import { CommandHandlerEvents } from '../../lib/util.js';
export default class CommandEndedListener extends Listener {
    constructor() {
        super(CommandHandlerEvents.COMMAND_ENDED, {
            event: CommandHandlerEvents.COMMAND_ENDED,
            emitter: 'commandHandler',
            category: 'commandHandler'
        });
    }
    async exec(interaction, _command, _args) {
        if (!interaction.isCommand())
            return;
    }
}
//# sourceMappingURL=command-ended.js.map