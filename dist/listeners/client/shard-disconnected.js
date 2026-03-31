import { Listener } from '../../lib/handlers.js';
export default class ShardDisconnectListener extends Listener {
    constructor() {
        super('shardDisconnect', {
            event: 'shardDisconnect',
            emitter: 'client',
            category: 'client'
        });
    }
    exec(event, id) {
        this.client.logger.warn(`Shard ${id} disconnected (${event.code})`, {
            label: 'SHARD DISCONNECTED'
        });
    }
}
//# sourceMappingURL=shard-disconnected.js.map