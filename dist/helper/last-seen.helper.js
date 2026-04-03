import { EmbedBuilder } from 'discord.js';
import { container } from 'tsyringe';
import { Client } from '../struct/client.js';
import { lastSeenTimestampFormat, padStart } from '../util/helper.js';
export const lastSeenEmbedMaker = async (clan, { color, scoreView }) => {
    const client = container.resolve(Client);
    const db = client.db.collection("Players" /* Collections.PLAYERS */);
    const playerTags = clan.memberList.map((m) => m.tag);
    const result = await db
        .aggregate([
        {
            $match: { tag: { $in: playerTags } }
        },
        {
            $project: {
                name: '$name',
                tag: '$tag',
                lastSeen: '$lastSeen',
                townHallLevel: '$townHallLevel'
            }
        }
    ])
        .toArray();
    // Query activity counts from PlayerActivities (written by clashmate-service poller)
    const since = new Date(Date.now() - (scoreView ? 30 : 1) * 24 * 60 * 60 * 1000);
    const activityResult = await client.db
        .collection("PlayerActivities" /* Collections.PLAYER_ACTIVITIES */)
        .aggregate([
        {
            $match: {
                tag: { $in: playerTags },
                createdAt: { $gte: since }
            }
        },
        {
            $group: {
                _id: '$tag',
                count: { $sum: 1 }
            }
        },
        {
            $project: {
                _id: 0,
                tag: '$_id',
                count: '$count'
            }
        }
    ])
        .toArray();
    const activityMap = activityResult.reduce((record, item) => {
        record[item.tag] = item.count;
        return record;
    }, {});
    const _members = clan.memberList.map((m) => {
        const mem = result.find((d) => d.tag === m.tag);
        return {
            tag: m.tag,
            name: m.name,
            townHallLevel: m.townHallLevel.toString(),
            count: activityMap[m.tag] || 0,
            lastSeen: mem ? new Date().getTime() - new Date(mem.lastSeen).getTime() : 0
        };
    });
    _members.sort((a, b) => a.lastSeen - b.lastSeen);
    const members = _members
        .filter((m) => m.lastSeen > 0)
        .concat(_members.filter((m) => m.lastSeen === 0));
    const embed = new EmbedBuilder();
    embed.setAuthor({ name: `${clan.name} (${clan.tag})`, iconURL: clan.badgeUrls.medium });
    if (color)
        embed.setColor(color);
    if (scoreView) {
        members.sort((a, b) => b.count - a.count);
        embed.setDescription([
            '**Clan member activity scores (last 30d)**',
            '```',
            `TH  TOTAL AVG  NAME`,
            members
                .map((m) => {
                const townHallLevel = padStart(m.townHallLevel, 2);
                const count = padStart(Math.floor(m.count / 30), 3);
                return `${townHallLevel}  ${padStart(m.count, 4)}  ${count}  ${m.name}`;
            })
                .join('\n'),
            '```'
        ].join('\n'));
    }
    else {
        embed.setDescription([
            `**[Last seen and last 24h activity scores](https://clashperk.com/faq)**`,
            '```',
            `TH  LAST-ON  24H  NAME`,
            members
                .map((m) => {
                const townHallLevel = padStart(m.townHallLevel, 2);
                return `${townHallLevel}  ${lastSeenTimestampFormat(m.lastSeen)}  ${padStart(Math.min(m.count, 999), 3)}  ${m.name}`;
            })
                .join('\n'),
            '```'
        ].join('\n'));
    }
    embed.setFooter({ text: `Synced [${members.length}/${clan.members}]` });
    embed.setTimestamp();
    return embed;
};
//# sourceMappingURL=last-seen.helper.js.map