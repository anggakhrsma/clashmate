import { describe, expect, it } from 'vitest';

import {
  assertTopLevelPollingResourceType,
  buildPollingEnrollmentResourceIds,
  TOP_LEVEL_POLLING_RESOURCE_TYPES,
} from './index.js';

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
});
