import { diff } from 'radash';
import { Listener } from '../../lib/handlers.js';
export default class MessageUpdateListener extends Listener {
    constructor() {
        super('messageUpdate', {
            event: 'messageUpdate',
            emitter: 'client',
            category: 'client'
        });
    }
    async exec(oldMessage, newMessage) {
        if (!(oldMessage.author?.id === this.client.user.id &&
            newMessage.author.id === this.client.user.id))
            return;
        const oldIds = this.flattenCustomIds(oldMessage);
        const newIds = this.flattenCustomIds(newMessage);
        const disposed = diff(oldIds, newIds);
        // Clean up disposed component IDs from in-memory map
        for (const customId of disposed) {
            this.client.components.delete(customId);
        }
    }
    flattenCustomIds(message) {
        return message.components
            .flatMap((row) => row.components)
            .map((c) => c.customId)
            .filter((id) => id && /^CMD/.test(id));
    }
}
//# sourceMappingURL=message-update.js.map