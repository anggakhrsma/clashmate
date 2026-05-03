import type {
  PollingIntervalConfig,
  PollingLeaseStore,
  PollingResourceType,
} from '@clashmate/database';
import type { Logger } from '@clashmate/logger';

import {
  type PollingLeaseHandler,
  type ProcessDuePollingLeaseResult,
  processOneDuePollingLeasePerFamily,
} from './polling-orchestration.js';

export interface WorkerPollingLoopOptions {
  readonly leaseStore: PollingLeaseStore;
  readonly ownerId: string;
  readonly lockForSeconds: number;
  readonly intervals: Record<PollingResourceType, PollingIntervalConfig>;
  readonly handlers: Record<PollingResourceType, PollingLeaseHandler>;
  readonly logger: Pick<Logger, 'debug' | 'error' | 'info'>;
  readonly random?: () => number;
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
}

export interface WorkerPollingLoopController {
  readonly ownerId: string;
  stop: () => void;
  runOnce: () => Promise<ProcessDuePollingLeaseResult[]>;
}

export function createNoopPollingLeaseHandler(
  resourceType: PollingResourceType,
): PollingLeaseHandler {
  return async (lease) => {
    if (lease.resourceType !== resourceType) {
      throw new Error(`${resourceType} no-op poller cannot process ${lease.resourceType} leases.`);
    }
  };
}

export function createWorkerOwnerId(prefix = 'worker'): string {
  return `${prefix}-${process.pid}-${Date.now().toString(36)}`;
}

export function computeWorkerLoopDelayMs(
  intervals: Record<PollingResourceType, PollingIntervalConfig>,
  random = Math.random,
): number {
  const intervalConfigs = [intervals.clan, intervals.player, intervals.war];

  if (
    intervalConfigs.some(
      (interval) =>
        !Number.isFinite(interval.baseSeconds) ||
        !Number.isFinite(interval.jitterSeconds) ||
        interval.baseSeconds <= 0 ||
        interval.jitterSeconds < 0,
    )
  ) {
    throw new Error(
      'Worker polling loop intervals must be finite and positive with non-negative jitter.',
    );
  }

  const baseSeconds = Math.min(
    intervals.clan.baseSeconds,
    intervals.player.baseSeconds,
    intervals.war.baseSeconds,
  );
  const jitterSeconds = Math.min(
    intervals.clan.jitterSeconds,
    intervals.player.jitterSeconds,
    intervals.war.jitterSeconds,
  );
  const jitter = Math.floor(random() * (jitterSeconds + 1));

  return (baseSeconds + jitter) * 1000;
}

function validateWorkerPollingLoopOptions(options: WorkerPollingLoopOptions): void {
  if (!options || typeof options !== 'object') {
    throw new Error('Worker polling loop options must be an object.');
  }

  if (typeof options.ownerId !== 'string' || !options.ownerId.trim()) {
    throw new Error('Worker polling loop ownerId must be a non-empty string.');
  }

  if (
    !Number.isFinite(options.lockForSeconds) ||
    !Number.isInteger(options.lockForSeconds) ||
    options.lockForSeconds <= 0
  ) {
    throw new Error('Worker polling loop lockForSeconds must be a finite positive integer.');
  }

  if (!options.handlers || typeof options.handlers !== 'object') {
    throw new Error('Worker polling loop handlers must include clan, player, and war functions.');
  }

  for (const resourceType of ['clan', 'player', 'war'] as const) {
    if (typeof options.handlers[resourceType] !== 'function') {
      throw new Error(`Worker polling loop ${resourceType} handler must be a function.`);
    }
  }

  if (options.random !== undefined && typeof options.random !== 'function') {
    throw new Error('Worker polling loop random must be a function when provided.');
  }
  if (options.setTimeout !== undefined && typeof options.setTimeout !== 'function') {
    throw new Error('Worker polling loop setTimeout must be a function when provided.');
  }
  if (options.clearTimeout !== undefined && typeof options.clearTimeout !== 'function') {
    throw new Error('Worker polling loop clearTimeout must be a function when provided.');
  }
}

export async function runWorkerPollingIteration(
  options: WorkerPollingLoopOptions,
): Promise<ProcessDuePollingLeaseResult[]> {
  validateWorkerPollingLoopOptions(options);

  try {
    const orchestrationOptions = {
      leaseStore: options.leaseStore,
      ownerId: options.ownerId,
      lockForSeconds: options.lockForSeconds,
      intervals: options.intervals,
      handlers: options.handlers,
      ...(options.random ? { random: options.random } : {}),
    };
    const results = await processOneDuePollingLeasePerFamily(orchestrationOptions);

    options.logger.debug({ results }, 'Worker polling iteration completed');
    return results;
  } catch (error) {
    options.logger.error({ error }, 'Worker polling iteration failed');
    return [];
  }
}

export function startWorkerPollingLoop(
  options: WorkerPollingLoopOptions,
): WorkerPollingLoopController {
  validateWorkerPollingLoopOptions(options);

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleTimeout = options.setTimeout ?? setTimeout;
  const clearScheduledTimeout = options.clearTimeout ?? clearTimeout;

  const runOnce = () => runWorkerPollingIteration(options);

  const scheduleNext = () => {
    if (stopped) return;
    const delayMs = computeWorkerLoopDelayMs(options.intervals, options.random);
    timer = scheduleTimeout(() => {
      void runOnce().finally(scheduleNext);
    }, delayMs);
  };

  void runOnce().finally(scheduleNext);
  options.logger.info({ ownerId: options.ownerId }, 'Worker polling loop started');

  return {
    ownerId: options.ownerId,
    stop: () => {
      stopped = true;
      if (timer) clearScheduledTimeout(timer);
    },
    runOnce,
  };
}
