import type { ClaimedPollingLease, WarSnapshotStore } from '@clashmate/database';
import { describe, expect, it, vi } from 'vitest';

import { createWarPollerHandler, parseCurrentWarResourceId } from './war-poller.js';

const warLease: ClaimedPollingLease = {
  resourceType: 'war',
  resourceId: 'current-war:#AAA111',
  ownerId: 'worker-a',
  runAfter: new Date('2026-04-26T23:59:00.000Z'),
  lockedUntil: new Date('2026-04-27T00:00:30.000Z'),
  attempts: 0,
  lastError: null,
};

function createSnapshotStore(status: 'upserted' | 'not_linked'): WarSnapshotStore {
  return {
    upsertLatestWarSnapshot: vi.fn().mockResolvedValue({ status }),
  };
}

describe('war poller handler', () => {
  it('fetches a linked clan current war and writes the latest war snapshot', async () => {
    const fetchedAt = new Date('2026-04-27T00:00:00.000Z');
    const coc = {
      getCurrentWar: vi.fn().mockResolvedValue({
        clanTag: '#AAA111',
        state: 'inWar',
        data: { state: 'inWar', teamSize: 15 },
      }),
    };
    const snapshots = createSnapshotStore('upserted');
    const handler = createWarPollerHandler({ coc, snapshots, now: () => fetchedAt });

    await expect(handler(warLease)).resolves.toEqual({
      status: 'snapshot_updated',
      clanTag: '#AAA111',
      state: 'inWar',
    });

    expect(coc.getCurrentWar).toHaveBeenCalledWith('#AAA111');
    expect(snapshots.upsertLatestWarSnapshot).toHaveBeenCalledWith({
      clanTag: '#AAA111',
      state: 'inWar',
      snapshot: {
        clanTag: '#AAA111',
        state: 'inWar',
        data: { state: 'inWar', teamSize: 15 },
      },
      fetchedAt,
    });
  });

  it('does not turn a search-only clan war lookup into a durable snapshot', async () => {
    const coc = {
      getCurrentWar: vi.fn().mockResolvedValue({ clanTag: '#BBB222', state: 'notInWar' }),
    };
    const snapshots = createSnapshotStore('not_linked');
    const handler = createWarPollerHandler({ coc, snapshots });

    await expect(handler({ ...warLease, resourceId: 'current-war:#BBB222' })).resolves.toEqual({
      status: 'not_linked',
      clanTag: '#BBB222',
      state: 'notInWar',
    });
  });

  it('rejects non-war leases', async () => {
    const handler = createWarPollerHandler({
      coc: { getCurrentWar: vi.fn() },
      snapshots: createSnapshotStore('upserted'),
    });

    await expect(handler({ ...warLease, resourceType: 'clan' })).rejects.toThrow(
      'War poller cannot process clan leases.',
    );
  });

  it('parses current war resources derived from linked clans', () => {
    expect(parseCurrentWarResourceId('current-war: #abc123 ')).toBe('#ABC123');
    expect(() => parseCurrentWarResourceId('#ABC123')).toThrow(
      'Unsupported war polling resource id: #ABC123',
    );
  });
});
