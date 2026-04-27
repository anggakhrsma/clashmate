import { describe, expect, it } from 'vitest';

import { buildClanMemberEventKey, schema } from './index.js';

describe('clan member join/leave event foundation', () => {
  it('builds normalized deterministic event keys', () => {
    expect(
      buildClanMemberEventKey({
        clanTag: ' #abc123 ',
        playerTag: ' #player ',
        eventType: 'joined',
        eventAt: new Date('2026-04-27T10:15:00.000Z'),
      }),
    ).toBe('clan:#ABC123:member:#PLAYER:joined:2026-04-27T10:15:00.000Z');
  });

  it('keeps high-volume member events append-only without soft deletes', () => {
    expect(schema.clanMemberEvents.eventKey.name).toBe('event_key');
    expect('deletedAt' in schema.clanMemberEvents).toBe(false);
  });

  it('stores member snapshots as latest clan/player state', () => {
    expect(schema.clanMemberSnapshots.clanTag.name).toBe('clan_tag');
    expect(schema.clanMemberSnapshots.playerTag.name).toBe('player_tag');
    expect('deletedAt' in schema.clanMemberSnapshots).toBe(false);
  });
});
