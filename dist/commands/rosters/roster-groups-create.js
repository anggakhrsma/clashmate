import { Command } from '../../lib/handlers.js';
export default class RosterGroupsCreateCommand extends Command {
    constructor() {
        super('roster-groups-create', {
            category: 'roster',
            channel: 'guild',
            userPermissions: ['ManageGuild'],
            roleKey: "rosterManagerRole" /* Settings.ROSTER_MANAGER_ROLE */,
            defer: true,
            ephemeral: true
        });
    }
    async exec(interaction, args) {
        const category = await this.client.rosterManager.searchCategory(interaction.guild.id, args.name);
        if (category)
            return interaction.editReply({ content: 'A group with this name already exists.' });
        if (args.group_role) {
            const dup = await this.client.rosterManager.categories.findOne({
                roleId: args.group_role.id
            });
            if (dup)
                return interaction.editReply({ content: 'A group with this role already exists.' });
        }
        const categories = await this.client.rosterManager.getCategories(interaction.guildId);
        const maxCategoryOrder = Math.max(...categories.map((cat) => cat.order));
        await this.client.rosterManager.createCategory({
            name: args.name,
            displayName: args.name,
            order: maxCategoryOrder + 10,
            guildId: interaction.guild.id,
            roleId: args.group_role?.id,
            selectable: Boolean(args.selectable),
            createdAt: new Date()
        });
        return interaction.editReply({ content: 'User group created!' });
    }
}
//# sourceMappingURL=roster-groups-create.js.map