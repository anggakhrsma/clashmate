import { Command } from '../../lib/handlers.js';
export default class PingCommand extends Command {
    constructor() {
        super('ping', {
            category: 'none',
            defer: false
        });
    }
    async run(message) {
        const msg = await message.channel.send({
            content: '**Pinging...**',
            allowedMentions: { repliedUser: false },
            reply: { messageReference: message.id, failIfNotExists: false }
        });
        const ping = (msg.editedTimestamp || msg.createdTimestamp) -
            (message.editedTimestamp || message.createdTimestamp);
        return msg.edit({
            allowedMentions: { repliedUser: false },
            content: [
                `**Gateway Ping~ ${Math.round(this.client.ws.ping).toString()}ms**`,
                `**API Ping~ ${ping.toString()}ms**`
            ].join('\n')
        });
    }
}
//# sourceMappingURL=ping.js.map