import type {
  FanOutClanMemberEventNotificationsInput,
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

    options.logger.info(
      {
        eventsScanned: result.eventsScanned,
        matchedTargets: result.matchedTargets,
        insertedOutboxEntries: result.insertedOutboxEntries,
      },
      'Clan member notification fan-out completed',
    );
  } catch (error) {
    options.logger.error({ error }, 'Clan member notification fan-out failed');
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
