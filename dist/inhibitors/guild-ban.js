import { Inhibitor } from '../lib/handlers.js';
export default class GuildBanInhibitor extends Inhibitor {
    constructor() {
        super('guild-blacklist', {
            reason: 'blacklist',
            priority: 2
        });
    }
    exec(interaction) {
        if (this.client.isOwner(interaction.user.id))
            return false;
        if (!interaction.guild)
            return false;
        const blacklist = this.client.settings.get('global', "guildBans" /* Settings.GUILD_BLACKLIST */, []);
        return blacklist.includes(interaction.guild.id);
    }
}
//# sourceMappingURL=guild-ban.js.map