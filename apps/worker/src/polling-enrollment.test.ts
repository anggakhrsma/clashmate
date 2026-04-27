import { describe, expect, it, vi } from 'vitest';

import { syncPollingLeases } from './polling-enrollment.js';

describe('syncPollingLeases', () => {
  it('syncs only the three top-level poller families from linked resources', async () => {
    const runAfter = new Date('2026-04-27T00:00:00.000Z');
    const enrollment = {
      upsertPollingLease: vi.fn(),
      syncClanPollingLeases: vi.fn().mockResolvedValue({ enrolled: 1, removed: 2 }),
      syncPlayerPollingLeases: vi.fn().mockResolvedValue({ enrolled: 3, removed: 4 }),
      syncWarPollingLeases: vi.fn().mockResolvedValue({ enrolled: 5, removed: 6 }),
    };

    await expect(syncPollingLeases(enrollment, runAfter)).resolves.toEqual({
      clan: { enrolled: 1, removed: 2 },
      player: { enrolled: 3, removed: 4 },
      war: { enrolled: 5, removed: 6 },
    });

    expect(enrollment.syncClanPollingLeases).toHaveBeenCalledWith(runAfter);
    expect(enrollment.syncPlayerPollingLeases).toHaveBeenCalledWith(runAfter);
    expect(enrollment.syncWarPollingLeases).toHaveBeenCalledWith(runAfter);
    expect(enrollment.upsertPollingLease).not.toHaveBeenCalled();
  });
});
