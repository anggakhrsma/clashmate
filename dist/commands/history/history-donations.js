import { EmbedBuilder } from 'discord.js';
import moment from 'moment';
import { cluster } from 'radash';
import { Command } from '../../lib/handlers.js';
import { handlePagination } from '../../util/pagination.js';
import { Util } from '../../util/toolkit.js';
export default class DonationsHistoryCommand extends Command {
    constructor() {
        super('donations-history', {
            category: 'none',
            channel: 'guild',
            clientPermissions: ['EmbedLinks'],
            defer: true
        });
    }
    async exec(interaction, args) {
        const tags = await this.client.resolver.resolveArgs(args.clans);
        const clans = tags.length
            ? await this.client.storage.search(interaction.guildId, tags)
            : await this.client.storage.find(interaction.guildId);
        const includedClans = tags.length ? clans : [];
        if (args.user) {
            const playerTags = await this.client.resolver.getLinkedPlayerTags(args.user.id);
            const { embeds, result } = await this.getHistory(interaction, playerTags, includedClans);
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
            const { embeds, result } = await this.getHistory(interaction, playerTags, includedClans);
            if (!result.length) {
                return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
            }
            return handlePagination(interaction, embeds);
        }
        if (!clans.length && tags.length)
            return interaction.editReply(this.i18n('common.no_clans_found', {
                lng: interaction.locale,
                command: this.client.commands.SETUP_CLAN
            }));
        if (!clans.length) {
            return interaction.editReply(this.i18n('common.no_clans_linked', {
                lng: interaction.locale,
                command: this.client.commands.SETUP_CLAN
            }));
        }
        const _clans = (await Promise.all(clans.map((clan) => this.client.coc.getClan(clan.tag))))
            .filter((r) => r.res.ok)
            .map((r) => r.body);
        const playerTags = _clans.flatMap((clan) => clan.memberList.map((member) => member.tag));
        const { embeds, result } = await this.getHistory(interaction, playerTags, clans);
        if (!result.length) {
            return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
        }
        return handlePagination(interaction, embeds);
    }
    async getHistory(interaction, playerTags, clans) {
        const clanTags = clans?.map((clan) => clan.tag);
        const result = await this.client.db
            .collection("PlayerSeasons" /* Collections.PLAYER_SEASONS */)
            .aggregate([
            { $match: { tag: { $in: playerTags } } },
            {
                $match: {
                    createdAt: {
                        $gte: moment().startOf('month').subtract(7, 'month').toDate()
                    }
                }
            },
            { $sort: { _id: -1 } },
            {
                $set: {
                    _troops: {
                        $subtract: ['$troopsDonations.current', '$troopsDonations.initial']
                    },
                    _spells: {
                        $subtract: ['$spellsDonations.current', '$spellsDonations.initial']
                    },
                    _sieges: {
                        $multiply: [
                            {
                                $subtract: ['$siegeMachinesDonations.current', '$siegeMachinesDonations.initial']
                            },
                            30
                        ]
                    }
                }
            },
            {
                $set: {
                    donations: { $sum: ['$_troops', '$_spells', '$_sieges'] }
                }
            },
            {
                $group: {
                    _id: '$tag',
                    name: { $first: '$name' },
                    tag: { $first: '$tag' },
                    donations: {
                        $sum: '$donations'
                    },
                    seasons: {
                        $push: {
                            season: '$season',
                            clans: '$clans',
                            donations: '$donations'
                        }
                    }
                }
            },
            {
                $sort: {
                    donations: -1
                }
            }
        ])
            .toArray();
        const embeds = [];
        for (const chunk of cluster(result, 15)) {
            const embed = new EmbedBuilder();
            embed.setColor(this.client.embed(interaction));
            embed.setTitle('Donation History (last 6 months)');
            if (clans?.length)
                embed.setFooter({ text: clans.map((clan) => `${clan.name} (${clan.tag})`).join(', ') });
            chunk.forEach(({ name, tag, seasons }) => {
                embed.addFields({
                    name: `${name} (${tag})`,
                    value: [
                        '```',
                        `\u200e${'DON'.padStart(7, ' ')} ${'REC'.padStart(7, ' ')}    SEASON`,
                        seasons
                            .map((season) => {
                            const clans = Object.entries(season.clans ?? {})
                                .filter(([key, val]) => val && (clanTags?.length ? clanTags.includes(key) : true))
                                .map(([_, val]) => val);
                            const { donations, donationsReceived } = clans.reduce((acc, cur) => {
                                acc.donations += cur?.donations.total ?? 0;
                                acc.donationsReceived += cur?.donationsReceived.total ?? 0;
                                return acc;
                            }, { donations: 0, donationsReceived: 0 });
                            const _donations = donations; // Math.max(donations, season.donations);
                            const don = Util.formatNumber(_donations).padStart(7, ' ');
                            const rec = Util.formatNumber(donationsReceived).padStart(7, ' ');
                            return `${don} ${rec}  ${moment(season.season).format('MMM YYYY')}`;
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
//# sourceMappingURL=history-donations.js.map