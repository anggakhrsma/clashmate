import { CLAN_GAMES_STARTING_DATE } from '../util/constants.js';
import { ClanLogType } from '../entities/index.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SnowflakeUtil, WebhookClient } from 'discord.js';
import moment from 'moment';
import { clanGamesEmbedMaker } from '../helper/clan-games.helper.js';
import { EMOJIS } from '../util/emojis.js';
import { RootLog } from './root-log.js';
export class ClanGamesLog extends RootLog {
    constructor(enqueuer) {
        super(enqueuer.client);
        Object.defineProperty(this, "enqueuer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: enqueuer
        });
        Object.defineProperty(this, "refreshRate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "intervalId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.client = enqueuer.client;
        this.refreshRate = 30 * 60 * 1000;
    }
    get collection() {
        return this.client.db.collection("ClanLogs" /* Collections.CLAN_LOGS */);
    }
    get permissions() {
        return ['ReadMessageHistory', 'SendMessages', 'EmbedLinks', 'UseExternalEmojis', 'ViewChannel'];
    }
    async handleMessage(cache, webhook, data) {
        if (cache.message && new Date().getDate() === CLAN_GAMES_STARTING_DATE) {
            const messageDate = moment(Number(SnowflakeUtil.deconstruct(cache.message).timestamp)).startOf('month');
            const currentDate = moment().startOf('month');
            if (moment(messageDate).isBefore(moment(currentDate), 'month')) {
                delete cache.message;
            }
        }
        const embed = this.embed(cache, data);
        if (!cache.message) {
            const msg = await this.send(cache, webhook, {
                embeds: [embed],
                threadId: cache.threadId,
                components: [this._components(cache.tag)]
            });
            return this.updateMessageId(cache, msg);
        }
        const msg = await this.edit(cache, webhook, {
            embeds: [embed],
            threadId: cache.threadId,
            components: [this._components(cache.tag)]
        });
        return this.updateMessageId(cache, msg);
    }
    _components(tag) {
        const row = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId(JSON.stringify({ cmd: 'clan-games', max: false, tag, season: this.seasonId }))
            .setEmoji(EMOJIS.REFRESH)
            .setStyle(ButtonStyle.Secondary))
            .addComponents(new ButtonBuilder()
            .setCustomId(JSON.stringify({
            cmd: 'clan-games',
            max: true,
            filter: false,
            tag,
            season: this.seasonId
        }))
            .setLabel('Maximum Points')
            .setStyle(ButtonStyle.Primary));
        return row;
    }
    get seasonId() {
        const now = new Date();
        return now.toISOString().slice(0, 7);
    }
    async send(cache, webhook, payload) {
        try {
            return await super.sendMessage(cache, webhook, payload);
        }
        catch (error) {
            this.client.logger.error(`${error.toString()} {${cache._id.toString()}}`, {
                label: ClanGamesLog.name
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
                label: ClanGamesLog.name
            });
            return null;
        }
    }
    embed(cache, { clan, ...data }) {
        return clanGamesEmbedMaker(clan, {
            members: data.members,
            seasonId: this.seasonId,
            color: cache.color
        });
    }
    didStart() {
        const startTime = new Date();
        startTime.setDate(CLAN_GAMES_STARTING_DATE);
        startTime.setHours(6, 0, 0, 0);
        const endTime = new Date();
        endTime.setDate(CLAN_GAMES_STARTING_DATE + 6);
        endTime.setHours(10, 0, 0, 0);
        return new Date() >= startTime && new Date() <= endTime;
    }
    async init() {
        if (this.didStart()) {
            this._flush();
            return this._init();
        }
        clearInterval(this.intervalId);
        this.intervalId = setInterval(async () => {
            if (this.didStart()) {
                this._flush();
                await this._init();
                clearInterval(this.intervalId);
            }
        }, 5 * 60 * 1000).unref();
    }
    async flush(intervalId) {
        if (this.didStart())
            return null;
        await this.init();
        clearInterval(intervalId);
        return this.cached.clear();
    }
    _flush() {
        const intervalId = setInterval(() => {
            this.flush(intervalId);
        }, 5 * 60 * 1000);
        return intervalId.unref();
    }
    async _init() {
        const guildIds = this.client.guilds.cache.map((guild) => guild.id);
        for await (const data of this.collection.find({
            guildId: { $in: guildIds },
            logType: ClanLogType.CLAN_GAMES_EMBED_LOG,
            isEnabled: true
        })) {
            this.setCache(data);
        }
    }
    async add(guildId) {
        for await (const data of this.collection.find({
            guildId,
            logType: ClanLogType.CLAN_GAMES_EMBED_LOG,
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
            color: data.color,
            deepLink: data.deepLink,
            logType: data.logType,
            retries: 0,
            webhook: data.webhook?.id ? new WebhookClient(data.webhook) : null
        });
    }
}
//# sourceMappingURL=clan-games-log.js.map