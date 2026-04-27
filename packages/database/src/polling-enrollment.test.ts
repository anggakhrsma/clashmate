import { describe, expect, it } from 'vitest';

import {
  assertTopLevelPollingResourceType,
  buildPollingEnrollmentResourceIds,
  TOP_LEVEL_POLLING_RESOURCE_TYPES,
} from './index.js';

type Lease = {
  resourceType: string;
  resourceId: string;
  lockedUntil: Date | null;
};

function removableStaleLeases(
  leases: Lease[],
  resourceType: string,
  desiredResourceIds: readonly string[],
  now: Date,
) {
  const desired = new Set(desiredResourceIds);
  return leases
    .filter((lease) => lease.resourceType === resourceType)
    .filter((lease) => !desired.has(lease.resourceId))
    .filter((lease) => lease.lockedUntil === null || lease.lockedUntil <= now)
    .map((lease) => lease.resourceId);
}

describe('polling enrollment rules', () => {
  it('enrolls active tracked clans only', () => {
    expect(
      buildPollingEnrollmentResourceIds([
        { resourceId: '#AAA111', isActive: true },
        { resourceId: '#BBB222', isActive: false },
        { resourceId: ' #aaa111 ', isActive: true },
      ]),
    ).toEqual(['#AAA111']);
  });

  it('enrolls linked players and normalizes duplicate tags', () => {
    expect(
      buildPollingEnrollmentResourceIds([{ resourceId: '#PLAYER1' }, { resourceId: ' #player1 ' }]),
    ).toEqual(['#PLAYER1']);
  });

  it('keeps top-level poller resource types limited to clan, player, and war', () => {
    expect(TOP_LEVEL_POLLING_RESOURCE_TYPES).toEqual(['clan', 'player', 'war']);
    expect(() => assertTopLevelPollingResourceType('donation')).toThrow(
      'Unsupported top-level polling resource type: donation',
    );
  });

  it('does not remove stale leases that are currently locked', () => {
    const now = new Date('2026-04-27T00:00:00.000Z');

    expect(
      removableStaleLeases(
        [
          { resourceType: 'clan', resourceId: '#STALE1', lockedUntil: null },
          {
            resourceType: 'clan',
            resourceId: '#STALE2',
            lockedUntil: new Date('2026-04-27T00:00:30.000Z'),
          },
          {
            resourceType: 'clan',
            resourceId: '#STALE3',
            lockedUntil: new Date('2026-04-26T23:59:59.000Z'),
          },
        ],
        'clan',
        [],
        now,
      ),
    ).toEqual(['#STALE1', '#STALE3']);
  });
});
