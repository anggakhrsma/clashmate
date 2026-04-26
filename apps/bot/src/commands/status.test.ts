import { readFileSync } from 'node:fs';
import type { CommandContext } from '@clashmate/discord';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { describe, expect, it } from 'vitest';

import {
  buildStatusEmbed,
  createStatusSlashCommand,
  formatDuration,
  formatMegabytes,
  formatOptionalCount,
  formatVersion,
  type StatusView,
  statusCommandData,
} from './status.js';

describe('/status command data', () => {
  it('matches the reference name, description, and empty options', () => {
    const json = statusCommandData.toJSON();

    expect(json.name).toBe('status');
    expect(json.description).toBe("Shows information about the bot's status.");
    expect(json.options ?? []).toHaveLength(0);
    expect(json.dm_permission).toBe(false);
  });
});

describe('status formatting', () => {
  it('formats memory, counts, duration, and versions', () => {
    expect(formatMegabytes(12.345)).toBe('12.35 MB');
    expect(formatOptionalCount(1234567)).toBe('1,234,567');
    expect(formatOptionalCount(undefined)).toBe('Unavailable');
    expect(formatDuration(90_061)).toBe('1d, 1h, 1m, 1s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatVersion({ version: '1.2.3' })).toBe('1.2.3');
    expect(
      formatVersion({
        version: '1.2.3',
        commitSha: 'abc123',
        repositoryUrl: 'https://github.com/example/clashmate/',
      }),
    ).toBe('[1.2.3](https://github.com/example/clashmate/commit/abc123)');
  });

  it('builds a status embed without old project links or status page', () => {
    const view: StatusView = {
      botName: 'ClashMate',
      botAvatarUrl: 'https://example.com/avatar.png',
      color: 0x123456,
      metrics: {
        memoryUsedMb: 42,
        freeMemoryMb: 256,
        uptimeSeconds: 3_725,
        servers: 1_234,
        commandsUsedLast30Days: 99,
        clans: 12,
        links: 34,
        runtime: 'Single Discord gateway process',
        version: '0.0.0',
      },
    };

    const json = buildStatusEmbed(view).toJSON();
    const fields = json.fields ?? [];

    expect(fields.map((field) => field.name)).toEqual([
      'Memory Usage',
      'Free Memory',
      'Uptime',
      'Servers',
      'Commands Used',
      'Clans',
      'Players',
      'Links',
      'Runtime',
      'Version',
    ]);
    expect(fields.find((field) => field.name === 'Players')?.value).toBe('Unavailable');
    expect(fields.find((field) => field.name === 'Runtime')?.value).toBe(
      'Single Discord gateway process',
    );
    expect(JSON.stringify(json)).not.toContain('ClashPerk');
    expect(JSON.stringify(json)).not.toContain('clashperk');
    expect(JSON.stringify(json)).not.toContain('status.clashperk.com');
  });

  it('does not include Discord sharding or cluster diagnostics', () => {
    const view: StatusView = {
      botName: 'ClashMate',
      metrics: {
        memoryUsedMb: 42,
        freeMemoryMb: 256,
        uptimeSeconds: 3_725,
        servers: 1,
        runtime: 'Single Discord gateway process',
        version: '0.0.0',
      },
    };
    const embedText = JSON.stringify(buildStatusEmbed(view).toJSON());
    const sourceText = readFileSync(
      new URL('../../src/commands/status.ts', import.meta.url),
      'utf8',
    );
    const forbiddenTerms = [
      'Shard',
      'Cluster',
      'shard',
      'cluster',
      'discord-hybrid-sharding',
      'getInfo',
      'client.cluster',
    ];

    for (const term of forbiddenTerms) {
      expect(embedText).not.toContain(term);
      expect(sourceText).not.toContain(term);
    }
  });
});

describe('/status access control', () => {
  it('rejects non-owner users before collecting metrics', async () => {
    const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
    let metricsRead = false;
    const command = createStatusSlashCommand({
      version: '0.0.0',
      metricReader: {
        countClans: async () => {
          metricsRead = true;
          return 1;
        },
      },
    });
    const interaction = {
      isChatInputCommand: () => true,
      user: { id: 'not-owner' },
      reply: async (payload: { content?: string; ephemeral?: boolean }) => {
        replies.push(payload);
      },
    } as unknown as ChatInputCommandInteraction;
    const context: CommandContext = {
      client: {} as Client,
      ownerIds: ['owner'],
    };

    await command.execute(interaction, context);

    expect(replies).toEqual([{ content: 'Only bot owners can use `/status`.', ephemeral: true }]);
    expect(metricsRead).toBe(false);
  });
});
