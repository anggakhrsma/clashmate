import type { ClaimedPollingLease, PlayerSnapshotStore } from '@clashmate/database';
import { describe, expect, it, vi } from 'vitest';

import { createPlayerPollerHandler } from './player-poller.js';

const playerLease: ClaimedPollingLease = {
  resourceType: 'player',
  resourceId: '#PLAYER1',
  ownerId: 'worker-a',
  runAfter: new Date('2026-04-26T23:59:00.000Z'),
  lockedUntil: new Date('2026-04-27T00:00:30.000Z'),
  attempts: 0,
  lastError: null,
};

function createSnapshotStore(status: 'upserted' | 'not_linked'): PlayerSnapshotStore {
  return {
    upsertLatestPlayerSnapshot: vi.fn().mockResolvedValue({ status }),
  };
}

describe('player poller handler', () => {
  it('fetches a linked player through packages/coc and writes the latest snapshot', async () => {
    const fetchedAt = new Date('2026-04-27T00:00:00.000Z');
    const coc = {
      getPlayer: vi
        .fn()
        .mockResolvedValue({ tag: '#PLAYER1', name: 'Chief', data: { trophies: 5000 } }),
    };
    const snapshots = createSnapshotStore('upserted');
    const handler = createPlayerPollerHandler({ coc, snapshots, now: () => fetchedAt });

    await expect(handler(playerLease)).resolves.toEqual({
      status: 'snapshot_updated',
      playerTag: '#PLAYER1',
    });

    expect(coc.getPlayer).toHaveBeenCalledWith('#PLAYER1');
    expect(snapshots.upsertLatestPlayerSnapshot).toHaveBeenCalledWith({
      playerTag: '#PLAYER1',
      name: 'Chief',
      snapshot: { tag: '#PLAYER1', name: 'Chief', data: { trophies: 5000 } },
      fetchedAt,
    });
  });

  it('does not turn an unlinked searched player into a durable snapshot', async () => {
    const coc = { getPlayer: vi.fn().mockResolvedValue({ tag: '#SEARCH1', name: 'Search Only' }) };
    const snapshots = createSnapshotStore('not_linked');
    const handler = createPlayerPollerHandler({ coc, snapshots });

    await expect(handler({ ...playerLease, resourceId: '#SEARCH1' })).resolves.toEqual({
      status: 'not_linked',
      playerTag: '#SEARCH1',
    });
  });

  it('rejects non-player leases', async () => {
    const handler = createPlayerPollerHandler({
      coc: { getPlayer: vi.fn() },
      snapshots: createSnapshotStore('upserted'),
    });

    await expect(handler({ ...playerLease, resourceType: 'clan' })).rejects.toThrow(
      'Player poller cannot process clan leases.',
    );
  });
});
