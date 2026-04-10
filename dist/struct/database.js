import { LEGEND_LEAGUE_ID } from '../util/constants.js';
import { MongoClient } from 'mongodb';
function getDbNameFromMongoUrl(url) {
    const match = url.match(/^[a-z]+(?:\+srv)?:\/\/[^/]+\/([^?]+)/i);
    return match?.[1] || 'clashmate-old';
}
class MongoDbClient extends MongoClient {
    constructor() {
        super(process.env.MONGODB_URL);
        Object.defineProperty(this, "dbName", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: getDbNameFromMongoUrl(process.env.MONGODB_URL)
        });
        this.on('open', () => this.createIndex(this.db(this.dbName)));
    }
    async connect() {
        return super.connect();
    }
    async createIndex(db) {
        return Promise.all([
            db.collection("BotGrowth" /* Collections.BOT_GROWTH */).createIndex({ key: 1 }, { unique: true }),
            db.collection("BotGuilds" /* Collections.BOT_GUILDS */).createIndexes([
                {
                    key: { guild: 1 },
                    unique: true
                },
                {
                    key: { usage: 1 }
                }
            ]),
            db.collection("Layouts" /* Collections.LAYOUTS */).createIndexes([
                {
                    key: { layoutId: 1 }
                },
                {
                    key: { guildId: 1 }
                },
                {
                    key: { messageIds: 1 }
                }
            ]),
            db
                .collection("BotInteractions" /* Collections.BOT_INTERACTIONS */)
                .createIndex({ user: 1, guild: 1 }, { unique: true }),
            db.collection("BotStats" /* Collections.BOT_STATS */).createIndex({ name: 1 }, { unique: true }),
            db.collection("BotUsage" /* Collections.BOT_USAGE */).createIndexes([
                {
                    key: { key: 1 },
                    unique: true
                }
            ]),
            db.collection("BotUsers" /* Collections.BOT_USERS */).createIndex({ user: 1 }, { unique: true }),
            db.collection("GuildEvents" /* Collections.GUILD_EVENTS */).createIndexes([
                {
                    key: { guildId: 1 }
                }
            ]),
            db.collection("CustomBots" /* Collections.CUSTOM_BOTS */).createIndexes([
                {
                    key: { serviceId: 1 },
                    unique: true
                }
            ]),
            db.collection("LegendAttacks" /* Collections.LEGEND_ATTACKS */).createIndexes([
                {
                    key: { tag: 1, seasonId: 1 },
                    unique: true
                },
                {
                    key: { seasonId: 1 }
                }
            ]),
            db.collection("CWLGroups" /* Collections.CWL_GROUPS */).createIndexes([
                {
                    key: { 'clans.tag': 1, 'season': 1 }
                },
                {
                    key: { uid: 1 },
                    unique: true
                },
                {
                    key: { id: 1 }
                },
                {
                    key: { createdAt: 1 }
                }
            ]),
            db.collection("ClanGames" /* Collections.CLAN_GAMES */).createIndexes([
                {
                    key: { tag: 1, season: 1 },
                    unique: true
                },
                {
                    key: { tag: 1 }
                }
            ]),
            db.collection("GoogleSheets" /* Collections.GOOGLE_SHEETS */).createIndexes([
                {
                    key: { hash: 1 },
                    unique: true
                }
            ]),
            db.collection("PlayerRanks" /* Collections.PLAYER_RANKS */).createIndexes([
                {
                    key: { countryCode: 1, season: 1 },
                    unique: true
                },
                {
                    key: { 'players.tag': 1 }
                }
            ]),
            db.collection("ClanCategories" /* Collections.CLAN_CATEGORIES */).createIndex({ guildId: 1 }),
            db.collection("ClanRanks" /* Collections.CLAN_RANKS */).createIndexes([
                {
                    key: { countryCode: 1, season: 1 },
                    unique: true
                },
                {
                    key: { 'clans.tag': 1 }
                }
            ]),
            db.collection("CapitalRanks" /* Collections.CAPITAL_RANKS */).createIndexes([
                {
                    key: { countryCode: 1, season: 1 },
                    unique: true
                },
                {
                    key: { 'clans.tag': 1 }
                }
            ]),
            db.collection("PlayerSeasons" /* Collections.PLAYER_SEASONS */).createIndexes([
                {
                    key: { tag: 1, season: 1 },
                    unique: true
                },
                {
                    key: { __clans: 1, season: 1 }
                },
                {
                    key: { createdAt: 1 },
                    expireAfterSeconds: 60 * 60 * 24 * 30 * 36 // 36 months
                }
            ]),
            db.collection("ClanGamesPoints" /* Collections.CLAN_GAMES_POINTS */).createIndexes([
                {
                    key: { tag: 1, season: 1 },
                    unique: true
                },
                {
                    key: { __clans: 1, season: 1 }
                }
            ]),
            db.collection("WarBaseCalls" /* Collections.WAR_BASE_CALLS */).createIndexes([
                {
                    key: { warId: 1, guild: 1 },
                    unique: true
                }
            ]),
            db.collection("CapitalContributions" /* Collections.CAPITAL_CONTRIBUTIONS */).createIndexes([
                {
                    key: { tag: 1, season: 1 }
                },
                {
                    key: { 'clan.tag': 1 }
                },
                {
                    key: { createdAt: 1 },
                    expireAfterSeconds: 60 * 60 * 24 * 30 * 24 // 24 months
                }
            ]),
            db.collection("CapitalRaidSeasons" /* Collections.CAPITAL_RAID_SEASONS */).createIndexes([
                {
                    key: { tag: 1, weekId: 1 },
                    unique: true
                },
                {
                    key: { tag: 1 }
                },
                {
                    key: { 'members.tag': 1 }
                }
            ]),
            db.collection("AutoRoleDelays" /* Collections.AUTO_ROLE_DELAYS */).createIndexes([
                {
                    key: { guildId: 1, userId: 1 },
                    unique: true
                },
                {
                    key: { guildId: 1 }
                },
                {
                    key: { updatedAt: 1 },
                    expireAfterSeconds: 60 * 60 * 24 * 10 // 10 days
                }
            ]),
            db.collection("ClanStores" /* Collections.CLAN_STORES */).createIndexes([
                {
                    key: { guild: 1, tag: 1 },
                    unique: true
                },
                {
                    key: { tag: 1 }
                }
            ]),
            db.collection("ClanLogs" /* Collections.CLAN_LOGS */).createIndexes([
                {
                    key: { guildId: 1, clanTag: 1, logType: 1 },
                    unique: true
                }
            ]),
            db.collection("AutoBoardLogs" /* Collections.AUTO_BOARDS */).createIndexes([
                {
                    key: { guildId: 1, boardType: 1 },
                    unique: true
                }
            ]),
            db.collection("FlagAlertLogs" /* Collections.FLAG_ALERT_LOGS */).createIndexes([
                {
                    key: { guildId: 1 },
                    unique: true
                }
            ]),
            db.collection("ClanWars" /* Collections.CLAN_WARS */).createIndexes([
                {
                    key: { uid: 1 },
                    unique: true
                },
                {
                    key: { id: 1 }
                },
                {
                    key: { 'clan.tag': 1 }
                },
                {
                    key: { 'opponent.tag': 1 }
                },
                {
                    key: { 'clan.members.tag': 1 }
                },
                {
                    key: { 'opponent.members.tag': 1 }
                },
                {
                    key: { leagueGroupId: 1 },
                    sparse: true
                },
                {
                    key: { warTag: 1 },
                    sparse: true
                },
                {
                    key: { endTime: 1 },
                    expireAfterSeconds: 60 * 60 * 24 * 30 * 36 // 36 months
                }
            ]),
            db.collection("Flags" /* Collections.FLAGS */).createIndex({ guild: 1, tag: 1 }),
            db.collection("Players" /* Collections.PLAYERS */).createIndexes([
                {
                    key: { 'clan.tag': 1 }
                },
                {
                    key: { tag: 1 },
                    unique: true
                },
                {
                    key: { lastSeen: 1 },
                    expireAfterSeconds: 60 * 60 * 24 * 30 * 6, // 6 months
                    partialFilterExpression: { leagueId: { $lt: LEGEND_LEAGUE_ID } }
                }
            ]),
            db.collection("Users" /* Collections.USERS */).createIndexes([
                {
                    key: { userId: 1 },
                    unique: true
                }
            ]),
            db.collection("PlayerLinks" /* Collections.PLAYER_LINKS */).createIndexes([
                {
                    key: { name: 'text' }
                },
                {
                    key: { tag: 1 },
                    unique: true
                },
                {
                    key: { userId: 1 }
                }
            ]),
            db.collection("Rosters" /* Collections.ROSTERS */).createIndexes([
                {
                    key: { name: 'text' }
                },
                {
                    key: { guildId: 1 }
                }
            ]),
            db.collection("RosterCategories" /* Collections.ROSTER_CATEGORIES */).createIndexes([
                {
                    key: { name: 'text' }
                },
                {
                    key: { guildId: 1 }
                }
            ]),
            db.collection("Patrons" /* Collections.PATREON_MEMBERS */).createIndex({ id: 1 }, { unique: true }),
            db.collection("Settings" /* Collections.SETTINGS */).createIndex({ guildId: 1 }, { unique: true }),
            db.collection("Reminders" /* Collections.WAR_REMINDERS */).createIndexes([
                {
                    key: { guild: 1 }
                },
                {
                    key: { clans: 1 }
                }
            ]),
            db.collection("RaidReminders" /* Collections.RAID_REMINDERS */).createIndexes([
                {
                    key: { guild: 1 }
                },
                {
                    key: { clans: 1 }
                }
            ]),
            db.collection("ClanGamesReminders" /* Collections.CLAN_GAMES_REMINDERS */).createIndexes([
                {
                    key: { guild: 1 }
                },
                {
                    key: { clans: 1 }
                }
            ]),
            db.collection("Schedulers" /* Collections.WAR_SCHEDULERS */).createIndexes([
                {
                    key: { tag: 1 }
                },
                {
                    key: { guild: 1 }
                },
                {
                    key: { reminderId: 1 }
                },
                {
                    key: { timestamp: 1 },
                    expireAfterSeconds: 60 * 60 * 24 * 3 // 3 days
                }
            ]),
            db.collection("RaidSchedulers" /* Collections.RAID_SCHEDULERS */).createIndexes([
                {
                    key: { tag: 1 }
                },
                {
                    key: { guild: 1 }
                },
                {
                    key: { reminderId: 1 }
                },
                {
                    key: { timestamp: 1 },
                    expireAfterSeconds: 60 * 60 * 24 * 3 // 3 days
                }
            ]),
            db.collection("ClanGamesSchedulers" /* Collections.CLAN_GAMES_SCHEDULERS */).createIndexes([
                {
                    key: { tag: 1 }
                },
                {
                    key: { guild: 1 }
                },
                {
                    key: { reminderId: 1 }
                },
                {
                    key: { timestamp: 1 },
                    expireAfterSeconds: 60 * 60 * 24 * 3 // 3 days
                }
            ]),
            db.collection("PollerEvents" /* Collections.POLLER_EVENTS */).createIndexes([
                {
                    key: { createdAt: 1 },
                    expireAfterSeconds: 60 * 60 * 24 // 24 hours
                }
            ])
        ]);
    }
}
export const mongoClient = new MongoDbClient();
//# sourceMappingURL=database.js.map