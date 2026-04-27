import { describe, expect, it } from 'vitest';

import {
  assertTopLevelPollingResourceType,
  computeJitteredNextRun,
  TOP_LEVEL_POLLING_RESOURCE_TYPES,
} from './index.js';

type Lease = {
  resourceType: string;
  resourceId: string;
  ownerId: string | null;
  runAfter: Date;
  lockedUntil: Date | null;
  attempts: number;
  lastError: string | null;
};

function claimDueLease(
  leases: Lease[],
  resourceType: string,
  ownerId: string,
  lockForSeconds: number,
  now: Date,
): Lease | null {
  assertTopLevelPollingResourceType(resourceType);
  const due = leases
    .filter((lease) => lease.resourceType === resourceType)
    .filter((lease) => lease.runAfter <= now)
    .filter((lease) => lease.lockedUntil === null || lease.lockedUntil <= now)
    .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())[0];

  if (!due) return null;

  due.ownerId = ownerId;
  due.lockedUntil = new Date(now.getTime() + lockForSeconds * 1000);
  return due;
}

function completeLease(leases: Lease[], resourceType: string, resourceId: string, ownerId: string) {
  const lease = leases.find(
    (candidate) =>
      candidate.resourceType === resourceType &&
      candidate.resourceId === resourceId &&
      candidate.ownerId === ownerId,
  );

  if (!lease) return false;

  lease.ownerId = null;
  lease.lockedUntil = null;
  lease.attempts = 0;
  lease.lastError = null;
  return true;
}

function failLease(
  leases: Lease[],
  resourceType: string,
  resourceId: string,
  ownerId: string,
  error: string,
) {
  const lease = leases.find(
    (candidate) =>
      candidate.resourceType === resourceType &&
      candidate.resourceId === resourceId &&
      candidate.ownerId === ownerId,
  );

  if (!lease) return false;

  lease.ownerId = null;
  lease.lockedUntil = null;
  lease.attempts += 1;
  lease.lastError = error;
  return true;
}

describe('polling lease claiming rules', () => {
  it('keeps top-level poller types limited to clan, player, and war', () => {
    expect(TOP_LEVEL_POLLING_RESOURCE_TYPES).toEqual(['clan', 'player', 'war']);
  });

  it('claims a due unlocked lease and sets owner_id and locked_until', () => {
    const now = new Date('2026-04-27T00:00:00.000Z');
    const leases: Lease[] = [
      {
        resourceType: 'clan',
        resourceId: '#AAA111',
        ownerId: null,
        runAfter: new Date('2026-04-26T23:59:00.000Z'),
        lockedUntil: null,
        attempts: 0,
        lastError: null,
      },
    ];

    expect(claimDueLease(leases, 'clan', 'worker-a', 30, now)).toMatchObject({
      resourceType: 'clan',
      resourceId: '#AAA111',
      ownerId: 'worker-a',
      lockedUntil: new Date('2026-04-27T00:00:30.000Z'),
    });
  });

  it('does not claim a future lease', () => {
    const now = new Date('2026-04-27T00:00:00.000Z');
    const leases: Lease[] = [
      {
        resourceType: 'player',
        resourceId: '#PLAYER1',
        ownerId: null,
        runAfter: new Date('2026-04-27T00:01:00.000Z'),
        lockedUntil: null,
        attempts: 0,
        lastError: null,
      },
    ];

    expect(claimDueLease(leases, 'player', 'worker-a', 30, now)).toBeNull();
  });

  it('does not claim a currently locked lease', () => {
    const now = new Date('2026-04-27T00:00:00.000Z');
    const leases: Lease[] = [
      {
        resourceType: 'war',
        resourceId: 'current-war:#AAA111',
        ownerId: 'worker-b',
        runAfter: new Date('2026-04-26T23:59:00.000Z'),
        lockedUntil: new Date('2026-04-27T00:00:10.000Z'),
        attempts: 0,
        lastError: null,
      },
    ];

    expect(claimDueLease(leases, 'war', 'worker-a', 30, now)).toBeNull();
  });

  it('claims an expired locked lease', () => {
    const now = new Date('2026-04-27T00:00:00.000Z');
    const leases: Lease[] = [
      {
        resourceType: 'war',
        resourceId: 'current-war:#AAA111',
        ownerId: 'worker-b',
        runAfter: new Date('2026-04-26T23:59:00.000Z'),
        lockedUntil: new Date('2026-04-26T23:59:59.000Z'),
        attempts: 0,
        lastError: null,
      },
    ];

    expect(claimDueLease(leases, 'war', 'worker-a', 30, now)).toMatchObject({
      ownerId: 'worker-a',
      lockedUntil: new Date('2026-04-27T00:00:30.000Z'),
    });
  });

  it('completes a lease only when the worker still owns it', () => {
    const leases: Lease[] = [
      {
        resourceType: 'clan',
        resourceId: '#AAA111',
        ownerId: 'worker-a',
        runAfter: new Date('2026-04-26T23:59:00.000Z'),
        lockedUntil: new Date('2026-04-27T00:00:30.000Z'),
        attempts: 2,
        lastError: 'previous failure',
      },
    ];

    expect(completeLease(leases, 'clan', '#AAA111', 'worker-b')).toBe(false);
    expect(leases[0]).toMatchObject({ ownerId: 'worker-a', attempts: 2 });

    expect(completeLease(leases, 'clan', '#AAA111', 'worker-a')).toBe(true);
    expect(leases[0]).toMatchObject({
      ownerId: null,
      lockedUntil: null,
      attempts: 0,
      lastError: null,
    });
  });

  it('fails a lease only when the worker still owns it', () => {
    const leases: Lease[] = [
      {
        resourceType: 'war',
        resourceId: 'current-war:#AAA111',
        ownerId: 'worker-a',
        runAfter: new Date('2026-04-26T23:59:00.000Z'),
        lockedUntil: new Date('2026-04-27T00:00:30.000Z'),
        attempts: 0,
        lastError: null,
      },
    ];

    expect(failLease(leases, 'war', 'current-war:#AAA111', 'worker-b', 'boom')).toBe(false);
    expect(leases[0]).toMatchObject({ ownerId: 'worker-a', attempts: 0, lastError: null });

    expect(failLease(leases, 'war', 'current-war:#AAA111', 'worker-a', 'boom')).toBe(true);
    expect(leases[0]).toMatchObject({
      ownerId: null,
      lockedUntil: null,
      attempts: 1,
      lastError: 'boom',
    });
  });

  it('rejects unsupported resource types', () => {
    expect(() => claimDueLease([], 'donation', 'worker-a', 30, new Date())).toThrow(
      'Unsupported top-level polling resource type: donation',
    );
  });

  it('computes jittered next run times', () => {
    expect(
      computeJitteredNextRun(
        new Date('2026-04-27T00:00:00.000Z'),
        { baseSeconds: 300, jitterSeconds: 60 },
        () => 0.5,
      ),
    ).toEqual(new Date('2026-04-27T00:05:30.000Z'));
  });
});
