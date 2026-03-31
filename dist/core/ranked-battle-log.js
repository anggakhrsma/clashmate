import { COLOR_CODES, UNRANKED_TIER_ID } from '../util/constants.js';
import { ClanLogType } from '../entities/index.js';
import { EmbedBuilder, WebhookClient } from 'discord.js';
import moment from 'moment';
import { cluster, title } from 'radash';
import { PLAYER_LEAGUE_TIERS } from '../util/emojis.js';
import { padStart } from '../util/helper.js';
import { Util } from '../util/toolkit.js';
import { RootLog } from './root-log.js';
export class RankedBattleLog extends RootLog {
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
        Object.defineProperty(this, "lastPostedAt", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        this.client = enqueuer.client;
        this.refreshRate = 10 * 60 * 1000;
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
        const embeds = await this.getEmbeds(cache);
        if (!embeds?.length)
            return null;
        for (const chunk of cluster(embeds, 10)) {
            await this.send(cache, webhook, {
                embeds: chunk,
                threadId: cache.threadId
            });
            await Util.delay(250);
        }
        await this.collection.updateOne({ _id: cache._id }, { $set: { lastPostedAt: this.lastPostedAt || new Date() } });
    }
    async send(cache, webhook, payload) {
        try {
            return await super.sendMessage(cache, webhook, payload);
        }
        catch (error) {
            this.client.logger.error(`${error.toString()} {${cache._id.toString()}}`, {
                label: RankedBattleLog.name
            });
            return null;
        }
    }
    async getEmbeds(cache) {
        const { body: clan } = await this.client.coc.getClan(cache.tag);
        if (!clan)
            return null;
        const { startTime, id: weekId, endTime } = Util.getTournamentWindow(moment().startOf('week').toDate());
        const rows = { data: [] }; // ClickHouse removed
        const result = rows.data.reduce((record, row) => {
            record[row.tag] = row;
            return record;
        }, {});
        const players = clan.memberList
            .filter((player) => result[player.tag])
            .map((player) => {
            const leagueId = player.leagueTier?.id || UNRANKED_TIER_ID;
            const league = player.leagueTier?.name || 'Unranked';
            const trophies = result[player.tag].trophies;
            const status = leagueId > result[player.tag].leagueId
                ? `PROMOTED`
                : result[player.tag].leagueId === leagueId
                    ? `STAYED`
                    : `DEMOTED`;
            return {
                player,
                league,
                trophies,
                status
            };
        });
        const playerGroups = players.reduce((record, item) => {
            record[item.status] = record[item.status] || [];
            record[item.status].push(item);
            return record;
        }, {});
        const priority = { PROMOTED: 1, STAYED: 2, DEMOTED: 3 };
        const embeds = Object.entries(playerGroups)
            .sort(([a], [b]) => priority[a] - priority[b])
            .map(([status, players], index, items) => {
            const color = status === 'PROMOTED'
                ? COLOR_CODES.GREEN
                : status === 'STAYED'
                    ? COLOR_CODES.PEACH
                    : COLOR_CODES.RED;
            const embed = new EmbedBuilder()
                .setAuthor({ name: `${clan.name} (${clan.tag})`, iconURL: clan.badgeUrls.small })
                .setTitle(`${title(status.toLowerCase())} (${players.length})`)
                .setDescription(players
                .map((player) => `${PLAYER_LEAGUE_TIERS[player.league]} \`${padStart(player.trophies, 4)}\` \u200e${player.player.name}`)
                .join('\n'))
                .setColor(color);
            if (index === items.length - 1) {
                embed.setTimestamp().setFooter({
                    text: `${moment(startTime).format('DD MMM YYYY')} - ${moment(endTime).format('DD MMM YYYY')}`
                });
            }
            return embed;
        });
        return embeds;
    }
    async _refresh() {
        if (this.timeout)
            clearTimeout(this.timeout);
        try {
            const { startTime } = Util.getTournamentWindow();
            const timestamp = moment(startTime).add(3, 'hours').toDate();
            if (timestamp.getTime() > Date.now())
                return;
            this.lastPostedAt = timestamp;
            const guildIds = this.client.guilds.cache.map((guild) => guild.id);
            const cursor = this.collection.aggregate([
                {
                    $match: {
                        guildId: { $in: guildIds },
                        logType: ClanLogType.RANKED_BATTLE_LEAGUE_CHANGE_LOG,
                        lastPostedAt: { $lt: timestamp }
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
                    logType: ClanLogType.RANKED_BATTLE_LEAGUE_CHANGE_LOG,
                    channel: log.channelId
                });
                this.queued.delete(logId);
                await Util.delay(3000);
            }
        }
        finally {
            this.timeout = setTimeout(this._refresh.bind(this), this.refreshRate);
        }
    }
    async init() {
        const guildIds = this.client.guilds.cache.map((guild) => guild.id);
        for await (const data of this.collection.find({
            guildId: { $in: guildIds },
            logType: ClanLogType.RANKED_BATTLE_LEAGUE_CHANGE_LOG,
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
            logType: ClanLogType.RANKED_BATTLE_LEAGUE_CHANGE_LOG,
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
            webhook: data.webhook?.id ? new WebhookClient(data.webhook) : null
        });
    }
}
//# sourceMappingURL=ranked-battle-log.js.map