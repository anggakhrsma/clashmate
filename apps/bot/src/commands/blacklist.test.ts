import type { GlobalAccessBlockStore, ToggleGlobalAccessBlockInput } from '@clashmate/database';
import type { CommandContext } from '@clashmate/discord';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { describe, expect, it } from 'vitest';

import {
  blacklistCommandData,
  createBlacklistSlashCommand,
  formatBlacklistToggleMessage,
  validateBlacklistTarget,
} from './blacklist.js';

function createStore(action: 'created' | 'deleted' = 'created') {
  const toggles: ToggleGlobalAccessBlockInput[] = [];
  const store: GlobalAccessBlockStore = {
    isUserBlacklisted: async () => false,
    toggle: async (input) => {
      toggles.push(input);
      return { action };
    },
  };

  return { store, toggles };
}

function createContext(ownerIds: string[] = ['owner']): CommandContext {
  return {
    ownerIds,
    client: {
      user: { id: 'bot', displayName: 'ClashMate' },
    } as Client,
  };
}

describe('/blacklist command data', () => {
  it('registers the slash command with one required user option', () => {
    const json = blacklistCommandData.toJSON();

    expect(json.name).toBe('blacklist');
    expect(json.description).toBe('Toggle whether a Discord user can use ClashMate commands.');
    expect(json.dm_permission).toBe(true);
    expect(json.options).toHaveLength(1);
    expect(json.options?.[0]).toMatchObject({
      name: 'user',
      description: 'User to add to or remove from the command blacklist.',
      required: true,
    });
    expect(JSON.stringify(json)).not.toContain('ClashPerk');
    expect(JSON.stringify(json)).not.toContain('clashperk');
  });
});

describe('/blacklist access control and target validation', () => {
  it('rejects non-owner users before writing', async () => {
    const { store, toggles } = createStore();
    const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
    const command = createBlacklistSlashCommand({ accessBlocks: store });
    const interaction = {
      isChatInputCommand: () => true,
      user: { id: 'not-owner' },
      reply: async (payload: { content?: string; ephemeral?: boolean }) => {
        replies.push(payload);
      },
    } as unknown as ChatInputCommandInteraction;

    await command.execute(interaction, createContext());

    expect(replies).toEqual([
      { content: 'Only bot owners can use `/blacklist`.', ephemeral: true },
    ]);
    expect(toggles).toHaveLength(0);
  });

  it('rejects owners and the bot user as targets', () => {
    const context = createContext(['owner', 'target-owner']);

    expect(validateBlacklistTarget('target-owner', context)).toBe(
      'Bot owners cannot be blacklisted.',
    );
    expect(validateBlacklistTarget('bot', context)).toBe('ClashMate cannot blacklist itself.');
    expect(validateBlacklistTarget('regular-user', context)).toBeUndefined();
  });
});

describe('/blacklist toggle behavior', () => {
  it('creates an active user block and returns the reference success text', async () => {
    const { store, toggles } = createStore('created');
    const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
    const command = createBlacklistSlashCommand({ accessBlocks: store });
    const interaction = {
      isChatInputCommand: () => true,
      user: { id: 'owner' },
      options: {
        getUser: () => ({ id: 'target', username: 'TargetUser', displayName: 'Target User' }),
      },
      reply: async (payload: { content?: string; ephemeral?: boolean }) => {
        replies.push(payload);
      },
    } as unknown as ChatInputCommandInteraction;

    await command.execute(interaction, createContext());

    expect(toggles).toEqual([
      {
        targetType: 'user',
        targetId: 'target',
        targetName: 'Target User',
        actorDiscordUserId: 'owner',
      },
    ]);
    expect(replies).toEqual([
      {
        content: "**Target User** has been blacklisted from using ClashMate's command.",
        ephemeral: true,
      },
    ]);
  });

  it('formats remove success text', () => {
    expect(
      formatBlacklistToggleMessage({
        action: 'deleted',
        targetDisplayName: 'Target User',
        botDisplayName: 'ClashMate',
      }),
    ).toBe("**Target User** has been removed from the ClashMate's blacklist.");
  });
});
