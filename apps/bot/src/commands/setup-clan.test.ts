import { describe, expect, it } from 'vitest';

import {
  autocompleteSetupClan,
  filterCategoryChoices,
  filterClanChoices,
  formatConfigureJoinLeaveMessage,
  formatDisableJoinLeaveMessage,
  formatLinkClanMessage,
  formatUnlinkChannelMessage,
  formatUnlinkClanMessage,
  setupClanCommandData,
} from './setup-clan.js';

describe('/setup clan', () => {
  it('registers the setup clan subcommand shape', () => {
    const json = setupClanCommandData.toJSON();

    expect(json.name).toBe('setup');
    expect(json.description).toBe('Enable/disable features on the server or add/remove clans.');
    expect(json.dm_permission).toBe(false);
    expect(json.default_member_permissions).toBe('32');

    const subcommand = json.options?.find((option) => option.name === 'clan') as
      | {
          description?: string;
          options?: Array<{ name: string; required?: boolean; autocomplete?: boolean }>;
        }
      | undefined;
    expect(subcommand?.description).toBe('Link/unlink clans to the server or channels.');
    expect(subcommand?.options?.map((option) => option.name)).toEqual([
      'clan',
      'category',
      'clan_channel',
      'unlink_clan_channel',
      'unlink_clan',
    ]);

    const clanOption = subcommand?.options?.find((option) => option.name === 'clan');
    expect(clanOption?.required).toBe(true);
    expect(clanOption?.autocomplete).toBe(true);

    const logsSubcommand = json.options?.find((option) => option.name === 'clan-logs') as
      | {
          description?: string;
          options?: Array<{ name: string; required?: boolean; autocomplete?: boolean }>;
        }
      | undefined;
    expect(logsSubcommand?.description).toBe('Setup automatic logs for the clan.');
    expect(logsSubcommand?.options?.map((option) => option.name)).toEqual([
      'clan',
      'action',
      'channel',
    ]);

    const logsClanOption = logsSubcommand?.options?.find((option) => option.name === 'clan');
    expect(logsClanOption?.required).toBe(true);
    expect(logsClanOption?.autocomplete).toBe(true);
  });

  it('formats Join/Leave Log configuration messages', () => {
    expect(
      formatConfigureJoinLeaveMessage({
        status: 'configured',
        clanName: 'Alpha',
        clanTag: '#2PP',
        discordChannelId: '123',
      }),
    ).toBe('Enabled Join/Leave Log for **Alpha (#2PP)** in <#123>.');
    expect(formatConfigureJoinLeaveMessage({ status: 'clan_not_linked' })).toBe(
      'That clan is not linked to this server. Use `/setup clan` first.',
    );
    expect(
      formatDisableJoinLeaveMessage({ status: 'disabled', clanName: 'Alpha', clanTag: '#2PP' }),
    ).toBe('Disabled Join/Leave Log for **Alpha (#2PP)**.');
    expect(
      formatDisableJoinLeaveMessage({
        status: 'not_configured',
        clanName: 'Alpha',
        clanTag: '#2PP',
      }),
    ).toBe('No Join/Leave Log is enabled for **Alpha (#2PP)**.');
  });

  it('formats link success and channel conflict messages', () => {
    expect(
      formatLinkClanMessage(
        {
          status: 'linked',
          clanName: 'ClashMate Clan',
          clanTag: '#2PP',
          category: { id: 'category-id', displayName: 'War' },
          channelLinked: true,
        },
        'Test Guild',
        '123',
      ),
    ).toBe(
      'Successfully linked **ClashMate Clan (#2PP)** to **Test Guild** <#123> with category **War**.',
    );

    expect(
      formatLinkClanMessage(
        {
          status: 'channel_conflict',
          conflict: { clanName: 'Other Clan', clanTag: '#8YY' },
        },
        'Test Guild',
        '123',
      ),
    ).toBe('<#123> is already linked to Other Clan (#8YY)');
  });

  it('formats unlink messages', () => {
    expect(formatUnlinkChannelMessage({ status: 'unlinked', clanName: 'Alpha' }, '123')).toBe(
      'Successfully unlinked **Alpha** from <#123>.',
    );
    expect(formatUnlinkChannelMessage({ status: 'not_found' }, '123')).toBe(
      'No clans were found that are linked to <#123>.',
    );
    expect(
      formatUnlinkClanMessage({
        status: 'unlinked',
        clan: { id: 'clan-id', name: 'Alpha', clanTag: '#2PP' },
      }),
    ).toBe('Successfully unlinked **Alpha (#2PP)**.');
    expect(formatUnlinkClanMessage({ status: 'not_found' })).toBe(
      'No clans were found on the server for the specified tag.',
    );
  });

  it('suggests existing guild clan categories matching the focused value', () => {
    expect(
      filterCategoryChoices(
        [
          { id: 'war-id', displayName: 'War' },
          { id: 'farm-id', displayName: 'Farming' },
          { id: 'cwl-id', displayName: 'CWL' },
        ],
        'wa',
      ),
    ).toEqual([{ name: 'War', value: 'war-id' }]);
  });

  it('suggests linked guild clans matching tag name or alias', () => {
    expect(
      filterClanChoices(
        [
          { id: '1', clanTag: '#2PP', name: 'War Heroes', alias: 'main' },
          { id: '2', clanTag: '#8YY', name: 'Farm Team', alias: 'casual' },
        ],
        'main',
      ),
    ).toEqual([{ name: 'War Heroes (#2PP)', value: '#2PP' }]);

    expect(
      filterClanChoices([{ id: '1', clanTag: '#2PP', name: 'War Heroes', alias: null }], '2p'),
    ).toEqual([{ name: 'War Heroes (#2PP)', value: '#2PP' }]);
  });

  it('returns empty category choices and preserves typed clan no-match values', () => {
    expect(filterCategoryChoices([], '')).toEqual([]);
    expect(filterClanChoices([], '')).toEqual([]);
    expect(filterClanChoices([], '#ABC123')).toEqual([{ name: '#ABC123', value: '#ABC123' }]);
  });

  it('handles /setup clan autocomplete through injected stores', async () => {
    const responses: unknown[] = [];
    const interaction = {
      commandName: 'setup',
      guildId: 'guild-1',
      options: {
        getSubcommand: () => 'clan',
        getFocused: () => ({ name: 'category', value: 'cw' }),
      },
      respond: async (choices: unknown[]) => {
        responses.push(choices);
      },
    };

    await autocompleteSetupClan(interaction as never, {
      coc: { getClan: async () => ({ tag: '#2PP', name: 'Unused' }) },
      clans: {
        listClanCategories: async (guildId) => {
          expect(guildId).toBe('guild-1');
          return [{ id: 'cwl-id', displayName: 'CWL' }];
        },
        listLinkedClans: async () => [],
        linkClan: async () => ({
          status: 'linked',
          clanName: 'Unused',
          clanTag: '#2PP',
          channelLinked: false,
        }),
        unlinkClan: async () => ({ status: 'not_found' }),
        unlinkChannel: async () => ({ status: 'not_found' }),
      },
    });

    expect(responses).toEqual([[{ name: 'CWL', value: 'cwl-id' }]]);
  });

  it('does not contain old ClashPerk branding strings', () => {
    const serialized = JSON.stringify(setupClanCommandData.toJSON());

    expect(serialized).not.toContain('ClashPerk');
    expect(serialized).not.toContain('clashperk');
    expect(serialized).not.toContain('cprk.us');
  });
});
