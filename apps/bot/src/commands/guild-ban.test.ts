import type { GlobalAccessBlockStore, ToggleGlobalAccessBlockInput } from '@clashmate/database';
import type { CommandContext } from '@clashmate/discord';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { describe, expect, it } from 'vitest';

import {
  createGuildBanSlashCommand,
  formatGuildBanToggleMessage,
  guildBanCommandData,
  isDiscordSnowflake,
  resolveGuildDisplayName,
} from './guild-ban.js';

function createStore(action: 'created' | 'deleted' = 'created') {
  const toggles: ToggleGlobalAccessBlockInput[] = [];
  const store: GlobalAccessBlockStore = {
    isUserBlacklisted: async () => false,
    isGuildBlacklisted: async () => false,
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
      guilds: {
        cache: new Map([['123456789012345678', { name: 'Cached Server' }]]),
      },
    } as unknown as Client,
  };
}

describe('/guild-ban command data', () => {
  it('registers the slash command with one required string option', () => {
    const json = guildBanCommandData.toJSON();

    expect(json.name).toBe('guild-ban');
    expect(json.description).toBe('Toggle whether a Discord server can use ClashMate commands.');
    expect(json.dm_permission).toBe(true);
    expect(json.options).toHaveLength(1);
    expect(json.options?.[0]).toMatchObject({
      name: 'id',
      description: 'Server ID to add to or remove from the command blacklist.',
      required: true,
    });
    expect(JSON.stringify(json)).not.toContain('ClashPerk');
    expect(JSON.stringify(json)).not.toContain('clashperk');
  });
});

describe('/guild-ban access control and validation', () => {
  it('rejects non-owner users before writing', async () => {
    const { store, toggles } = createStore();
    const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
    const command = createGuildBanSlashCommand({ accessBlocks: store });
    const interaction = {
      isChatInputCommand: () => true,
      user: { id: 'not-owner' },
      reply: async (payload: { content?: string; ephemeral?: boolean }) => {
        replies.push(payload);
      },
    } as unknown as ChatInputCommandInteraction;

    await command.execute(interaction, createContext());

    expect(replies).toEqual([
      { content: 'Only bot owners can use `/guild-ban`.', ephemeral: true },
    ]);
    expect(toggles).toHaveLength(0);
  });

  it('rejects malformed guild ids before writing', async () => {
    const { store, toggles } = createStore();
    const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
    const command = createGuildBanSlashCommand({ accessBlocks: store });
    const interaction = {
      isChatInputCommand: () => true,
      user: { id: 'owner' },
      options: { getString: () => 'not-a-snowflake' },
      reply: async (payload: { content?: string; ephemeral?: boolean }) => {
        replies.push(payload);
      },
    } as unknown as ChatInputCommandInteraction;

    await command.execute(interaction, createContext());

    expect(replies).toEqual([{ content: 'Invalid guildId.', ephemeral: true }]);
    expect(toggles).toHaveLength(0);
  });

  it('validates Discord snowflakes', () => {
    expect(isDiscordSnowflake('12345678901234567')).toBe(true);
    expect(isDiscordSnowflake('12345678901234567890')).toBe(true);
    expect(isDiscordSnowflake('1234567890123456')).toBe(false);
    expect(isDiscordSnowflake('123456789012345678901')).toBe(false);
    expect(isDiscordSnowflake('1234abc89012345678')).toBe(false);
  });
});

describe('/guild-ban toggle behavior', () => {
  it('creates an active guild block and uses the cached guild name', async () => {
    const { store, toggles } = createStore('created');
    const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
    const command = createGuildBanSlashCommand({ accessBlocks: store });
    const interaction = {
      isChatInputCommand: () => true,
      user: { id: 'owner' },
      options: { getString: () => '123456789012345678' },
      reply: async (payload: { content?: string; ephemeral?: boolean }) => {
        replies.push(payload);
      },
    } as unknown as ChatInputCommandInteraction;

    await command.execute(interaction, createContext());

    expect(toggles).toEqual([
      {
        targetType: 'guild',
        targetId: '123456789012345678',
        targetName: 'Cached Server',
        actorDiscordUserId: 'owner',
      },
    ]);
    expect(replies).toEqual([
      {
        content: "**Cached Server** has been blacklisted from using ClashMate's command.",
        ephemeral: true,
      },
    ]);
  });

  it('falls back to the raw id for unknown guild ids', () => {
    expect(resolveGuildDisplayName('999999999999999999', createContext())).toBe(
      '999999999999999999',
    );
  });

  it('formats remove success text', () => {
    expect(
      formatGuildBanToggleMessage({
        action: 'deleted',
        targetDisplayName: 'Cached Server',
        botDisplayName: 'ClashMate',
      }),
    ).toBe("**Cached Server** has been removed from the ClashMate's blacklist.");
  });
});
