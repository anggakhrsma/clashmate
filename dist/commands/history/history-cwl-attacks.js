import { WAR_LEAGUE_MAP } from '../../util/constants.js';
import { EmbedBuilder } from 'discord.js';
import moment from 'moment';
import { ObjectId } from 'mongodb';
import { Command } from '../../lib/handlers.js';
import { BLUE_NUMBERS, CWL_LEAGUES, EMOJIS, ORANGE_NUMBERS, WHITE_NUMBERS } from '../../util/emojis.js';
import { handlePagination } from '../../util/pagination.js';
const stars = {
    0: '☆☆☆',
    1: '★☆☆',
    2: '★★☆',
    3: '★★★'
};
export default class CWLHistoryCommand extends Command {
    constructor() {
        super('cwl-attacks-history', {
            category: 'none',
            channel: 'guild',
            clientPermissions: ['UseExternalEmojis', 'EmbedLinks'],
            defer: true
        });
    }
    async exec(interaction, args) {
        if (args.player) {
            const player = await this.client.resolver.resolvePlayer(interaction, args.player);
            if (!player)
                return null;
            const playerTags = [player.tag];
            return this.getHistory(interaction, playerTags);
        }
        if (args.clans) {
            const { clans } = await this.client.storage.handleSearch(interaction, { args: args.clans });
            if (!clans)
                return;
            const _clans = (await Promise.all(clans.slice(0, 1).map((clan) => this.client.coc.getClan(clan.tag))))
                .filter((r) => r.res.ok)
                .map((r) => r.body);
            const playerTags = _clans.flatMap((clan) => clan.memberList.map((member) => member.tag));
            return this.getHistory(interaction, playerTags);
        }
        if (args.roster && ObjectId.isValid(args.roster)) {
            const data = await this.client.db
                .collection("Rosters" /* Collections.ROSTERS */)
                .findOne({ _id: new ObjectId(args.roster) });
            if (!data || !data.members?.length)
                return interaction.editReply('No roster found.');
            return this.getHistory(interaction, data.members.map((m) => m.tag));
        }
        const playerTags = await this.client.resolver.getLinkedPlayerTags(args.user?.id ?? interaction.user.id);
        return this.getHistory(interaction, playerTags);
    }
    async getHistory(interaction, playerTags) {
        const _wars = await this.getWars(playerTags);
        const leagueGroupIds = [...new Set(_wars.map((a) => a.leagueGroupId).filter(Boolean))];
        const groups = await this.client.db
            .collection("CWLGroups" /* Collections.CWL_GROUPS */)
            .find({
            $or: [{ id: { $in: leagueGroupIds } }, { leagueGroupId: { $in: leagueGroupIds } }]
        }, { projection: { season: 1, leagues: 1, id: 1, leagueGroupId: 1 } })
            .toArray();
        const groupMap = groups.reduce((acc, group) => {
            Object.entries(group.leagues ?? {}).map(([tag, leagueId]) => {
                acc[`${group.season}-${tag}`] = leagueId;
            });
            return acc;
        }, {});
        const warMap = _wars.reduce((acc, war) => {
            const key = `${war.member.name} (${war.member.tag})`;
            acc[key] ??= [];
            acc[key].push(war);
            return acc;
        }, {});
        const embeds = [];
        Object.entries(warMap)
            .sort(([, a], [, b]) => b.length - a.length)
            .map(([key, userGroups]) => {
            const embed = new EmbedBuilder().setColor(this.client.embed(interaction));
            const _warsMap = userGroups.reduce((acc, war) => {
                const seasonId = war.endTime.toISOString().slice(0, 7);
                acc[seasonId] ??= [];
                acc[seasonId].push(war);
                return acc;
            }, {});
            const __wars = Object.entries(_warsMap);
            const value = __wars
                .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
                .map(([seasonId, wars], i) => {
                wars.sort((a, b) => a.endTime.getTime() - b.endTime.getTime());
                const participated = wars.filter((war) => war.attack).length;
                const totalStars = wars.reduce((acc, war) => acc + (war.attack?.stars ?? 0), 0);
                const totalDestruction = wars.reduce((acc, war) => acc + this.getAttackDestruction(war.attack), 0);
                const season = moment(seasonId).format('MMM YYYY').toString();
                const [{ member, clan }] = wars;
                const leagueId = groupMap[`${seasonId}-${clan.tag}`];
                const leagueName = WAR_LEAGUE_MAP[leagueId];
                const leagueIcon = CWL_LEAGUES[leagueName];
                const header = [`**${season}** (#${member.mapPosition}, TH${this.getTownHallLevel(member)})`];
                if (clan.name)
                    header.push(clan.name);
                if (leagueName)
                    header.push(`${leagueIcon} ${leagueName}`);
                return [
                    header.join('\n'),
                    wars
                        .filter((war) => war.attack)
                        .map(({ attack, defender }, i) => {
                        return `${WHITE_NUMBERS[i + 1]} ${stars[attack.stars]} \`${this.percentage(this.getAttackDestruction(attack))}\` \u200b → ${BLUE_NUMBERS[defender.mapPosition]}${ORANGE_NUMBERS[this.getTownHallLevel(defender)]}`;
                    })
                        .join('\n'),
                    `${EMOJIS.CROSS_SWORD} ${participated}/${wars.length} wars, ${totalStars} stars, ${totalDestruction}%`,
                    i === __wars.length - 1 ? '' : '\u200b'
                ].join('\n');
            })
                .join('\n');
            embed.setTitle('**CWL attack history (last 3 months)**');
            embed.setDescription(`**${key}**\n\n${value}`);
            embeds.push(embed);
        });
        if (!embeds.length) {
            return interaction.editReply('No CWL history found.');
        }
        if (embeds.length === 1) {
            return interaction.editReply({ embeds: [...embeds], components: [] });
        }
        return handlePagination(interaction, embeds);
    }
    async getWars(tags) {
        const cursor = this.client.db.collection("ClanWars" /* Collections.CLAN_WARS */).aggregate([
            {
                $match: {
                    startTime: {
                        $gte: moment()
                            .startOf('month')
                            .subtract(new Date().getDate() >= 10 ? 2 : 3, 'month')
                            .toDate()
                    },
                    warType: 3 /* WarType.CWL */,
                    $or: [{ 'clan.members.tag': { $in: tags } }, { 'opponent.members.tag': { $in: tags } }]
                }
            },
            { $sort: { _id: -1 } }
        ]);
        const attacks = [];
        for await (const data of cursor) {
            data.clan.members.sort((a, b) => a.mapPosition - b.mapPosition);
            data.opponent.members.sort((a, b) => a.mapPosition - b.mapPosition);
            for (const tag of tags) {
                const __member = data.clan.members
                    .map((mem, i) => ({ ...mem, mapPosition: i + 1 }))
                    .find((m) => m.tag === tag);
                const member = __member ??
                    data.opponent.members
                        .map((mem, i) => ({ ...mem, mapPosition: i + 1 }))
                        .find((m) => m.tag === tag);
                if (!member)
                    continue;
                const clan = __member ? data.clan : data.opponent;
                const opponent = clan.tag === data.clan.tag ? data.opponent : data.clan;
                const __attacks = clan.members.flatMap((m) => m.attacks ?? []);
                const memberAttacks = __attacks.filter((atk) => atk.attackerTag === tag);
                if (!memberAttacks.length) {
                    attacks.push({
                        attack: null,
                        previousBestAttack: null,
                        defender: null,
                        clan: {
                            name: clan.name,
                            tag: clan.tag
                        },
                        endTime: new Date(data.endTime),
                        member,
                        // @ts-expect-error it exists
                        leagueGroupId: data.leagueGroupId
                    });
                }
                for (const atk of memberAttacks) {
                    const defender = opponent.members.find((m) => m.tag === atk.defenderTag);
                    const previousBestAttack = this.client.coc.getPreviousBestAttack(__attacks, atk);
                    attacks.push({
                        attack: atk,
                        previousBestAttack,
                        defender,
                        clan: {
                            name: clan.name,
                            tag: clan.tag
                        },
                        endTime: new Date(data.endTime),
                        member,
                        // @ts-expect-error it exists
                        leagueGroupId: data.leagueGroupId
                    });
                }
            }
        }
        return attacks;
    }
    percentage(num) {
        return `${num}%`.toString().padStart(4, ' ');
    }
    getAttackDestruction(attack) {
        if (!attack)
            return 0;
        const value = attack.destructionPercentage ??
            attack.destruction ??
            0;
        return Number.isFinite(value) ? value : 0;
    }
    getTownHallLevel(member) {
        if (!member)
            return 0;
        const value = member.townhallLevel ??
            member.townHallLevel ??
            0;
        return Number.isFinite(value) ? value : 0;
    }
}
//# sourceMappingURL=history-cwl-attacks.js.map