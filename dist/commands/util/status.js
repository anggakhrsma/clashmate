import { EmbedBuilder } from 'discord.js';
import moment from 'moment';
import 'moment-duration-format';
import { readFile } from 'node:fs/promises';
import os from 'os';
import { URL, fileURLToPath } from 'url';
import { Command } from '../../lib/handlers.js';
const pkgPath = fileURLToPath(new URL('../../../package.json', import.meta.url).href);
const pkg = JSON.parse((await readFile(pkgPath)).toString());
export default class StatusCommand extends Command {
    constructor() {
        super('status', {
            aliases: ['bot'],
            category: 'none',
            channel: 'guild',
            clientPermissions: ['EmbedLinks'],
            defer: true,
            ephemeral: false
        });
    }
    async run(message) {
        const embed = await this.get(message.guild);
        return message.channel.send({ embeds: [embed] });
    }
    async exec(interaction) {
        const embed = await this.get(interaction.guild);
        return interaction.editReply({ embeds: [embed] });
    }
    async get(guild) {
        let [guilds, memory] = [0, 0];
        const values = [[this.client.guilds.cache.size, 0, 0]];
        for (const value of values ?? [
            [this.client.guilds.cache.size, process.memoryUsage().heapUsed / 1024 / 1024]
        ]) {
            guilds += value[0];
            memory += value[1];
        }
        const embed = new EmbedBuilder()
            .setColor(this.client.embed(guild.id))
            .setAuthor({
            name: `${this.client.user.displayName}`,
            iconURL: this.client.user.displayAvatarURL({ extension: 'png' })
        })
            .addFields({
            name: 'Memory Usage',
            value: `${memory.toFixed(2)} MB`,
            inline: false
        });
        embed.addFields({
            name: 'Free Memory',
            value: `${this.freemem.toFixed(2)} MB`,
            inline: false
        });
        embed.addFields({
            name: 'Uptime',
            value: moment
                .duration(process.uptime() * 1000)
                .format('D[d], H[h], m[m], s[s]', { trim: 'both mid' }),
            inline: false
        }, {
            name: 'Servers',
            value: guilds.toLocaleString(),
            inline: false
        }, {
            name: 'Commands Used',
            value: `${(await this.usage()).toLocaleString()} (last 30d)`,
            inline: false
        }, {
            name: 'Clans',
            value: `${(await this.count("ClanStores" /* Collections.CLAN_STORES */)).toLocaleString()}`,
            inline: false
        });
        embed.addFields({
            name: 'Players',
            value: `${(await this.count("Players" /* Collections.PLAYERS */)).toLocaleString()}`,
            inline: false
        }, {
            name: 'Links',
            value: `${(await this.count("PlayerLinks" /* Collections.PLAYER_LINKS */)).toLocaleString()}`,
            inline: false
        });
        embed.addFields({
            name: 'Shard',
            value: `${guild.shard.id}/${1}`,
            inline: false
        }, {
            name: 'Version',
            value: `[${pkg.version}](https://github.com/clashperk/clashperk/commit/${process.env.GIT_SHA})`,
            inline: false
        }, {
            name: 'Status Page',
            value: 'https://status.clashperk.com',
            inline: false
        });
        return embed;
    }
    get freemem() {
        return os.freemem() / (1024 * 1024);
    }
    count(collection) {
        return this.client.db.collection(collection).estimatedDocumentCount();
    }
    async usage() {
        const [usage] = await this.client.db
            .collection("BotUsage" /* Collections.BOT_USAGE */)
            .aggregate([
            {
                $sort: {
                    createdAt: -1
                }
            },
            {
                $match: {
                    createdAt: {
                        $gte: moment().subtract(30, 'days').toDate()
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    total: {
                        $sum: '$usage'
                    }
                }
            }
        ])
            .toArray();
        return usage?.total ?? 0;
    }
}
//# sourceMappingURL=status.js.map