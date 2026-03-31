import { Listener } from '../../lib/handlers.js';
export default class GatewayRateLimitListener extends Listener {
    constructor() {
        super('gatewayRateLimit', {
            event: 'RATE_LIMITED',
            emitter: 'ws',
            category: 'client'
        });
    }
    exec(a, b) {
        console.log({ a, b });
    }
}
//# sourceMappingURL=gateway-rate-limit.js.map