import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, DiscordjsError, DiscordjsErrorCodes, MessageFlags, ModalBuilder, SectionBuilder, SeparatorSpacingSize, TextDisplayBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { Command } from '../../lib/handlers.js';
import { createInteractionCollector } from '../../util/pagination.js';
export default class LayoutConfigCommand extends Command {
    constructor() {
        super('layout-config', {
            category: 'search',
            channel: 'guild',
            defer: true,
            userPermissions: ['ManageGuild']
        });
    }
    get collection() {
        return this.client.db.collection("Layouts" /* Collections.LAYOUTS */);
    }
    async exec(interaction, args) {
        if (!this.client.util.isManager(interaction.member)) {
            return interaction.reply({
                flags: MessageFlags.Ephemeral,
                content: 'You are not allowed to edit this layout.'
            });
        }
        const customIds = {
            edit: this.client.uuid(interaction.user.id)
        };
        const getEmbed = () => {
            const container = new ContainerBuilder();
            container.setAccentColor(this.client.embed(interaction));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Layout Config'));
            container.addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small));
            const allowLayoutTracking = this.client.settings.get(interaction.guild, "allowLayoutTracking" /* Settings.ALLOW_LAYOUT_TRACKING */, false);
            const allowLayoutVoting = this.client.settings.get(interaction.guild, "allowLayoutVoting" /* Settings.ALLOW_LAYOUT_VOTING */, false);
            const layoutTemplate = this.client.settings.get(interaction.guild, "layoutTemplate" /* Settings.LAYOUT_TEMPLATE */);
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
                '**Layout Voting**',
                allowLayoutVoting ? 'Enabled' : 'Disabled',
                '',
                '**Layout Tracking**',
                allowLayoutTracking ? 'Enabled' : 'Disabled'
            ].join('\n')));
            container.addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small));
            const section = new SectionBuilder();
            section.addTextDisplayComponents(new TextDisplayBuilder().setContent([
                '**Layout Template**',
                layoutTemplate || 'None' //
            ].join('\n')));
            section.setButtonAccessory(new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setCustomId(customIds.edit)
                .setLabel('Edit Template'));
            container.addSectionComponents(section);
            return container;
        };
        if (typeof args.allow_tracking === 'boolean') {
            await this.client.settings.set(interaction.guild, "allowLayoutTracking" /* Settings.ALLOW_LAYOUT_TRACKING */, args.allow_tracking);
        }
        if (typeof args.allow_voting === 'boolean') {
            await this.client.settings.set(interaction.guild, "allowLayoutVoting" /* Settings.ALLOW_LAYOUT_VOTING */, args.allow_voting);
        }
        const container = getEmbed();
        const msg = await interaction.editReply({ components: [container], withComponents: true });
        createInteractionCollector({
            message: msg,
            interaction,
            customIds,
            onClick: async (action) => {
                const layoutTemplate = this.client.settings.get(interaction.guild, "layoutTemplate" /* Settings.LAYOUT_TEMPLATE */);
                const modalCustomId = this.client.uuid(interaction.user.id);
                const templateInput = new TextInputBuilder()
                    .setCustomId(modalCustomId)
                    .setLabel('Layout Template')
                    .setPlaceholder('Enter layout template (markdown supported)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1800)
                    .setRequired(false);
                if (layoutTemplate)
                    templateInput.setValue(layoutTemplate);
                const modal = new ModalBuilder()
                    .setCustomId(modalCustomId)
                    .setTitle('Edit Layout Template');
                modal.addComponents(new ActionRowBuilder().addComponents(templateInput));
                await action.showModal(modal);
                try {
                    const modalSubmitInteraction = await action.awaitModalSubmit({
                        time: 10 * 60 * 1000,
                        filter: (subAction) => subAction.customId === modalCustomId
                    });
                    const newTemplate = modalSubmitInteraction.fields.getTextInputValue(modalCustomId);
                    await this.client.settings.set(interaction.guild, "layoutTemplate" /* Settings.LAYOUT_TEMPLATE */, newTemplate?.trim() || null);
                    await modalSubmitInteraction.deferUpdate();
                    const container = getEmbed();
                    return interaction.editReply({ components: [container], withComponents: true });
                }
                catch (error) {
                    if (!(error instanceof DiscordjsError &&
                        error.code === DiscordjsErrorCodes.InteractionCollectorError)) {
                        throw error;
                    }
                }
            }
        });
    }
}
//# sourceMappingURL=layout-config.js.map