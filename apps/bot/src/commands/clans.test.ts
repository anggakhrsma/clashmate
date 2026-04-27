import { describe, expect, it } from 'vitest';

import {
  buildClansPayload,
  clanProfileUrl,
  clansCommandData,
  filterClansCategoryChoices,
  formatClanLine,
  groupClansByCategory,
  type ClansLinkedClan,
} from './clans.js';

const baseClan = (overrides: Partial<ClansLinkedClan>): ClansLinkedClan => ({
  id: 'clan-id',
  clanTag: '#2PP',
  name: 'Alpha',
  alias: null,
  categoryId: null,
  sortOrder: 0,
  ...overrides,
});

describe('/clans', () => {
  it('registers the clans command shape', () => {
    const json = clansCommandData.toJSON();

    expect(json.name).toBe('clans');
    expect(json.description).toBe('Show all linked clans.');
    expect(json.dm_permission).toBe(false);
    expect(json.options).toEqual([
      expect.objectContaining({
        name: 'category',
        description: 'Filter clans by category.',
        required: false,
        autocomplete: true,
      }),
    ]);
  });

  it('suggests matching category choices', () => {
    expect(
      filterClansCategoryChoices(
        [
          { id: 'war-id', displayName: 'War' },
          { id: 'farm-id', displayName: 'Farming' },
          { id: 'cwl-id', displayName: 'CWL' },
        ],
        'wa',
      ),
    ).toEqual([{ name: 'War', value: 'war-id' }]);
  });

  it('returns setup guidance when no clans are linked', () => {
    expect(
      buildClansPayload({ categories: [], clans: [], guildName: 'Guild' }),
    ).toEqual({ content: 'No clans are linked to this server yet. Use `/setup clan` to link one.' });
  });

  it('groups uncategorized and stale-category clans under General', () => {
    const groups = groupClansByCategory(
      [baseClan({ id: '1', clanTag: '#AAA', categoryId: null }), baseClan({ id: '2', clanTag: '#BBB', categoryId: 'missing' })],
      [{ id: 'war-id', displayName: 'War', sortOrder: 0 }],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.category.displayName).toBe('General');
    expect(groups[0]?.clans.map((clan) => clan.clanTag)).toEqual(['#AAA', '#BBB']);
  });

  it('renders clans grouped by category with alias, snapshot stats, and Clash profile links', () => {
    const payload = buildClansPayload({
      guildName: 'Test Guild',
      categories: [{ id: 'war-id', displayName: 'War', sortOrder: 0 }],
      clans: [
        baseClan({
          clanTag: '#2PP',
          name: 'Alpha',
          alias: 'Main',
          categoryId: 'war-id',
          snapshot: { members: 47, clanLevel: 19 },
        }),
      ],
    });

    const json = payload.embeds?.[0]?.toJSON();
    expect(json?.author?.name).toBe('Test Guild Clans');
    expect(json?.footer?.text).toBe('Total 1');
    expect(json?.description).toContain('**War**');
    expect(json?.description).toContain('[Main (#2PP) - 47 members · Level 19]');
    expect(json?.description).toContain(
      'https://link.clashofclans.com/en?action=OpenClanProfile&tag=%232PP',
    );
  });

  it('filters by category and reports empty category results', () => {
    const categories = [
      { id: 'war-id', displayName: 'War', sortOrder: 0 },
      { id: 'farm-id', displayName: 'Farm', sortOrder: 1 },
    ];
    const clans = [baseClan({ clanTag: '#WAR', categoryId: 'war-id' })];

    const filtered = buildClansPayload({ categories, clans, categoryId: 'war-id', guildName: 'Guild' });
    expect(filtered.embeds?.[0]?.toJSON().description).toContain('#WAR');

    expect(buildClansPayload({ categories, clans, categoryId: 'farm-id', guildName: 'Guild' })).toEqual({
      content: 'No clans found for the specified category.',
    });
  });

  it('uses Unknown when snapshot stats are missing', () => {
    expect(formatClanLine(baseClan({ snapshot: undefined }))).toBe(
      `[Alpha (#2PP) - Unknown](${clanProfileUrl('#2PP')})`,
    );
  });

  it('does not contain old ClashPerk branding or shortlinks', () => {
    const serialized = JSON.stringify(clansCommandData.toJSON());

    expect(serialized).not.toContain('ClashPerk');
    expect(serialized).not.toContain('clashperk');
    expect(serialized).not.toContain('cprk.us');
  });
});
