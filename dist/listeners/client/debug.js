import { Listener } from '../../lib/handlers.js';
export default class DebugListener extends Listener {
    constructor() {
        super('debug', {
            event: 'debug',
            emitter: 'client',
            category: 'client'
        });
    }
    exec(info) {
        if (process.env.DEBUG)
            this.client.logger.debug(`${info}`, { label: 'DEBUG' });
    }
}
//# sourceMappingURL=debug.js.map