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
  readonly claimedAt?: Date;
  readonly completedAt?: Date;
  readonly durationMs?: number;
  readonly nextRunAt?: Date;
  readonly errorMessage?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown polling lease error';
}

function attachPollingObservability<T extends ProcessDuePollingLeaseResult>(
  result: T,
  observability: Omit<ProcessDuePollingLeaseResult, 'resourceType' | 'status' | 'resourceId'>,
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
    await options.handlers[resourceType](lease);
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
    return attachPollingObservability(
      {
        resourceType,
        status: 'processed',
        resourceId: lease.resourceId,
      },
      {
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
