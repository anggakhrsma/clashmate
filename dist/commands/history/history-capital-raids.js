import { EmbedBuilder } from 'discord.js';
import moment from 'moment';
import { Command } from '../../lib/handlers.js';
import { handlePagination } from '../../util/pagination.js';
import { cluster } from 'radash';
export default class CapitalRaidsHistoryCommand extends Command {
    constructor() {
        super('capital-raids-history', {
            category: 'none',
            channel: 'guild',
            clientPermissions: ['EmbedLinks'],
            defer: true
        });
    }
    async exec(interaction, args) {
        if (args.user) {
            const playerTags = await this.client.resolver.getLinkedPlayerTags(args.user.id);
            const { embeds, result } = await this.getHistory(interaction, playerTags);
            if (!result.length) {
                return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
            }
            return handlePagination(interaction, embeds);
        }
        if (args.player) {
            const player = await this.client.resolver.resolvePlayer(interaction, args.player);
            if (!player)
                return null;
            const playerTags = [player.tag];
            const { embeds, result } = await this.getHistory(interaction, playerTags);
            if (!result.length) {
                return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
            }
            return handlePagination(interaction, embeds);
        }
        const { clans } = await this.client.storage.handleSearch(interaction, { args: args.clans });
        if (!clans)
            return;
        const _clans = (await Promise.all(clans.map((clan) => this.client.coc.getClan(clan.tag))))
            .filter((r) => r.res.ok)
            .map((r) => r.body);
        const playerTags = _clans.flatMap((clan) => clan.memberList.map((member) => member.tag));
        const { embeds, result } = await this.getHistory(interaction, playerTags);
        if (!result.length) {
            return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
        }
        return handlePagination(interaction, embeds);
    }
    async getHistory(interaction, playerTags) {
        const result = await this.client.db
            .collection("CapitalRaidSeasons" /* Collections.CAPITAL_RAID_SEASONS */)
            .aggregate([
            {
                $match: {
                    'members.tag': {
                        $in: [...playerTags]
                    },
                    'createdAt': {
                        $gte: moment().startOf('month').subtract(2, 'month').toDate()
                    }
                }
            },
            {
                $unwind: {
                    path: '$members'
                }
            },
            {
                $match: {
                    'members.tag': {
                        $in: [...playerTags]
                    }
                }
            },
            {
                $sort: {
                    _id: -1
                }
            },
            {
                $group: {
                    _id: '$members.tag',
                    name: {
                        $first: '$members.name'
                    },
                    tag: {
                        $first: '$members.tag'
                    },
                    raids: {
                        $push: {
                            weekId: '$weekId',
                            clan: {
                                name: '$name',
                                tag: '$tag'
                            },
                            name: '$members.name',
                            tag: '$members.tag',
                            attacks: '$members.attacks',
                            attackLimit: '$members.attackLimit',
                            bonusAttackLimit: '$members.bonusAttackLimit',
                            capitalResourcesLooted: '$members.capitalResourcesLooted',
                            reward: {
                                $sum: [
                                    {
                                        $multiply: ['$offensiveReward', '$members.attacks']
                                    },
                                    '$defensiveReward'
                                ]
                            }
                        }
                    }
                }
            }
        ])
            .toArray();
        result.sort((a, b) => b.raids.length - a.raids.length);
        const embeds = [];
        for (const chunk of cluster(result, 10)) {
            const embed = new EmbedBuilder();
            embed.setColor(this.client.embed(interaction));
            embed.setTitle('Capital Raid History (last 2 months)');
            chunk.forEach((member) => {
                embed.addFields({
                    name: `${member.name} (${member.tag})`,
                    value: [
                        '```',
                        '#  LOOT HIT   WEEK CLAN',
                        member.raids
                            .slice(0, 9)
                            .map((raid, i) => {
                            const looted = raid.capitalResourcesLooted.toString().padStart(3, ' ');
                            const attacks = `${raid.attacks}/${raid.attackLimit + raid.bonusAttackLimit}`;
                            const week = moment(raid.weekId).format('D/MMM').padStart(6, ' ');
                            return `${i + 1} ${looted} ${attacks} ${week} \u200e${raid.clan.name}`;
                        })
                            .join('\n'),
                        '```'
                    ].join('\n')
                });
            });
            embeds.push(embed);
        }
        return { embeds, result };
    }
    padding(num) {
        return num.toString().padStart(6, ' ');
    }
}
//# sourceMappingURL=history-capital-raids.js.map