import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Command } from '../../lib/handlers.js';
import { Util } from '../../util/toolkit.js';
import { fromReduced } from './summary-compo.js';
export default class SummaryClansCommand extends Command {
    constructor() {
        super('summary-clans', {
            category: 'none',
            channel: 'guild',
            clientPermissions: ['EmbedLinks'],
            defer: true
        });
    }
    async exec(interaction, args) {
        const { clans } = await this.client.storage.handleSearch(interaction, { args: args.clans });
        if (!clans)
            return;
        const _clans = await this.client.coc._getClans(clans);
        _clans.sort((a, b) => a.name.localeCompare(b.name));
        if (!_clans.length) {
            return interaction.editReply(this.i18n('common.no_clans_found', {
                lng: interaction.locale,
                command: this.client.commands.SETUP_CLAN
            }));
        }
        const overall = [];
        for (const clan of _clans) {
            const players = clan.memberList.map((mem) => ({
                tag: mem.tag,
                townHallLevel: mem.townHallLevel
            }));
            overall.push(...players);
        }
        const customIds = {
            joinLeave: this.createId({ cmd: this.id, display: 'join-leave' }),
            clans: this.createId({ cmd: this.id, display: 'clans' })
        };
        const row = new ActionRowBuilder();
        row.addComponents(new ButtonBuilder()
            .setCustomId(customIds.joinLeave)
            .setLabel('Join/Leave Logs')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(args.display === 'join-leave'), new ButtonBuilder()
            .setCustomId(customIds.clans)
            .setLabel('Clans and Town Hall')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(args.display === 'clans' || !args.display));
        const nameLen = Math.max(..._clans.map((clan) => clan.name.length)) + 1;
        const tagLen = Math.max(..._clans.map((clan) => clan.tag.length)) + 1;
        const totalMembers = _clans.reduce((p, c) => p + c.members, 0);
        if (args.display === 'join-leave') {
            const logs = await this.getJoinLeaveLogs(interaction, _clans);
            const embed = new EmbedBuilder()
                .setColor(this.client.embed(interaction))
                .setAuthor({
                name: `${interaction.guild.name} Clans`,
                iconURL: interaction.guild.iconURL()
            })
                .setDescription([
                `**Join/Leave History (last 30 days)**`,
                `\`\u200e${'#'.padStart(3, ' ')} ${'JOINED'.padStart(5, ' ')} ${'LEFT'.padStart(5, ' ')}  ${'CLAN'.padEnd(nameLen, ' ')} \``,
                ...logs.map((clan, i) => {
                    const nn = `${i + 1}`.padStart(3, ' ');
                    const name = Util.escapeBackTick(clan.name).padEnd(nameLen, ' ');
                    return `\`\u200e${nn}  ${this.fmtNum(clan.join)} ${this.fmtNum(clan.leave)}  ${name} \u200f\``;
                })
            ].join('\n'))
                .setFooter({ text: `${clans.length} clans, ${totalMembers} members` });
            return interaction.editReply({ embeds: [embed], components: [row] });
        }
        const embed = new EmbedBuilder()
            .setColor(this.client.embed(interaction))
            .setAuthor({ name: `${interaction.guild.name} Clans`, iconURL: interaction.guild.iconURL() })
            .setDescription([
            _clans
                .map((clan) => {
                const name = Util.escapeBackTick(clan.name).padEnd(nameLen, ' ');
                return `\`\u200e${name} ${clan.tag.padStart(tagLen, ' ')}  ${clan.members.toString().padStart(2, ' ')}/50 \u200f\``;
            })
                .join('\n')
        ].join('\n'))
            .addFields({ name: 'Town Hall Levels', value: this.compo(overall) })
            .setFooter({ text: `${clans.length} clans, ${totalMembers} members` });
        return interaction.editReply({ embeds: [embed], components: [row] });
    }
    async getJoinLeaveLogs(_interaction, clans) {
        const { Collections } = await import('../../util/constants.js');
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const results = await this.client.db
            .collection("ClanLogs" /* Collections.CLAN_LOGS */)
            .aggregate([
            {
                $match: {
                    clanTag: { $in: clans.map((c) => c.tag) },
                    op: { $in: ['JOINED', 'LEFT'] },
                    createdAt: { $gte: since }
                }
            },
            { $group: { _id: { clanTag: '$clanTag', op: '$op' }, count: { $sum: 1 } } }
        ])
            .toArray();
        const clanMap = results.reduce((acc, r) => {
            acc[r._id.clanTag] ??= {};
            acc[r._id.clanTag][r._id.op] = r.count;
            return acc;
        }, {});
        const logs = clans.map((clan) => ({
            name: clan.name,
            tag: clan.tag,
            join: clanMap[clan.tag]?.JOINED ?? 0,
            leave: clanMap[clan.tag]?.LEFT ?? 0
        }));
        logs.sort((a, b) => b.join - a.join);
        return logs;
    }
    compo(players) {
        const reduced = players.reduce((count, member) => {
            const townHall = member.townHallLevel;
            count[townHall] = (count[townHall] || 0) + 1;
            return count;
        }, {});
        return fromReduced(reduced, false);
    }
    fmtNum(num) {
        const numString = num > 999 ? `${(num / 1000).toFixed(1)}K` : num.toString();
        return numString.padStart(5, ' ');
    }
}
//# sourceMappingURL=summary-clans.js.map