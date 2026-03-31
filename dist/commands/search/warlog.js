import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, time } from 'discord.js';
import moment from 'moment';
import { Command } from '../../lib/handlers.js';
import { EMOJIS } from '../../util/emojis.js';
import { Util } from '../../util/toolkit.js';
export default class WarLogCommand extends Command {
    constructor() {
        super('warlog', {
            category: 'war',
            channel: 'guild',
            clientPermissions: ['UseExternalEmojis', 'EmbedLinks'],
            defer: true
        });
    }
    args() {
        return {
            clan: {
                id: 'tag',
                match: 'STRING'
            }
        };
    }
    async exec(interaction, args) {
        const data = await this.client.resolver.resolveClan(interaction, args.tag ?? args.user?.id);
        if (!data)
            return;
        const embed = new EmbedBuilder()
            .setColor(this.client.embed(interaction))
            .setAuthor({
            name: `${data.name} (${data.tag})`,
            iconURL: `${data.badgeUrls.medium}`,
            url: `https://link.clashofclans.com/en?action=OpenClanProfile&tag=${encodeURIComponent(data.tag)}`
        })
            .setDescription([
            `${data.warWins} Wins, ${data.isWarLogPublic ? `${data.warLosses} Losses,` : ''} ${data.warWinStreak} Win Streak`
        ].join('\n'));
        if (!data.isWarLogPublic) {
            embed.setDescription('War Log is Private');
            return interaction.editReply({ embeds: [embed] });
        }
        const wars = await this.client.db
            .collection("ClanWars" /* Collections.CLAN_WARS */)
            .find({
            $or: [{ 'clan.tag': data.tag }, { 'opponent.tag': data.tag }],
            warType: { $ne: 3 /* WarType.CWL */ },
            state: 'warEnded'
        })
            .sort({ _id: -1 })
            .limit(20)
            .toArray();
        const { body, res } = await this.client.coc.getClanWarLog(data.tag, { limit: 10 });
        if (!res.ok) {
            return interaction.editReply('**504 Request Timeout!**');
        }
        const __wars = body.items.map((warLog) => {
            const war = this.getWarInfo(wars, warLog);
            return { ...warLog, id: war?.id, attacks: war?.attacks };
        });
        for (const item of __wars) {
            const { clan, opponent } = item;
            const _time = time(new Date(moment(item.endTime).toDate()), 'R');
            embed.addFields([
                {
                    name: `\u200b\n\u200e${this.result(item.result)} ${opponent.name ?? 'Clan War League'} ${item.id ? `\u200e(#${item.id})` : ''}`,
                    value: [
                        `${EMOJIS.STAR} \`\u200e${this.padStart(clan.stars)} / ${this.padEnd(opponent.stars)}\u200f\`\u200e ${EMOJIS.FIRE} ${(clan.destructionPercentage || 0).toFixed(2)}% ${opponent.name ? `/ ${(opponent.destructionPercentage || 0).toFixed(2)}%` : ''}`,
                        `${EMOJIS.USERS} \`\u200e${this.padStart(item.teamSize)} / ${this.padEnd(item.teamSize)}\u200f\`\u200e ${EMOJIS.SWORD} ${clan.attacks}${item.id ? ` / ${item.attacks}` : ''} ${EMOJIS.CLOCK} ${_time}`
                    ].join('\n')
                }
            ]);
        }
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(this.createId({ cmd: this.id, tag: data.tag, export: true }))
            .setLabel('Export War ID')
            .setStyle(ButtonStyle.Primary));
        return interaction.editReply({ embeds: [embed], components: [row] });
    }
    async exportWars(interaction, clan) {
        const wars = await this.client.db
            .collection("ClanWars" /* Collections.CLAN_WARS */)
            .find({
            $or: [{ 'clan.tag': clan.tag }, { 'opponent.tag': clan.tag }],
            warType: 1 /* WarType.REGULAR */,
            state: 'warEnded'
        })
            .sort({ _id: -1 })
            .limit(300)
            .project({
            _id: 0,
            id: 1,
            startTime: 1,
            clan: {
                name: 1,
                tag: 1
            },
            opponent: {
                name: 1,
                tag: 1
            }
        })
            .toArray();
        const sheets = [];
        wars.forEach((war) => {
            if (war.opponent.tag === clan.tag) {
                war.opponent = war.clan;
            }
        });
        sheets.push({
            title: Util.escapeSheetName(`${clan.name} (${clan.tag})`),
            columns: [
                { name: 'War ID', width: 100, align: 'LEFT' },
                { name: 'Opponent', width: 160, align: 'LEFT' },
                { name: 'Opponent Tag', width: 160, align: 'LEFT' },
                { name: 'Date', width: 160, align: 'LEFT' }
            ],
            rows: wars.map((war) => [
                war.id,
                war.opponent.name,
                war.opponent.tag,
                moment(war.startTime).toDate()
            ])
        });
        return interaction.editReply({ content: 'Export is not available.' });
    }
    getWarInfo(wars, war) {
        const data = wars.find((en) => war.opponent?.tag &&
            [en.clan.tag, en.opponent.tag].includes(war.opponent.tag) &&
            this.compareDate(war.endTime, en.endTime));
        if (!data)
            return null;
        return { id: data.id, attacks: data.opponent.attacks };
    }
    result(result) {
        if (result === 'win')
            return `${EMOJIS.OK}`;
        if (result === 'lose')
            return `${EMOJIS.WRONG}`;
        return EMOJIS.EMPTY;
    }
    padEnd(num) {
        return num.toString().padEnd(3, ' ');
    }
    padStart(num) {
        return num.toString().padStart(3, ' ');
    }
    compareDate(apiDate, dbDate) {
        return new Date(moment(apiDate).toDate()) >= dbDate;
    }
}
//# sourceMappingURL=warlog.js.map