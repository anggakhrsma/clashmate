import { EmbedBuilder } from 'discord.js';
import { Command } from '../../lib/handlers.js';
export default class CategoryListCommand extends Command {
    constructor() {
        super('category-list', {
            category: 'setup',
            channel: 'guild',
            defer: true,
            ephemeral: true,
            userPermissions: ['ManageGuild']
        });
    }
    async exec(interaction) {
        const categories = await this.client.storage.getOrCreateDefaultCategories(interaction.guildId);
        const embed = new EmbedBuilder().setColor(this.client.embed(interaction)).setAuthor({
            name: `${interaction.guild.name} Categories`,
            iconURL: interaction.guild.iconURL()
        });
        embed.setDescription(categories.map((cat) => `1. ${cat.name}`).join('\n'));
        return interaction.editReply({ embeds: [embed] });
    }
}
//# sourceMappingURL=category-list.js.map