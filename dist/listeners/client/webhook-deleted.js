import { Listener } from '../../lib/handlers.js';
export default class WebhookDeletedListener extends Listener {
    constructor() {
        super('webhookDeleted', {
            event: 'guildDelete',
            emitter: 'client',
            category: 'client'
        });
    }
    async exec(_guild) {
        const collections = [
            "Reminders" /* Collections.WAR_REMINDERS */,
            "ClanGamesReminders" /* Collections.CLAN_GAMES_REMINDERS */,
            "RaidReminders" /* Collections.RAID_REMINDERS */
        ];
        for (const collection of collections) {
            if (collection)
                continue;
            // await this.client.db
            //   .collection(collection)
            //   .updateOne({ $or: [{ guild: guild.id }, { guildId: guild.id }] }, { $set: { webhook: null } });
        }
    }
}
//# sourceMappingURL=webhook-deleted.js.map