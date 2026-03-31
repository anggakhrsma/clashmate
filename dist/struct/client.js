import { Client as DiscordClient, GatewayIntentBits, Options } from 'discord.js';
import { nanoid } from 'nanoid';
import { URL, fileURLToPath } from 'node:url';
import { container } from 'tsyringe';
import { Enqueuer } from '../core/enqueuer.js';
import { RolesManager } from '../core/roles-manager.js';
import { CommandHandler, InhibitorHandler, ListenerHandler } from '../lib/handlers.js';
import { ClientUtil } from '../util/client.util.js';
import { Logger } from '../util/logger.js';
import { Autocomplete } from './autocomplete-client.js';
import { CapitalRaidScheduler } from './capital-raid-scheduler.js';
import { ClanGamesScheduler } from './clan-games-scheduler.js';
import { ClanPoller } from './clan-poller.js';
import { ClanWarScheduler } from './clan-war-scheduler.js';
import { ClashClient } from './clash-client.js';
import { CommandsMap } from './commands-map.js';
import { mongoClient } from './database.js';
import { GuildEventsHandler } from './guild-events-handler.js';
import { Resolver } from './resolver.js';
import { RosterManager } from './roster-manager.js';
import { SettingsProvider } from './settings-provider.js';
import { StatsHandler } from './stats-handler.js';
import { StorageHandler } from './storage-handler.js';
export class Client extends DiscordClient {
    constructor() {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildWebhooks,
                GatewayIntentBits.GuildMessages
            ],
            makeCache: Options.cacheWithLimits({
                ...Options.DefaultMakeCacheSettings,
                PresenceManager: 0,
                VoiceStateManager: 0,
                GuildBanManager: 0,
                GuildInviteManager: 0,
                GuildScheduledEventManager: 0,
                GuildStickerManager: 0,
                StageInstanceManager: 0,
                ReactionUserManager: 0,
                ReactionManager: 0,
                BaseGuildEmojiManager: 0,
                GuildEmojiManager: 0,
                ApplicationCommandManager: 0,
                ThreadMemberManager: 0,
                ApplicationEmojiManager: 0,
                EntitlementManager: 0,
                GuildForumThreadManager: 0,
                GuildTextThreadManager: 0,
                ThreadManager: 0,
                AutoModerationRuleManager: 0,
                DMMessageManager: 0,
                GuildMessageManager: 0,
                MessageManager: 0
            }),
            sweepers: {
                ...Options.DefaultSweeperSettings,
                messages: {
                    interval: 5 * 60,
                    lifetime: 10 * 60
                },
                guildMembers: {
                    interval: 5 * 60,
                    filter: () => (member) => member.id !== this.user.id && !this.cacheOverLimitGuilds.has(member.guild.id)
                },
                users: {
                    interval: 5 * 60,
                    filter: () => (user) => user.id !== this.user.id
                }
            }
        });
        Object.defineProperty(this, "commandHandler", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new CommandHandler(this, {
                directory: fileURLToPath(new URL('../commands', import.meta.url))
            })
        });
        Object.defineProperty(this, "listenerHandler", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new ListenerHandler(this, {
                directory: fileURLToPath(new URL('../listeners', import.meta.url))
            })
        });
        Object.defineProperty(this, "inhibitorHandler", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new InhibitorHandler(this, {
                directory: fileURLToPath(new URL('../inhibitors', import.meta.url))
            })
        });
        Object.defineProperty(this, "logger", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "db", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "util", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "settings", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "coc", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "stats", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "storage", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "clanWarScheduler", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "capitalRaidScheduler", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "clanGamesScheduler", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "guildEvents", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "inMaintenance", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: Boolean(false)
        });
        Object.defineProperty(this, "enqueuer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "poller", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "components", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "_componentPayloads", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "resolver", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "ownerId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "rosterManager", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "autocomplete", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "cacheOverLimitGuilds", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Set()
        });
        Object.defineProperty(this, "rolesManager", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new RolesManager(this)
        });
        Object.defineProperty(this, "commands", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.logger = new Logger(this);
        this.util = new ClientUtil(this);
        this.coc = new ClashClient(this);
        this.ownerId = process.env.OWNER;
        container.register(Client, { useValue: this });
    }
    get applicationId() {
        return this.user.id;
    }
    isFeatureEnabled(flag, distinctId) {
        return this.settings.isFeatureEnabled(flag, distinctId);
    }
    isOwner(user) {
        const userId = this.users.resolveId(user);
        return userId === process.env.OWNER;
    }
    /** Patreon gating removed — always returns false (all features free). */
    isPatron(_guildId) {
        return false;
    }
    embed(guildRef) {
        const guildId = typeof guildRef === 'string' ? guildRef : guildRef ? guildRef.guild : null;
        if (!guildId)
            return null;
        return this.settings.get(guildId, "color" /* Settings.COLOR */, null);
    }
    uuid(...userIds) {
        const uniqueId = nanoid();
        this.components.set(uniqueId, userIds);
        return uniqueId;
    }
    async enqueue() {
        await this.enqueuer.init();
        this.clanGamesScheduler.init();
        this.capitalRaidScheduler.init();
        this.clanWarScheduler.init();
        this.guildEvents.init();
        this.rosterManager.init();
        // Start the in-process clan poller — replaces the upstream Redis worker.
        // Waits 30 s before first tick so the bot is fully settled after startup.
        setTimeout(() => this.poller.start(), 30_000);
    }
    async init(token) {
        await this.commandHandler.register();
        await this.listenerHandler.register();
        await this.inhibitorHandler.register();
        await mongoClient
            .connect()
            .then(() => this.logger.info('Connected to MongoDB Atlas', { label: 'DATABASE' }));
        this.db = mongoClient.db(mongoClient.dbName);
        this.settings = new SettingsProvider(this);
        await this.settings.init({ globalOnly: true });
        this.storage = new StorageHandler(this);
        this.enqueuer = new Enqueuer(this);
        this.poller = new ClanPoller(this);
        this.stats = new StatsHandler(this);
        this.resolver = new Resolver(this);
        this.clanWarScheduler = new ClanWarScheduler(this);
        this.capitalRaidScheduler = new CapitalRaidScheduler(this);
        this.clanGamesScheduler = new ClanGamesScheduler(this);
        this.commands = new CommandsMap(this);
        this.guildEvents = new GuildEventsHandler(this);
        this.rosterManager = new RosterManager(this);
        this.autocomplete = new Autocomplete(this);
        await this.coc.autoLogin();
        this.once('clientReady', async () => {
            await this.settings.init({ globalOnly: false });
            if (process.env.NODE_ENV === 'production') {
                await this.enqueue();
            }
        });
        this.logger.info('Connecting to Discord Gateway', { label: 'DISCORD' });
        return this.login(token);
    }
}
//# sourceMappingURL=client.js.map