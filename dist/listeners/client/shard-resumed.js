import { Listener } from '../../lib/handlers.js';
export default class ShardResumeListener extends Listener {
    constructor() {
        super('shardResume', {
            event: 'shardResume',
            emitter: 'client',
            category: 'client'
        });
    }
    exec(id, replayedEvents) {
        this.client.logger.info(`Shard ${id} resumed (replayed ${replayedEvents} events)`, {
            label: 'SHARD RESUMED'
        });
    }
}
//# sourceMappingURL=shard-resumed.js.map