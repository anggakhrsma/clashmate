import { describe, expect, it } from 'vitest';

import {
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
});
