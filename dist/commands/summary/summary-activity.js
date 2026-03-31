import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Command } from '../../lib/handlers.js';
import { EMOJIS } from '../../util/emojis.js';
import { padStart } from '../../util/helper.js';
import { Season, Util } from '../../util/toolkit.js';
export default class SummaryCommand extends Command {
    constructor() {
        super('summary-activity', {
            category: 'none',
            channel: 'guild',
            clientPermissions: ['EmbedLinks'],
            defer: true
        });
    }
    async exec(interaction, args) {
        const season = args.season ?? Season.ID;
        const { clans, resolvedArgs } = await this.client.storage.handleSearch(interaction, {
            args: args.clans
        });
        if (!clans)
            return;
        const embed = args.clans_only
            ? await this.getClansEmbed(interaction, clans)
            : await this.getMembersEmbed(interaction, clans, season, Boolean(args.asc_order));
        const payload = {
            cmd: this.id,
            clans_only: args.clans_only,
            season: args.season,
            clans: resolvedArgs,
            asc_order: args.asc_order
        };
        const customIds = {
            refresh: this.createId(payload),
            toggle: this.createId({ ...payload, clans_only: !args.clans_only }),
            asc_order: this.createId({ ...payload, asc_order: !args.asc_order })
        };
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setEmoji(EMOJIS.REFRESH)
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(customIds.refresh), new ButtonBuilder()
            .setLabel(args.clans_only ? 'Players Summary' : 'Clans Summary')
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(customIds.toggle), new ButtonBuilder()
            .setLabel(args.asc_order ? 'Most Active' : 'Least Active')
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(customIds.asc_order));
        return interaction.editReply({ embeds: [embed], components: [row] });
    }
    async getActivity(clanTag) {
        const rows = { data: [] }; // ClickHouse removed
        return {
            avgDailyOnline: Number(rows.data[0]?.avg_daily_active_members ?? 0),
            avgDailyActivity: Number(rows.data[0]?.avg_daily_activity_count ?? 0)
        };
    }
    async aggregationQuery(playerTags, season, ascOrder) {
        const db = this.client.db.collection("Players" /* Collections.PLAYERS */);
        const result = await db
            .aggregate([
            {
                $match: {
                    tag: {
                        $in: playerTags
                    }
                }
            },
            {
                $sort: {
                    [`seasons.${season}`]: ascOrder ? 1 : -1
                }
            },
            {
                $project: {
                    tag: '$tag',
                    name: '$name',
                    lastSeen: '$lastSeen',
                    score: `$seasons.${season}`
                }
            },
            {
                $match: {
                    score: {
                        $exists: true
                    },
                    lastSeen: {
                        $exists: true
                    }
                }
            },
            {
                $limit: 99
            }
        ])
            .toArray();
        return result.filter((r) => r.score && r.lastSeen);
    }
    async getClansEmbed(interaction, clans) {
        const collection = [];
        for (const clan of clans) {
            const action = await this.getActivity(clan.tag);
            collection.push({
                online: action?.avgDailyOnline ?? 0,
                total: action?.avgDailyActivity ?? 0,
                name: clan.name,
                tag: clan.tag
            });
            if (!action)
                continue;
        }
        collection.sort((a, b) => b.total - a.total);
        const embed = new EmbedBuilder();
        embed.setAuthor({ name: 'Clan Activity Summary' });
        embed.setDescription([
            '**Daily Average Active Members (last 30d)**',
            '',
            `\u200e\` #  AVG  SCORE \`  CLAN NAME`,
            ...collection.map((clan, i) => {
                const online = padStart(clan.online.toFixed(0), 3);
                const total = padStart(clan.total.toFixed(0), 5);
                return `\u200e\`${padStart(i + 1, 2)}  ${online}  ${total} \` ${clan.name}`;
            })
        ].join('\n'));
        return embed;
    }
    async getMembersEmbed(interaction, clans, season, ascOrder) {
        const embed = new EmbedBuilder();
        embed.setAuthor({ name: 'Most Active Members' });
        const clanList = (await Promise.all(clans.map((clan) => this.client.coc.getClan(clan.tag))))
            .filter((r) => r.res.ok)
            .map((r) => r.body);
        const clanMemberTags = clanList.flatMap((clan) => clan.memberList).map((m) => m.tag);
        const members = await this.aggregationQuery(clanMemberTags, season, ascOrder);
        embed.setDescription([
            `\u200e\` #  LAST-ON SCORE \` NAME`,
            members
                .map((m, idx) => `\u200e\`${padStart(idx + 1, 2)}  ${this.getTime(m.lastSeen.getTime())}  ${padStart(m.score, 4)} \`  ${m.name}`)
                .join('\n')
        ].join('\n'));
        embed.setFooter({ text: `Season ${season}` });
        return embed;
    }
    getTime(ms) {
        ms = Date.now() - ms;
        if (!ms)
            return ''.padEnd(7, ' ');
        return Util.duration(ms + 1e3).padEnd(7, ' ');
    }
}
//# sourceMappingURL=summary-activity.js.map