import { Listener } from '../../lib/handlers.js';
import { Util } from '../../util/toolkit.js';
export default class GuildMemberAddListener extends Listener {
    constructor() {
        super('guildMemberAdd', {
            emitter: 'client',
            event: 'guildMemberAdd',
            category: 'client'
        });
    }
    async exec(member) {
        if (this.client.settings.hasCustomBot(member.guild) && !false)
            return;
        if (this.client.settings.get(member.guild, "useAutoRole" /* Settings.USE_AUTO_ROLE */, true)) {
            await Util.delay(3000);
            const autoRoleAllowNotLinked = this.client.settings.get(member.guild, "autoRoleAllowNotLinked" /* Settings.AUTO_ROLE_ALLOW_NOT_LINKED */, true);
            await this.client.rolesManager.updateOne(member.user, member.guild.id, true, autoRoleAllowNotLinked);
        }
    }
}
//# sourceMappingURL=guild-member-add.js.map