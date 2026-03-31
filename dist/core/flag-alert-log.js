import { UNRANKED_TIER_ID } from '../util/constants.js';
import { Collection, EmbedBuilder, WebhookClient, time } from 'discord.js';
import { ObjectId } from 'mongodb';
import { HOME_BASE_LEAGUES, TOWN_HALLS } from '../util/emojis.js';
import { Util } from '../util/toolkit.js';
export class FlagAlertLog {
    constructor(enqueuer) {
        Object.defineProperty(this, "enqueuer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: enqueuer
        });
        Object.defineProperty(this, "cached", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Collection()
        });
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.client = enqueuer.client;
    }
    get collection() {
        return this.client.db.collection("FlagAlertLogs" /* Collections.FLAG_ALERT_LOGS */);
    }
    get permissions() {
        return ['ReadMessageHistory', 'SendMessages', 'EmbedLinks', 'UseExternalEmojis', 'ViewChannel'];
    }
    async exec(tag, payload) {
        const members = payload.members.filter((mem) => mem.op === 'JOINED');
        if (!members.length)
            return null;
        const clans = this.enqueuer.cached.get(tag) ?? [];
        for (const clan of clans) {
            const cache = this.cached.get(clan.guild);
            // double posting prevention for custom bots
            if (cache?.guildId && this.client.settings.hasCustomBot(cache.guildId) && !false)
                continue;
            if (cache)
                await this.permissionsFor(cache, payload);
        }
    }
    async permissionsFor(cache, payload) {
        const channel = this.client.util.hasPermissions(cache.channelId, this.permissions);
        if (channel) {
            if (channel.isThread)
                cache.threadId = channel.channel.id;
            const webhook = await this.webhook(cache, channel.parent);
            if (webhook)
                return this.handleMessage(cache, webhook, payload);
        }
    }
    async handleMessage(cache, webhook, payload) {
        return this.send(cache, webhook, payload);
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
    async send(cache, webhook, data) {
        const members = data.members.filter((mem) => mem.op === 'JOINED');
        if (!members.length)
            return null;
        const delay = members.length >= 5 ? 2000 : 250;
        const messages = (await Promise.all(members.map((member) => this.embed(cache, data, member)))).filter((m) => m);
        for (const message of messages) {
            if (!message)
                continue;
            const msg = await this._send(cache, webhook, {
                embeds: [message.embed],
                content: message.content,
                threadId: cache.threadId
            });
            await this.updateMessageId(cache, msg);
            await Util.delay(delay);
        }
        return members.length;
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
    async embed(cache, data, member) {
        const guild = this.client.guilds.cache.get(cache.guildId);
        if (!guild)
            return null;
        let content = null;
        const embed = new EmbedBuilder().setColor(0xeb3508);
        const flag = await this.client.db.collection("Flags" /* Collections.FLAGS */).findOne({
            guild: cache.guildId,
            tag: member.tag,
            flagType: 'ban',
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
        }, { sort: { _id: -1 } });
        if (!flag)
            return null;
        const { body: player, res } = await this.client.coc.getPlayer(member.tag);
        if (!res.ok)
            return null;
        embed.setTitle(`\u200e${player.name} (${player.tag})`);
        embed.setFooter({ text: `Joined ${data.clan.name}`, iconURL: data.clan.badge });
        const user = await this.client.users.fetch(flag.user, { cache: false }).catch(() => null);
        if (cache.useAutoRole) {
            const clan = await this.client.storage.collection.findOne({
                guild: cache.guildId,
                tag: data.clan.tag
            });
            const roles = [clan?.roles?.coLeader, clan?.roles?.leader].filter((roleId) => roleId && guild.roles.cache.has(roleId));
            if (roles.length)
                content = `<@&${roles.join('> <@&')}>`;
        }
        else if (cache.roleId && guild.roles.cache.has(cache.roleId)) {
            content = `<@&${cache.roleId}>`;
        }
        embed.setDescription([
            `${TOWN_HALLS[player.townHallLevel]} **${player.townHallLevel}** ${HOME_BASE_LEAGUES[player.leagueTier?.id ?? UNRANKED_TIER_ID]} **${player.trophies}**`,
            '',
            '**Flag**',
            `${flag.reason}`,
            '',
            `${user ? user.displayName : 'Unknown'} (${time(flag.createdAt, 'f')})`
        ].join('\n'));
        return { embed, content };
    }
    async init() {
        for await (const data of this.collection.find({
            guildId: { $in: this.client.guilds.cache.map((guild) => guild.id) }
        })) {
            this.cached.set(data.guildId, {
                _id: data._id.toHexString(),
                guildId: data.guildId,
                roleId: data.roleId,
                useAutoRole: data.useAutoRole,
                channelId: data.channelId,
                updatedAt: data.updatedAt,
                webhook: data.webhook ? new WebhookClient(data.webhook) : null
            });
        }
    }
    async add(guildId) {
        const data = await this.collection.findOne({ guildId });
        if (!data)
            return null;
        this.cached.set(guildId, {
            _id: data._id.toHexString(),
            guildId: data.guildId,
            roleId: data.roleId,
            useAutoRole: data.useAutoRole,
            channelId: data.channelId,
            updatedAt: data.updatedAt,
            webhook: data.webhook ? new WebhookClient(data.webhook) : null
        });
    }
    del(guildId) {
        return this.cached.delete(guildId);
    }
}
//# sourceMappingURL=flag-alert-log.js.map