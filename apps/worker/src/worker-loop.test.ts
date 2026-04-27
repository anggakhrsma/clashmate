import type { ClaimedPollingLease, PollingLeaseStore } from '@clashmate/database';
import { describe, expect, it, vi } from 'vitest';

import {
  computeWorkerLoopDelayMs,
  createNoopPollingLeaseHandler,
  runWorkerPollingIteration,
} from './worker-loop.js';

const intervals = {
  clan: { baseSeconds: 300, jitterSeconds: 60 },
  player: { baseSeconds: 900, jitterSeconds: 180 },
  war: { baseSeconds: 120, jitterSeconds: 30 },
} as const;

const playerLease: ClaimedPollingLease = {
  resourceType: 'player',
  resourceId: '#PLAYER',
  ownerId: 'worker-a',
  runAfter: new Date('2026-04-27T00:00:00.000Z'),
  lockedUntil: new Date('2026-04-27T00:01:00.000Z'),
  attempts: 0,
  lastError: null,
};

function createLeaseStore(): PollingLeaseStore {
  return {
    claimDuePollingLease: vi.fn(async (resourceType) =>
      resourceType === 'player' ? playerLease : null,
    ),
    completePollingLease: vi.fn().mockResolvedValue(undefined),
    failPollingLease: vi.fn().mockResolvedValue(undefined),
  };
}

function createLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };
}

describe('worker polling loop foundation', () => {
  it('uses the smallest configured family interval with jitter for loop scheduling', () => {
    expect(computeWorkerLoopDelayMs(intervals, () => 0)).toBe(120_000);
    expect(computeWorkerLoopDelayMs(intervals, () => 1)).toBe(151_000);
  });

  it('temporary player and war handlers are no-ops that do not fetch or persist data', async () => {
    await expect(createNoopPollingLeaseHandler('player')(playerLease)).resolves.toBeUndefined();
    await expect(createNoopPollingLeaseHandler('war')(playerLease)).rejects.toThrow(
      'war no-op poller cannot process player leases.',
    );
  });

  it('runs at most one due lease per family and completes no-op leases', async () => {
    const leaseStore = createLeaseStore();
    const logger = createLogger();

    await expect(
      runWorkerPollingIteration({
        leaseStore,
        ownerId: 'worker-a',
        lockForSeconds: 60,
        intervals,
        handlers: {
          clan: vi.fn(),
          player: createNoopPollingLeaseHandler('player'),
          war: createNoopPollingLeaseHandler('war'),
        },
        logger,
        random: () => 0,
      }),
    ).resolves.toEqual([
      { resourceType: 'clan', status: 'idle' },
      { resourceType: 'player', status: 'processed', resourceId: '#PLAYER' },
      { resourceType: 'war', status: 'idle' },
    ]);

    expect(leaseStore.claimDuePollingLease).toHaveBeenCalledTimes(3);
    expect(leaseStore.completePollingLease).toHaveBeenCalledWith(
      'player',
      '#PLAYER',
      'worker-a',
      expect.any(Date),
    );
  });

  it('logs unexpected orchestration errors without throwing out of the loop', async () => {
    const logger = createLogger();
    const leaseStore = createLeaseStore();
    vi.mocked(leaseStore.claimDuePollingLease).mockRejectedValue(new Error('database unavailable'));

    await expect(
      runWorkerPollingIteration({
        leaseStore,
        ownerId: 'worker-a',
        lockForSeconds: 60,
        intervals,
        handlers: {
          clan: vi.fn(),
          player: createNoopPollingLeaseHandler('player'),
          war: createNoopPollingLeaseHandler('war'),
        },
        logger,
      }),
    ).resolves.toEqual([]);

    expect(logger.error).toHaveBeenCalledWith(
      { error: expect.any(Error) },
      'Worker polling iteration failed',
    );
  });
});
