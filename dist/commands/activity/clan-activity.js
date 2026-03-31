import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import moment from 'moment';
import { Command } from '../../lib/handlers.js';
import Google from '../../struct/google.js';
import { EMOJIS } from '../../util/emojis.js';
export default class ClanActivityCommand extends Command {
    constructor() {
        super('activity', {
            category: 'activity',
            channel: 'guild',
            clientPermissions: ['EmbedLinks', 'AttachFiles'],
            defer: true
        });
    }
    async exec(interaction, args) {
        const { clans, resolvedArgs } = await this.client.storage.handleSearch(interaction, {
            args: args.clans
        });
        if (!clans)
            return;
        const days = args.days ?? 1;
        const limit = args.limit ?? 10;
        const isTotal = !args.clans || args.clans === '*';
        const result = await this.aggregate(clans.map((clan) => clan.tag), days, isTotal ? limit : clans.length);
        if (!result.length)
            return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
        const timezone = await this.getTimezoneOffset(interaction, args.timezone);
        const isHourly = days <= 3;
        const itemCount = isHourly ? 24 : 1;
        const dataLabel = new Array(days * itemCount)
            .fill(0)
            .map((_, i) => {
            const decrement = new Date().getTime() - (isHourly ? 60 * 60 * 1000 : 60 * 60 * 1000 * 24) * i;
            const key = isHourly
                ? moment(decrement).minutes(0).seconds(0).milliseconds(0).toISOString()
                : moment(decrement).hours(0).minutes(0).seconds(0).milliseconds(0).toISOString();
            return {
                key,
                timestamp: new Date(new Date(key).getTime() + timezone.offset * 1000)
            };
        })
            .reverse();
        const clansMap = Object.fromEntries(clans.map((clan) => [clan.tag, clan.name]));
        const COLORS = [
            '#4e79a7',
            '#f28e2b',
            '#e15759',
            '#76b7b2',
            '#59a14f',
            '#edc948',
            '#b07aa1',
            '#ff9da7',
            '#9c755f',
            '#bab0ac'
        ];
        const datasets = result.map((clan, i) => ({
            label: clansMap[clan.clanTag] || clan.clanTag,
            data: this.buildDataset(dataLabel, clan),
            borderColor: COLORS[i % COLORS.length],
            backgroundColor: COLORS[i % COLORS.length] + '33',
            fill: false,
            tension: 0.3,
            pointRadius: isHourly ? 2 : 4
        }));
        const unit = isHourly ? 'hour' : 'day';
        const labels = dataLabel.map((d) => {
            const m = moment(d.timestamp);
            if (!isHourly)
                return m.format('MMM D');
            // At midnight (12am), show date instead of time
            if (m.hour() === 0)
                return m.format('MMM D');
            // Otherwise show time only in 12h format without leading zero
            return m.format('hA'); // e.g. "6PM", "2AM"
        });
        // Use clan nickname if available, else clan name
        const getNickname = async (tag, name) => {
            const nickname = await this.client.storage.getNickname(interaction.guildId, tag, name);
            return nickname || name;
        };
        const legendLabels = await Promise.all(result.map((r) => getNickname(r.clanTag, clansMap[r.clanTag] || r.clanTag)));
        const datasetsWithLabels = datasets.map((d, i) => ({ ...d, label: legendLabels[i] }));
        const titleText = isHourly
            ? `Active Members Per Hour (${timezone.name})`
            : `Active Members Per Day (${timezone.name})`;
        const chartConfig = {
            type: 'line',
            data: { labels, datasets: datasetsWithLabels },
            options: {
                layout: { padding: { top: 10, right: 20, bottom: 10, left: 10 } },
                plugins: {
                    title: {
                        display: true,
                        text: titleText,
                        color: '#ffffff',
                        font: { size: 28, weight: 'bold' },
                        padding: { bottom: 12 }
                    },
                    legend: {
                        display: true,
                        labels: {
                            color: '#cccccc',
                            boxWidth: 12,
                            padding: 16,
                            font: { size: 22 }
                        }
                    },
                    tooltip: {
                        backgroundColor: '#2a2a3e',
                        titleColor: '#ffffff',
                        bodyColor: '#cccccc',
                        borderColor: '#444466',
                        borderWidth: 1,
                        padding: 10
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            maxRotation: 0,
                            callback: (val, index) => {
                                if (index % 2 !== 0)
                                    return null;
                                return val;
                            },
                            font: { size: 20 },
                            color: '#cccccc'
                        },
                        grid: {
                            color: (ctx) => (ctx.index % 2 === 0 ? '#2a2a3e' : 'transparent')
                        }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: '#aaaaaa',
                            precision: 0,
                            font: { size: 20 }
                        },
                        grid: { color: '#2a2a3e' },
                        title: {
                            display: true,
                            text: 'Active Members',
                            color: '#888899',
                            font: { size: 20 }
                        }
                    }
                }
            }
        };
        // QuickChart — free public chart-as-image API, no key required
        const quickchartUrl = 'https://quickchart.io/chart';
        const chartRes = await fetch(quickchartUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                width: 1200,
                height: 600,
                backgroundColor: '#1e2130',
                version: 4,
                chart: chartConfig
            })
        });
        if (!chartRes.ok) {
            return interaction.editReply('Failed to generate chart image. Please try again.');
        }
        const buffer = Buffer.from(await chartRes.arrayBuffer());
        const attachment = new AttachmentBuilder(buffer, { name: 'activity.png' });
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setEmoji(EMOJIS.REFRESH)
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(this.createId({
            cmd: this.id,
            clans: resolvedArgs,
            days: args.days,
            timezone: args.timezone,
            limit: args.limit
        })));
        const timeZoneCommand = this.client.commands.get('/timezone');
        return interaction.editReply({
            content: timezone.name === 'UTC' ? `Set your timezone with the ${timeZoneCommand} command.` : null,
            files: [attachment],
            components: [row]
        });
    }
    /**
     * Aggregate active member counts from MongoDB clan_logs.
     * The poller writes JOINED/LEFT/DONATED/etc. events — we count unique member
     * tags per time bucket as a proxy for "active members".
     */
    async aggregate(clanTags, days, limit) {
        const isHourly = days <= 3;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const bucketFormat = isHourly
            ? {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' },
                hour: { $hour: '$createdAt' }
            }
            : {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' }
            };
        const rows = await this.client.db
            .collection('PlayerActivities')
            .aggregate([
            {
                $match: {
                    clanTag: { $in: clanTags },
                    createdAt: { $gte: since }
                }
            },
            {
                $group: {
                    _id: { clanTag: '$clanTag', bucket: bucketFormat },
                    uniqueMembers: { $addToSet: '$tag' }
                }
            },
            {
                $project: {
                    clanTag: '$_id.clanTag',
                    count: { $size: '$uniqueMembers' },
                    time: {
                        $dateToString: {
                            format: isHourly ? '%Y-%m-%dT%H:00:00.000Z' : '%Y-%m-%dT00:00:00.000Z',
                            date: {
                                $dateFromParts: {
                                    year: '$_id.bucket.year',
                                    month: '$_id.bucket.month',
                                    day: '$_id.bucket.day',
                                    hour: { $ifNull: ['$_id.bucket.hour', 0] }
                                }
                            }
                        }
                    }
                }
            },
            { $sort: { time: 1 } }
        ])
            .toArray();
        // Group by clan and compute totals for sorting
        const grouped = rows.reduce((acc, row) => {
            if (!acc[row.clanTag])
                acc[row.clanTag] = { activities: [], total: 0 };
            acc[row.clanTag].activities.push({
                count: row.count,
                time: row.time
            });
            acc[row.clanTag].total += row.count;
            return acc;
        }, {});
        const entries = Object.entries(grouped);
        if (!entries.length)
            return [];
        entries.sort((a, b) => b[1].total - a[1].total);
        return entries.slice(0, limit).map(([clanTag, { activities }]) => ({ clanTag, activities }));
    }
    buildDataset(dataLabel, clan) {
        return dataLabel.map(({ key }) => {
            const match = clan.activities.find((a) => a.time === key);
            return match?.count ?? 0;
        });
    }
    async getTimezoneOffset(interaction, location) {
        const zone = location ? moment.tz.zone(location) : null;
        if (zone)
            return { offset: zone.utcOffset(Date.now()) * 60 * -1, name: zone.name };
        const user = await this.client.db
            .collection("Users" /* Collections.USERS */)
            .findOne({ userId: interaction.user.id });
        if (!location) {
            if (!user?.timezone?.id)
                return { offset: 0, name: 'UTC' };
            return {
                offset: moment.tz.zone(user.timezone.id).utcOffset(Date.now()) * 60 * -1,
                name: user.timezone.name
            };
        }
        const raw = await Google.timezone(location);
        if (!raw)
            return { offset: 0, name: 'UTC' };
        const offset = Number(raw.timezone.rawOffset) + Number(raw.timezone.dstOffset);
        if (!user?.timezone) {
            await this.client.db.collection("Users" /* Collections.USERS */).updateOne({ userId: interaction.user.id }, {
                $set: {
                    username: interaction.user.username,
                    displayName: interaction.user.displayName,
                    discriminator: interaction.user.discriminator,
                    timezone: {
                        id: raw.timezone.timeZoneId,
                        offset: Number(offset),
                        name: raw.timezone.timeZoneName,
                        location: raw.location.formatted_address
                    }
                },
                $setOnInsert: { createdAt: new Date() }
            }, { upsert: true });
        }
        return {
            offset: moment.tz.zone(raw.timezone.timeZoneId).utcOffset(Date.now()) * 60 * -1,
            name: raw.timezone.timeZoneName
        };
    }
    titleCase(str) {
        return str
            .replace(/_/g, ' ')
            .toLowerCase()
            .replace(/\b(\w)/g, (char) => char.toUpperCase());
    }
}
//# sourceMappingURL=clan-activity.js.map