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
  validateWorkerPollingLoopIntervals(intervals);

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

function validateWorkerPollingLoopIntervals(
  intervals: Record<PollingResourceType, PollingIntervalConfig>,
): void {
  if (!intervals || typeof intervals !== 'object') {
    throw new Error('Worker polling loop intervals must include clan, player, and war configs.');
  }

  for (const resourceType of ['clan', 'player', 'war'] as const) {
    const interval = intervals[resourceType];

    if (!interval || typeof interval !== 'object') {
      throw new Error(`Worker polling loop ${resourceType} interval must be an object.`);
    }

    if (!Number.isFinite(interval.baseSeconds) || interval.baseSeconds <= 0) {
      throw new Error(
        `Worker polling loop ${resourceType} baseSeconds must be a finite positive number.`,
      );
    }

    if (!Number.isFinite(interval.jitterSeconds) || interval.jitterSeconds < 0) {
      throw new Error(
        `Worker polling loop ${resourceType} jitterSeconds must be a finite non-negative number.`,
      );
    }
  }
}

type PollingOutcomeStatus = ProcessDuePollingLeaseResult['status'];

interface PollingOutcomeLeaseDetail {
  readonly resourceType: PollingResourceType;
  readonly resourceId: string;
  readonly durationMs?: number;
  readonly nextRunAt?: string;
  readonly errorMessage?: string;
  readonly diagnostics?: Record<string, unknown>;
}

interface PollingOutcomeSummary {
  readonly counts: Record<PollingOutcomeStatus, number>;
  readonly processed: PollingOutcomeLeaseDetail[];
  readonly failed: PollingOutcomeLeaseDetail[];
}

const POLLING_OUTCOME_STATUSES: readonly PollingOutcomeStatus[] = ['processed', 'idle', 'failed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pickDefinedDiagnostics(
  result: ProcessDuePollingLeaseResult,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  const source = result as unknown;
  if (!isRecord(source)) return undefined;

  const diagnostics = Object.fromEntries(
    fields.flatMap((field) => (source[field] === undefined ? [] : [[field, source[field]]])),
  );

  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined;
}

function createPollingOutcomeDiagnostics(
  result: ProcessDuePollingLeaseResult,
): Record<string, unknown> | undefined {
  if (result.resourceType === 'clan') {
    return pickDefinedDiagnostics(result, [
      'clanTag',
      'fetchedMemberCount',
      'memberEventProcessingRan',
      'memberEventSkipReason',
      'joined',
      'left',
      'donationEvents',
      'roleChangeEvents',
    ]);
  }

  if (result.resourceType === 'player') {
    return pickDefinedDiagnostics(result, [
      'playerTag',
      'clanTag',
      'clanGamesConsidered',
      'clanGamesSkipReason',
      'clanGamesSeasonId',
      'gamesChampionAchievementValue',
      'clanGamesEventMaxPoints',
      'clanGames',
    ]);
  }

  return pickDefinedDiagnostics(result, [
    'clanTag',
    'state',
    'warKey',
    'attackEventsGenerated',
    'attackEventsInserted',
    'attackEventsSkipReason',
    'stateEventsGenerated',
    'stateEventsInserted',
    'stateEventsSkipReason',
    'missedAttackEventsGenerated',
    'missedAttackEventsInserted',
    'missedAttackEventsSkipReason',
    'retentionRan',
    'retentionSkipReason',
  ]);
}

function createPollingOutcomeLeaseDetail(
  result: ProcessDuePollingLeaseResult,
): PollingOutcomeLeaseDetail | undefined {
  if (!result.resourceId) return undefined;
  const diagnostics = createPollingOutcomeDiagnostics(result);

  return {
    resourceType: result.resourceType,
    resourceId: result.resourceId,
    ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    ...(result.nextRunAt ? { nextRunAt: result.nextRunAt.toISOString() } : {}),
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function summarizePollingOutcomes(
  results: readonly ProcessDuePollingLeaseResult[],
): PollingOutcomeSummary {
  const counts: Record<PollingOutcomeStatus, number> = {
    processed: 0,
    idle: 0,
    failed: 0,
  };
  const processed: PollingOutcomeLeaseDetail[] = [];
  const failed: PollingOutcomeLeaseDetail[] = [];

  for (const result of results) {
    counts[result.status] += 1;

    if (result.status !== 'processed' && result.status !== 'failed') continue;
    const detail = createPollingOutcomeLeaseDetail(result);
    if (!detail) continue;

    if (result.status === 'processed') {
      processed.push(detail);
    } else {
      failed.push(detail);
    }
  }

  return {
    counts: Object.fromEntries(
      POLLING_OUTCOME_STATUSES.map((status) => [status, counts[status]]),
    ) as Record<PollingOutcomeStatus, number>,
    processed,
    failed,
  };
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

  validateWorkerPollingLoopIntervals(options.intervals);

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
    const pollingOutcome = summarizePollingOutcomes(results);

    options.logger.debug({ results, pollingOutcome }, 'Worker polling iteration completed');
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
      void runOnce()
        .catch((error: unknown) => {
          options.logger.error({ error }, 'Scheduled worker polling iteration failed');
        })
        .finally(scheduleNext);
    }, delayMs);
  };

  void runOnce()
    .catch((error: unknown) => {
      options.logger.error({ error }, 'Initial worker polling iteration failed');
    })
    .finally(scheduleNext);
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
