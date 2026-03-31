import { ObjectId } from 'mongodb';
import { Command } from '../../lib/handlers.js';
export default class CategoryDeleteCommand extends Command {
    constructor() {
        super('category-delete', {
            category: 'setup',
            channel: 'guild',
            userPermissions: ['ManageGuild'],
            ephemeral: true,
            defer: true
        });
    }
    async exec(interaction, args) {
        if (!ObjectId.isValid(args.category))
            return interaction.editReply('Invalid categoryId.');
        const deleted = await this.client.db
            .collection("ClanCategories" /* Collections.CLAN_CATEGORIES */)
            .findOneAndDelete({ _id: new ObjectId(args.category) });
        if (!deleted)
            return interaction.editReply('Failed to delete the category.');
        return interaction.editReply('Successfully deleted.');
    }
}
//# sourceMappingURL=category-delete.js.map