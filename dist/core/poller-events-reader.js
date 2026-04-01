import { inspect } from 'node:util';
const POLL_INTERVAL_MS = 30_000; // read PollerEvents every 30 s
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // skip events older than 2 h
const MAX_EVENTS_PER_TICK = 100;
/**
 * PollerEventsReader — consumes events written by clashmate-service.
 *
 * The service polls the CoC API and inserts change events into the
 * `PollerEvents` MongoDB collection. This reader picks them up and
 * calls the existing Enqueuer.dispatch() — so all embed formatting and
 * Discord webhook delivery remains in the bot, unchanged.
 */
export class PollerEventsReader {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "running", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "timer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        this.client.logger.info('PollerEvents reader started', { label: 'POLLER' });
        this.tick();
    }
    stop() {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    tick() {
        if (!this.running)
            return;
        this.timer = setTimeout(async () => {
            try {
                await this.processEvents();
            }
            catch (err) {
                this.client.logger.error(inspect(err, { depth: 2 }), { label: 'POLLER' });
            }
            finally {
                this.tick();
            }
        }, POLL_INTERVAL_MS);
    }
    async processEvents() {
        const col = this.client.db.collection('PollerEvents');
        const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
        // Fetch a batch of unprocessed events (oldest first)
        const events = await col
            .find({ processed: false })
            .sort({ createdAt: 1 })
            .limit(MAX_EVENTS_PER_TICK)
            .toArray();
        if (events.length === 0)
            return;
        for (const event of events) {
            // Atomically claim the event (skip if already claimed by another process)
            const claim = await col.findOneAndUpdate({ _id: event._id, processed: false }, { $set: { processed: true, processedAt: new Date() } });
            if (!claim)
                continue; // already processed elsewhere
            // Skip stale events (don't send delayed notifications)
            if (event.createdAt < cutoff)
                continue;
            // Build the dispatch payload (omit internal DB fields)
            const { _id, processed, processedAt, createdAt, ...payload } = event;
            try {
                await this.client.enqueuer.dispatch(payload);
            }
            catch (err) {
                this.client.logger.error(inspect(err, { depth: 2 }), { label: 'POLLER' });
            }
        }
    }
}
//# sourceMappingURL=poller-events-reader.js.map