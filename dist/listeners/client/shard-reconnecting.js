import { Listener } from '../../lib/handlers.js';
export default class ShardReconnectListener extends Listener {
    constructor() {
        super('shardReconnecting', {
            event: 'shardReconnecting',
            emitter: 'client',
            category: 'client'
        });
    }
    exec(id) {
        this.client.logger.info(`Shard ${id} Reconnecting`, { label: 'SHARD RECONNECTING' });
    }
}
//# sourceMappingURL=shard-reconnecting.js.map