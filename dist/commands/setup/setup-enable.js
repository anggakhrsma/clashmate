import { Command } from '../../lib/handlers.js';
export default class SetupEnableCommand extends Command {
    constructor() {
        super('setup-enable', {
            category: 'hidden',
            channel: 'guild',
            defer: false,
            userPermissions: ['ManageGuild']
        });
    }
    exec(interaction) {
        return interaction.reply({
            content: `This command has been replaced with ${this.client.commands.get('/setup clan')} and ${this.client.commands.get('/setup clan-embed')}`,
            ephemeral: true
        });
    }
}
//# sourceMappingURL=setup-enable.js.map