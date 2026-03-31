import { PermissionFlagsBits } from 'discord.js';
import { Inhibitor } from '../lib/handlers.js';
export default class PermissionInhibitor extends Inhibitor {
    constructor() {
        super('permission', {
            reason: 'permission',
            priority: 10,
            disabled: true
        });
    }
    exec(interaction, command) {
        if (!interaction.inCachedGuild() && command.channel === 'dm')
            return false;
        if (interaction.inGuild() && !interaction.inCachedGuild())
            return true;
        if (!interaction.inCachedGuild())
            return true;
        if (!interaction.channel)
            return true;
        if (interaction.channel.isThread()) {
            return !interaction.appPermissions.has([PermissionFlagsBits.SendMessagesInThreads]);
        }
        return !interaction.appPermissions.has([
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ViewChannel
        ]);
    }
}
//# sourceMappingURL=permission.js.map