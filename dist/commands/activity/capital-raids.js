import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import moment from 'moment';
import { Command } from '../../lib/handlers.js';
import { EMOJIS } from '../../util/emojis.js';
import { padStart } from '../../util/helper.js';
import { Season, Util } from '../../util/toolkit.js';
export default class CapitalRaidsCommand extends Command {
    constructor() {
        super('capital-raids', {
            category: 'activity',
            channel: 'guild',
            clientPermissions: ['EmbedLinks'],
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
        const currentWeekId = this.raidWeek().weekId;
        const weekId = args.week ?? currentWeekId;
        const { res, body: raid } = await this.client.coc.getRaidSeasons(clan.tag, 6);
        if (!res.ok || !raid.items.length) {
            return interaction.followUp({
                content: `Raid weekend info isn't available for ${clan.name} (${clan.tag})`
            });
        }
        const data = raid.items.find((item) => moment(item.startTime).format('YYYY-MM-DD') === weekId);
        const refreshButton = new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(EMOJIS.REFRESH)
            .setCustomId(JSON.stringify({ cmd: this.id, tag: clan.tag, week: weekId }));
        const row = new ActionRowBuilder().addComponents(refreshButton);
        const raidSeason = await this.aggregateCapitalRaids(clan, weekId);
        // Use aggregated members (includes non-participants) or fall back to API data
        let members = raidSeason?.members ?? [];
        if (!members.length && data?.members) {
            // Sort API members by looted descending, fix attackLimit to include bonus
            members = [...data.members]
                .map((m) => ({ ...m, attackLimit: m.attackLimit + (m.bonusAttackLimit ?? 0) }))
                .sort((a, b) => b.capitalResourcesLooted - a.capitalResourcesLooted);
            // Add clan members who didn't participate
            clan.memberList.forEach((member) => {
                if (!members.find((m) => m.tag === member.tag)) {
                    members.push({
                        name: member.name,
                        tag: member.tag,
                        capitalResourcesLooted: 0,
                        attacks: 0,
                        attackLimit: 5
                    });
                }
            });
        }
        if (!members.length || !data) {
            return interaction.followUp({
                content: this.i18n('command.capital.raids.no_data', {
                    weekId,
                    clan: clan.name,
                    lng: interaction.locale
                })
            });
        }
        const previousAttacks = raid.items
            .filter((raid) => raid.state !== 'ongoing')
            .map((item) => item.totalAttacks)
            .slice(0, 10);
        const embed = this.getCapitalRaidEmbed({
            clan,
            weekId,
            members,
            locale: interaction.locale,
            raidSeason: data,
            previousAttacks
        });
        await interaction.editReply({ embeds: [embed], components: [row] });
    }
    async aggregateCapitalRaids(clan, weekId) {
        const season = await this.client.db
            .collection("CapitalRaidSeasons" /* Collections.CAPITAL_RAID_SEASONS */)
            .findOne({ weekId, tag: clan.tag });
        if (!season)
            return null;
        if (!season.members.length)
            return null;
        const members = season.members.map((m) => ({
            ...m,
            attackLimit: m.attackLimit + (m.bonusAttackLimit ?? 0)
        }));
        clan.memberList.forEach((member) => {
            const raidMember = members.find((mem) => mem.tag === member.tag);
            if (!raidMember) {
                members.push({
                    name: member.name,
                    tag: member.tag,
                    capitalResourcesLooted: 0,
                    attacks: 0,
                    attackLimit: 5,
                    bonusAttackLimit: 0
                });
            }
        });
        return {
            members: members.sort((a, b) => b.capitalResourcesLooted - a.capitalResourcesLooted),
            data: season
        };
    }
    getCapitalRaidEmbed({ clan, weekId, members, locale }) {
        const startDate = moment(weekId).toDate();
        const endDate = moment(weekId).clone().add(3, 'days').toDate();
        const weekend = Util.raidWeekDateFormat(startDate, endDate);
        const embed = new EmbedBuilder()
            .setAuthor({
            name: `${clan.name} (${clan.tag})`,
            iconURL: clan.badgeUrls.small
        })
            .setTimestamp()
            .setFooter({
            text: [`Week of ${weekend}`].join('\n')
        });
        embed.setDescription([
            `**${this.i18n('command.capital.raids.title', { lng: locale })}**`,
            '```',
            '\u200e # LOOTED HITS  NAME',
            members
                .map((mem, i) => {
                const rank = (i + 1).toString().padStart(2, ' ');
                const looted = padStart(mem.capitalResourcesLooted, 6);
                const attacks = `${mem.attacks}/${mem.attackLimit}`.padStart(4, ' ');
                return `\u200e${rank} ${looted} ${attacks}  ${mem.name}`;
            })
                .join('\n'),
            '```'
        ].join('\n'));
        return embed;
    }
    calculateStats(raidSeason) {
        const offensive = {
            totalLoot: 0,
            totalAttacks: 0,
            attacksPerRaid: 0,
            lootPerRaid: 0,
            lootPerAttack: 0,
            projectedLoot: 0,
            lootPerClan: [],
            attacksPerClan: []
        };
        const defensive = {
            totalLoot: 0,
            totalAttacks: 0,
            attacksPerRaid: 0,
            lootPerRaid: 0,
            lootPerAttack: 0,
            lootPerClan: [],
            attacksPerClan: []
        };
        for (const defense of raidSeason.defenseLog) {
            defensive.totalAttacks += defense.attackCount;
            const loot = defense.districts.reduce((acc, cur) => acc + cur.totalLooted, 0);
            defensive.totalLoot += loot;
            if (defense.districtsDestroyed === defense.districtCount) {
                defensive.lootPerClan.push(loot);
                defensive.attacksPerClan.push(defense.attackCount);
            }
        }
        defensive.attacksPerRaid = Number((defensive.attacksPerClan.reduce((acc, cur) => acc + cur, 0) /
            defensive.attacksPerClan.length).toFixed(2));
        defensive.lootPerRaid = Number((defensive.lootPerClan.reduce((acc, cur) => acc + cur, 0) / defensive.lootPerClan.length).toFixed(2));
        defensive.lootPerAttack = Number((defensive.totalLoot / defensive.totalAttacks).toFixed(2));
        for (const attack of raidSeason.attackLog) {
            offensive.totalAttacks += attack.attackCount;
            const loot = attack.districts.reduce((acc, cur) => acc + cur.totalLooted, 0);
            offensive.totalLoot += loot;
            if (attack.districtsDestroyed === attack.districtCount) {
                offensive.lootPerClan.push(loot);
                offensive.attacksPerClan.push(attack.attackCount);
            }
        }
        offensive.attacksPerRaid = Number((offensive.attacksPerClan.reduce((acc, cur) => acc + cur, 0) /
            offensive.attacksPerClan.length).toFixed(2));
        offensive.lootPerRaid = Number((offensive.lootPerClan.reduce((acc, cur) => acc + cur, 0) / offensive.lootPerClan.length).toFixed(2));
        offensive.lootPerAttack = Number((offensive.totalLoot / offensive.totalAttacks).toFixed(2));
        offensive.projectedLoot = Number((offensive.lootPerAttack * 300).toFixed(2));
        return { offensive, defensive };
    }
    async rankings(tag) {
        const ranks = await this.client.db
            .collection("CapitalRanks" /* Collections.CAPITAL_RANKS */)
            .aggregate([
            {
                $match: {
                    season: Season.ID
                }
            },
            {
                $unwind: {
                    path: '$clans'
                }
            },
            {
                $match: {
                    'clans.tag': tag
                }
            }
        ])
            .toArray();
        return {
            globalRank: ranks.find(({ countryCode }) => countryCode === 'global')?.clans.rank ?? null,
            countryRank: ranks.find(({ countryCode }) => countryCode !== 'global') ?? null
        };
    }
    async performanceCard(body) {
        const res = await fetch(`${process.env.IMAGE_GEN_API_BASE_URL}/capital/raid-performance-card`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        }).then((res) => res.json());
        return `${process.env.IMAGE_GEN_API_BASE_URL}/${res.id}`;
    }
    raidWeek() {
        const today = new Date();
        const weekDay = today.getUTCDay();
        const hours = today.getUTCHours();
        const isRaidWeek = (weekDay === 5 && hours >= 7) || [0, 6].includes(weekDay) || (weekDay === 1 && hours < 7);
        today.setUTCDate(today.getUTCDate() - today.getUTCDay());
        if (weekDay < 5 || (weekDay <= 5 && hours < 7))
            today.setDate(today.getUTCDate() - 7);
        today.setUTCDate(today.getUTCDate() + 5);
        today.setUTCMinutes(0, 0, 0);
        return { weekDate: today, weekId: today.toISOString().slice(0, 10), isRaidWeek };
    }
}
//# sourceMappingURL=capital-raids.js.map