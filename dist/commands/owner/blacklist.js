import { Command } from '../../lib/handlers.js';
export default class BlacklistCommand extends Command {
    constructor() {
        super('blacklist', {
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
    async run(message, { id }) {
        const user = id ? await this.client.users.fetch(id).catch(() => null) : null;
        if (!user)
            return message.reply('Invalid userId.');
        const blacklist = this.client.settings.get('global', "blacklist" /* Settings.USER_BLACKLIST */, []);
        if (blacklist.includes(user.id)) {
            const index = blacklist.indexOf(user.id);
            blacklist.splice(index, 1);
            if (blacklist.length === 0)
                this.client.settings.delete('global', "blacklist" /* Settings.USER_BLACKLIST */);
            else
                this.client.settings.set('global', "blacklist" /* Settings.USER_BLACKLIST */, blacklist);
            return message.channel.send(`**${user.displayName}** has been removed from the ${this.client.user.displayName}'s blacklist.`);
        }
        blacklist.push(user.id);
        this.client.settings.set('global', "blacklist" /* Settings.USER_BLACKLIST */, blacklist);
        return message.channel.send(`**${user.displayName}** has been blacklisted from using ${this.client.user.displayName}'s command.`);
    }
}
//# sourceMappingURL=blacklist.js.map