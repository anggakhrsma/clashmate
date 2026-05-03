import type {
  FanOutClanDonationEventNotificationsInput,
  FanOutClanGamesEventNotificationsInput,
  FanOutClanMemberEventNotificationsInput,
  FanOutClanRoleChangeEventNotificationsInput,
  FanOutMissedWarAttackEventNotificationsInput,
  FanOutWarAttackEventNotificationsInput,
  FanOutWarStateEventNotificationsInput,
  NotificationFanOutStore,
} from '@clashmate/database';
import type { Logger } from '@clashmate/logger';

export interface NotificationFanOutLoopIntervalConfig {
  readonly baseSeconds: number;
  readonly jitterSeconds: number;
}

export interface NotificationFanOutLoopOptions {
  readonly fanOutStore: NotificationFanOutStore;
  readonly interval: NotificationFanOutLoopIntervalConfig;
  readonly batchSize?: number;
  readonly logger: Pick<Logger, 'debug' | 'error' | 'info'>;
  readonly random?: () => number;
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
}

export interface NotificationFanOutLoopController {
  stop: () => void;
  runOnce: () => Promise<void>;
}

const MAX_NOTIFICATION_FANOUT_BATCH_SIZE = 1000;

function resolveNotificationFanOutIterationLimit(
  batchSize: number | undefined,
): number | undefined {
  if (batchSize === undefined) return undefined;
  if (!Number.isFinite(batchSize) || !Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('Notification fan-out batchSize must be a finite positive integer.');
  }
  if (batchSize > MAX_NOTIFICATION_FANOUT_BATCH_SIZE) {
    throw new Error(
      `Notification fan-out batchSize must not exceed ${MAX_NOTIFICATION_FANOUT_BATCH_SIZE}.`,
    );
  }
  return batchSize;
}

function createNotificationFanOutInput(limit: number | undefined): { limit?: number } {
  return limit === undefined ? {} : { limit };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function validateNotificationFanOutLoopOptions(options: NotificationFanOutLoopOptions): void {
  if (!isObjectRecord(options)) {
    throw new Error('Notification fan-out options must be an object.');
  }

  const { fanOutStore, logger } = options;
  if (!isObjectRecord(fanOutStore)) {
    throw new Error('Notification fan-out fanOutStore must be an object.');
  }

  for (const method of [
    'fanOutClanMemberEventNotifications',
    'fanOutWarAttackEventNotifications',
    'fanOutWarStateEventNotifications',
    'fanOutMissedWarAttackEventNotifications',
    'fanOutClanDonationEventNotifications',
    'fanOutClanRoleChangeEventNotifications',
  ] as const) {
    if (typeof fanOutStore[method] !== 'function') {
      throw new Error(`Notification fan-out fanOutStore.${method} must be a function.`);
    }
  }

  if (
    fanOutStore.fanOutClanGamesEventNotifications !== undefined &&
    typeof fanOutStore.fanOutClanGamesEventNotifications !== 'function'
  ) {
    throw new Error(
      'Notification fan-out fanOutStore.fanOutClanGamesEventNotifications must be a function when provided.',
    );
  }

  if (!isObjectRecord(logger)) {
    throw new Error('Notification fan-out logger must be an object.');
  }
  if (typeof logger.info !== 'function') {
    throw new Error('Notification fan-out logger.info must be a function.');
  }
  if (typeof logger.error !== 'function') {
    throw new Error('Notification fan-out logger.error must be a function.');
  }

  if (options.random !== undefined && typeof options.random !== 'function') {
    throw new Error('Notification fan-out random must be a function when provided.');
  }
  if (options.setTimeout !== undefined && typeof options.setTimeout !== 'function') {
    throw new Error('Notification fan-out setTimeout must be a function when provided.');
  }
  if (options.clearTimeout !== undefined && typeof options.clearTimeout !== 'function') {
    throw new Error('Notification fan-out clearTimeout must be a function when provided.');
  }
}

export function computeNotificationFanOutLoopDelayMs(
  interval: NotificationFanOutLoopIntervalConfig,
  random = Math.random,
): number {
  if (
    !Number.isFinite(interval.baseSeconds) ||
    !Number.isFinite(interval.jitterSeconds) ||
    interval.baseSeconds <= 0 ||
    interval.jitterSeconds < 0
  ) {
    throw new Error(
      'Notification fan-out loop intervals must be finite and positive with non-negative jitter.',
    );
  }

  const jitter = Math.floor(random() * (interval.jitterSeconds + 1));
  return (interval.baseSeconds + jitter) * 1000;
}

export async function runNotificationFanOutIteration(
  options: NotificationFanOutLoopOptions,
): Promise<void> {
  validateNotificationFanOutLoopOptions(options);
  const limit = resolveNotificationFanOutIterationLimit(options.batchSize);

  try {
    const input: FanOutClanMemberEventNotificationsInput = createNotificationFanOutInput(limit);

    const result = await options.fanOutStore.fanOutClanMemberEventNotifications(input);
    const warAttackInput: FanOutWarAttackEventNotificationsInput =
      createNotificationFanOutInput(limit);
    const warAttackResult =
      await options.fanOutStore.fanOutWarAttackEventNotifications(warAttackInput);
    const warStateInput: FanOutWarStateEventNotificationsInput =
      createNotificationFanOutInput(limit);
    const warStateResult =
      await options.fanOutStore.fanOutWarStateEventNotifications(warStateInput);
    const missedWarAttackInput: FanOutMissedWarAttackEventNotificationsInput =
      createNotificationFanOutInput(limit);
    const missedWarAttackResult =
      await options.fanOutStore.fanOutMissedWarAttackEventNotifications(missedWarAttackInput);
    const donationInput: FanOutClanDonationEventNotificationsInput =
      createNotificationFanOutInput(limit);
    const donationResult =
      await options.fanOutStore.fanOutClanDonationEventNotifications(donationInput);
    const roleChangeInput: FanOutClanRoleChangeEventNotificationsInput =
      createNotificationFanOutInput(limit);
    const roleChangeResult =
      await options.fanOutStore.fanOutClanRoleChangeEventNotifications(roleChangeInput);
    const clanGamesInput: FanOutClanGamesEventNotificationsInput =
      createNotificationFanOutInput(limit);
    const fanOutClanGames = options.fanOutStore.fanOutClanGamesEventNotifications;
    const clanGamesResult =
      typeof fanOutClanGames === 'function'
        ? await fanOutClanGames.call(options.fanOutStore, clanGamesInput)
        : null;

    options.logger.info(
      {
        eventsScanned: result.eventsScanned,
        matchedTargets: result.matchedTargets,
        insertedOutboxEntries: result.insertedOutboxEntries,
      },
      'Clan member notification fan-out completed',
    );
    options.logger.info(
      {
        eventsScanned: warAttackResult.eventsScanned,
        matchedTargets: warAttackResult.matchedTargets,
        insertedOutboxEntries: warAttackResult.insertedOutboxEntries,
      },
      'War attack notification fan-out completed',
    );
    options.logger.info(
      {
        eventsScanned: warStateResult.eventsScanned,
        matchedTargets: warStateResult.matchedTargets,
        insertedOutboxEntries: warStateResult.insertedOutboxEntries,
      },
      'War state notification fan-out completed',
    );
    options.logger.info(
      {
        eventsScanned: missedWarAttackResult.eventsScanned,
        matchedTargets: missedWarAttackResult.matchedTargets,
        insertedOutboxEntries: missedWarAttackResult.insertedOutboxEntries,
      },
      'Missed war attack notification fan-out completed',
    );
    options.logger.info(
      {
        eventsScanned: donationResult.eventsScanned,
        matchedTargets: donationResult.matchedTargets,
        insertedOutboxEntries: donationResult.insertedOutboxEntries,
      },
      'Clan donation notification fan-out completed',
    );
    options.logger.info(
      {
        eventsScanned: roleChangeResult.eventsScanned,
        matchedTargets: roleChangeResult.matchedTargets,
        insertedOutboxEntries: roleChangeResult.insertedOutboxEntries,
      },
      'Clan role change notification fan-out completed',
    );
    if (clanGamesResult) {
      options.logger.info(
        {
          eventsScanned: clanGamesResult.eventsScanned,
          matchedTargets: clanGamesResult.matchedTargets,
          insertedOutboxEntries: clanGamesResult.insertedOutboxEntries,
        },
        'Clan Games notification fan-out completed',
      );
    }
  } catch (error) {
    options.logger.error({ error }, 'Notification fan-out failed');
  }
}

export function startNotificationFanOutLoop(
  options: NotificationFanOutLoopOptions,
): NotificationFanOutLoopController {
  validateNotificationFanOutLoopOptions(options);

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleTimeout = options.setTimeout ?? setTimeout;
  const clearScheduledTimeout = options.clearTimeout ?? clearTimeout;

  const runOnce = () => runNotificationFanOutIteration(options);

  const scheduleNext = () => {
    if (stopped) return;
    const delayMs = computeNotificationFanOutLoopDelayMs(options.interval, options.random);
    timer = scheduleTimeout(() => {
      void runOnce().finally(scheduleNext);
    }, delayMs);
  };

  void runOnce().finally(scheduleNext);
  options.logger.info(
    { interval: options.interval },
    'Clan member notification fan-out loop started',
  );

  return {
    stop: () => {
      stopped = true;
      if (timer) clearScheduledTimeout(timer);
    },
    runOnce,
  };
}
