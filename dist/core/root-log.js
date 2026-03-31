import { DiscordErrorCodes } from '../util/constants.js';
import { Collection, WebhookClient } from 'discord.js';
const WEBHOOK_RETRY_THRESHOLD = 3;
export class RootLog {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "cached", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.cached = new Collection();
    }
    get permissions() {
        throw new Error('Method not implemented.');
    }
    get collection() {
        throw new Error('Method not implemented.');
    }
    handleMessage(cache, webhook, data) {
        throw new Error('Method not implemented.');
    }
    async exec(clanTag, data) {
        const clans = this.cached.filter((cache) => cache.tag === clanTag);
        for (const _id of clans.keys()) {
            const cache = this.cached.get(_id);
            if (!cache)
                continue;
            if (data.channel && cache.channel !== data.channel)
                continue;
            // Double posting prevention for custom bots
            if (this.client.settings.hasCustomBot(cache.guild) && !false)
                continue;
            await this.permissionsFor(cache, data);
        }
        return clans.clear();
    }
    async permissionsFor(cache, data) {
        const channel = this.client.util.hasPermissions(cache.channel, this.permissions);
        if (channel) {
            if (channel.isThread)
                cache.threadId = channel.channel.id;
            const webhook = await this.getWebhook(cache, channel.parent);
            if (webhook)
                return this.handleMessage(cache, webhook, data);
        }
    }
    updateWebhook(cache, webhook, channelId) {
        return this.collection.updateOne({ _id: cache._id }, { $set: { channelId, webhook: { id: webhook.id, token: webhook.token } } });
    }
    deleteWebhook(cache) {
        cache.webhook = null;
        cache.deleted = true;
        return this.collection.updateOne({ _id: cache._id }, { $set: { webhook: null } });
    }
    async updateMessageId(cache, msg) {
        if (msg && (cache.message !== msg.id || cache.channel !== msg.channel_id)) {
            await this.collection.updateOne({ _id: cache._id }, {
                $set: {
                    retries: 0,
                    messageId: msg.id,
                    channelId: msg.channel_id,
                    lastPostedAt: new Date()
                }
            });
        }
        if (msg) {
            cache.message = msg.id;
            cache.channel = msg.channel_id;
        }
        if (!msg) {
            await this.collection.updateOne({ _id: cache._id }, { $inc: { retries: 1 } });
        }
        return msg;
    }
    async sendMessage(cache, webhook, payload) {
        try {
            return await webhook.send(payload);
        }
        catch (error) {
            if ([DiscordErrorCodes.UNKNOWN_CHANNEL, DiscordErrorCodes.UNKNOWN_WEBHOOK].includes(error.code)) {
                await this.deleteWebhook(cache);
            }
            throw error;
        }
    }
    async editMessage(cache, webhook, payload) {
        if (!cache.message)
            return this.sendMessage(cache, webhook, payload);
        try {
            return await webhook.editMessage(cache.message, payload);
        }
        catch (error) {
            if (error.code === DiscordErrorCodes.UNKNOWN_MESSAGE) {
                delete cache.message;
                return this.sendMessage(cache, webhook, payload);
            }
            if ([DiscordErrorCodes.UNKNOWN_CHANNEL, DiscordErrorCodes.UNKNOWN_WEBHOOK].includes(error.code)) {
                await this.deleteWebhook(cache);
            }
            throw error;
        }
    }
    async getWebhook(cache, channel) {
        if (cache.webhook)
            return cache.webhook;
        if (cache.retries && cache.deleted && cache.retries > WEBHOOK_RETRY_THRESHOLD)
            return null;
        const webhook = await this.client.storage.getWebhook(channel).catch(() => null);
        if (webhook) {
            cache.webhook = new WebhookClient({ id: webhook.id, token: webhook.token });
            await this.updateWebhook(cache, cache.webhook, cache.channel);
            return cache.webhook;
        }
        cache.webhook = null;
        cache.deleted = true;
        cache.retries = (cache.retries || 0) + 1;
        return null;
    }
    delete(_id) {
        return this.cached.delete(_id);
    }
}
//# sourceMappingURL=root-log.js.map