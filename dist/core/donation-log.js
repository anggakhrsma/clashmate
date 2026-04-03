import { ClanLogType } from '../entities/index.js';
import { EmbedBuilder, escapeMarkdown, time, WebhookClient } from 'discord.js';
import moment from 'moment';
import { title } from 'radash';
import { padStart } from '../util/helper.js';
import { Season, Util } from '../util/toolkit.js';
import { RootLog } from './root-log.js';
export class DonationLog extends RootLog {
    constructor(enqueuer) {
        super(enqueuer.client);
        Object.defineProperty(this, "enqueuer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: enqueuer
        });
        Object.defineProperty(this, "queued", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Set()
        });
        Object.defineProperty(this, "refreshRate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "timeouts", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.client = enqueuer.client;
        this.refreshRate = 30 * 60 * 1000;
        this.timeouts = {};
    }
    get permissions() {
        return ['SendMessages', 'EmbedLinks', 'UseExternalEmojis', 'ViewChannel'];
    }
    get collection() {
        return this.client.db.collection("ClanLogs" /* Collections.CLAN_LOGS */);
    }
    async handleMessage(cache, webhook, data) {
        if (data.logType !== cache.logType)
            return null;
        const embed = await this.rangeDonation(cache, {
            gte: data.gte,
            lte: data.lte,
            interval: data.interval,
            tag: cache.tag
        });
        if (!embed)
            return;
        await this.send(cache, webhook, {
            embeds: [embed],
            threadId: cache.threadId
        });
        return this.collection.updateOne({ _id: cache._id }, { $set: { lastPostedAt: new Date() } });
    }
    async send(cache, webhook, payload) {
        try {
            return await super.sendMessage(cache, webhook, payload);
        }
        catch (error) {
            this.client.logger.error(`${error.toString()} {${cache._id.toString()}}`, {
                label: DonationLog.name
            });
            return null;
        }
    }
    async rangeDonation(cache, { tag, gte, lte, interval }) {
        const { body: clan } = await this.client.coc.getClan(tag);
        if (!clan?.members)
            return null;
        const data = await this.client.db
            .collection('PlayerActivities')
            .aggregate([
            {
                $match: {
                    clanTag: tag,
                    createdAt: { $gte: moment(gte).toDate(), $lte: moment(lte).toDate() },
                    op: 'DONATED'
                }
            },
            {
                $group: {
                    _id: '$tag',
                    donated: { $sum: '$donations' },
                    received: { $sum: '$donationsReceived' },
                    name: { $first: '$name' }
                }
            },
            {
                $project: {
                    tag: '$_id',
                    donated: 1,
                    received: 1,
                    name: 1,
                    _id: 0
                }
            }
        ])
            .toArray();
        const playersMap = data.reduce((record, item) => {
            record[item.tag] = item;
            return record;
        }, {});
        const playerTags = Object.keys(playersMap);
        const currentMemberTags = clan.memberList.map((member) => member.tag);
        const oldMemberTags = playerTags.filter((tag) => !currentMemberTags.includes(tag));
        const players = await this.client.db
            .collection("Players" /* Collections.PLAYERS */)
            .find({ tag: { $in: oldMemberTags } }, { projection: { name: 1, tag: 1 } })
            .toArray();
        const result = [...clan.memberList, ...players].map((player) => ({
            name: player.name,
            tag: player.tag,
            donated: playersMap[player.tag]?.donated ?? 0,
            received: playersMap[player.tag]?.received ?? 0
        }));
        result.sort((a, b) => b.received - a.received);
        result.sort((a, b) => b.donated - a.donated);
        const embed = new EmbedBuilder().setAuthor({
            name: `${clan.name} (${clan.tag})`,
            iconURL: clan.badgeUrls.large
        });
        if (cache.color)
            embed.setColor(cache.color);
        const [description] = Util.splitMessage([
            `**${title(interval.toLowerCase())} Donations**`,
            `${time(moment(gte).toDate())} - ${time(moment(lte).toDate())}`,
            '',
            ...result.map((player) => {
                const don = padStart(player.donated, 5);
                const rec = padStart(player.received, 5);
                const name = escapeMarkdown(player.name);
                return `\` ${don} ${rec} \` \u200e${name}`;
            })
        ].join('\n'), { maxLength: 4096 });
        embed.setDescription(description);
        const donated = result.reduce((acc, cur) => acc + cur.donated, 0);
        const received = result.reduce((acc, cur) => acc + cur.received, 0);
        embed.setFooter({ text: `[${donated} DON | ${received} REC]` });
        embed.setTimestamp();
        return embed;
    }
    async _refreshDaily() {
        if (this.timeouts.daily)
            clearTimeout(this.timeouts.daily);
        try {
            const interval = "DAILY" /* DonationLogFrequencyTypes.DAILY */;
            const lte = moment().startOf('day').toDate();
            const gte = moment(lte).subtract(1, 'd').toISOString();
            const timestamp = new Date(lte.getTime() + 15 * 60 * 1000);
            if (timestamp.getTime() > Date.now())
                return;
            const guildIds = this.client.guilds.cache.map((guild) => guild.id);
            const logs = await this.collection
                .find({
                isEnabled: true,
                guildId: { $in: guildIds },
                lastPostedAt: { $lt: timestamp },
                logType: ClanLogType.DAILY_DONATION_LOG
            })
                .toArray();
            for (const log of logs) {
                if (!this.client.guilds.cache.has(log.guildId))
                    continue;
                const id = log._id.toHexString();
                if (this.queued.has(id))
                    continue;
                this.queued.add(id);
                await this.exec(log.clanTag, {
                    gte,
                    lte: lte.toISOString(),
                    interval,
                    channel: log.channelId,
                    logType: ClanLogType.DAILY_DONATION_LOG
                });
                this.queued.delete(id);
                await Util.delay(2000);
            }
        }
        finally {
            this.timeouts.daily = setTimeout(this._refreshDaily.bind(this), this.refreshRate).unref();
        }
    }
    async _refreshWeekly() {
        if (this.timeouts.weekly)
            clearTimeout(this.timeouts.weekly);
        try {
            const interval = "WEEKLY" /* DonationLogFrequencyTypes.WEEKLY */;
            const lte = moment().startOf('week').toDate();
            const gte = moment(lte).subtract(7, 'days').toISOString();
            const timestamp = new Date(lte.getTime() + 15 * 60 * 1000);
            if (timestamp.getTime() > Date.now())
                return;
            const guildIds = this.client.guilds.cache.map((guild) => guild.id);
            const logs = await this.collection
                .find({
                isEnabled: true,
                guildId: { $in: guildIds },
                lastPostedAt: { $lt: timestamp },
                logType: ClanLogType.WEEKLY_DONATION_LOG
            })
                .toArray();
            for (const log of logs) {
                if (!this.client.guilds.cache.has(log.guildId))
                    continue;
                const id = log._id.toHexString();
                if (this.queued.has(id))
                    continue;
                this.queued.add(id);
                await this.exec(log.clanTag, {
                    gte,
                    lte: lte.toISOString(),
                    interval,
                    channel: log.channelId,
                    logType: ClanLogType.WEEKLY_DONATION_LOG
                });
                this.queued.delete(id);
                await Util.delay(2000);
            }
        }
        finally {
            this.timeouts.weekly = setTimeout(this._refreshWeekly.bind(this), this.refreshRate).unref();
        }
    }
    async _refreshMonthly() {
        if (this.timeouts.monthly)
            clearTimeout(this.timeouts.monthly);
        try {
            const interval = "MONTHLY" /* DonationLogFrequencyTypes.MONTHLY */;
            const { startTime, endTime: lte } = Season.getLastSeason();
            const gte = startTime.toISOString();
            const timestamp = new Date(lte.getTime() + 10 * 60 * 1000);
            if (timestamp.getTime() > Date.now())
                return;
            const guildIds = this.client.guilds.cache.map((guild) => guild.id);
            const logs = await this.collection
                .find({
                isEnabled: true,
                guildId: { $in: guildIds },
                lastPostedAt: { $lt: timestamp },
                logType: ClanLogType.MONTHLY_DONATION_LOG
            })
                .toArray();
            for (const log of logs) {
                if (!this.client.guilds.cache.has(log.guildId))
                    continue;
                const id = log._id.toHexString();
                if (this.queued.has(id))
                    continue;
                this.queued.add(id);
                await this.exec(log.clanTag, {
                    gte,
                    lte: lte.toISOString(),
                    interval,
                    channel: log.channelId,
                    logType: ClanLogType.MONTHLY_DONATION_LOG
                });
                this.queued.delete(id);
                await Util.delay(2000);
            }
        }
        finally {
            this.timeouts.monthly = setTimeout(this._refreshMonthly.bind(this), this.refreshRate).unref();
        }
    }
    async init() {
        const guildIds = this.client.guilds.cache.map((guild) => guild.id);
        for await (const data of this.collection.find({
            guildId: { $in: guildIds },
            logType: {
                $in: [
                    ClanLogType.DAILY_DONATION_LOG,
                    ClanLogType.WEEKLY_DONATION_LOG,
                    ClanLogType.MONTHLY_DONATION_LOG
                ]
            },
            isEnabled: true
        })) {
            this.setCache(data);
        }
        (async () => {
            await this._refreshDaily();
            await this._refreshWeekly();
            await this._refreshMonthly();
        })();
    }
    async add(guildId) {
        for await (const data of this.collection.find({
            guildId,
            logType: {
                $in: [
                    ClanLogType.DAILY_DONATION_LOG,
                    ClanLogType.WEEKLY_DONATION_LOG,
                    ClanLogType.MONTHLY_DONATION_LOG
                ]
            },
            isEnabled: true
        })) {
            this.setCache(data);
        }
    }
    setCache(data) {
        this.cached.set(data._id.toHexString(), {
            _id: data._id,
            guild: data.guildId,
            channel: data.channelId,
            tag: data.clanTag,
            deepLink: data.deepLink,
            logType: data.logType,
            color: data.color,
            retries: 0,
            webhook: data.webhook?.id ? new WebhookClient(data.webhook) : null
        });
    }
}
//# sourceMappingURL=donation-log.js.map