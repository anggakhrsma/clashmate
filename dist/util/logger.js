import chalk from 'chalk';
import moment from 'moment';
import util from 'node:util';
import { padStart } from './helper.js';
const COLORS = {
    debug: 'yellow',
    info: 'cyan',
    warn: 'magenta',
    error: 'red',
    log: 'grey'
};
const TAGS = {
    debug: '[DEBUG]',
    info: '[INFO ]',
    warn: '[WARN ]',
    error: '[ERROR]',
    log: '[INFO ]'
};
export class Logger {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
    }
    debug(message, { label }) {
        return this.write(message, { label, tag: 'debug' });
    }
    log(message, { label }) {
        return this.write(message, { label, tag: 'log' });
    }
    info(message, { label }) {
        return this.write(message, { label, tag: 'info' });
    }
    error(message, { label }) {
        return this.write(message, { error: true, label, tag: 'error' });
    }
    warn(message, { label }) {
        return this.write(message, { label, tag: 'warn' });
    }
    write(message, { error, label, tag }) {
        const timestamp = chalk.cyan(moment().utcOffset('+05:30').format('DD-MM-YYYY kk:mm:ss'));
        const content = this.clean(message);
        const stream = error ? process.stderr : process.stdout;
        const color = COLORS[tag];
        stream.write(`[${timestamp}]${this.shard} ${chalk[color].bold(TAGS[tag])} » ${label ? `[${label}] » ` : ''}${content}\n`);
    }
    clean(message) {
        if (typeof message === 'string')
            return message;
        return util.inspect(message, { depth: Infinity });
    }
    get shard() {
        const clusterId = 0;
        return typeof clusterId === 'number' ? ` [CLUSTER${padStart(clusterId, 2)}]` : ` [CLUSTER X]`;
    }
}
//# sourceMappingURL=logger.js.map