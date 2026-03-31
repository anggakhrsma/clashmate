import { Collections, Flags } from '@app/constants';
import { Collection } from 'discord.js';
import { inspect } from 'node:util';
import { Client } from '../struct/client.js';
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
  public cached = new Collection<string, Cached[]>();

  private paused = Boolean(false);
  private queue = new Queue();

  public flagAlertLog = new FlagAlertLog(this);

  private autoBoardLog = new AutoBoardLog(this);
  private maintenanceLog = new MaintenanceLog(this);
  private capitalLog = new CapitalLog(this);
  private clanEmbedLog = new ClanEmbedLog(this);
  private clanGamesLog = new ClanGamesLog(this);
  private clanLog = new ClanLog(this);
  private clanWarLog = new ClanWarLog(this);
  private donationLog = new DonationLog(this);
  private lastSeenLog = new LastSeenLog(this);
  private legendLog = new LegendLog(this);
  private rankedBattleLog = new RankedBattleLog(this);

  public constructor(public readonly client: Client) {
    this.maintenanceLog.init();
    this.paused = Boolean(false);
  }

  public pause(forced = false, ms = 5 * 60 * 1000) {
    if (this.paused) return this.paused;
    this.paused = Boolean(true);
    if (forced) setTimeout(() => (this.paused = Boolean(false)), ms);
    return this.paused;
  }

  /** Dispatch a clan-update event received from the CoC EventManager. */
  public async dispatch(data: Record<string, unknown>) {
    const clanTag = (data.tag ?? data.clanTag) as string;
    if (this.paused || !this.cached.has(clanTag)) return;

    if (this.queue.remaining >= 2000) {
      this.client.logger.warn(
        `Queue is full (${this.queue.remaining}), skipping log processing...`,
        { label: 'Enqueuer' }
      );
      return;
    }

    await this.queue.wait();
    try {
      switch (data.op) {
        case Flags.CLAN_FEED_LOG:
          await Promise.all([
            this.flagAlertLog.exec(clanTag, data as any),
            this.clanLog.exec(clanTag, data)
          ]);
          this.client.rolesManager.exec(clanTag, data as any);
          break;
        case Flags.CLAN_GAMES_LOG:
          await this.clanGamesLog.exec(clanTag, data as any);
          break;
        case Flags.CLAN_EVENT_LOG:
        case Flags.TOWN_HALL_LOG:
        case Flags.PLAYER_FEED_LOG:
          await this.clanLog.exec(clanTag, data as any);
          break;
        case Flags.CLAN_WAR_LOG:
          await this.clanWarLog.exec((data.clan as { tag: string }).tag, data as any);
          this.client.rolesManager.exec(clanTag, data as any);
          break;
        case Flags.DONATION_LOG_V2:
          await this.clanLog.exec((data.clan as { tag: string }).tag, data as any);
          break;
        case Flags.CAPITAL_LOG:
          await this.clanLog.exec(clanTag, data as any);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error(inspect(error, { depth: Infinity }));
    } finally {
      this.queue.shift();
    }
  }

  private async _loadClans(tag?: string) {
    const result = await this.client.db
      .collection(Collections.CLAN_STORES)
      .aggregate<AggregatedResult>([
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

    for (const { _id, clans } of result) this.cached.set(_id, clans);
  }

  public async init() {
    if (this.maintenanceLog.inMaintenance) return;

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

  public async add(data: { tag: string; guild: string }) {
    if (!this.client.guilds.cache.has(data.guild)) return;

    const [result] = await this.client.db
      .collection(Collections.CLAN_STORES)
      .aggregate<{ tag: string; lastRan?: string; uniqueId: number }>([
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
    } else {
      this.cached.delete(data.tag);
    }
  }

  public async delete(data: { tag: string; guild: string }) {
    const clans = await this.client.db
      .collection(Collections.CLAN_STORES)
      .find(
        { tag: data.tag, paused: false, guild: { $ne: data.guild } },
        { projection: { _id: 1 } }
      )
      .toArray();

    const logs = await this.client.db
      .collection(Collections.CLAN_LOGS)
      .find({ guildId: data.guild, clanTag: data.tag })
      .toArray();
    for (const log of logs) this.deleteLog(log._id.toHexString());

    if (!clans.length) {
      this.cached.delete(data.tag);
    } else {
      await this._loadClans(data.tag);
    }
  }

  public deleteLog(logId: string) {
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

  public async addLog(guildId: string) {
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

  public async addAutoBoard(id: string) {
    return this.autoBoardLog.add(id);
  }

  public async delAutoBoard(id: string) {
    return this.autoBoardLog.del(id);
  }

  public async flush() {
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

interface Cached {
  _id: string;
  guild: string;
  tag: string;
}

interface AggregatedResult {
  _id: string;
  clans: [{ _id: string; tag: string; guild: string }];
}
