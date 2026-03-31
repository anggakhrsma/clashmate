import { FeatureFlags } from '../../util/constants.js';
import { inspect } from 'util';
import { Command } from '../../lib/handlers.js';
export default class FeatureFlagsCommand extends Command {
    constructor() {
        super('feature-flags', {
            category: 'none',
            defer: false,
            ownerOnly: true
        });
    }
    async run(message) {
        const result = await Promise.all(Object.values(FeatureFlags).map(async (flag) => ({
            [flag]: this.client.isFeatureEnabled(flag, message.guild.id)
        })));
        const inspected = inspect(result, { depth: 1 }).replace(new RegExp('!!NL!!', 'g'), '\n');
        return message.channel.send(`\`\`\`${inspected}\`\`\``);
    }
}
//# sourceMappingURL=feature-flags.js.map