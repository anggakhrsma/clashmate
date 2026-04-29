import type {
  FanOutClanDonationEventNotificationsInput,
  FanOutClanMemberEventNotificationsInput,
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

export function computeNotificationFanOutLoopDelayMs(
  interval: NotificationFanOutLoopIntervalConfig,
  random = Math.random,
): number {
  if (interval.baseSeconds <= 0 || interval.jitterSeconds < 0) {
    throw new Error(
      'Notification fan-out loop intervals must be positive with non-negative jitter.',
    );
  }

  const jitter = Math.floor(random() * (interval.jitterSeconds + 1));
  return (interval.baseSeconds + jitter) * 1000;
}

export async function runNotificationFanOutIteration(
  options: NotificationFanOutLoopOptions,
): Promise<void> {
  try {
    const input: FanOutClanMemberEventNotificationsInput = {};
    if (options.batchSize !== undefined) input.limit = options.batchSize;

    const result = await options.fanOutStore.fanOutClanMemberEventNotifications(input);
    const warAttackInput: FanOutWarAttackEventNotificationsInput = {};
    if (options.batchSize !== undefined) warAttackInput.limit = options.batchSize;
    const warAttackResult =
      await options.fanOutStore.fanOutWarAttackEventNotifications(warAttackInput);
    const warStateInput: FanOutWarStateEventNotificationsInput = {};
    if (options.batchSize !== undefined) warStateInput.limit = options.batchSize;
    const warStateResult =
      await options.fanOutStore.fanOutWarStateEventNotifications(warStateInput);
    const missedWarAttackInput: FanOutMissedWarAttackEventNotificationsInput = {};
    if (options.batchSize !== undefined) missedWarAttackInput.limit = options.batchSize;
    const missedWarAttackResult =
      await options.fanOutStore.fanOutMissedWarAttackEventNotifications(missedWarAttackInput);
    const donationInput: FanOutClanDonationEventNotificationsInput = {};
    if (options.batchSize !== undefined) donationInput.limit = options.batchSize;
    const donationResult =
      await options.fanOutStore.fanOutClanDonationEventNotifications(donationInput);

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
  } catch (error) {
    options.logger.error({ error }, 'Notification fan-out failed');
  }
}

export function startNotificationFanOutLoop(
  options: NotificationFanOutLoopOptions,
): NotificationFanOutLoopController {
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
