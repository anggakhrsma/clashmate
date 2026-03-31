import { BOT_MANAGER_HYPERLINK, mapMissingPermissions, missingPermissions } from '../../util/constants.js';
import { MessageFlags } from 'discord.js';
import { Listener } from '../../lib/handlers.js';
export default class MissingPermissionsListener extends Listener {
    constructor() {
        super('missingPermissions', {
            event: 'missingPermissions',
            emitter: 'commandHandler',
            category: 'commandHandler'
        });
    }
    exec(interaction, command, type, missing) {
        const text = {
            client: () => {
                const name = mapMissingPermissions(missing).missingPerms;
                return `The bot is missing ${name} to execute this command.`;
            },
            user: () => {
                const name = this.missingPermissions(interaction.channel, interaction.user, missing);
                return `You are missing the ${name} or the ${BOT_MANAGER_HYPERLINK} role to use this command.`;
            }
        }[type];
        const label = interaction.guild
            ? `${interaction.guild.name}/${interaction.user.displayName}`
            : `${interaction.user.displayName}`;
        this.client.logger.log(`${command.id} ~ ${type}Permissions (${missing.join(', ')})`, { label });
        return interaction.reply({ content: text(), flags: MessageFlags.Ephemeral });
    }
    missingPermissions(channel, user, permissions) {
        return missingPermissions(channel, user, permissions).missingPerms;
    }
}
//# sourceMappingURL=missing-permissions.js.map