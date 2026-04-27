import { ClashMateCocClient } from '@clashmate/coc';
import { loadConfig } from '@clashmate/config';
import {
  createClanSnapshotStore,
  createDatabase,
  createPollingEnrollmentStore,
  createPollingLeaseStore,
  createWarSnapshotStore,
} from '@clashmate/database';
import { createLogger } from '@clashmate/logger';

import { createClanPollerHandler } from './clan-poller.js';
import { syncPollingLeases } from './polling-enrollment.js';
import { createWarPollerHandler } from './war-poller.js';
import {
  createNoopPollingLeaseHandler,
  createWorkerOwnerId,
  startWorkerPollingLoop,
} from './worker-loop.js';

const config = loadConfig();
const logger = createLogger('worker', config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL);
const pollingEnrollment = createPollingEnrollmentStore(database);
const pollingLeases = createPollingLeaseStore(database);
const clanSnapshots = createClanSnapshotStore(database);
const warSnapshots = createWarSnapshotStore(database);
const coc = new ClashMateCocClient({ token: config.CLASH_OF_CLANS_API_TOKEN });
const clanPollerHandler = createClanPollerHandler({ coc, snapshots: clanSnapshots });
const warPollerHandler = createWarPollerHandler({ coc, snapshots: warSnapshots });
const workerOwnerId = createWorkerOwnerId();
const pollingEnrollmentResult = await syncPollingLeases(pollingEnrollment);

startWorkerPollingLoop({
  leaseStore: pollingLeases,
  ownerId: workerOwnerId,
  lockForSeconds: 60,
  intervals: {
    clan: { baseSeconds: config.POLL_CLAN_SECONDS, jitterSeconds: config.POLL_CLAN_JITTER_SECONDS },
    player: {
      baseSeconds: config.POLL_PLAYER_SECONDS,
      jitterSeconds: config.POLL_PLAYER_JITTER_SECONDS,
    },
    war: { baseSeconds: config.POLL_WAR_SECONDS, jitterSeconds: config.POLL_WAR_JITTER_SECONDS },
  },
  handlers: {
    clan: clanPollerHandler,
    player: createNoopPollingLeaseHandler('player'),
    war: warPollerHandler,
  },
  logger,
});

logger.info(
  {
    databaseReady: Boolean(database),
    clashApiReady: await coc.ready(),
    clanPollerReady: Boolean(clanPollerHandler),
    playerPollerReady: 'noop',
    warPollerReady: Boolean(warPollerHandler),
    workerOwnerId,
    pollingEnrollment: pollingEnrollmentResult,
  },
  'Worker started',
);
