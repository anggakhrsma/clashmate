import { ClashMateCocClient } from '@clashmate/coc';
import { loadConfig } from '@clashmate/config';
import { createDatabase, createPollingEnrollmentStore } from '@clashmate/database';
import { createLogger } from '@clashmate/logger';

import { syncPollingLeasesFromLinkedResources } from './polling-enrollment.js';

const config = loadConfig();
const logger = createLogger('worker', config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL);
const pollingEnrollment = createPollingEnrollmentStore(database);
const coc = new ClashMateCocClient({ token: config.CLASH_OF_CLANS_API_TOKEN });
const pollingEnrollmentResult = await syncPollingLeasesFromLinkedResources(pollingEnrollment);

logger.info(
  {
    databaseReady: Boolean(database),
    clashApiReady: await coc.ready(),
    pollingEnrollment: pollingEnrollmentResult,
  },
  'Worker started',
);

// Polling implementation will use PostgreSQL-backed leases and idempotent events.
