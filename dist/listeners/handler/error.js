import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { inspect } from 'node:util';
import { Listener } from '../../lib/handlers.js';
export default class ErrorListener extends Listener {
    constructor() {
        super('commandHandlerError', {
            event: 'error',
            emitter: 'commandHandler',
            category: 'commandHandler'
        });
    }
    async exec(error, interaction, command) {
        const label = interaction.guild
            ? `${interaction.guild.name}/${interaction.user.displayName}`
            : `${interaction.user.displayName}`;
        this.client.logger.error(`${command?.id ?? 'unknown'} ~ ${error.toString()}`, { label });
        console.error(inspect(error, { depth: Infinity }));
        const content = interaction.inCachedGuild() && !interaction.channel
            ? 'Something went wrong while executing this command. (most likely the bot is missing **View Channel** permission in this channel)'
            : `${this.i18n('common.something_went_wrong', { lng: interaction.locale })}`;
        const message = {
            content,
            components: [
                new ActionRowBuilder().addComponents(new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel(this.i18n('common.contact_support', { lng: interaction.locale }))
                    .setURL(process.env.SUPPORT_SERVER_URL ?? 'https://discord.gg/clashmate'))
            ],
            flags: MessageFlags.Ephemeral
        };
        try {
            if (!interaction.deferred)
                return await interaction.reply(message);
            return await interaction.followUp(message);
        }
        catch (err) {
            this.client.logger.error(`${err.toString()}`, { label: 'ERRORED' });
        }
    }
}
//# sourceMappingURL=error.js.map