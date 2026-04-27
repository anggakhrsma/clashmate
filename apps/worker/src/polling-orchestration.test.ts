import type { ClaimedPollingLease, PollingLeaseStore } from '@clashmate/database';
import { describe, expect, it, vi } from 'vitest';

import {
  processOneDuePollingLease,
  processOneDuePollingLeasePerFamily,
  WORKER_POLLING_RESOURCE_TYPES,
} from './polling-orchestration.js';

const claimedLease: ClaimedPollingLease = {
  resourceType: 'clan',
  resourceId: '#AAA111',
  ownerId: 'worker-a',
  runAfter: new Date('2026-04-26T23:59:00.000Z'),
  lockedUntil: new Date('2026-04-27T00:00:30.000Z'),
  attempts: 0,
  lastError: null,
};

function createLeaseStore(lease: ClaimedPollingLease | null): PollingLeaseStore {
  return {
    claimDuePollingLease: vi.fn().mockResolvedValue(lease),
    completePollingLease: vi.fn().mockResolvedValue(undefined),
    failPollingLease: vi.fn().mockResolvedValue(undefined),
  };
}

describe('polling orchestration', () => {
  it('does not create worker poller families beyond clan, player, and war', () => {
    expect(WORKER_POLLING_RESOURCE_TYPES).toEqual(['clan', 'player', 'war']);
  });

  it('completes a claimed lease by rescheduling and clearing lock fields through the store', async () => {
    const leaseStore = createLeaseStore(claimedLease);
    const handler = vi.fn().mockResolvedValue(undefined);

    await expect(
      processOneDuePollingLease('clan', {
        leaseStore,
        ownerId: 'worker-a',
        lockForSeconds: 30,
        intervals: {
          clan: { baseSeconds: 300, jitterSeconds: 60 },
          player: { baseSeconds: 900, jitterSeconds: 180 },
          war: { baseSeconds: 120, jitterSeconds: 30 },
        },
        handlers: { clan: handler, player: vi.fn(), war: vi.fn() },
        now: () => new Date('2026-04-27T00:00:00.000Z'),
        random: () => 0,
      }),
    ).resolves.toEqual({ resourceType: 'clan', status: 'processed', resourceId: '#AAA111' });

    expect(leaseStore.claimDuePollingLease).toHaveBeenCalledWith(
      'clan',
      'worker-a',
      30,
      new Date('2026-04-27T00:00:00.000Z'),
    );
    expect(handler).toHaveBeenCalledWith(claimedLease);
    expect(leaseStore.completePollingLease).toHaveBeenCalledWith(
      'clan',
      '#AAA111',
      new Date('2026-04-27T00:05:00.000Z'),
    );
    expect(leaseStore.failPollingLease).not.toHaveBeenCalled();
  });

  it('failure increments attempts, stores error, clears lock fields, and schedules retry through the store', async () => {
    const leaseStore = createLeaseStore(claimedLease);
    const error = new Error('boom');

    await expect(
      processOneDuePollingLease('clan', {
        leaseStore,
        ownerId: 'worker-a',
        lockForSeconds: 30,
        intervals: {
          clan: { baseSeconds: 30, jitterSeconds: 10 },
          player: { baseSeconds: 900, jitterSeconds: 180 },
          war: { baseSeconds: 120, jitterSeconds: 30 },
        },
        handlers: { clan: vi.fn().mockRejectedValue(error), player: vi.fn(), war: vi.fn() },
        now: () => new Date('2026-04-27T00:00:00.000Z'),
        random: () => 0,
      }),
    ).resolves.toEqual({ resourceType: 'clan', status: 'failed', resourceId: '#AAA111' });

    expect(leaseStore.failPollingLease).toHaveBeenCalledWith(
      'clan',
      '#AAA111',
      error,
      new Date('2026-04-27T00:00:30.000Z'),
    );
    expect(leaseStore.completePollingLease).not.toHaveBeenCalled();
  });

  it('processes one due lease per top-level family only', async () => {
    const leaseStore = createLeaseStore(null);

    await processOneDuePollingLeasePerFamily({
      leaseStore,
      ownerId: 'worker-a',
      lockForSeconds: 30,
      intervals: {
        clan: { baseSeconds: 300, jitterSeconds: 60 },
        player: { baseSeconds: 900, jitterSeconds: 180 },
        war: { baseSeconds: 120, jitterSeconds: 30 },
      },
      handlers: { clan: vi.fn(), player: vi.fn(), war: vi.fn() },
      now: () => new Date('2026-04-27T00:00:00.000Z'),
      random: () => 0,
    });

    expect(leaseStore.claimDuePollingLease).toHaveBeenCalledTimes(3);
    expect(leaseStore.claimDuePollingLease).toHaveBeenNthCalledWith(
      1,
      'clan',
      'worker-a',
      30,
      new Date('2026-04-27T00:00:00.000Z'),
    );
    expect(leaseStore.claimDuePollingLease).toHaveBeenNthCalledWith(
      2,
      'player',
      'worker-a',
      30,
      new Date('2026-04-27T00:00:00.000Z'),
    );
    expect(leaseStore.claimDuePollingLease).toHaveBeenNthCalledWith(
      3,
      'war',
      'worker-a',
      30,
      new Date('2026-04-27T00:00:00.000Z'),
    );
  });
});
