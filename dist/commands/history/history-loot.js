import { EmbedBuilder } from 'discord.js';
import moment from 'moment';
import { Command } from '../../lib/handlers.js';
import { handlePagination } from '../../util/pagination.js';
import { Util } from '../../util/toolkit.js';
import { cluster } from 'radash';
export default class LootHistoryCommand extends Command {
    constructor() {
        super('loot-history', {
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
            .collection("PlayerSeasons" /* Collections.PLAYER_SEASONS */)
            .aggregate([
            { $match: { tag: { $in: playerTags } } },
            {
                $match: {
                    createdAt: {
                        $gte: moment().startOf('month').subtract(12, 'month').toDate()
                    }
                }
            },
            { $sort: { _id: -1 } },
            {
                $set: {
                    elixirLoot: {
                        $subtract: ['$elixirLoots.current', '$elixirLoots.initial']
                    },
                    goldLoot: {
                        $subtract: ['$goldLoots.current', '$goldLoots.initial']
                    },
                    darkLoot: {
                        $subtract: ['$darkElixirLoots.current', '$darkElixirLoots.initial']
                    }
                }
            },
            {
                $set: {
                    totalLoot: {
                        $sum: ['$elixirLoot', '$goldLoot', '$darkLoot']
                    }
                }
            },
            {
                $group: {
                    _id: '$tag',
                    name: { $first: '$name' },
                    tag: { $first: '$tag' },
                    seasonCount: { $sum: 1 },
                    totalLoot: { $sum: '$totalLoot' },
                    attackWins: { $sum: '$attackWins' },
                    seasons: {
                        $push: {
                            season: '$season',
                            goldLoot: '$goldLoot',
                            elixirLoot: '$elixirLoot',
                            darkLoot: '$darkLoot'
                        }
                    }
                }
            },
            {
                $sort: {
                    seasonCount: -1
                }
            },
            {
                $sort: {
                    totalLoot: -1
                }
            }
        ])
            .toArray();
        const embeds = [];
        for (const chunk of cluster(result, 12)) {
            const embed = new EmbedBuilder();
            embed.setColor(this.client.embed(interaction));
            embed.setTitle('Loot History (last 12 months)');
            chunk.forEach(({ name, tag, seasons }) => {
                embed.addFields({
                    name: `${name} (${tag})`,
                    value: [
                        '```',
                        `\u200e${'GOLD'.padStart(7, ' ')} ${'ELIXIR'.padStart(7, ' ')} ${'DARK'.padStart(7, ' ')}    SEASON`,
                        seasons
                            .map((season) => {
                            const _gold = Util.formatNumber(season.goldLoot).padStart(7, ' ');
                            const _elixir = Util.formatNumber(season.elixirLoot).padStart(7, ' ');
                            const _dark = Util.formatNumber(season.darkLoot).padStart(7, ' ');
                            return `${_gold} ${_elixir} ${_dark}  ${moment(season.season).format('MMM YYYY')}`;
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
}
//# sourceMappingURL=history-loot.js.map