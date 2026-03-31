import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import moment from 'moment';
import { cluster } from 'radash';
import { Command } from '../../lib/handlers.js';
import { dynamicPagination } from '../../util/pagination.js';
import { Season } from '../../util/toolkit.js';
export default class LeaderboardCapitalCommand extends Command {
    constructor() {
        super('leaderboard-capital', {
            category: 'search',
            channel: 'guild',
            defer: true
        });
    }
    async exec(interaction, args) {
        const loc = await this.client.db
            .collection("CapitalRanks" /* Collections.CAPITAL_RANKS */)
            .findOne({ countryCode: args.location || 'global', season: args.season || Season.ID });
        if (!loc) {
            return interaction.editReply('An error occurred while fetching the leaderboard.');
        }
        const clanTags = (await this.client.storage.find(interaction.guildId)).map((clan) => clan.tag);
        const clans = loc.clans.map((clan) => ({
            name: clan.name,
            tag: clan.tag,
            rank: clan.rank,
            trophies: clan.clanCapitalPoints
        }));
        const season = moment(loc.season).format('MMM YYYY');
        const embeds = [];
        cluster(clans, 100).forEach((clans, idx) => {
            const embed = new EmbedBuilder();
            embed.setColor(this.client.embed(interaction));
            embed.setDescription(clans
                .map((clan) => {
                if (clanTags.includes(clan.tag)) {
                    return `${idx * 101}. \`${clan.trophies}\` \u200b \u200e[${escapeMarkdown(clan.name)}](http://cprk.us/c/${clan.tag.replace('#', '')})`;
                }
                return `${idx * 101}. \`${clan.trophies}\` \u200b \u200e${escapeMarkdown(clan.name)}`;
            })
                .join('\n'));
            embed.setTitle(`${loc.country} Capital Leaderboard (${season})`);
            embed.setFooter({ text: `${loc.country} (${season})` });
            embeds.push(embed);
        });
        return dynamicPagination(interaction, embeds, { cmd: this.id, ...args });
    }
}
//# sourceMappingURL=leaderboard-capital.js.map