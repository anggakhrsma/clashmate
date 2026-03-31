import { ClanLogType } from '../entities/index.js';
import { Util } from 'clashofclans.js';
import { WebhookClient } from 'discord.js';
import { clanEmbedMaker } from '../helper/clan-embed.helper.js';
import { RootLog } from './root-log.js';
export class ClanEmbedLog extends RootLog {
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
        Object.defineProperty(this, "timeout", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.refreshRate = 30 * 60 * 1000;
        this.client = enqueuer.client;
    }
    get collection() {
        return this.client.db.collection("ClanLogs" /* Collections.CLAN_LOGS */);
    }
    get permissions() {
        return ['ReadMessageHistory', 'SendMessages', 'EmbedLinks', 'UseExternalEmojis', 'ViewChannel'];
    }
    async handleMessage(cache, webhook, data) {
        if (cache.logType !== data.logType)
            return null;
        const embed = await this.embed(cache);
        if (!embed)
            return null;
        if (!cache.message) {
            const msg = await this.send(cache, webhook, {
                embeds: [embed],
                threadId: cache.threadId
            });
            return this.updateMessageId(cache, msg);
        }
        const msg = await this.edit(cache, webhook, {
            embeds: [embed],
            threadId: cache.threadId
        });
        return this.updateMessageId(cache, msg);
    }
    async send(cache, webhook, payload) {
        try {
            return await super.sendMessage(cache, webhook, payload);
        }
        catch (error) {
            this.client.logger.error(`${error.toString()} {${cache._id.toString()}}`, {
                label: ClanEmbedLog.name
            });
            return null;
        }
    }
    async edit(cache, webhook, payload) {
        try {
            return await super.editMessage(cache, webhook, payload);
        }
        catch (error) {
            this.client.logger.error(`${error.toString()} {${cache._id.toString()}}`, {
                label: ClanEmbedLog.name
            });
            return null;
        }
    }
    async embed(cache) {
        const { body: clan } = await this.client.coc.getClan(cache.tag);
        if (!clan)
            return null;
        const embed = await clanEmbedMaker(clan, {
            description: cache.embed.description,
            accepts: cache.embed?.accepts ?? '',
            fields: cache.embed?.fields ?? '',
            bannerImage: cache.embed?.bannerImage ?? '',
            color: cache.color
        });
        return embed;
    }
    async _refresh() {
        if (this.timeout)
            clearTimeout(this.timeout);
        try {
            const guildIds = this.client.guilds.cache.map((guild) => guild.id);
            const cursor = this.collection.aggregate([
                {
                    $match: {
                        guildId: { $in: guildIds },
                        logType: ClanLogType.CLAN_EMBED_LOG,
                        lastPostedAt: { $lte: new Date(Date.now() - this.refreshRate * 2) }
                    }
                },
                {
                    $lookup: {
                        from: "ClanStores" /* Collections.CLAN_STORES */,
                        localField: 'clanId',
                        foreignField: '_id',
                        as: '_store',
                        pipeline: [{ $match: { active: true, paused: false } }, { $project: { _id: 1 } }]
                    }
                },
                { $unwind: { path: '$_store' } }
            ]);
            for await (const log of cursor) {
                if (!this.client.guilds.cache.has(log.guildId))
                    continue;
                const logId = log._id.toHexString();
                if (this.queued.has(logId))
                    continue;
                this.queued.add(logId);
                await this.exec(log.clanTag, {
                    logType: ClanLogType.CLAN_EMBED_LOG,
                    channel: log.channelId
                });
                this.queued.delete(logId);
                await Util.delay(3000);
            }
        }
        finally {
            this.timeout = setTimeout(this._refresh.bind(this), this.refreshRate).unref();
        }
    }
    async init() {
        const guildIds = this.client.guilds.cache.map((guild) => guild.id);
        for await (const data of this.collection.find({
            guildId: { $in: guildIds },
            logType: ClanLogType.CLAN_EMBED_LOG,
            isEnabled: true
        })) {
            this.setCache(data);
        }
        (async () => {
            await this._refresh();
        })();
    }
    async add(guildId) {
        for await (const data of this.collection.find({
            guildId,
            logType: ClanLogType.CLAN_EMBED_LOG,
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
            message: data.messageId,
            tag: data.clanTag,
            deepLink: data.deepLink,
            logType: data.logType,
            color: data.color,
            retries: 0,
            embed: data.metadata,
            webhook: data.webhook?.id ? new WebhookClient(data.webhook) : null
        });
    }
}
//# sourceMappingURL=clan-embed-log.js.map