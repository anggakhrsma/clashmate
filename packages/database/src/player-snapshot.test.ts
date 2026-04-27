import { describe, expect, it } from 'vitest';

import { normalizeLatestPlayerSnapshotInput, schema } from './index.js';

describe('player latest snapshot foundation', () => {
  it('normalizes latest player snapshot input for idempotent upserts', () => {
    const fetchedAt = new Date('2026-04-27T00:00:00.000Z');
    const snapshot = { tag: '#PLAYER1', name: 'Chief' };

    expect(
      normalizeLatestPlayerSnapshotInput({
        playerTag: ' #player1 ',
        name: 'Chief',
        snapshot,
        fetchedAt,
      }),
    ).toEqual({ playerTag: '#PLAYER1', name: 'Chief', snapshot, fetchedAt });
  });

  it('rejects blank player tags', () => {
    expect(() =>
      normalizeLatestPlayerSnapshotInput({ playerTag: ' ', name: 'Chief', snapshot: {} }),
    ).toThrow('Player snapshot requires a player tag.');
  });

  it('keeps latest player snapshots as hard-retained current state without soft-delete columns', () => {
    expect(schema.playerLatestSnapshots.playerTag.name).toBe('player_tag');
    expect('deletedAt' in schema.playerLatestSnapshots).toBe(false);
  });
});
