import type { ClashMateCocClient } from '@clashmate/coc';
import type { ClaimedPollingLease, PlayerSnapshotStore } from '@clashmate/database';

export interface PlayerPollerHandlerOptions {
  readonly coc: Pick<ClashMateCocClient, 'getPlayer'>;
  readonly snapshots: PlayerSnapshotStore;
  readonly now?: () => Date;
}

export interface PlayerPollerResult {
  readonly status: 'snapshot_updated' | 'not_linked';
  readonly playerTag: string;
}

export function createPlayerPollerHandler(options: PlayerPollerHandlerOptions) {
  return async (lease: ClaimedPollingLease): Promise<PlayerPollerResult> => {
    if (lease.resourceType !== 'player') {
      throw new Error(`Player poller cannot process ${lease.resourceType} leases.`);
    }

    const player = await options.coc.getPlayer(lease.resourceId);
    const playerTag = player.tag;
    const result = await options.snapshots.upsertLatestPlayerSnapshot({
      playerTag: player.tag,
      name: player.name,
      snapshot: player,
      fetchedAt: options.now?.() ?? new Date(),
    });

    return {
      status: result.status === 'upserted' ? 'snapshot_updated' : 'not_linked',
      playerTag,
    };
  };
}
