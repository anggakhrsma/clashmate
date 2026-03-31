import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageType, StringSelectMenuBuilder } from 'discord.js';
import { getBbLegendRankingEmbedMaker, getLegendRankingEmbedMaker } from '../../helper/leaderboard.helper.js';
import { Command } from '../../lib/handlers.js';
import { EMOJIS } from '../../util/emojis.js';
import { Season } from '../../util/toolkit.js';
export default class LegendLeaderboardCommand extends Command {
    constructor() {
        super('legend-leaderboard', {
            category: 'search',
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
        let seasonId = args.season ?? Season.ID;
        const isDefaultMessage = interaction.isMessageComponent() && interaction.message.type === MessageType.Default;
        if (isDefaultMessage) {
            const currentSeasonEnd = this.client.coc.util.getSeasonEnd(new Date()).toISOString();
            const messageSentAt = this.client.coc.util
                .getSeasonEnd(interaction.message.createdAt)
                .toISOString();
            if (currentSeasonEnd !== messageSentAt)
                seasonId = messageSentAt.slice(0, 7);
        }
        const { embed, players } = args.is_bb
            ? await getBbLegendRankingEmbedMaker({
                guild: interaction.guild,
                sort_by: args.sort_by,
                limit: args.limit,
                seasonId,
                clanTags: clans.map((clan) => clan.tag)
            })
            : await getLegendRankingEmbedMaker({
                guild: interaction.guild,
                sort_by: args.sort_by,
                limit: args.limit,
                seasonId,
                clanTags: clans.map((clan) => clan.tag)
            });
        if (!players.length) {
            embed.setDescription(`No players are in the ${args.is_bb ? 'Legend League' : 'Leaderboard'}`);
        }
        if (players.length &&
            args.enable_auto_updating &&
            this.client.util.isManager(interaction.member)) {
            await this.client.storage.makeAutoBoard({
                channelId: interaction.channelId,
                boardType: args.enable_auto_updating,
                guild: interaction.guild,
                props: { limit: args.limit }
            });
            return interaction.editReply('Successfully enabled auto updating Leaderboard.');
        }
        const currentSeasonId = Season.ID;
        const payload = {
            cmd: this.id,
            clans: resolvedArgs,
            sort_by: args.sort_by,
            limit: args.limit,
            is_bb: args.is_bb,
            season: args.season && args.season !== currentSeasonId ? args.season : null
        };
        const customIds = {
            toggle: this.createId({ ...payload, is_bb: !args.is_bb }),
            refresh: this.createId({ ...payload, export_disabled: false }),
            sortBy: this.createId({ ...payload, string_key: 'sort_by' })
        };
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setEmoji(EMOJIS.REFRESH)
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(customIds.refresh));
        if (!args.is_bb) {
            row.addComponents();
        }
        if (!isDefaultMessage) {
            row.addComponents(new ButtonBuilder()
                .setLabel(args.is_bb ? 'Legend League' : 'Builder Base League')
                .setStyle(ButtonStyle.Secondary)
                .setCustomId(customIds.toggle));
        }
        const sortingRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(customIds.sortBy)
            .setPlaceholder('Sort by')
            .addOptions({
            label: 'Town Hall Ascending',
            description: 'Lowest Town Hall with highest Trophies',
            value: 'town_hall_asc',
            default: args.sort_by === 'town_hall_asc'
        }, {
            label: 'Town Hall Descending',
            description: 'Highest Town Hall with highest Trophies',
            value: 'town_hall_desc',
            default: args.sort_by === 'town_hall_desc'
        }, {
            label: 'Trophies Only',
            description: 'Highest Trophies Only',
            value: 'trophies_only',
            default: args.sort_by === 'trophies_only'
        }));
        if (seasonId !== Season.ID && !args.season) {
            return interaction.editReply({ embeds: [embed], components: [] });
        }
        await interaction.editReply({
            embeds: [embed],
            components: args.is_bb || isDefaultMessage ? [row] : [row, sortingRow]
        });
    }
    async export(interaction, players, clans) {
        const sheets = [
            {
                title: `Leaderboard`,
                columns: [
                    { name: 'NAME', align: 'LEFT', width: 160 },
                    { name: 'TAG', align: 'LEFT', width: 160 },
                    { name: 'CLAN', align: 'LEFT', width: 160 },
                    { name: 'CLAN TAG', align: 'LEFT', width: 160 },
                    { name: 'TOWN HALL', align: 'RIGHT', width: 100 },
                    { name: 'TROPHIES', align: 'RIGHT', width: 100 },
                    { name: 'ATTACKS WON', align: 'RIGHT', width: 100 }
                ],
                rows: players.map((player) => [
                    player.name,
                    player.tag,
                    player.clan?.name,
                    player.clan?.tag,
                    player.townHallLevel,
                    player.trophies,
                    player.attackWins
                ])
            }
        ];
        return interaction.editReply({ content: 'Export is not available.' });
    }
}
//# sourceMappingURL=legend-leaderboard.js.map