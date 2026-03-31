import 'reflect-metadata';
import 'dotenv/config';

import { createServer } from 'node:http';
import { Logger } from './util/logger.js';

// Single-process entrypoint — no sharding needed for self-hosted MonkeyBytes deployment
// The bot process is launched directly here; scale via vertical resources if needed.

const logger = new Logger(null);

// Dynamic import so reflect-metadata is registered first
const { Client } = await import('./struct/client.js');
const client = new Client();

try {
  await client.init(process.env.DISCORD_TOKEN!);
  logger.info('Bot is online', { label: 'DISCORD' });
} catch (error) {
  logger.error(error, { label: 'STARTUP' });
  process.exit(1);
}

process.on('unhandledRejection', (error) => {
  console.error(error);
});

// Simple health check server for MonkeyBytes uptime monitoring
const server = createServer((_, res) => {
  res.writeHead(client.isReady() ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ isReady: client.isReady() }));
});

const port = process.env.PORT || 8070;
server.listen(port, () => {
  logger.log(`Health check listening on http://localhost:${port}`, { label: 'Server' });
});
