import { Command } from '../../lib/handlers.js';
export default class GuildBanCommand extends Command {
    constructor() {
        super('guild-ban', {
            category: 'owner',
            ownerOnly: true,
            defer: false
        });
    }
    args() {
        return {
            id: {
                match: 'STRING'
            }
        };
    }
    getGuild(id) {
        if (this.client.guilds.cache.has(id))
            return this.client.guilds.cache.get(id);
        return { id, name: id };
    }
    run(message, { id }) {
        const guild = this.getGuild(id);
        if (!guild)
            return message.reply('Invalid guildId.');
        const blacklist = this.client.settings.get('global', "guildBans" /* Settings.GUILD_BLACKLIST */, []);
        if (blacklist.includes(guild.id)) {
            const index = blacklist.indexOf(guild.id);
            blacklist.splice(index, 1);
            if (blacklist.length === 0)
                this.client.settings.delete('global', "guildBans" /* Settings.GUILD_BLACKLIST */);
            else
                this.client.settings.set('global', "guildBans" /* Settings.GUILD_BLACKLIST */, blacklist);
            return message.channel.send(`**${guild.name}** has been removed from the ${this.client.user.displayName}'s blacklist.`);
        }
        blacklist.push(guild.id);
        this.client.settings.set('global', "guildBans" /* Settings.GUILD_BLACKLIST */, blacklist);
        return message.channel.send(`**${guild.name}** has been blacklisted from using ${this.client.user.displayName}'s command.`);
    }
}
//# sourceMappingURL=guild-ban.js.map