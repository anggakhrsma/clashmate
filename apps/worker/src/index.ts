import { ClashMateCocClient } from '@clashmate/coc';
import { loadConfig } from '@clashmate/config';
import {
  createCapitalRaidSeasonStore,
  createClanGamesEventStore,
  createClanMemberEventStore,
  createClanMemberSnapshotReader,
  createClanSnapshotStore,
  createDatabase,
  createDatabaseAutoroleSettingsStore,
  createDatabaseNicknameConfigStore,
  createDatabasePlayerLinkStore,
  createDatabaseReconciliationPlanningOutcomeStore,
  createDatabaseReminderDeliveryStore,
  createMissedWarAttackEventStore,
  createNotificationFanOutStore,
  createNotificationOutboxDeliveryStore,
  createPlayerSnapshotStore,
  createPollingEnrollmentStore,
  createPollingLeaseStore,
  createWarAttackEventStore,
  createWarSnapshotStore,
  createWarStateEventStore,
} from '@clashmate/database';
import type { Logger } from '@clashmate/logger';
import { createLogger } from '@clashmate/logger';

import { createClanPollerHandler } from './clan-poller.js';
import { createDiscordRestNotificationSender } from './discord-notification-sender.js';
import { startNotificationDeliveryLoop } from './notification-delivery-loop.js';
import { startNotificationFanOutLoop } from './notification-fanout-loop.js';
import { createPlayerPollerHandler } from './player-poller.js';
import { startPollingEnrollmentLoop, syncPollingLeases } from './polling-enrollment.js';
import { startReconciliationPlanningLoop } from './reconciliation-planning-loop.js';
import { startReminderSchedulerLoop } from './reminder-scheduler-loop.js';
import { createWarPollerHandler } from './war-poller.js';
import { createWorkerOwnerId, startWorkerPollingLoop } from './worker-loop.js';

interface ShutdownController {
  readonly stop: () => void;
}

interface NamedShutdownController extends ShutdownController {
  readonly name: string;
}

function registerShutdownHandlers(
  controllers: readonly NamedShutdownController[],
  shutdownLogger: Pick<Logger, 'error' | 'info'>,
): void {
  let shuttingDown = false;

  const handleShutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      shutdownLogger.info(
        { signal, exitCode: process.exitCode ?? 0, exitCodeReason: 'shutdown_already_in_progress' },
        'Duplicate worker shutdown signal ignored',
      );
      return;
    }
    shuttingDown = true;

    shutdownLogger.info(
      { signal, controllers: controllers.map((controller) => controller.name) },
      'Worker shutdown started',
    );

    let failed = false;
    const stopResults: { name: string; stopped: boolean }[] = [];

    for (const controller of controllers) {
      try {
        controller.stop();
        stopResults.push({ name: controller.name, stopped: true });
      } catch (error) {
        failed = true;
        stopResults.push({ name: controller.name, stopped: false });
        shutdownLogger.error(
          { controller: controller.name, error, signal },
          'Worker shutdown controller stop failed',
        );
      }
    }

    const exitCodeReason = failed ? 'controller_stop_failed' : 'all_controllers_stopped';
    process.exitCode = failed ? 1 : 0;

    if (failed) {
      shutdownLogger.error(
        { signal, exitCode: process.exitCode, exitCodeReason, stopResults },
        'Worker shutdown completed with errors',
      );
      return;
    }

    shutdownLogger.info(
      { signal, exitCode: process.exitCode, exitCodeReason, stopResults },
      'Worker shutdown completed',
    );
  };

  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);
}

const config = loadConfig();
const logger = createLogger('worker', config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL);
const pollingEnrollment = createPollingEnrollmentStore(database);
const pollingLeases = createPollingLeaseStore(database);
const clanSnapshots = createClanSnapshotStore(database);
const clanMemberSnapshots = createClanMemberSnapshotReader(database);
const clanMemberEvents = createClanMemberEventStore(database);
const capitalRaidSeasons = createCapitalRaidSeasonStore(database);
const clanGames = createClanGamesEventStore(database);
const playerSnapshots = createPlayerSnapshotStore(database);
const warSnapshots = createWarSnapshotStore(database);
const warAttackEvents = createWarAttackEventStore(database);
const warStateEvents = createWarStateEventStore(database);
const missedWarAttackEvents = createMissedWarAttackEventStore(database);
const notificationFanOut = createNotificationFanOutStore(database);
const notificationDelivery = createNotificationOutboxDeliveryStore(database);
const reminderDelivery = createDatabaseReminderDeliveryStore(database);
const playerLinks = createDatabasePlayerLinkStore(database);
const autoroleSettings = createDatabaseAutoroleSettingsStore(database);
const nicknameConfigs = createDatabaseNicknameConfigStore(database);
const reconciliationPlanningOutcomes = createDatabaseReconciliationPlanningOutcomeStore(database);
const notificationSender = createDiscordRestNotificationSender(config.DISCORD_TOKEN);
const coc = new ClashMateCocClient({ token: config.CLASH_OF_CLANS_API_TOKEN });
const clanPollerHandler = createClanPollerHandler({
  coc,
  snapshots: clanSnapshots,
  memberEvents: clanMemberEvents,
  capitalRaidSeasons,
});
const playerPollerHandler = createPlayerPollerHandler({
  coc,
  snapshots: playerSnapshots,
  clanGames,
});
const warPollerHandler = createWarPollerHandler({
  coc,
  snapshots: warSnapshots,
  attackEvents: warAttackEvents,
  stateEvents: warStateEvents,
  missedAttackEvents: missedWarAttackEvents,
});
const workerOwnerId = createWorkerOwnerId();
const pollingIntervals = {
  clan: { baseSeconds: config.POLL_CLAN_SECONDS, jitterSeconds: config.POLL_CLAN_JITTER_SECONDS },
  player: {
    baseSeconds: config.POLL_PLAYER_SECONDS,
    jitterSeconds: config.POLL_PLAYER_JITTER_SECONDS,
  },
  war: { baseSeconds: config.POLL_WAR_SECONDS, jitterSeconds: config.POLL_WAR_JITTER_SECONDS },
};
const pollingEnrollmentInterval = {
  baseSeconds: Math.max(
    300,
    Math.min(
      pollingIntervals.clan.baseSeconds,
      pollingIntervals.player.baseSeconds,
      pollingIntervals.war.baseSeconds,
    ),
  ),
  jitterSeconds: Math.max(
    60,
    Math.min(
      pollingIntervals.clan.jitterSeconds,
      pollingIntervals.player.jitterSeconds,
      pollingIntervals.war.jitterSeconds,
    ),
  ),
};
const pollingEnrollmentResult = await syncPollingLeases(pollingEnrollment);

const pollingEnrollmentLoop = startPollingEnrollmentLoop({
  enrollment: pollingEnrollment,
  interval: pollingEnrollmentInterval,
  logger,
});

const notificationFanOutLoop = startNotificationFanOutLoop({
  fanOutStore: notificationFanOut,
  interval: {
    baseSeconds: config.NOTIFICATION_FANOUT_SECONDS,
    jitterSeconds: config.NOTIFICATION_FANOUT_JITTER_SECONDS,
  },
  batchSize: config.NOTIFICATION_FANOUT_BATCH_SIZE,
  logger,
});

const reminderSchedulerLoop = startReminderSchedulerLoop({
  reminders: reminderDelivery,
  snapshots: clanMemberSnapshots,
  links: playerLinks,
  interval: {
    baseSeconds: config.NOTIFICATION_FANOUT_SECONDS,
    jitterSeconds: config.NOTIFICATION_FANOUT_JITTER_SECONDS,
  },
  batchSize: config.NOTIFICATION_FANOUT_BATCH_SIZE,
  logger,
});

const reconciliationPlanningLoop = startReconciliationPlanningLoop({
  autoroles: autoroleSettings,
  nicknames: nicknameConfigs,
  snapshots: clanMemberSnapshots,
  outcomes: reconciliationPlanningOutcomes,
  interval: {
    baseSeconds: config.RECONCILIATION_PLANNING_SECONDS,
    jitterSeconds: config.RECONCILIATION_PLANNING_JITTER_SECONDS,
  },
  logger,
});

const notificationDeliveryLoop = startNotificationDeliveryLoop({
  deliveryStore: notificationDelivery,
  sender: notificationSender,
  ownerId: workerOwnerId,
  lockForSeconds: 60,
  interval: {
    baseSeconds: config.NOTIFICATION_DELIVERY_SECONDS,
    jitterSeconds: config.NOTIFICATION_DELIVERY_JITTER_SECONDS,
  },
  batchSize: config.NOTIFICATION_DELIVERY_BATCH_SIZE,
  maxAttempts: config.NOTIFICATION_DELIVERY_MAX_ATTEMPTS,
  retryBaseSeconds: config.NOTIFICATION_DELIVERY_RETRY_SECONDS,
  logger,
});

const workerPollingLoop = startWorkerPollingLoop({
  leaseStore: pollingLeases,
  ownerId: workerOwnerId,
  lockForSeconds: 60,
  intervals: pollingIntervals,
  handlers: {
    clan: clanPollerHandler,
    player: playerPollerHandler,
    war: warPollerHandler,
  },
  logger,
});

registerShutdownHandlers(
  [
    { name: 'pollingEnrollment', ...pollingEnrollmentLoop },
    { name: 'notificationFanOut', ...notificationFanOutLoop },
    { name: 'reminderScheduler', ...reminderSchedulerLoop },
    { name: 'reconciliationPlanning', ...reconciliationPlanningLoop },
    { name: 'notificationDelivery', ...notificationDeliveryLoop },
    { name: 'workerPolling', ...workerPollingLoop },
  ],
  logger,
);

const enabledLoopControllers = [
  'pollingEnrollment',
  'notificationFanOut',
  'reminderScheduler',
  'reconciliationPlanning',
  'notificationDelivery',
  'workerPolling',
] as const;

const loopConfiguration = {
  polling: {
    lockForSeconds: 60,
    intervals: pollingIntervals,
  },
  pollingEnrollment: {
    interval: pollingEnrollmentInterval,
  },
  notificationFanOut: {
    interval: {
      baseSeconds: config.NOTIFICATION_FANOUT_SECONDS,
      jitterSeconds: config.NOTIFICATION_FANOUT_JITTER_SECONDS,
    },
    batchSize: config.NOTIFICATION_FANOUT_BATCH_SIZE,
  },
  reminderScheduler: {
    interval: {
      baseSeconds: config.NOTIFICATION_FANOUT_SECONDS,
      jitterSeconds: config.NOTIFICATION_FANOUT_JITTER_SECONDS,
    },
    batchSize: config.NOTIFICATION_FANOUT_BATCH_SIZE,
  },
  reconciliationPlanning: {
    interval: {
      baseSeconds: config.RECONCILIATION_PLANNING_SECONDS,
      jitterSeconds: config.RECONCILIATION_PLANNING_JITTER_SECONDS,
    },
  },
  notificationDelivery: {
    lockForSeconds: 60,
    interval: {
      baseSeconds: config.NOTIFICATION_DELIVERY_SECONDS,
      jitterSeconds: config.NOTIFICATION_DELIVERY_JITTER_SECONDS,
    },
    batchSize: config.NOTIFICATION_DELIVERY_BATCH_SIZE,
    maxAttempts: config.NOTIFICATION_DELIVERY_MAX_ATTEMPTS,
    retryBaseSeconds: config.NOTIFICATION_DELIVERY_RETRY_SECONDS,
  },
} as const;

const readinessChecks = {
  databaseReady: Boolean(database),
  clashApiReady: await coc.ready(),
  clanPollerReady: Boolean(clanPollerHandler),
  playerPollerReady: Boolean(playerPollerHandler),
  warPollerReady: Boolean(warPollerHandler),
  clanGamesReady: Boolean(clanGames),
  notificationFanOutReady: Boolean(notificationFanOut),
  notificationDeliveryReady: Boolean(notificationDelivery),
  reminderSchedulerReady: Boolean(reminderDelivery),
  reconciliationPlanningReady: Boolean(
    autoroleSettings && nicknameConfigs && reconciliationPlanningOutcomes,
  ),
} as const;

logger.info(
  {
    readinessChecks,
    loopConfiguration,
    enabledLoopControllers,
    workerOwnerId,
    pollingEnrollment: pollingEnrollmentResult,
  },
  'Worker started',
);
