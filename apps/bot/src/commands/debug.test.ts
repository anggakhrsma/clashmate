import { describe, expect, it } from 'vitest';

import {
  type DebugView,
  debugCommandData,
  formatDurationMs,
  renderDebugText,
  splitDiscordMessage,
} from './debug.js';

describe('/debug command data', () => {
  it('matches the reference name, description, and empty options', () => {
    const json = debugCommandData.toJSON();

    expect(json.name).toBe('debug');
    expect(json.description).toBe('Displays some basic debug information.');
    expect(json.options ?? []).toHaveLength(0);
    expect(json.dm_permission).toBe(false);
  });
});

describe('debug rendering', () => {
  it('renders diagnostics without removed sharding, premium, or old-project strings', () => {
    const view: DebugView = {
      botName: 'ClashMate',
      guildId: 'guild-1',
      channelId: 'channel-1',
      readerAvailable: true,
      permissions: [
        { name: 'View Channel', granted: true },
        { name: 'Send Messages', granted: false },
      ],
      webhookCount: 2,
      pollers: {
        clanLeases: 3,
        playerLeases: 4,
        warLeases: 5,
        dueLeases: 1,
      },
      config: {
        diagnosticsEnabled: true,
      },
      clans: [
        {
          name: 'Alpha Clan',
          active: true,
          lastSync: new Date(Date.now() - 5 * 60_000),
          warLog: 'Public',
        },
        {
          name: 'Beta Clan',
          active: true,
          lastSync: new Date(Date.now() - 2 * 60 * 60_000),
          warLog: 'Unknown',
        },
      ],
    };

    const text = renderDebugText(view);

    expect(text).toContain('**ClashMate Debug Menu**');
    expect(text).toContain('guild-1');
    expect(text).toContain('<#channel-1> (channel-1)');
    expect(text).toContain('☑️ View Channel');
    expect(text).toContain('❌ Send Messages');
    expect(text).toContain('Permissions: 1/2 covered');
    expect(text).toContain('Webhooks: 2 available');
    expect(text).toContain('**Worker/Poller Diagnostics**');
    expect(text).toContain('Coverage: 3 clan, 4 player, 5 war');
    expect(text).toContain('Due leases: 1/12 due');
    expect(text).toContain('**Config Diagnostics**');
    expect(text).toContain('Diagnostics enabled: Yes');
    expect(text).toContain('Freshness: 1 fresh, 1 stale, 0 unknown');
    expect(text).toContain('Alpha Clan');
    expect(text).toContain('Public');
    expect(text).toContain('Unknown');
    expect(text).not.toMatch(
      /Shard|Cluster|cluster|Patreon|premium|subscription|ClashPerk|clashperk|cprk\.us/i,
    );
  });

  it('renders unavailable diagnostics and an empty clan list clearly', () => {
    const view: DebugView = {
      botName: 'ClashMate',
      guildId: 'guild-1',
      channelId: 'channel-1',
      readerAvailable: false,
      permissions: [],
      webhookCount: 'Unavailable',
      pollers: undefined,
      config: undefined,
      clans: [],
    };

    const text = renderDebugText(view);

    expect(text).toContain('No tracked clan data available (debug reader missing).');
    expect(text).toContain('**Worker/Poller Diagnostics**\nUnavailable');
    expect(text).toContain('**Config Diagnostics**\nUnavailable (debug reader missing)');
    expect(text).toContain('**Reconciliation Planning**\nUnavailable (debug reader missing)');
    expect(text).not.toMatch(/Shard|Cluster|cluster/i);
  });
});

describe('debug formatting helpers', () => {
  it('formats missing and present durations', () => {
    expect(formatDurationMs(undefined)).toBe('...');
    expect(formatDurationMs(0)).toBe('...');
    expect(formatDurationMs(1_000)).toBe('1s');
    expect(formatDurationMs(60_000)).toBe('1m');
    expect(formatDurationMs(3_600_000)).toBe('1h');
    expect(formatDurationMs(86_400_000)).toBe('1d');
  });

  it('splits long Discord messages', () => {
    const chunks = splitDiscordMessage(
      ['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10)].join('\n'),
      15,
    );

    expect(chunks).toEqual(['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc']);
  });
});
