import { Command } from '../../lib/handlers.js';
import { Season, Util } from '../../util/toolkit.js';
export default class LegendAttacksHistoryCommand extends Command {
    constructor() {
        super('history-legend-attacks', {
            category: 'search',
            channel: 'guild',
            clientPermissions: ['EmbedLinks', 'UseExternalEmojis'],
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
        const _clans = (await Promise.all(clans.map((clan) => this.client.coc.getClan(clan.tag))))
            .filter((r) => r.res.ok)
            .map((r) => r.body);
        const playerTags = _clans.flatMap((clan) => clan.memberList.map((member) => member.tag));
        const { result } = await this.getHistory(interaction, playerTags);
        if (!result.length) {
            return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
        }
    }
    async getHistory(interaction, playerTags) {
        const seasonId = Season.ID;
        const players = await this.client.db
            .collection("LegendAttacks" /* Collections.LEGEND_ATTACKS */)
            .find({
            tag: { $in: playerTags },
            seasonId
        })
            .toArray();
        const result = [];
        for (const { logs, name, tag } of players) {
            const days = Util.getLegendDays();
            const perDayLogs = days.reduce((prev, { startTime, endTime }, i) => {
                const mixedLogs = logs.filter((atk) => atk.timestamp >= startTime && atk.timestamp <= endTime);
                const attacks = mixedLogs.filter((en) => en.inc > 0);
                const defenses = mixedLogs.filter((en) => en.inc <= 0);
                const attackCount = attacks.length;
                const defenseCount = defenses.length;
                const final = mixedLogs.slice(-1).at(0);
                const initial = mixedLogs.at(0);
                const gain = attacks.reduce((acc, cur) => acc + cur.inc, 0);
                const loss = defenses.reduce((acc, cur) => acc + cur.inc, 0);
                prev.push({
                    attackCount,
                    defenseCount,
                    gain,
                    loss,
                    final: final?.end ?? '-',
                    initial: initial?.start ?? '-',
                    day: i + 1,
                    netGain: gain + loss
                });
                return prev;
            }, []);
            result.push({ name, tag, logs: perDayLogs });
        }
        return { embeds: [], result };
    }
}
//# sourceMappingURL=history-legend-attacks.js.map