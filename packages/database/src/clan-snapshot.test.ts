import { describe, expect, it } from 'vitest';

import { normalizeLatestClanSnapshotInput, schema } from './index.js';

describe('clan latest snapshot foundation', () => {
  it('normalizes latest clan snapshot input for idempotent upserts', () => {
    const fetchedAt = new Date('2026-04-27T00:00:00.000Z');
    const snapshot = { tag: '#AAA111', name: 'Alpha' };

    expect(
      normalizeLatestClanSnapshotInput({
        clanTag: ' #aaa111 ',
        name: 'Alpha',
        snapshot,
        fetchedAt,
      }),
    ).toEqual({ clanTag: '#AAA111', name: 'Alpha', snapshot, fetchedAt });
  });

  it('rejects blank clan tags', () => {
    expect(() =>
      normalizeLatestClanSnapshotInput({ clanTag: ' ', name: 'Alpha', snapshot: {} }),
    ).toThrow('Clan snapshot requires a clan tag.');
  });

  it('keeps latest clan snapshots as hard-retained current state without soft-delete columns', () => {
    expect(schema.clanLatestSnapshots.clanTag.name).toBe('clan_tag');
    expect('deletedAt' in schema.clanLatestSnapshots).toBe(false);
  });
});
