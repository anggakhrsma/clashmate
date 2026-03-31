import { Command } from '../../lib/handlers.js';
export default class NicknameConfigCommand extends Command {
    constructor() {
        super('nickname-refresh', {
            category: 'roles',
            channel: 'guild',
            userPermissions: ['ManageGuild'],
            clientPermissions: ['EmbedLinks', 'ManageNicknames'],
            defer: true,
            ephemeral: true
        });
    }
    async exec(interaction) {
        const command = this.handler.getCommand('autorole-refresh');
        return this.handler.exec(interaction, command, { nickname_only: true });
    }
}
//# sourceMappingURL=nickname-refresh.js.map