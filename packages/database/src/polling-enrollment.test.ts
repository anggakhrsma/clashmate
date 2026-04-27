import { describe, expect, it } from 'vitest';

import {
  assertTopLevelPollingResourceType,
  buildPollingEnrollmentResourceIds,
  TOP_LEVEL_POLLING_RESOURCE_TYPES,
} from './index.js';

describe('polling enrollment rules', () => {
  it('enrolls active non-deleted tracked clans only', () => {
    expect(
      buildPollingEnrollmentResourceIds([
        { resourceId: '#AAA111', isActive: true, deletedAt: null },
        { resourceId: '#BBB222', isActive: false, deletedAt: null },
        { resourceId: '#CCC333', isActive: true, deletedAt: new Date('2026-01-01T00:00:00Z') },
        { resourceId: ' #aaa111 ', isActive: true, deletedAt: null },
      ]),
    ).toEqual(['#AAA111']);
  });

  it('enrolls non-deleted linked players only', () => {
    expect(
      buildPollingEnrollmentResourceIds([
        { resourceId: '#PLAYER1', deletedAt: null },
        { resourceId: '#PLAYER2', deletedAt: new Date('2026-01-01T00:00:00Z') },
        { resourceId: ' #player1 ', deletedAt: null },
      ]),
    ).toEqual(['#PLAYER1']);
  });

  it('keeps top-level poller resource types limited to clan, player, and war', () => {
    expect(TOP_LEVEL_POLLING_RESOURCE_TYPES).toEqual(['clan', 'player', 'war']);
    expect(() => assertTopLevelPollingResourceType('donation')).toThrow(
      'Unsupported top-level polling resource type: donation',
    );
  });
});
