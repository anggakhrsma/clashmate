import { FeatureFlags, Settings } from '@app/constants';
import {
  BaseInteraction,
  Client as DiscordClient,
  GatewayIntentBits,
  Message,
  Options,
  User
} from 'discord.js';
import { Db } from 'mongodb';
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

export class Client extends DiscordClient<true> {
  public commandHandler = new CommandHandler(this, {
    directory: fileURLToPath(new URL('../commands', import.meta.url))
  });

  public listenerHandler = new ListenerHandler(this, {
    directory: fileURLToPath(new URL('../listeners', import.meta.url))
  });

  public inhibitorHandler = new InhibitorHandler(this, {
    directory: fileURLToPath(new URL('../inhibitors', import.meta.url))
  });

  public logger: Logger;
  public db!: Db;
  public util: ClientUtil;
  public settings!: SettingsProvider;
  public coc: ClashClient;
  public stats!: StatsHandler;
  public storage!: StorageHandler;
  public clanWarScheduler!: ClanWarScheduler;
  public capitalRaidScheduler!: CapitalRaidScheduler;
  public clanGamesScheduler!: ClanGamesScheduler;
  public guildEvents!: GuildEventsHandler;
  public inMaintenance = Boolean(false);
  public enqueuer!: Enqueuer;
  public poller!: ClanPoller;
  public components = new Map<string, string[]>();
  public _componentPayloads = new Map<string, Record<string, unknown>>();
  public resolver!: Resolver;
  public ownerId: string;
  public rosterManager!: RosterManager;
  public autocomplete!: Autocomplete;
  public cacheOverLimitGuilds = new Set<string>();
  public rolesManager = new RolesManager(this);
  public commands!: CommandsMap;

  public constructor() {
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
          filter: () => (member) =>
            member.id !== this.user.id && !this.cacheOverLimitGuilds.has(member.guild.id)
        },
        users: {
          interval: 5 * 60,
          filter: () => (user) => user.id !== this.user.id
        }
      }
    });

    this.logger = new Logger(this);
    this.util = new ClientUtil(this);
    this.coc = new ClashClient(this);
    this.ownerId = process.env.OWNER!;
    container.register(Client, { useValue: this });
  }

  public get applicationId() {
    return this.user.id!;
  }

  public isFeatureEnabled(flag: FeatureFlags, distinctId: string | 'global') {
    return this.settings.isFeatureEnabled(flag, distinctId);
  }

  public isOwner(user: string | User) {
    const userId = this.users.resolveId(user);
    return userId === process.env.OWNER!;
  }

  /** Patreon gating removed — always returns false (all features free). */
  public isPatron(_guildId?: string): false {
    return false;
  }

  public embed(guildRef: Message | string | BaseInteraction | null) {
    const guildId = typeof guildRef === 'string' ? guildRef : guildRef ? guildRef.guild : null;
    if (!guildId) return null;
    return this.settings.get<number>(guildId, Settings.COLOR, null);
  }

  public uuid(...userIds: string[]) {
    const uniqueId = nanoid();
    this.components.set(uniqueId, userIds);
    return uniqueId;
  }

  private async enqueue() {
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

  public async init(token: string) {
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
