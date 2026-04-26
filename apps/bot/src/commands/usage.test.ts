import type { CommandContext } from '@clashmate/discord';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { describe, expect, it } from 'vitest';

import {
  buildUsageEmbed,
  createUsageSlashCommand,
  formatUsageDate,
  type UsageView,
  usageCommandData,
} from './usage.js';

describe('/usage command data', () => {
  it('matches the reference command name and options', () => {
    const json = usageCommandData.toJSON();

    expect(json.name).toBe('usage');
    expect(json.description).toBe("You can't use it anyway, so why explain?");
    expect(json.dm_permission).toBe(true);
    expect(json.default_member_permissions).toBe('0');
    expect(json.options?.map((option) => option.name)).toEqual(['chart', 'limit']);
    expect(json.options?.map((option) => option.required ?? false)).toEqual([false, false]);
  });
});

describe('usage formatting', () => {
  it('formats empty usage without legacy claims', () => {
    const view: UsageView = {
      botName: 'ClashMate',
      dailyUsage: [],
      commandTotals: [],
      totalUses: 0,
    };

    const json = buildUsageEmbed(view).toJSON();

    expect(json.title).toBe('Usage');
    expect(json.description).toContain('No daily usage recorded yet.');
    expect(json.description).toContain('No command usage recorded yet.');
    expect(json.footer?.text).toBe('0x Total • Since launch');
    expect(JSON.stringify(json)).not.toContain('April 2019');
    expect(JSON.stringify(json)).not.toContain('ClashPerk');
    expect(JSON.stringify(json)).not.toContain('clashperk');
  });

  it('orders and renders usage rows supplied by the reader', () => {
    const view: UsageView = {
      botName: 'ClashMate',
      dailyUsage: [
        { date: '2026-04-27', uses: 1234 },
        { date: '2026-04-26', uses: 5 },
      ],
      commandTotals: [
        { commandName: 'status', uses: 9 },
        { commandName: 'debug', uses: 3 },
      ],
      totalUses: 12,
    };

    const json = buildUsageEmbed(view).toJSON();

    expect(json.description).toContain('Apr 27');
    expect(json.description).toContain('1,234');
    expect(json.description).toContain('/status');
    expect(json.description).toContain('/debug');
    expect(json.footer?.text).toBe('12x Total • Since launch');
    expect(formatUsageDate(new Date('2026-04-27T12:00:00Z'))).toBe('Apr 27');
  });
});

describe('/usage access control and modes', () => {
  it('rejects non-owner users before reading metrics', async () => {
    const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
    let metricsRead = false;
    const command = createUsageSlashCommand({
      metricReader: {
        listRecentDailyUsage: async () => {
          metricsRead = true;
          return [];
        },
        listCommandTotals: async () => [],
        listRecentGrowth: async () => [],
      },
    });
    const interaction = createInteraction({
      userId: 'not-owner',
      reply: async (payload) => {
        replies.push(payload);
      },
    });

    await command.execute(interaction, createContext());

    expect(replies).toEqual([{ content: 'Only bot owners can use `/usage`.', ephemeral: true }]);
    expect(metricsRead).toBe(false);
  });

  it('filters stale command totals and renders an ephemeral embed', async () => {
    const edits: Array<{ embeds?: unknown[] }> = [];
    const command = createUsageSlashCommand({
      loadedCommandNames: ['status'],
      metricReader: {
        listRecentDailyUsage: async () => [{ date: '2026-04-27', uses: 4 }],
        listCommandTotals: async () => [
          { commandName: 'stale', uses: 999 },
          { commandName: 'status', uses: 7 },
        ],
        listRecentGrowth: async () => [],
      },
    });
    const interaction = createInteraction({
      userId: 'owner',
      editReply: async (payload) => {
        edits.push(payload as { embeds?: unknown[] });
      },
    });

    await command.execute(interaction, createContext());

    const embedJson = (edits[0]?.embeds?.[0] as { toJSON: () => unknown }).toJSON();
    expect(JSON.stringify(embedJson)).toContain('/status');
    expect(JSON.stringify(embedJson)).not.toContain('/stale');
  });

  it('returns chart renderer output for chart mode', async () => {
    const edits: string[] = [];
    const command = createUsageSlashCommand({
      metricReader: {
        listRecentDailyUsage: async () => [],
        listCommandTotals: async () => [],
        listRecentGrowth: async () => [
          { date: '2026-04-27', guildAdditions: 3, guildDeletions: 1 },
        ],
      },
      chartRenderer: {
        renderGrowthChart: async (input) => `https://charts.example/${input.today.net}`,
      },
    });
    const interaction = createInteraction({
      userId: 'owner',
      chart: true,
      editReply: async (payload) => {
        edits.push(payload as string);
      },
    });

    await command.execute(interaction, createContext());

    expect(edits).toEqual(['https://charts.example/2']);
  });
});

function createContext(): CommandContext {
  return {
    ownerIds: ['owner'],
    client: {
      user: {
        displayName: 'ClashMate',
        username: 'ClashMate',
        displayAvatarURL: () => 'https://example.com/avatar.png',
      },
    } as unknown as Client,
  };
}

function createInteraction(options: {
  userId: string;
  chart?: boolean;
  limit?: number;
  reply?: (payload: { content?: string; ephemeral?: boolean }) => Promise<void>;
  editReply?: (payload: unknown) => Promise<void>;
}): ChatInputCommandInteraction {
  return {
    isChatInputCommand: () => true,
    inGuild: () => false,
    guild: null,
    appPermissions: null,
    user: { id: options.userId },
    options: {
      getBoolean: (name: string) => (name === 'chart' ? (options.chart ?? null) : null),
      getInteger: (name: string) => (name === 'limit' ? (options.limit ?? null) : null),
    },
    reply: options.reply ?? (async () => {}),
    deferReply: async () => {},
    editReply: options.editReply ?? (async () => {}),
  } as unknown as ChatInputCommandInteraction;
}
