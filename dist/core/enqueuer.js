import { Collection } from 'discord.js';
import { inspect } from 'node:util';
import { Queue } from '../struct/queue.js';
import { AutoBoardLog } from './auto-board-log.js';
import { CapitalLog } from './capital-log.js';
import { ClanEmbedLog } from './clan-embed-log.js';
import { ClanGamesLog } from './clan-games-log.js';
import { ClanLog } from './clan-log.js';
import { ClanWarLog } from './clan-war-log.js';
import { DonationLog } from './donation-log.js';
import { FlagAlertLog } from './flag-alert-log.js';
import { LastSeenLog } from './last-seen-log.js';
import { LegendLog } from './legend-log.js';
import { MaintenanceLog } from './maintenance-log.js';
import { RankedBattleLog } from './ranked-battle-log.js';
/**
 * Enqueuer — single-process edition.
 *
 * The original clashperk used Redis pub/sub so a separate upstream worker could
 * push clan-update events to all bot shards. In clashmate we run as one process,
 * so we use the clashofclans.js EventManager to poll the CoC API directly and
 * dispatch events in-process via a simple async queue.
 */
export class Enqueuer {
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
            value: new Collection()
        });
        Object.defineProperty(this, "paused", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: Boolean(false)
        });
        Object.defineProperty(this, "queue", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Queue()
        });
        Object.defineProperty(this, "flagAlertLog", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new FlagAlertLog(this)
        });
        Object.defineProperty(this, "autoBoardLog", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new AutoBoardLog(this)
        });
        Object.defineProperty(this, "maintenanceLog", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new MaintenanceLog(this)
        });
        Object.defineProperty(this, "capitalLog", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new CapitalLog(this)
        });
        Object.defineProperty(this, "clanEmbedLog", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new ClanEmbedLog(this)
        });
        Object.defineProperty(this, "clanGamesLog", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new ClanGamesLog(this)
        });
        Object.defineProperty(this, "clanLog", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new ClanLog(this)
        });
        Object.defineProperty(this, "clanWarLog", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new ClanWarLog(this)
        });
        Object.defineProperty(this, "donationLog", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new DonationLog(this)
        });
        Object.defineProperty(this, "lastSeenLog", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new LastSeenLog(this)
        });
        Object.defineProperty(this, "legendLog", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new LegendLog(this)
        });
        Object.defineProperty(this, "rankedBattleLog", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new RankedBattleLog(this)
        });
        this.maintenanceLog.init();
        this.paused = Boolean(false);
    }
    pause(forced = false, ms = 5 * 60 * 1000) {
        if (this.paused)
            return this.paused;
        this.paused = Boolean(true);
        if (forced)
            setTimeout(() => (this.paused = Boolean(false)), ms);
        return this.paused;
    }
    /** Dispatch a clan-update event received from the CoC EventManager. */
    async dispatch(data) {
        const clanTag = (data.tag ?? data.clanTag);
        if (this.paused || !this.cached.has(clanTag))
            return;
        if (this.queue.remaining >= 2000) {
            this.client.logger.warn(`Queue is full (${this.queue.remaining}), skipping log processing...`, { label: 'Enqueuer' });
            return;
        }
        await this.queue.wait();
        try {
            switch (data.op) {
                case 2 /* Flags.CLAN_FEED_LOG */:
                    await Promise.all([
                        this.flagAlertLog.exec(clanTag, data),
                        this.clanLog.exec(clanTag, data)
                    ]);
                    this.client.rolesManager.exec(clanTag, data);
                    break;
                case 16 /* Flags.CLAN_GAMES_LOG */:
                    await this.clanGamesLog.exec(clanTag, data);
                    break;
                case 8192 /* Flags.CLAN_EVENT_LOG */:
                case 512 /* Flags.TOWN_HALL_LOG */:
                case 1024 /* Flags.PLAYER_FEED_LOG */:
                    await this.clanLog.exec(clanTag, data);
                    break;
                case 32 /* Flags.CLAN_WAR_LOG */:
                    await this.clanWarLog.exec(data.clan.tag, data);
                    this.client.rolesManager.exec(clanTag, data);
                    break;
                case 16384 /* Flags.DONATION_LOG_V2 */:
                    await this.clanLog.exec(data.clan.tag, data);
                    break;
                case 4096 /* Flags.CAPITAL_LOG */:
                    await this.clanLog.exec(clanTag, data);
                    break;
                default:
                    break;
            }
        }
        catch (error) {
            console.error(inspect(error, { depth: Infinity }));
        }
        finally {
            this.queue.shift();
        }
    }
    async _loadClans(tag) {
        const result = await this.client.db
            .collection("ClanStores" /* Collections.CLAN_STORES */)
            .aggregate([
            {
                $match: {
                    guild: { $in: this.client.guilds.cache.map((guild) => guild.id) },
                    paused: false,
                    ...(tag ? { tag } : {})
                }
            },
            {
                $group: {
                    _id: '$tag',
                    clans: {
                        $push: { _id: { $toString: '$_id' }, tag: '$tag', guild: '$guild' }
                    }
                }
            }
        ])
            .toArray();
        for (const { _id, clans } of result)
            this.cached.set(_id, clans);
    }
    async init() {
        if (this.maintenanceLog.inMaintenance)
            return;
        await this._loadClans();
        await this.capitalLog.init();
        await this.clanEmbedLog.init();
        await this.clanGamesLog.init();
        await this.clanWarLog.init();
        await this.donationLog.init();
        await this.lastSeenLog.init();
        await this.rankedBattleLog.init();
        await this.clanLog.init();
        await this.legendLog.init();
        await this.autoBoardLog.init();
        await this.flagAlertLog.init();
    }
    async add(data) {
        if (!this.client.guilds.cache.has(data.guild))
            return;
        const [result] = await this.client.db
            .collection("ClanStores" /* Collections.CLAN_STORES */)
            .aggregate([
            { $match: { tag: data.tag, paused: false } },
            {
                $group: {
                    _id: '$tag',
                    uniqueId: { $max: '$uniqueId' },
                    lastRan: { $max: '$lastRan' }
                }
            },
            { $set: { tag: '$_id' } },
            { $unset: '_id' }
        ])
            .toArray();
        await this.addLog(data.guild);
        if (result) {
            await this._loadClans(data.tag);
        }
        else {
            this.cached.delete(data.tag);
        }
    }
    async delete(data) {
        const clans = await this.client.db
            .collection("ClanStores" /* Collections.CLAN_STORES */)
            .find({ tag: data.tag, paused: false, guild: { $ne: data.guild } }, { projection: { _id: 1 } })
            .toArray();
        const logs = await this.client.db
            .collection("ClanLogs" /* Collections.CLAN_LOGS */)
            .find({ guildId: data.guild, clanTag: data.tag })
            .toArray();
        for (const log of logs)
            this.deleteLog(log._id.toHexString());
        if (!clans.length) {
            this.cached.delete(data.tag);
        }
        else {
            await this._loadClans(data.tag);
        }
    }
    deleteLog(logId) {
        this.capitalLog.delete(logId);
        this.clanEmbedLog.delete(logId);
        this.clanGamesLog.delete(logId);
        this.clanLog.delete(logId);
        this.clanWarLog.delete(logId);
        this.donationLog.delete(logId);
        this.lastSeenLog.delete(logId);
        this.legendLog.delete(logId);
        this.rankedBattleLog.delete(logId);
    }
    async addLog(guildId) {
        await Promise.all([
            this.capitalLog.add(guildId),
            this.clanEmbedLog.add(guildId),
            this.clanGamesLog.add(guildId),
            this.clanLog.add(guildId),
            this.clanWarLog.add(guildId),
            this.donationLog.add(guildId),
            this.lastSeenLog.add(guildId),
            this.legendLog.add(guildId),
            this.rankedBattleLog.add(guildId)
        ]);
    }
    async addAutoBoard(id) {
        return this.autoBoardLog.add(id);
    }
    async delAutoBoard(id) {
        return this.autoBoardLog.del(id);
    }
    async flush() {
        this.autoBoardLog.cached.clear();
        this.flagAlertLog.cached.clear();
        this.capitalLog.cached.clear();
        this.clanEmbedLog.cached.clear();
        this.clanGamesLog.cached.clear();
        this.clanLog.cached.clear();
        this.clanWarLog.cached.clear();
        this.donationLog.cached.clear();
        this.lastSeenLog.cached.clear();
        this.legendLog.cached.clear();
        this.rankedBattleLog.cached.clear();
    }
}
//# sourceMappingURL=enqueuer.js.map