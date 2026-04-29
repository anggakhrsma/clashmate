import type { ClaimedPollingLease, ClanMemberEventStore, ClanSnapshotStore } from '@clashmate/database';
import { describe, expect, it, vi } from 'vitest';

import { createClanPollerHandler } from './clan-poller.js';

const clanLease: ClaimedPollingLease = {
  resourceType: 'clan',
  resourceId: '#AAA111',
  ownerId: 'worker-a',
  runAfter: new Date('2026-04-26T23:59:00.000Z'),
  lockedUntil: new Date('2026-04-27T00:00:30.000Z'),
  attempts: 0,
  lastError: null,
};

function createSnapshotStore(status: 'upserted' | 'not_linked'): ClanSnapshotStore {
  return {
    upsertLatestClanSnapshot: vi.fn().mockResolvedValue({ status }),
  };
}

describe('clan poller handler', () => {
  it('fetches a linked clan through packages/coc and writes the latest snapshot and member events', async () => {
    const fetchedAt = new Date('2026-04-27T00:00:00.000Z');
    const coc = {
      getClan: vi.fn().mockResolvedValue({
        tag: '#AAA111',
        name: 'Alpha',
        data: { level: 12 },
        memberList: [{ tag: '#P1', name: 'One', role: 'member', trophies: 1234 }],
      }),
    };
    const snapshots = createSnapshotStore('upserted');
    const memberEvents: ClanMemberEventStore = {
      processClanMemberSnapshots: vi.fn().mockResolvedValue({
        status: 'processed',
        joined: 1,
        left: 0,
        donationEvents: 0,
      }),
    };
    const handler = createClanPollerHandler({ coc, snapshots, memberEvents, now: () => fetchedAt });

    await expect(handler(clanLease)).resolves.toEqual({
      status: 'snapshot_updated',
      clanTag: '#AAA111',
    });

    expect(coc.getClan).toHaveBeenCalledWith('#AAA111');
    expect(snapshots.upsertLatestClanSnapshot).toHaveBeenCalledWith({
      clanTag: '#AAA111',
      name: 'Alpha',
      snapshot: {
        tag: '#AAA111',
        name: 'Alpha',
        data: { level: 12 },
        memberList: [{ tag: '#P1', name: 'One', role: 'member', trophies: 1234 }],
      },
      fetchedAt,
    });
    expect(memberEvents.processClanMemberSnapshots).toHaveBeenCalledWith({
      clanTag: '#AAA111',
      fetchedAt,
      members: [
        expect.objectContaining({
          playerTag: '#P1',
          name: 'One',
          role: 'member',
          trophies: 1234,
        }),
      ],
    });
  });

  it('extracts clan members from the real ClashMateCocClient data wrapper shape', async () => {
    const fetchedAt = new Date('2026-04-27T00:00:00.000Z');
    const coc = {
      getClan: vi.fn().mockResolvedValue({
        tag: '#AAA111',
        name: 'Alpha',
        data: {
          memberList: [
            {
              tag: '#P2',
              name: 'Two',
              role: 'admin',
              expLevel: 200,
              league: { id: 29000022 },
              trophies: 5678,
              donations: 90,
              donationsReceived: 12,
            },
          ],
        },
      }),
    };
    const snapshots = createSnapshotStore('upserted');
    const memberEvents: ClanMemberEventStore = {
      processClanMemberSnapshots: vi.fn().mockResolvedValue({
        status: 'processed',
        joined: 1,
        left: 0,
        donationEvents: 0,
      }),
    };
    const handler = createClanPollerHandler({ coc, snapshots, memberEvents, now: () => fetchedAt });

    await handler(clanLease);

    expect(memberEvents.processClanMemberSnapshots).toHaveBeenCalledWith({
      clanTag: '#AAA111',
      fetchedAt,
      members: [
        expect.objectContaining({
          playerTag: '#P2',
          name: 'Two',
          role: 'admin',
          expLevel: 200,
          leagueId: 29000022,
          trophies: 5678,
          donations: 90,
          donationsReceived: 12,
        }),
      ],
    });
  });

  it('does not turn an unlinked searched clan into a durable snapshot', async () => {
    const coc = { getClan: vi.fn().mockResolvedValue({ tag: '#BBB222', name: 'Search Only' }) };
    const snapshots = createSnapshotStore('not_linked');
    const handler = createClanPollerHandler({ coc, snapshots });

    await expect(handler({ ...clanLease, resourceId: '#BBB222' })).resolves.toEqual({
      status: 'not_linked',
      clanTag: '#BBB222',
    });
  });

  it('does not write member events for unlinked clans', async () => {
    const coc = { getClan: vi.fn().mockResolvedValue({ tag: '#BBB222', name: 'Search Only' }) };
    const snapshots = createSnapshotStore('not_linked');
    const memberEvents: ClanMemberEventStore = {
      processClanMemberSnapshots: vi.fn(),
    };
    const handler = createClanPollerHandler({ coc, snapshots, memberEvents });

    await handler({ ...clanLease, resourceId: '#BBB222' });

    expect(memberEvents.processClanMemberSnapshots).not.toHaveBeenCalled();
  });

  it('rejects non-clan leases', async () => {
    const handler = createClanPollerHandler({
      coc: { getClan: vi.fn() },
      snapshots: createSnapshotStore('upserted'),
    });

    await expect(handler({ ...clanLease, resourceType: 'player' })).rejects.toThrow(
      'Clan poller cannot process player leases.',
    );
  });
});
