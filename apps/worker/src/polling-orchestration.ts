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

export type PollingLeaseHandler = (lease: ClaimedPollingLease) => Promise<void>;

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
}

export async function processOneDuePollingLease(
  resourceType: PollingResourceType,
  options: PollingOrchestrationOptions,
): Promise<ProcessDuePollingLeaseResult> {
  assertTopLevelPollingResourceType(resourceType);
  const now = options.now?.() ?? new Date();
  const lease = await options.leaseStore.claimDuePollingLease(
    resourceType,
    options.ownerId,
    options.lockForSeconds,
    now,
  );

  if (!lease) return { resourceType, status: 'idle' };

  try {
    await options.handlers[resourceType](lease);
    await options.leaseStore.completePollingLease(
      resourceType,
      lease.resourceId,
      options.ownerId,
      computeJitteredNextRun(
        options.now?.() ?? new Date(),
        options.intervals[resourceType],
        options.random,
      ),
    );
    return { resourceType, status: 'processed', resourceId: lease.resourceId };
  } catch (error) {
    await options.leaseStore.failPollingLease(
      resourceType,
      lease.resourceId,
      options.ownerId,
      error,
      computeJitteredNextRun(
        options.now?.() ?? new Date(),
        options.intervals[resourceType],
        options.random,
      ),
    );
    return { resourceType, status: 'failed', resourceId: lease.resourceId };
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
