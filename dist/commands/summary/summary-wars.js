import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, time } from 'discord.js';
import moment from 'moment';
import { Command } from '../../lib/handlers.js';
import { EMOJIS } from '../../util/emojis.js';
const states = {
    inWar: '**End time:**',
    preparation: '**Start time:**',
    warEnded: '**Ended:**'
};
export default class SummaryWarsCommand extends Command {
    constructor() {
        super('summary-wars', {
            category: 'none',
            channel: 'guild',
            clientPermissions: ['EmbedLinks', 'UseExternalEmojis'],
            defer: true
        });
    }
    async exec(interaction, args) {
        const { clans, resolvedArgs } = await this.client.storage.handleSearch(interaction, {
            args: args.clans
        });
        if (!clans)
            return;
        const result = (await Promise.all(clans.map((clan) => this.getWAR(clan.tag)))).flat();
        const wars = result.filter((res) => res.state !== 'notInWar');
        wars.sort((a, b) => this.remAtkDiff(a) - this.remAtkDiff(b));
        wars.sort((a, b) => this.dateDiff(a) - this.dateDiff(b));
        const prepWars = wars.filter((war) => war.state === 'preparation');
        const inWarWars = wars.filter((war) => war.state === 'inWar' && !this.isCompleted(war));
        const completedWars = wars.filter((war) => war.state === 'inWar' && this.isCompleted(war));
        const endedWars = wars.filter((war) => war.state === 'warEnded');
        const sorted = [...inWarWars, ...completedWars, ...prepWars, ...endedWars];
        if (!sorted.length)
            return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
        const chunks = Array(Math.ceil(sorted.length / 15))
            .fill(0)
            .map(() => sorted.splice(0, 15));
        const embeds = [];
        for (const chunk of chunks) {
            const embed = new EmbedBuilder().setColor(this.client.embed(interaction));
            for (const data of chunk) {
                embed.addFields({
                    name: `${data.clan.name} ${EMOJIS.VS_BLUE} ${data.opponent.name} ${data.round ? `(CWL Round #${data.round})` : ''}`,
                    value: [
                        `${data.state === 'preparation' ? '' : this.getLeaderBoard(data.clan, data.opponent)}`,
                        `${states[data.state]} ${time(moment(this._getTime(data)).toDate(), 'R')}`,
                        '\u200b'
                    ].join('\n')
                });
            }
            embeds.push(embed);
        }
        if (embeds.length === 1) {
            embeds.forEach((embed) => embed.setTimestamp());
        }
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(EMOJIS.REFRESH)
            .setCustomId(this.createId({ cmd: this.id, clans: resolvedArgs })));
        if (embeds.length === 1) {
            return interaction.editReply({ embeds: embeds, components: [row] });
        }
        for (const embed of embeds) {
            await interaction.followUp({ embeds: [embed], components: [] });
        }
    }
    get onGoingCWL() {
        return new Date().getDate() >= 1 && new Date().getDate() <= 10;
    }
    async getWAR(clanTag) {
        if (this.onGoingCWL)
            return this.getCWL(clanTag);
        const { res, body } = await this.client.coc.getCurrentWar(clanTag);
        return res.ok ? [{ ...body, round: 0 }] : [];
    }
    async getCWL(clanTag) {
        const { res, body: group } = await this.client.coc.getClanWarLeagueGroup(clanTag);
        if (res.status === 504 || group.state === 'notInWar')
            return [];
        if (!res.ok) {
            const { res, body } = await this.client.coc.getCurrentWar(clanTag);
            return res.ok ? [{ ...body, round: 0 }] : [];
        }
        const chunks = await this.client.coc._clanWarLeagueRounds(clanTag, group);
        const war = chunks.find((data) => data.state === 'inWar') ??
            chunks.find((data) => data.state === 'preparation') ??
            chunks.find((data) => data.state === 'warEnded');
        return war ? [war] : [];
    }
    getLeaderBoard(clan, opponent) {
        return [
            `${EMOJIS.STAR} ${clan.stars}/${opponent.stars}`,
            `${EMOJIS.SWORD} ${clan.attacks}/${opponent.attacks}`,
            `${EMOJIS.FIRE} ${clan.destructionPercentage.toFixed(2)}%/${opponent.destructionPercentage.toFixed(2)}%`
        ].join(' ');
    }
    _getTime(data) {
        return data.state === 'preparation' ? data.startTime : data.endTime;
    }
    dateDiff(data) {
        return Math.abs(moment(data.endTime).toDate().getTime() - new Date().getTime());
    }
    remAtkDiff(data) {
        return (data.clan.attacks * 100) / (data.teamSize * (data.attacksPerMember ?? 1));
    }
    isCompleted(data) {
        return data.clan.attacks === data.teamSize * (data.attacksPerMember ?? 1);
    }
}
//# sourceMappingURL=summary-wars.js.map