import { describe, expect, it } from 'vitest';

import { DIRECT_MESSAGE_COMMAND_USAGE_GUILD_ID, normalizeCommandUsageIncrement } from './index.js';

describe('normalizeCommandUsageIncrement', () => {
  it('normalizes command names and derives the UTC usage date', () => {
    const usedAt = new Date('2026-04-27T23:59:59.000Z');

    expect(
      normalizeCommandUsageIncrement({ commandName: ' Status ', guildId: '123', usedAt }),
    ).toEqual({
      commandName: 'status',
      guildId: '123',
      usageDate: '2026-04-27',
      usedAt,
    });
  });

  it('uses a stable direct-message bucket when no guild is present', () => {
    const usedAt = new Date('2026-04-27T00:00:00.000Z');

    expect(
      normalizeCommandUsageIncrement({ commandName: 'usage', guildId: null, usedAt }),
    ).toMatchObject({
      guildId: DIRECT_MESSAGE_COMMAND_USAGE_GUILD_ID,
      usageDate: '2026-04-27',
    });
  });

  it('rejects blank command names', () => {
    expect(() => normalizeCommandUsageIncrement({ commandName: '   ', guildId: '123' })).toThrow(
      'Command usage requires a command name.',
    );
  });
});
