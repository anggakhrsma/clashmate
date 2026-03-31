import 'reflect-metadata';
import 'moment-duration-format';
import { inspect } from 'node:util';
import { Client } from './struct/client.js';
const client = new Client();
client.on('error', (error) => {
    console.error(inspect(error, { depth: Infinity }));
});
client.on('warn', (warn) => {
    console.warn(inspect(warn, { depth: Infinity }));
});
process.on('unhandledRejection', (error) => {
    console.error(inspect(error, { depth: Infinity }));
});
await client.init(process.env.DISCORD_TOKEN);
//# sourceMappingURL=main.js.map