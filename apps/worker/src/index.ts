import { ClashMateCocClient } from '@clashmate/coc';
import { loadConfig } from '@clashmate/config';
import { createDatabase } from '@clashmate/database';
import { createLogger } from '@clashmate/logger';

const config = loadConfig();
const logger = createLogger('worker', config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL);
const coc = new ClashMateCocClient({ token: config.CLASH_OF_CLANS_API_TOKEN });

logger.info(
  {
    databaseReady: Boolean(database),
    clashApiReady: await coc.ready(),
  },
  'Worker started',
);

// Polling implementation will use PostgreSQL-backed leases and idempotent events.
