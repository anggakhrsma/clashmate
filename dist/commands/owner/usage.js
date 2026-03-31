import { EmbedBuilder } from 'discord.js';
import moment from 'moment';
import { Command } from '../../lib/handlers.js';
import Chart from '../../struct/chart-handler.js';
export default class UsageCommand extends Command {
    constructor() {
        super('usage', {
            category: 'owner',
            clientPermissions: ['EmbedLinks', 'AttachFiles'],
            defer: true,
            ownerOnly: true,
            ephemeral: true
        });
    }
    args() {
        return {
            chart: {
                match: 'STRING'
            },
            limit: {
                match: 'INTEGER'
            }
        };
    }
    async exec(interaction, { chart, limit }) {
        limit ??= 15;
        if (chart) {
            const url = await this.buffer(Number(limit));
            return interaction.editReply(url);
        }
        const { commands, total } = await this.commands();
        const maxDigit = Math.max(...commands.map((cmd) => cmd.uses.toString().length));
        const usage = await this.usage();
        const embed = new EmbedBuilder()
            .setAuthor({
            name: `${this.client.user.displayName}`,
            iconURL: this.client.user.displayAvatarURL({ extension: 'png' })
        })
            .setColor(this.client.embed(interaction))
            .setTitle('Usage')
            .setFooter({ text: `${total.toLocaleString()}x Total • Since April 2019` });
        embed.setDescription([
            `__**\`\u200e${'Date'.padEnd(6, ' ')}  ${'Uses'.padEnd(18, ' ')}\u200f\`**__`,
            ...usage.map((en) => `\`\u200e${moment(en.createdAt).format('DD MMM')}  ${en.usage.toString().padEnd(18, ' ')}\u200f\``),
            '',
            `__**\`\u200e # ${'Uses'.padStart(maxDigit + 1, ' ')}  ${'Command'.padEnd(15, ' ')}\u200f\`**__`,
            ...commands.splice(0, 50).map(({ id, uses }, index) => {
                const command = `/${this.handler.getCommand(id).id}`;
                return `\`\u200e${(index + 1).toString().padStart(2, ' ')} ${uses
                    .toString()
                    .padStart(maxDigit, ' ')}x  ${command.padEnd(15, ' ')}\u200f\``;
            })
        ].join('\n'));
        return interaction.editReply({ embeds: [embed] });
    }
    async commands() {
        const result = await this.client.db
            .collection("BotCommands" /* Collections.BOT_COMMANDS */)
            .find()
            .toArray();
        const commands = result
            .filter((cmd) => this.handler.getCommand(cmd.command))
            .map((cmd) => ({
            id: cmd.command,
            uses: cmd.total
        }));
        return { commands: this.sort(commands), total: this.total(commands) };
    }
    async growth() {
        const cursor = this.client.db.collection("BotGrowth" /* Collections.BOT_GROWTH */).find();
        const data = await cursor.sort({ _id: -1 }).limit(1).next();
        return {
            addition: data?.addition,
            deletion: data?.deletion,
            growth: data?.addition - data?.deletion
        };
    }
    async buffer(limit) {
        const growth = await this.growth();
        const collection = await this.client.db
            .collection("BotGrowth" /* Collections.BOT_GROWTH */)
            .find()
            .sort({ _id: -1 })
            .limit(limit)
            .toArray();
        return Chart.growth(collection.reverse().map((growth) => ({ date: new Date(growth.key), value: growth })), { ...growth });
    }
    usage() {
        return this.client.db
            .collection("BotUsage" /* Collections.BOT_USAGE */)
            .find()
            .sort({ _id: -1 })
            .limit(15)
            .toArray();
    }
    sort(items) {
        return items.sort((a, b) => b.uses - a.uses);
    }
    total(items) {
        return items.reduce((previous, current) => current.uses + previous, 0);
    }
}
//# sourceMappingURL=usage.js.map