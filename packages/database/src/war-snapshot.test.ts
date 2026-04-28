import { describe, expect, it } from 'vitest';

import { buildWarAttackEventKey, normalizeLatestWarSnapshotInput, schema } from './index.js';

describe('war latest snapshot foundation', () => {
  it('normalizes latest war snapshot input for idempotent upserts', () => {
    const fetchedAt = new Date('2026-04-27T00:00:00.000Z');
    const snapshot = { state: 'inWar', teamSize: 15 };

    expect(
      normalizeLatestWarSnapshotInput({
        clanTag: ' #aaa111 ',
        state: ' InWar ',
        snapshot,
        fetchedAt,
      }),
    ).toEqual({ clanTag: '#AAA111', state: 'inwar', snapshot, fetchedAt });
  });

  it('rejects blank clan tags and states', () => {
    expect(() =>
      normalizeLatestWarSnapshotInput({ clanTag: ' ', state: 'inWar', snapshot: {} }),
    ).toThrow('War snapshot requires a clan tag.');
    expect(() =>
      normalizeLatestWarSnapshotInput({ clanTag: '#AAA111', state: ' ', snapshot: {} }),
    ).toThrow('War snapshot requires a state.');
  });

  it('keeps latest war snapshots as current state without soft-delete columns', () => {
    expect(schema.warLatestSnapshots.clanTag.name).toBe('clan_tag');
    expect('deletedAt' in schema.warLatestSnapshots).toBe(false);
  });

  it('defines append-only war attack events with guild-scoped idempotency keys', () => {
    expect(schema.warAttackEvents.eventKey.name).toBe('event_key');
    expect('deletedAt' in schema.warAttackEvents).toBe(false);
    expect(
      buildWarAttackEventKey({
        clanTag: ' #aaa111 ',
        warKey: ' Current:#AAA111:#OPP222:start ',
        attackerTag: ' #p1 ',
        defenderTag: ' #q1 ',
        attackOrder: 3,
        stars: 2,
        destructionPercentage: 90,
        freshAttack: false,
        rawAttack: {},
        sourceFetchedAt: new Date('2026-04-27T00:00:00.000Z'),
        occurredAt: new Date('2026-04-27T00:00:00.000Z'),
      }),
    ).toBe('war:current:#aaa111:#opp222:start:attack:#P1:#Q1:3');
  });
});
