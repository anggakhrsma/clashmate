import moment from 'moment';
import { Command } from '../../lib/handlers.js';
export default class JoinLeaveHistoryCommand extends Command {
    constructor() {
        super('join-leave-history', {
            category: 'none',
            channel: 'guild',
            clientPermissions: ['EmbedLinks'],
            defer: true
        });
    }
    async exec(interaction, args) {
        if (args.user) {
            const playerTags = await this.client.resolver.getLinkedPlayerTags(args.user.id);
            const { result } = await this.getHistory(interaction, playerTags);
            if (!result.length) {
                return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
            }
        }
        if (args.player) {
            const player = await this.client.resolver.resolvePlayer(interaction, args.player);
            if (!player)
                return null;
            const playerTags = [player.tag];
            const { result } = await this.getHistory(interaction, playerTags);
            if (!result.length) {
                return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
            }
        }
        const { clans } = await this.client.storage.handleSearch(interaction, { args: args.clans });
        if (!clans)
            return;
        const { result } = await this.getClanHistory(interaction, clans.map((clan) => clan.tag));
        if (!result.length) {
            return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
        }
    }
    async getHistory(interaction, playerTags) {
        const gte = moment().subtract(1, 'month').toDate().toISOString();
        const result = await this.client.db
            .collection("ClanLogs" /* Collections.CLAN_LOGS */)
            .find({ tag: { $in: playerTags }, op: { $in: ['JOINED', 'LEFT'] } })
            .sort({ createdAt: -1 })
            .limit(200)
            .toArray();
        return { embeds: [], result };
    }
    async getClanHistory(interaction, clanTags) {
        const gte = moment().subtract(1, 'month').toDate().toISOString();
        const result = await this.client.db
            .collection("ClanLogs" /* Collections.CLAN_LOGS */)
            .find({ clanTag: { $in: clanTags }, op: { $in: ['JOINED', 'LEFT'] } })
            .sort({ createdAt: -1 })
            .limit(200)
            .toArray();
        return { embeds: [], result };
    }
}
//# sourceMappingURL=history-join-leave.js.map