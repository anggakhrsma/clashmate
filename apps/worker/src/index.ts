import { ClashMateCocClient } from '@clashmate/coc';
import { loadConfig } from '@clashmate/config';
import {
  createClanMemberEventStore,
  createClanSnapshotStore,
  createDatabase,
  createNotificationFanOutStore,
  createPlayerSnapshotStore,
  createPollingEnrollmentStore,
  createPollingLeaseStore,
  createWarSnapshotStore,
} from '@clashmate/database';
import { createLogger } from '@clashmate/logger';

import { createClanPollerHandler } from './clan-poller.js';
import { startNotificationFanOutLoop } from './notification-fanout-loop.js';
import { createPlayerPollerHandler } from './player-poller.js';
import { syncPollingLeases } from './polling-enrollment.js';
import { createWarPollerHandler } from './war-poller.js';
import { createWorkerOwnerId, startWorkerPollingLoop } from './worker-loop.js';

const config = loadConfig();
const logger = createLogger('worker', config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL);
const pollingEnrollment = createPollingEnrollmentStore(database);
const pollingLeases = createPollingLeaseStore(database);
const clanSnapshots = createClanSnapshotStore(database);
const clanMemberEvents = createClanMemberEventStore(database);
const playerSnapshots = createPlayerSnapshotStore(database);
const warSnapshots = createWarSnapshotStore(database);
const notificationFanOut = createNotificationFanOutStore(database);
const coc = new ClashMateCocClient({ token: config.CLASH_OF_CLANS_API_TOKEN });
const clanPollerHandler = createClanPollerHandler({
  coc,
  snapshots: clanSnapshots,
  memberEvents: clanMemberEvents,
});
const playerPollerHandler = createPlayerPollerHandler({ coc, snapshots: playerSnapshots });
const warPollerHandler = createWarPollerHandler({ coc, snapshots: warSnapshots });
const workerOwnerId = createWorkerOwnerId();
const pollingEnrollmentResult = await syncPollingLeases(pollingEnrollment);

startNotificationFanOutLoop({
  fanOutStore: notificationFanOut,
  interval: {
    baseSeconds: config.NOTIFICATION_FANOUT_SECONDS,
    jitterSeconds: config.NOTIFICATION_FANOUT_JITTER_SECONDS,
  },
  batchSize: config.NOTIFICATION_FANOUT_BATCH_SIZE,
  logger,
});

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
    player: playerPollerHandler,
    war: warPollerHandler,
  },
  logger,
});

logger.info(
  {
    databaseReady: Boolean(database),
    clashApiReady: await coc.ready(),
    clanPollerReady: Boolean(clanPollerHandler),
    playerPollerReady: Boolean(playerPollerHandler),
    warPollerReady: Boolean(warPollerHandler),
    notificationFanOutReady: Boolean(notificationFanOut),
    notificationFanOutIntervalSeconds: config.NOTIFICATION_FANOUT_SECONDS,
    notificationFanOutJitterSeconds: config.NOTIFICATION_FANOUT_JITTER_SECONDS,
    notificationFanOutBatchSize: config.NOTIFICATION_FANOUT_BATCH_SIZE,
    workerOwnerId,
    pollingEnrollment: pollingEnrollmentResult,
  },
  'Worker started',
);
