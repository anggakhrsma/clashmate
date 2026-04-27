import type { ClashMateCocClient } from '@clashmate/coc';
import type { ClaimedPollingLease, ClanSnapshotStore } from '@clashmate/database';

export interface ClanPollerHandlerOptions {
  readonly coc: Pick<ClashMateCocClient, 'getClan'>;
  readonly snapshots: ClanSnapshotStore;
  readonly now?: () => Date;
}

export interface ClanPollerResult {
  readonly status: 'snapshot_updated' | 'not_linked';
  readonly clanTag: string;
}

export function createClanPollerHandler(options: ClanPollerHandlerOptions) {
  return async (lease: ClaimedPollingLease): Promise<ClanPollerResult> => {
    if (lease.resourceType !== 'clan') {
      throw new Error(`Clan poller cannot process ${lease.resourceType} leases.`);
    }

    const clan = await options.coc.getClan(lease.resourceId);
    const clanTag = clan.tag;
    const result = await options.snapshots.upsertLatestClanSnapshot({
      clanTag: clan.tag,
      name: clan.name,
      snapshot: clan,
      fetchedAt: options.now?.() ?? new Date(),
    });

    return { status: result.status === 'upserted' ? 'snapshot_updated' : 'not_linked', clanTag };
  };
}
