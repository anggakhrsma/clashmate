import { EmbedBuilder } from 'discord.js';
import moment from 'moment';
import { Command } from '../../lib/handlers.js';
import { handlePagination } from '../../util/pagination.js';
import { cluster } from 'radash';
export default class CapitalContributionHistoryCommand extends Command {
    constructor() {
        super('capital-contribution-history', {
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
            .collection("CapitalContributions" /* Collections.CAPITAL_CONTRIBUTIONS */)
            .aggregate([
            {
                $match: {
                    tag: {
                        $in: [...playerTags]
                    },
                    createdAt: {
                        $gte: moment().startOf('month').subtract(3, 'month').toDate()
                    }
                }
            },
            {
                $set: {
                    week: {
                        $dateTrunc: {
                            date: '$createdAt',
                            unit: 'week',
                            startOfWeek: 'monday'
                        }
                    }
                }
            },
            {
                $addFields: {
                    total: {
                        $subtract: ['$current', '$initial']
                    }
                }
            },
            {
                $group: {
                    _id: {
                        week: '$week',
                        tag: '$tag'
                    },
                    week: {
                        $first: '$week'
                    },
                    name: {
                        $first: '$name'
                    },
                    tag: {
                        $first: '$tag'
                    },
                    total: {
                        $sum: '$total'
                    }
                }
            },
            {
                $sort: {
                    week: -1
                }
            },
            {
                $group: {
                    _id: '$tag',
                    name: {
                        $first: '$name'
                    },
                    tag: {
                        $first: '$tag'
                    },
                    total: {
                        $sum: '$total'
                    },
                    weeks: {
                        $push: {
                            week: '$week',
                            total: '$total'
                        }
                    }
                }
            },
            {
                $sort: {
                    total: -1
                }
            }
        ])
            .toArray();
        result.sort((a, b) => b.weeks.length - a.weeks.length);
        const embeds = [];
        for (const chunk of cluster(result, 15)) {
            const embed = new EmbedBuilder();
            embed.setColor(this.client.embed(interaction));
            embed.setTitle('Capital Contribution History (last 3 months)');
            chunk.forEach(({ name, tag, weeks }) => {
                embed.addFields({
                    name: `${name} (${tag})`,
                    value: [
                        '```',
                        '\u200e #   LOOT   WEEKEND',
                        weeks
                            .slice(0, 14)
                            .map((week, i) => `\u200e${(i + 1).toString().padStart(2, ' ')}  ${this.padding(week.total)}  ${moment(week.week)
                            .format('D MMM')
                            .padStart(7, ' ')}`)
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
//# sourceMappingURL=history-capital-contribution.js.map