import { loadConfig } from '@clashmate/config';
import { createLogger } from '@clashmate/logger';
import Fastify from 'fastify';

const config = loadConfig();
const logger = createLogger('api', config.LOG_LEVEL);

const app = Fastify({
  loggerInstance: logger,
});

app.get('/health', async () => {
  return {
    ok: true,
    service: 'api',
    version: '0.0.0',
  };
});

await app.listen({
  host: '0.0.0.0',
  port: config.PORT,
});
