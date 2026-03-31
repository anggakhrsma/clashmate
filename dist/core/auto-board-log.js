import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Collection, SnowflakeUtil, WebhookClient } from 'discord.js';
import { ObjectId } from 'mongodb';
import { getBbLegendRankingEmbedMaker, getLegendRankingEmbedMaker } from '../helper/leaderboard.helper.js';
import { EMOJIS } from '../util/emojis.js';
import { Season, Util } from '../util/toolkit.js';
export class AutoBoardLog {
    constructor(enqueuer) {
        Object.defineProperty(this, "cached", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Collection()
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
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.client = enqueuer.client;
        this.refreshRate = 15 * 60 * 1000;
    }
    get collection() {
        return this.client.db.collection("AutoBoardLogs" /* Collections.AUTO_BOARDS */);
    }
    get permissions() {
        return ['ReadMessageHistory', 'SendMessages', 'EmbedLinks', 'UseExternalEmojis', 'ViewChannel'];
    }
    async exec(_id, data) {
        const cache = this.cached.get(_id);
        if (data.channelId && cache && cache.channelId !== data.channelId)
            return;
        // double posting prevention for custom bots
        if (cache?.guildId && this.client.settings.hasCustomBot(cache.guildId) && !false)
            return;
        if (cache)
            await this.permissionsFor(cache);
    }
    async permissionsFor(cache) {
        const channel = this.client.util.hasPermissions(cache.channelId, this.permissions);
        if (channel) {
            if (channel.isThread)
                cache.threadId = channel.channel.id;
            const webhook = await this.webhook(cache, channel.parent);
            if (webhook)
                return this.handleMessage(cache, webhook);
        }
    }
    isEndOfSeason(endOfSeason) {
        return endOfSeason.toISOString().slice(0, 7) !== new Date().toISOString().slice(0, 7);
    }
    async handleMessage(cache, webhook) {
        const endOfSeason = this.client.coc.util.getSeasonEnd(new Date());
        if (cache.messageId && this.isEndOfSeason(endOfSeason)) {
            const lastMessageTimestamp = this.client.coc.util
                .getSeasonEnd(new Date(Number(SnowflakeUtil.deconstruct(cache.messageId).timestamp)))
                .getTime();
            if (lastMessageTimestamp !== endOfSeason.getTime())
                delete cache.messageId;
        }
        if (!cache.messageId) {
            const msg = await this.send(cache, webhook);
            return this.updateMessageId(cache, msg);
        }
        const msg = await this.edit(cache, webhook);
        return this.updateMessageId(cache, msg);
    }
    _components(cache) {
        const btn = new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(JSON.stringify({
            cmd: 'legend-leaderboard',
            is_bb: cache.boardType === 'bb-legend-leaderboard',
            limit: cache.limit
        }))
            .setEmoji(EMOJIS.REFRESH);
        return new ActionRowBuilder().addComponents(btn);
    }
    updateWebhook(cache, webhook, channelId) {
        return this.collection.updateOne({ _id: new ObjectId(cache._id) }, { $set: { channelId, webhook: { id: webhook.id, token: webhook.token } } });
    }
    deleteWebhook(cache) {
        cache.webhook = null;
        cache.deleted = true;
        return this.collection.updateOne({ _id: new ObjectId(cache._id) }, { $set: { webhook: null } });
    }
    async updateMessageId(cache, msg) {
        if (msg) {
            await this.collection.updateOne({ _id: new ObjectId(cache._id) }, {
                $set: {
                    retries: 0,
                    messageId: msg.id,
                    channelId: msg.channel_id,
                    updatedAt: new Date()
                }
            });
            cache.messageId = msg.id;
            cache.channelId = msg.channel_id;
        }
        else {
            await this.collection.updateOne({ _id: new ObjectId(cache._id) }, { $inc: { retries: 1 } });
        }
        return msg;
    }
    async _send(cache, webhook, payload) {
        try {
            return await webhook.send(payload);
        }
        catch (error) {
            // Unknown Webhook / Unknown Channel
            if ([10015, 10003].includes(error.code)) {
                await this.deleteWebhook(cache);
            }
            throw error;
        }
    }
    async _edit(cache, webhook, payload) {
        try {
            return await webhook.editMessage(cache.messageId, payload);
        }
        catch (error) {
            if (error.code === 10008)
                return this.disableLog(cache);
            // Unknown Webhook / Unknown Channel
            if ([10015, 10003].includes(error.code)) {
                await this.deleteWebhook(cache);
            }
            throw error;
        }
    }
    async disableLog(cache) {
        this.cached.delete(cache._id);
        await this.collection.updateOne({ _id: new ObjectId(cache._id) }, { $set: { disabled: true } });
        return null;
    }
    async send(cache, webhook) {
        const embed = await this.embed(cache);
        if (!embed)
            return null;
        try {
            return await this._send(cache, webhook, {
                embeds: [embed],
                threadId: cache.threadId,
                components: [this._components(cache)]
            });
        }
        catch (error) {
            this.client.logger.error(`${error} {${cache._id.toString()}}`, {
                label: 'AutoBoardLog'
            });
            return null;
        }
    }
    async webhook(cache, channel) {
        if (cache.webhook)
            return cache.webhook;
        if (cache.deleted)
            return null;
        const webhook = await this.client.storage.getWebhook(channel).catch(() => null);
        if (webhook) {
            cache.webhook = new WebhookClient({ id: webhook.id, token: webhook.token });
            await this.updateWebhook(cache, cache.webhook, cache.channelId);
            return cache.webhook;
        }
        cache.webhook = null;
        cache.deleted = true;
        return null;
    }
    async edit(cache, webhook) {
        const embed = await this.embed(cache);
        if (!embed)
            return null;
        try {
            return await this._edit(cache, webhook, {
                embeds: [embed],
                threadId: cache.threadId,
                components: [this._components(cache)]
            });
        }
        catch (error) {
            this.client.logger.error(`${error} {${cache.guildId.toString()}}`, {
                label: 'AutoBoardLog'
            });
            return null;
        }
    }
    async embed(cache) {
        const guild = this.client.guilds.cache.get(cache.guildId);
        if (!guild)
            return null;
        if (cache.boardType === 'bb-legend-leaderboard') {
            const { embed, players } = await getBbLegendRankingEmbedMaker({
                guild,
                limit: cache.limit,
                seasonId: Season.ID
            });
            if (!players.length)
                return null;
            return embed;
        }
        const { embed, players } = await getLegendRankingEmbedMaker({
            guild,
            limit: cache.limit,
            seasonId: Season.ID
        });
        if (!players.length)
            return null;
        return embed;
    }
    async init() {
        for await (const data of this.collection.find({
            guildId: { $in: this.client.guilds.cache.map((guild) => guild.id) }
        })) {
            this.cached.set(data._id.toHexString(), {
                _id: data._id.toHexString(),
                guildId: data.guildId,
                boardType: data.boardType,
                color: data.color,
                limit: data.limit,
                channelId: data.channelId,
                messageId: data.messageId,
                updatedAt: data.updatedAt,
                webhook: data.webhook ? new WebhookClient(data.webhook) : null
            });
        }
        this._refresh();
    }
    async add(_id) {
        const data = await this.collection.findOne({ _id: new ObjectId(_id) });
        if (!data)
            return null;
        this.cached.set(data._id.toHexString(), {
            _id: data._id.toHexString(),
            guildId: data.guildId,
            boardType: data.boardType,
            color: data.color,
            limit: data.limit,
            channelId: data.channelId,
            messageId: data.messageId,
            updatedAt: data.updatedAt,
            webhook: data.webhook ? new WebhookClient(data.webhook) : null
        });
        return this.exec(_id, { channelId: data.channelId });
    }
    del(id) {
        return this.cached.delete(id);
    }
    async _refresh() {
        if (this.timeout)
            clearTimeout(this.timeout);
        try {
            const guildIds = this.client.guilds.cache.map((guild) => guild.id);
            const cursor = this.client.db.collection("AutoBoardLogs" /* Collections.AUTO_BOARDS */).aggregate([
                {
                    $match: {
                        guildId: { $in: guildIds },
                        updatedAt: { $lte: new Date(Date.now() - this.refreshRate * 2) }
                    }
                },
                {
                    $lookup: {
                        from: "ClanStores" /* Collections.CLAN_STORES */,
                        localField: 'guildId',
                        foreignField: 'guild',
                        as: '_store',
                        pipeline: [
                            { $match: { active: true, paused: false } },
                            { $project: { _id: 1 } },
                            { $limit: 1 }
                        ]
                    }
                },
                { $unwind: { path: '$_store' } }
            ]);
            for await (const log of cursor) {
                if (!this.client.guilds.cache.has(log.guildId))
                    continue;
                if (log.disabled)
                    continue;
                const logId = log._id.toHexString();
                if (this.queued.has(logId))
                    continue;
                this.queued.add(logId);
                await this.exec(logId, { channelId: log.channelId });
                this.queued.delete(logId);
                await Util.delay(3000);
            }
        }
        finally {
            this.timeout = setTimeout(this._refresh.bind(this), this.refreshRate).unref();
        }
    }
}
//# sourceMappingURL=auto-board-log.js.map