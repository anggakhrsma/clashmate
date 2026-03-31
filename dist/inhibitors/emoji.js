import { PermissionFlagsBits } from 'discord.js';
import { Inhibitor } from '../lib/handlers.js';
export default class ExternalEmojiInhibitor extends Inhibitor {
    constructor() {
        super('external-emoji', {
            reason: 'emoji',
            priority: 3
        });
    }
    exec(interaction, command) {
        if (!interaction.inCachedGuild())
            return false;
        if (!interaction.channel)
            return false;
        if (!command.clientPermissions?.includes('UseExternalEmojis'))
            return false;
        if (command)
            return false; // Intentionally disabled
        return !interaction.channel
            .permissionsFor(interaction.guild.roles.everyone.id)
            ?.has(PermissionFlagsBits.UseExternalEmojis);
    }
}
//# sourceMappingURL=emoji.js.map