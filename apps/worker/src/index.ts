import { ClashMateCocClient } from '@clashmate/coc';
import { loadConfig } from '@clashmate/config';
import {
  createClanSnapshotStore,
  createDatabase,
  createPollingEnrollmentStore,
} from '@clashmate/database';
import { createLogger } from '@clashmate/logger';

import { createClanPollerHandler } from './clan-poller.js';
import { syncPollingLeases } from './polling-enrollment.js';

const config = loadConfig();
const logger = createLogger('worker', config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL);
const pollingEnrollment = createPollingEnrollmentStore(database);
const clanSnapshots = createClanSnapshotStore(database);
const coc = new ClashMateCocClient({ token: config.CLASH_OF_CLANS_API_TOKEN });
const clanPollerHandler = createClanPollerHandler({ coc, snapshots: clanSnapshots });
const pollingEnrollmentResult = await syncPollingLeases(pollingEnrollment);

logger.info(
  {
    databaseReady: Boolean(database),
    clashApiReady: await coc.ready(),
    clanPollerReady: Boolean(clanPollerHandler),
    pollingEnrollment: pollingEnrollmentResult,
  },
  'Worker started',
);

// Polling implementation will use PostgreSQL-backed leases and idempotent events.
