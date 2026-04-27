import { describe, expect, it, vi } from 'vitest';

import { syncPollingLeasesFromLinkedResources } from './polling-enrollment.js';

describe('syncPollingLeasesFromLinkedResources', () => {
  it('syncs only the three top-level poller families from linked resources', async () => {
    const runAfter = new Date('2026-04-27T00:00:00.000Z');
    const enrollment = {
      upsertPollingLease: vi.fn(),
      syncClanPollingLeases: vi.fn().mockResolvedValue({ enrolled: 1, removed: 2 }),
      syncLinkedPlayerPollingLeases: vi.fn().mockResolvedValue({ enrolled: 3, removed: 4 }),
      syncWarPollingLeasesFromLinkedClans: vi.fn().mockResolvedValue({ enrolled: 5, removed: 6 }),
    };

    await expect(syncPollingLeasesFromLinkedResources(enrollment, runAfter)).resolves.toEqual({
      clan: { enrolled: 1, removed: 2 },
      player: { enrolled: 3, removed: 4 },
      war: { enrolled: 5, removed: 6 },
    });

    expect(enrollment.syncClanPollingLeases).toHaveBeenCalledWith(runAfter);
    expect(enrollment.syncLinkedPlayerPollingLeases).toHaveBeenCalledWith(runAfter);
    expect(enrollment.syncWarPollingLeasesFromLinkedClans).toHaveBeenCalledWith(runAfter);
    expect(enrollment.upsertPollingLease).not.toHaveBeenCalled();
  });
});
