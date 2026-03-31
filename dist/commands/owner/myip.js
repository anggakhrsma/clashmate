import { Command } from '../../lib/handlers.js';
export default class MyIpCommand extends Command {
    constructor() {
        super('myip', {
            category: 'owner',
            ownerOnly: true,
            defer: true,
            ephemeral: true
        });
    }
    args() {
        return {};
    }
    async exec(interaction) {
        const res = await fetch('https://ifconfig.me/ip');
        const ip = await res.text();
        return interaction.editReply(`**Outbound IP:** \`${ip.trim()}\``);
    }
}
//# sourceMappingURL=myip.js.map