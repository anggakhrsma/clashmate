import type { ClaimedPollingLease, NormalizedLatestWarSnapshot, WarSnapshotStore } from '@clashmate/database';
import { describe, expect, it, vi } from 'vitest';

import {
  createWarPollerHandler,
  detectWarAttackEvents,
  detectWarStateTransitionEvent,
  parseCurrentWarResourceId,
} from './war-poller.js';

const warLease: ClaimedPollingLease = {
  resourceType: 'war',
  resourceId: 'current-war:#AAA111',
  ownerId: 'worker-a',
  runAfter: new Date('2026-04-26T23:59:00.000Z'),
  lockedUntil: new Date('2026-04-27T00:00:30.000Z'),
  attempts: 0,
  lastError: null,
};

function createSnapshotStore(
  status: 'upserted' | 'not_linked',
  previous: NormalizedLatestWarSnapshot | null = null,
): WarSnapshotStore {
  return {
    getLatestWarSnapshot: vi.fn().mockResolvedValue(previous),
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
      attackEventsInserted: 0,
      stateEventsInserted: 0,
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
      attackEventsInserted: 0,
      stateEventsInserted: 0,
    });
  });

  it('detects war state transitions from the previous latest snapshot', () => {
    const previousFetchedAt = new Date('2026-04-27T00:00:00.000Z');
    const fetchedAt = new Date('2026-04-27T01:10:00.000Z');

    expect(
      detectWarStateTransitionEvent(
        {
          clanTag: '#AAA111',
          state: 'preparation',
          snapshot: { state: 'preparation' },
          fetchedAt: previousFetchedAt,
        },
        {
          clanTag: '#AAA111',
          state: 'inWar',
          data: {
            startTime: '2026-04-27T01:00:00.000Z',
            clan: { members: [] },
            opponent: { tag: '#OPP222' },
          },
        },
        fetchedAt,
      ),
    ).toEqual({
      clanTag: '#AAA111',
      warKey: 'current:#aaa111:#opp222:2026-04-27t01:00:00.000z',
      previousState: 'preparation',
      currentState: 'inwar',
      previousSnapshot: { state: 'preparation' },
      currentSnapshot: {
        clanTag: '#AAA111',
        state: 'inWar',
        data: {
          startTime: '2026-04-27T01:00:00.000Z',
          clan: { members: [] },
          opponent: { tag: '#OPP222' },
        },
      },
      sourceFetchedAt: fetchedAt,
      occurredAt: new Date('2026-04-27T01:00:00.000Z'),
      detectedAt: fetchedAt,
    });
  });

  it('does not detect war state events for initial snapshots or unchanged states', () => {
    const fetchedAt = new Date('2026-04-27T01:10:00.000Z');

    expect(
      detectWarStateTransitionEvent(null, { clanTag: '#AAA111', state: 'inWar', data: {} }, fetchedAt),
    ).toBeNull();
    expect(
      detectWarStateTransitionEvent(
        {
          clanTag: '#AAA111',
          state: 'inwar',
          snapshot: { state: 'inWar' },
          fetchedAt,
        },
        { clanTag: '#AAA111', state: 'inWar', data: {} },
        fetchedAt,
      ),
    ).toBeNull();
  });

  it('detects current-war attacks with deterministic war identity inputs', () => {
    const fetchedAt = new Date('2026-04-27T00:00:00.000Z');

    expect(
      detectWarAttackEvents(
        {
          clanTag: '#AAA111',
          data: {
            startTime: '20260427T010000.000Z',
            clan: {
              members: [
                {
                  tag: '#P1',
                  attacks: [
                    {
                      attackerTag: '#P1',
                      defenderTag: '#Q1',
                      stars: 3,
                      destructionPercentage: 100,
                      order: 4,
                      duration: 111,
                    },
                  ],
                },
              ],
            },
            opponent: {
              tag: '#OPP222',
              members: [{ tag: '#Q1', bestOpponentAttack: { order: 4 } }],
            },
          },
        },
        fetchedAt,
      ),
    ).toEqual([
      {
        clanTag: '#AAA111',
        warKey: 'current:#aaa111:#opp222:20260427t010000.000z',
        attackerTag: '#P1',
        defenderTag: '#Q1',
        attackOrder: 4,
        stars: 3,
        destructionPercentage: 100,
        duration: 111,
        freshAttack: true,
        rawAttack: {
          attackerTag: '#P1',
          defenderTag: '#Q1',
          stars: 3,
          destructionPercentage: 100,
          order: 4,
          duration: 111,
        },
        sourceFetchedAt: fetchedAt,
        occurredAt: fetchedAt,
        detectedAt: fetchedAt,
      },
    ]);
  });

  it('inserts detected attacks only after the linked war snapshot is accepted', async () => {
    const attackEvents = { insertWarAttackEvents: vi.fn().mockResolvedValue({ inserted: 1 }) };
    const handler = createWarPollerHandler({
      coc: {
        getCurrentWar: vi.fn().mockResolvedValue({
          clanTag: '#AAA111',
          state: 'inWar',
          data: {
            clan: {
              members: [
                {
                  attacks: [
                    {
                      attackerTag: '#P1',
                      defenderTag: '#Q1',
                      stars: 2,
                      destructionPercentage: 80,
                      order: 1,
                    },
                  ],
                },
              ],
            },
          },
        }),
      },
      snapshots: createSnapshotStore('upserted'),
      attackEvents,
    });

    await expect(handler(warLease)).resolves.toMatchObject({ attackEventsInserted: 1 });
    expect(attackEvents.insertWarAttackEvents).toHaveBeenCalledTimes(1);
  });

  it('inserts detected state transitions only after the linked war snapshot is accepted', async () => {
    const fetchedAt = new Date('2026-04-27T01:10:00.000Z');
    const stateEvents = { insertWarStateEvents: vi.fn().mockResolvedValue({ inserted: 1 }) };
    const handler = createWarPollerHandler({
      coc: {
        getCurrentWar: vi.fn().mockResolvedValue({
          clanTag: '#AAA111',
          state: 'inWar',
          data: {
            startTime: '2026-04-27T01:00:00.000Z',
            clan: { members: [] },
            opponent: { tag: '#OPP222' },
          },
        }),
      },
      snapshots: createSnapshotStore('upserted', {
        clanTag: '#AAA111',
        state: 'preparation',
        snapshot: { state: 'preparation' },
        fetchedAt: new Date('2026-04-27T00:55:00.000Z'),
      }),
      stateEvents,
      now: () => fetchedAt,
    });

    await expect(handler(warLease)).resolves.toMatchObject({ stateEventsInserted: 1 });
    expect(stateEvents.insertWarStateEvents).toHaveBeenCalledTimes(1);
    expect(stateEvents.insertWarStateEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        clanTag: '#AAA111',
        previousState: 'preparation',
        currentState: 'inwar',
        sourceFetchedAt: fetchedAt,
        detectedAt: fetchedAt,
      }),
    ]);
  });

  it('skips state transition inserts when the current war snapshot is not linked', async () => {
    const stateEvents = { insertWarStateEvents: vi.fn() };
    const handler = createWarPollerHandler({
      coc: {
        getCurrentWar: vi.fn().mockResolvedValue({ clanTag: '#AAA111', state: 'inWar', data: {} }),
      },
      snapshots: createSnapshotStore('not_linked', {
        clanTag: '#AAA111',
        state: 'preparation',
        snapshot: { state: 'preparation' },
        fetchedAt: new Date('2026-04-27T00:55:00.000Z'),
      }),
      stateEvents,
    });

    await expect(handler(warLease)).resolves.toMatchObject({
      status: 'not_linked',
      stateEventsInserted: 0,
    });
    expect(stateEvents.insertWarStateEvents).not.toHaveBeenCalled();
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
