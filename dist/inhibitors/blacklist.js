import { Inhibitor } from '../lib/handlers.js';
export default class BlacklistInhibitor extends Inhibitor {
    constructor() {
        super('blacklist', {
            reason: 'blacklist',
            priority: 1
        });
    }
    exec(interaction) {
        if (this.client.isOwner(interaction.user.id))
            return false;
        const blacklist = this.client.settings.get('global', "blacklist" /* Settings.USER_BLACKLIST */, []);
        return blacklist.includes(interaction.user.id);
    }
}
//# sourceMappingURL=blacklist.js.map