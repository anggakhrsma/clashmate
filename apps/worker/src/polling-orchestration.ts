import {
  assertTopLevelPollingResourceType,
  type ClaimedPollingLease,
  computeJitteredNextRun,
  type PollingIntervalConfig,
  type PollingLeaseStore,
  type PollingResourceType,
  TOP_LEVEL_POLLING_RESOURCE_TYPES,
} from '@clashmate/database';

export const WORKER_POLLING_RESOURCE_TYPES = TOP_LEVEL_POLLING_RESOURCE_TYPES;

export type PollingLeaseHandler = (lease: ClaimedPollingLease) => Promise<unknown>;

export interface PollingOrchestrationOptions {
  readonly leaseStore: PollingLeaseStore;
  readonly ownerId: string;
  readonly lockForSeconds: number;
  readonly intervals: Record<PollingResourceType, PollingIntervalConfig>;
  readonly handlers: Record<PollingResourceType, PollingLeaseHandler>;
  readonly now?: () => Date;
  readonly random?: () => number;
}

export interface ProcessDuePollingLeaseResult {
  readonly resourceType: PollingResourceType;
  readonly status: 'processed' | 'idle' | 'failed';
  readonly resourceId?: string;
  readonly leaseSummary?: PollingLeaseSummary;
  readonly skippedResources?: PollingSkippedResourcesSummary;
  readonly familySummary?: PollingFamilyResultSummary;
  readonly nextPoll?: PollingNextPollSummary;
  readonly claimedAt?: Date;
  readonly completedAt?: Date;
  readonly durationMs?: number;
  readonly nextRunAt?: Date;
  readonly errorMessage?: string;
}

export interface PollingLeaseSummary {
  readonly claimed: boolean;
  readonly resourceId?: string;
  readonly attempts?: number;
  readonly wasDueByMs?: number;
  readonly lockedUntil?: Date | null;
}

export interface PollingSkippedResourcesSummary {
  readonly count: number;
  readonly reasons: Record<string, number>;
}

export interface PollingFamilyResultSummary {
  readonly resourceType: PollingResourceType;
  readonly successCount: number;
  readonly failureCount: number;
  readonly skippedCount: number;
  readonly idleCount: number;
}

export interface PollingNextPollSummary {
  readonly scheduledAt: Date;
  readonly baseSeconds: number;
  readonly jitterSeconds: number;
  readonly delayMs: number;
  readonly jitterMs: number;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown polling lease error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createLeaseSummary(lease: ClaimedPollingLease, claimedAt: Date): PollingLeaseSummary {
  return {
    claimed: true,
    resourceId: lease.resourceId,
    attempts: lease.attempts,
    wasDueByMs: Math.max(0, claimedAt.getTime() - lease.runAfter.getTime()),
    lockedUntil: lease.lockedUntil,
  };
}

function createSkippedResourcesSummary(handlerResult: unknown): PollingSkippedResourcesSummary {
  if (!isRecord(handlerResult)) return { count: 0, reasons: {} };

  const reasons: Record<string, number> = {};
  const incrementReason = (reason: string) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };
  for (const [key, value] of Object.entries(handlerResult)) {
    if (!key.endsWith('SkipReason') || typeof value !== 'string' || !value) continue;
    incrementReason(value);
  }

  const { status } = handlerResult as { readonly status?: unknown };
  if (status === 'not_linked') {
    incrementReason('not_linked');
  }

  return {
    count: Object.values(reasons).reduce((sum, count) => sum + count, 0),
    reasons,
  };
}

function createFamilySummary(
  resourceType: PollingResourceType,
  status: ProcessDuePollingLeaseResult['status'],
  skippedCount: number,
): PollingFamilyResultSummary {
  return {
    resourceType,
    successCount: status === 'processed' ? 1 : 0,
    failureCount: status === 'failed' ? 1 : 0,
    skippedCount,
    idleCount: status === 'idle' ? 1 : 0,
  };
}

function createNextPollSummary(
  completedAt: Date,
  nextRunAt: Date,
  interval: PollingIntervalConfig,
): PollingNextPollSummary {
  const delayMs = nextRunAt.getTime() - completedAt.getTime();
  const baseMs = interval.baseSeconds * 1000;

  return {
    scheduledAt: nextRunAt,
    baseSeconds: interval.baseSeconds,
    jitterSeconds: interval.jitterSeconds,
    delayMs,
    jitterMs: Math.max(0, delayMs - baseMs),
  };
}

function attachPollingObservability<T extends ProcessDuePollingLeaseResult>(
  result: T,
  observability: Record<string, unknown>,
): T {
  for (const [key, value] of Object.entries(observability)) {
    if (value === undefined) continue;
    Object.defineProperty(result, key, {
      value,
      enumerable: false,
      configurable: true,
    });
  }
  return result;
}

function getHandlerObservability(handlerResult: unknown): Record<string, unknown> {
  return isRecord(handlerResult) ? handlerResult : {};
}

export async function processOneDuePollingLease(
  resourceType: PollingResourceType,
  options: PollingOrchestrationOptions,
): Promise<ProcessDuePollingLeaseResult> {
  assertTopLevelPollingResourceType(resourceType);
  const claimedAt = options.now?.() ?? new Date();
  const lease = await options.leaseStore.claimDuePollingLease(
    resourceType,
    options.ownerId,
    options.lockForSeconds,
    claimedAt,
  );

  if (!lease) return { resourceType, status: 'idle' };

  try {
    const handlerResult = await options.handlers[resourceType](lease);
    const completedAt = options.now?.() ?? new Date();
    const nextRunAt = computeJitteredNextRun(
      completedAt,
      options.intervals[resourceType],
      options.random,
    );
    await options.leaseStore.completePollingLease(
      resourceType,
      lease.resourceId,
      options.ownerId,
      nextRunAt,
    );
    const skippedResources = createSkippedResourcesSummary(handlerResult);
    return attachPollingObservability(
      {
        resourceType,
        status: 'processed',
        resourceId: lease.resourceId,
      },
      {
        ...getHandlerObservability(handlerResult),
        leaseSummary: createLeaseSummary(lease, claimedAt),
        skippedResources,
        familySummary: createFamilySummary(resourceType, 'processed', skippedResources.count),
        nextPoll: createNextPollSummary(completedAt, nextRunAt, options.intervals[resourceType]),
        claimedAt,
        completedAt,
        durationMs: completedAt.getTime() - claimedAt.getTime(),
        nextRunAt,
      },
    );
  } catch (error) {
    const completedAt = options.now?.() ?? new Date();
    const nextRunAt = computeJitteredNextRun(
      completedAt,
      options.intervals[resourceType],
      options.random,
    );
    await options.leaseStore.failPollingLease(
      resourceType,
      lease.resourceId,
      options.ownerId,
      error,
      nextRunAt,
    );
    return attachPollingObservability(
      {
        resourceType,
        status: 'failed',
        resourceId: lease.resourceId,
      },
      {
        leaseSummary: createLeaseSummary(lease, claimedAt),
        skippedResources: { count: 0, reasons: {} },
        familySummary: createFamilySummary(resourceType, 'failed', 0),
        nextPoll: createNextPollSummary(completedAt, nextRunAt, options.intervals[resourceType]),
        claimedAt,
        completedAt,
        durationMs: completedAt.getTime() - claimedAt.getTime(),
        nextRunAt,
        errorMessage: getErrorMessage(error),
      },
    );
  }
}

export async function processOneDuePollingLeasePerFamily(
  options: PollingOrchestrationOptions,
): Promise<ProcessDuePollingLeaseResult[]> {
  return Promise.all(
    WORKER_POLLING_RESOURCE_TYPES.map((resourceType) =>
      processOneDuePollingLease(resourceType, options),
    ),
  );
}
