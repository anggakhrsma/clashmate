import { Command } from '../../lib/handlers.js';
export default class SetupDisableCommand extends Command {
    constructor() {
        super('setup-disable', {
            category: 'hidden',
            channel: 'guild',
            clientPermissions: ['EmbedLinks'],
            defer: false
        });
    }
    async exec(interaction) {
        return interaction.reply({
            content: `This command has been replaced with ${this.client.commands.get('/setup clan')} and ${this.client.commands.get('/setup clan-embed')}`,
            ephemeral: true
        });
    }
}
//# sourceMappingURL=setup-disable.js.map