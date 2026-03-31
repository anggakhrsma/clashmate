import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import moment from 'moment';
import { cluster } from 'radash';
import { Command } from '../../lib/handlers.js';
import { BLUE_NUMBERS, EMOJIS, ORANGE_NUMBERS, TOWN_HALLS, WHITE_NUMBERS } from '../../util/emojis.js';
export default class CWLRosterCommand extends Command {
    constructor() {
        super('cwl-roster', {
            category: 'war',
            channel: 'guild',
            clientPermissions: ['EmbedLinks', 'UseExternalEmojis'],
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
        const clan = await this.client.resolver.resolveClan(interaction, args.tag ?? args.user?.id);
        if (!clan)
            return;
        const { body, res } = await this.client.coc.getClanWarLeagueGroup(clan.tag);
        if (res.status === 504 || body.state === 'notInWar') {
            return interaction.editReply(this.i18n('command.cwl.still_searching', {
                lng: interaction.locale,
                clan: `${clan.name} (${clan.tag})`
            }));
        }
        if (!res.ok) {
            return interaction.editReply(this.i18n('command.cwl.not_in_season', {
                lng: interaction.locale,
                clan: `${clan.name} (${clan.tag})`
            }));
        }
        return this.rounds(interaction, { body, clan, args });
    }
    async fetch(warTag) {
        const { body, res } = await this.client.coc.getClanWarLeagueRound(warTag);
        return { warTag, ...body, ...res };
    }
    async rounds(interaction, { body, clan, args }) {
        const clanTag = clan.tag;
        const rounds = body.rounds.filter((r) => !r.warTags.includes('#0'));
        const clanRounds = [];
        let [stars, destruction] = [0, 0];
        const ranking = {};
        const warTags = rounds.map((round) => round.warTags).flat();
        const wars = await Promise.all(warTags.map((warTag) => this.fetch(warTag)));
        for (const data of body.clans) {
            ranking[data.tag] = {
                name: data.name,
                tag: data.tag,
                stars: 0,
                destruction: 0
            };
        }
        for (const data of wars) {
            if (!data.ok)
                continue;
            const clan = ranking[data.clan.tag];
            const opponent = ranking[data.opponent.tag];
            if (data.state === 'inWar') {
                clan.stars += data.clan.stars;
                clan.destruction += data.clan.destructionPercentage * data.teamSize;
                opponent.stars += data.opponent.stars;
                opponent.destruction += data.opponent.destructionPercentage * data.teamSize;
            }
            if (data.state === 'warEnded') {
                clan.stars += this.winner(data.clan, data.opponent)
                    ? data.clan.stars + 10
                    : data.clan.stars;
                clan.destruction += data.clan.destructionPercentage * data.teamSize;
                opponent.stars += this.winner(data.opponent, data.clan)
                    ? data.opponent.stars + 10
                    : data.opponent.stars;
                opponent.destruction += data.opponent.destructionPercentage * data.teamSize;
            }
            if (data.clan.tag === clanTag || data.opponent.tag === clanTag) {
                const clan = data.clan.tag === clanTag ? data.clan : data.opponent;
                const opponent = data.clan.tag === clanTag ? data.opponent : data.clan;
                if (data.state === 'warEnded') {
                    stars += this.winner(clan, opponent) ? clan.stars + 10 : clan.stars;
                    destruction += clan.destructionPercentage * data.teamSize;
                }
                if (data.state === 'inWar') {
                    stars += clan.stars;
                    destruction += clan.destructionPercentage * data.teamSize;
                }
                clanRounds.push({
                    clan,
                    opponent,
                    state: data.state,
                    round: body.rounds.findIndex((round) => round.warTags.includes(data.warTag))
                });
            }
        }
        const flatTownHalls = body.clans
            .map((clan) => clan.members)
            .flat()
            .map((mem) => mem.townHallLevel);
        const [max, min] = [Math.max(...flatTownHalls), Math.min(...flatTownHalls)];
        const townHalls = Array(Math.min(5, max - min + 1))
            .fill(0)
            .map((_, i) => max - i);
        const ranks = Object.values(ranking);
        ranks.sort((a, b) => b.destruction - a.destruction).sort((a, b) => b.stars - a.stars);
        const next = clanRounds.find((round) => round.state === 'preparation');
        const rank = ranks.findIndex((a) => a.tag === clanTag);
        const summarizedEmbed = new EmbedBuilder().setColor(this.client.embed(interaction));
        summarizedEmbed.setDescription([
            '**Clan War League Rosters**',
            `${EMOJIS.HASH} ${townHalls.map((th) => ORANGE_NUMBERS[th]).join('')} **Clan**`,
            ranks
                .sort((a, b) => b.stars - a.stars)
                .map((clan, i) => `${BLUE_NUMBERS[++i]} ${this.flat(clan.tag, townHalls, body)} \u200e${clan.name}`)
                .join('\n')
        ].join('\n'));
        if (next) {
            const oppRank = ranks.findIndex((clan) => clan.tag === next.opponent.tag);
            const flatTownHalls = [...next.clan.members, ...next.opponent.members].map((mem) => mem.townhallLevel);
            const [max, min] = [Math.max(...flatTownHalls), Math.min(...flatTownHalls)];
            const townHalls = Array(Math.max(Math.min(5, max - min + 1), 2))
                .fill(0)
                .map((_, i) => max - i);
            summarizedEmbed.addFields([
                {
                    name: '\u200e',
                    value: [
                        `**Next War (Round #${next.round + 1})**`,
                        `${EMOJIS.HASH} ${townHalls.map((th) => ORANGE_NUMBERS[th]).join('')} **Clan**`,
                        `${BLUE_NUMBERS[rank + 1]} ${this.getNextRoster(next.clan, townHalls)} \u200e${next.clan.name}`,
                        `${BLUE_NUMBERS[oppRank + 1]} ${this.getNextRoster(next.opponent, townHalls)} \u200e${next.opponent.name}`
                    ].join('\n')
                }
            ]);
        }
        if (next?.round || rounds.length >= 2) {
            summarizedEmbed.addFields([
                {
                    name: '\u200b',
                    value: `Rank #${rank + 1} ${EMOJIS.STAR} ${stars} ${EMOJIS.DESTRUCTION} ${destruction.toFixed()}%`
                }
            ]);
        }
        const detailedEmbed = new EmbedBuilder();
        detailedEmbed
            .setFooter({ text: `Clan War League ${moment(body.season).format('MMMM YYYY')}` })
            .setAuthor({ name: 'CWL Roster' })
            .setDescription('CWL Roster and Town-Hall Distribution')
            .setColor(this.client.embed(interaction));
        for (const clan of body.clans) {
            const reduced = clan.members.reduce((count, member) => {
                const townHall = member.townHallLevel;
                count[townHall] = (count[townHall] || 0) + 1;
                return count;
            }, {});
            const townHalls = Object.entries(reduced)
                .map((entry) => ({ level: Number(entry[0]), total: Number(entry[1]) }))
                .sort((a, b) => b.level - a.level);
            detailedEmbed.addFields([
                {
                    name: `\u200e${clan.tag === clanTag ? `__${clan.name} (${clan.tag})__` : `${clan.name} (${clan.tag})`}`,
                    value: [
                        cluster(townHalls, 5)
                            .map((chunks) => chunks
                            .map((th) => `${TOWN_HALLS[th.level]} ${WHITE_NUMBERS[th.total]}\u200b`)
                            .join(' '))
                            .join('\n')
                    ].join('\n')
                }
            ]);
        }
        const embed = args.detailed ? detailedEmbed : summarizedEmbed;
        const payload = {
            cmd: this.id,
            tag: clanTag,
            detailed: args.detailed
        };
        const customIds = {
            toggle: this.createId({ ...payload, detailed: !args.detailed }),
            refresh: this.createId(payload)
        };
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(customIds.refresh)
            .setEmoji(EMOJIS.REFRESH)
            .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
            .setCustomId(customIds.toggle)
            .setStyle(ButtonStyle.Secondary)
            .setLabel(args.detailed ? 'Summarized Roster' : 'Detailed Roster'));
        return interaction.editReply({ embeds: [embed], components: [row] });
    }
    getNextRoster(clan, townHalls) {
        const roster = this.roster(clan);
        return townHalls.map((th) => WHITE_NUMBERS[roster[th] || 0]).join('');
    }
    flat(tag, townHalls, body) {
        const roster = this.roster(body.clans.find((clan) => clan.tag === tag));
        return townHalls.map((th) => WHITE_NUMBERS[roster[th] || 0]).join('');
    }
    roster(clan) {
        return clan.members.reduce((count, member) => {
            const townHall = member.townHallLevel || member.townhallLevel;
            count[townHall] = (count[townHall] || 0) + 1;
            return count;
        }, {});
    }
    winner(clan, opponent) {
        return this.client.coc.isWinner(clan, opponent);
    }
}
//# sourceMappingURL=cwl-roster.js.map