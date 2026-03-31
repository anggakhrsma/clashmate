import { ObjectId } from 'mongodb';
import { Command } from '../../lib/handlers.js';
export default class RosterDeleteCommand extends Command {
    constructor() {
        super('roster-delete', {
            category: 'roster',
            channel: 'guild',
            userPermissions: ['ManageGuild'],
            roleKey: "rosterManagerRole" /* Settings.ROSTER_MANAGER_ROLE */,
            defer: true,
            ephemeral: true
        });
    }
    async exec(interaction, args) {
        if (!ObjectId.isValid(args.roster))
            return interaction.editReply({ content: 'Invalid roster ID.' });
        const rosterId = new ObjectId(args.roster);
        await interaction.editReply({ content: 'Deleting roster...' });
        const roster = await this.client.rosterManager.clear(rosterId);
        if (!roster || roster.guildId !== interaction.guildId)
            return interaction.editReply({ content: 'Roster was deleted.' });
        await this.client.rosterManager.delete(rosterId);
        return interaction.editReply({ content: 'Roster deleted successfully.' });
    }
}
//# sourceMappingURL=roster-delete.js.map