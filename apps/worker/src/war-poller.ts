import type { ClashMateCocClient } from '@clashmate/coc';
import type { ClaimedPollingLease, WarSnapshotStore } from '@clashmate/database';

export const CURRENT_WAR_RESOURCE_PREFIX = 'current-war:';

export interface WarPollerHandlerOptions {
  readonly coc: Pick<ClashMateCocClient, 'getCurrentWar'>;
  readonly snapshots: WarSnapshotStore;
  readonly now?: () => Date;
}

export interface WarPollerResult {
  readonly status: 'snapshot_updated' | 'not_linked';
  readonly clanTag: string;
  readonly state: string;
}

export function createWarPollerHandler(options: WarPollerHandlerOptions) {
  return async (lease: ClaimedPollingLease): Promise<WarPollerResult> => {
    if (lease.resourceType !== 'war') {
      throw new Error(`War poller cannot process ${lease.resourceType} leases.`);
    }

    const clanTag = parseCurrentWarResourceId(lease.resourceId);
    const war = await options.coc.getCurrentWar(clanTag);
    const result = await options.snapshots.upsertLatestWarSnapshot({
      clanTag: war.clanTag,
      state: war.state,
      snapshot: war,
      fetchedAt: options.now?.() ?? new Date(),
    });

    return {
      status: result.status === 'upserted' ? 'snapshot_updated' : 'not_linked',
      clanTag: war.clanTag,
      state: war.state,
    };
  };
}

export function parseCurrentWarResourceId(resourceId: string): string {
  if (!resourceId.startsWith(CURRENT_WAR_RESOURCE_PREFIX)) {
    throw new Error(`Unsupported war polling resource id: ${resourceId}`);
  }

  const clanTag = resourceId.slice(CURRENT_WAR_RESOURCE_PREFIX.length).trim().toUpperCase();
  if (!clanTag) throw new Error('War polling resource id requires a clan tag.');
  return clanTag;
}
