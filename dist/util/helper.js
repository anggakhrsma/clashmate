import { ActionRowBuilder, ComponentType, StringSelectMenuBuilder } from 'discord.js';
import { title, unique } from 'radash';
import { container } from 'tsyringe';
import { Client } from '../struct/client.js';
import { FeatureFlags, UNRANKED_TIER_ID } from './constants.js';
import { Season, Util } from './toolkit.js';
export const hexToNanoId = (hex) => {
    return hex.toHexString().slice(-5).toUpperCase();
};
export const makeAbbr = (text) => {
    return title(text)
        .split(/\s+/)
        .map((word) => word[0]?.toUpperCase() || '')
        .join('');
};
export const trimTag = (tag) => {
    return tag.replace('#', '');
};
export const padStart = (str, length) => {
    return `${str}`.padStart(length, ' ');
};
export const padEnd = (str, length) => {
    return `${str}`.padEnd(length, ' ');
};
export const escapeBackTick = (text) => {
    return text.replace(/`/g, '');
};
export const localeSort = (a, b) => {
    return a.replace(/[^\x00-\xF7]+/g, '').localeCompare(b.replace(/[^\x00-\xF7]+/g, ''));
};
export const leagueTierSort = (a, b) => {
    return (b?.id || UNRANKED_TIER_ID) - (a?.id || UNRANKED_TIER_ID);
};
export const formatLeague = (league) => {
    return league
        .replace(/League/g, '')
        .replace(/\./g, '')
        .replace(/\s+/g, ' ')
        .trim();
};
export const lastSeenTimestampFormat = (timestamp) => {
    if (!timestamp)
        return padStart('', 7);
    return padStart(Util.duration(timestamp + 1e3), 7);
};
export const clanGamesMaxPoints = (month) => {
    const client = container.resolve(Client);
    const exceptionalMonths = client.settings.get('global', "clanGamesExceptionalMonths" /* Settings.CLAN_GAMES_EXCEPTIONAL_MONTHS */, []);
    if (exceptionalMonths.includes(month))
        return 5000;
    return 4000;
};
export const isNullish = (value) => typeof value === 'undefined' || value === null;
export const sumHeroes = (player) => {
    return player.heroes.reduce((prev, curr) => {
        if (curr.village === 'builderBase')
            return prev;
        return curr.level + prev;
    }, 0);
};
export const nullsLastSortAlgo = (a, b) => {
    if (isNullish(a) && isNullish(b)) {
        return 0;
    }
    else if (isNullish(a)) {
        return 1;
    }
    else if (isNullish(b)) {
        return -1;
    }
    return 10;
};
export const clanGamesSortingAlgorithm = (a, b) => {
    if (a === b)
        return 0;
    if (a === 0)
        return 1;
    if (b === 0)
        return -1;
    return a - b;
};
export const clanGamesLatestSeasonId = () => {
    const currentDate = new Date();
    if (currentDate.getDate() < 20)
        currentDate.setMonth(currentDate.getMonth() - 1);
    return currentDate.toISOString().slice(0, 7);
};
/**
 * @param sheet must be `spreadsheet.data`
 */
export const getMenuFromMessage = (interaction, selected, customId) => {
    const _components = interaction.message.components;
    const component = _components
        .flatMap((row) => row.components)
        .find((component) => component.type === ComponentType.StringSelect);
    if (component && component.type === ComponentType.StringSelect) {
        const menu = StringSelectMenuBuilder.from(component.toJSON());
        const options = component.options.map((op) => ({
            ...op,
            default: op.value === selected
        }));
        menu.setOptions(options);
        menu.setCustomId(customId);
        return [new ActionRowBuilder().addComponents(menu)];
    }
    return [];
};
export const recoverDonations = async (clan, season) => {
    const client = container.resolve(Client);
    const { endTime, startTime, seasonId } = Season.getSeasonById(season);
    const isEnabled = client.isFeatureEnabled(FeatureFlags.DONATIONS_RECOVERY, 'global');
    if (!isEnabled)
        return;
    const redisKey = `RECOVERY:${seasonId}:${clan.tag}`;
    // redis dedup removed
    client.logger.log(`Recovering donations for ${clan.tag}...`, { label: 'DonationRecovery' });
    const rows = { data: [] }; // ClickHouse removed
    const data = rows.data.map((row) => ({
        ...row,
        donated: Number(row.donated),
        received: Number(row.received)
    }));
    const membersMap = clan.memberList.reduce((record, item) => {
        record[item.tag] = {
            donated: item.donations,
            received: item.donationsReceived
        };
        return record;
    }, {});
    const playersMap = data.reduce((record, item) => {
        const member = membersMap[item.tag] ?? { donated: 0, received: 0 };
        record[item.tag] = {
            donated: Math.max(item.donated, member.donated),
            received: Math.max(item.received, member.received)
        };
        return record;
    }, {});
    const tags = Object.keys(playersMap);
    if (!tags.length)
        return;
    const collection = client.db.collection("PlayerSeasons" /* Collections.PLAYER_SEASONS */);
    const cursor = await collection
        .find({ tag: { $in: unique(tags) }, season: seasonId })
        .project({ tag: 1, name: 1, clans: 1, _id: 1, season: seasonId })
        .toArray();
    const ops = [];
    for (const player of cursor) {
        if (!player.clans?.[clan.tag])
            continue;
        const record = playersMap[player.tag];
        const donations = Math.max(player.clans[clan.tag].donations.total, record.donated);
        const received = Math.max(player.clans[clan.tag].donationsReceived.total, record.received);
        ops.push({
            updateOne: {
                filter: { _id: player._id },
                update: {
                    $set: {
                        [`clans.${clan.tag}.donations.total`]: donations,
                        [`clans.${clan.tag}.donationsReceived.total`]: received
                    }
                }
            }
        });
    }
    if (ops.length)
        await collection.bulkWrite(ops);
    // redis set removed
};
export const unitsFlatten = (data, { withEquipment = true }) => {
    const heroEquipment = withEquipment ? data.heroEquipment : [];
    return [
        ...data.troops.map((u) => ({
            name: u.name,
            level: u.level,
            maxLevel: u.maxLevel,
            type: 'troop',
            village: u.village
        })),
        ...data.heroes.map((u) => ({
            name: u.name,
            level: u.level,
            maxLevel: u.maxLevel,
            type: 'hero',
            village: u.village
        })),
        ...data.spells.map((u) => ({
            name: u.name,
            level: u.level,
            maxLevel: u.maxLevel,
            type: 'spell',
            village: u.village
        })),
        ...heroEquipment.map((u) => ({
            name: u.name,
            level: u.level,
            maxLevel: u.maxLevel,
            type: 'equipment',
            village: u.village
        }))
    ];
};
//# sourceMappingURL=helper.js.map