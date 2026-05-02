import type { PollingEnrollmentStore, PollingIntervalConfig } from '@clashmate/database';
import type { Logger } from '@clashmate/logger';

export interface SyncPollingLeasesResult {
  readonly clan: { enrolled: number; removed: number };
  readonly player: { enrolled: number; removed: number };
  readonly war: { enrolled: number; removed: number };
}

export interface PollingEnrollmentLoopOptions {
  readonly enrollment: PollingEnrollmentStore;
  readonly interval: PollingIntervalConfig;
  readonly logger: Pick<Logger, 'debug' | 'error' | 'info'>;
  readonly random?: () => number;
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
  readonly now?: () => Date;
}

export interface PollingEnrollmentLoopController {
  stop: () => void;
  runOnce: () => Promise<SyncPollingLeasesResult | null>;
}

export async function syncPollingLeases(
  enrollment: PollingEnrollmentStore,
  runAfter = new Date(),
): Promise<SyncPollingLeasesResult> {
  const [clan, player, war] = await Promise.all([
    enrollment.syncClanPollingLeases(runAfter),
    enrollment.syncPlayerPollingLeases(runAfter),
    enrollment.syncWarPollingLeases(runAfter),
  ]);

  return { clan, player, war };
}

export function computePollingEnrollmentLoopDelayMs(
  interval: PollingIntervalConfig,
  random = Math.random,
): number {
  if (
    !Number.isFinite(interval.baseSeconds) ||
    !Number.isFinite(interval.jitterSeconds) ||
    interval.baseSeconds <= 0 ||
    interval.jitterSeconds < 0
  ) {
    throw new Error(
      'Polling enrollment loop intervals must be finite and positive with non-negative jitter.',
    );
  }

  const jitter = Math.floor(random() * (interval.jitterSeconds + 1));

  return (interval.baseSeconds + jitter) * 1000;
}

export async function runPollingEnrollmentIteration(
  options: PollingEnrollmentLoopOptions,
): Promise<SyncPollingLeasesResult | null> {
  const runAfter = options.now?.() ?? new Date();

  try {
    const result = await syncPollingLeases(options.enrollment, runAfter);

    options.logger.info({ result, runAfter }, 'Polling enrollment resync completed');
    return result;
  } catch (error) {
    options.logger.error({ error, runAfter }, 'Polling enrollment resync failed');
    return null;
  }
}

export function startPollingEnrollmentLoop(
  options: PollingEnrollmentLoopOptions,
): PollingEnrollmentLoopController {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleTimeout = options.setTimeout ?? setTimeout;
  const clearScheduledTimeout = options.clearTimeout ?? clearTimeout;

  const runOnce = () => runPollingEnrollmentIteration(options);

  const scheduleNext = () => {
    if (stopped) return;

    const delayMs = computePollingEnrollmentLoopDelayMs(options.interval, options.random);
    timer = scheduleTimeout(() => {
      void runOnce().finally(scheduleNext);
    }, delayMs);
  };

  scheduleNext();
  options.logger.info({ interval: options.interval }, 'Polling enrollment resync loop started');

  return {
    stop: () => {
      stopped = true;
      if (timer) clearScheduledTimeout(timer);
    },
    runOnce,
  };
}
