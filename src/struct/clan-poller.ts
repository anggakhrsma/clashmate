/**
 * ClanPoller — clashmate's in-process clan change detector.
 *
 * Three independent polling loops:
 *   - Clan loop  (every 2 min): clan/member changes, donations, join/leave, war snapshots
 *   - War loop   (every 2 min): war state changes, saves war data to CLAN_WARS
 *   - Player loop (every 5 min): individual player stats for lastSeen activity scoring
 */

import { Collections, Flags } from '@app/constants';
import { LogActions } from '@app/entities';
import { APIClan, APIClanMember, APIClanWar } from 'clashofclans.js';
import { Collection } from 'discord.js';
import { inspect } from 'node:util';
import { Client } from './client.js';
import { Util } from '../util/toolkit.js';

const CLAN_POLL_INTERVAL = Number(process.env.CLAN_POLL_INTERVAL_MS ?? 5 * 60 * 1000);
const WAR_POLL_INTERVAL = Number(process.env.WAR_POLL_INTERVAL_MS ?? 4 * 60 * 1000);
const PLAYER_POLL_INTERVAL = Number(process.env.PLAYER_POLL_INTERVAL_MS ?? 18 * 60 * 1000);
const CONCURRENCY = Number(process.env.POLL_CONCURRENCY ?? 10);

interface ClanSnapshot {
  clan: APIClan;
  memberMap: Map<string, APIClanMember>;
  lastDonationReset: string;
}

interface WarSnapshot {
  war: APIClanWar;
  warTag: string;
}

export class ClanPoller {
  private clanSnapshots = new Collection<string, ClanSnapshot>();
  private warSnapshots = new Collection<string, WarSnapshot>();
  private playerCache = new Collection<string, Record<string, number>>();

  private clanTimer: NodeJS.Timeout | null = null;
  private warTimer: NodeJS.Timeout | null = null;
  private playerTimer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(private readonly client: Client) {}

  public start() {
    if (this.running) return;
    this.running = true;
    this.client.logger.info('Clan poller started', { label: 'POLLER' });
    this.clanTick();
    this.warTick();
    // Delay player loop so clan snapshots are populated first
    setTimeout(() => this.playerTick(), 30 * 1000);
  }

  public stop() {
    this.running = false;
    for (const t of [this.clanTimer, this.warTimer, this.playerTimer]) {
      if (t) clearTimeout(t);
    }
    this.clanTimer = this.warTimer = this.playerTimer = null;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async getTrackedTags(): Promise<string[]> {
    const clans = await this.client.db
      .collection(Collections.CLAN_STORES)
      .find(
        { guild: { $in: [...this.client.guilds.cache.keys()] }, paused: { $ne: true } },
        { projection: { tag: 1 } }
      )
      .toArray();
    return [...new Set(clans.map((c) => c.tag))];
  }

  private donationWeekKey(): string {
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    const week = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${week}`;
  }

  private async dispatch(data: Record<string, unknown>) {
    try {
      await this.client.enqueuer.dispatch(data);
    } catch (err) {
      this.client.logger.error(inspect(err, { depth: 2 }), { label: 'POLLER' });
    }
  }

  private buildClanPayload(clan: APIClan, prev: APIClan) {
    return {
      tag: clan.tag,
      name: clan.name,
      badge: clan.badgeUrls?.small ?? '',
      badgeUrl: clan.badgeUrls?.small ?? '',
      level: clan.clanLevel,
      members: clan.members,
      warLeague: clan.warLeague ?? { id: 0, name: 'Unranked' },
      oldWarLeague: prev.warLeague ?? { id: 0, name: 'Unranked' },
      capitalLeague: clan.capitalLeague ?? { id: 0, name: 'Unranked' },
      oldCapitalLeague: prev.capitalLeague ?? { id: 0, name: 'Unranked' },
      capitalHallLevel: clan.clanCapital?.capitalHallLevel ?? 0
    };
  }

  private memberEvent(member: APIClanMember, op: string): MemberEvent {
    return {
      op,
      tag: member.tag,
      name: member.name,
      role: member.role,
      leagueId: (member as any).league?.id ?? 29000000,
      townHallLevel: member.townHallLevel,
      donations: member.donations,
      donationsReceived: member.donationsReceived,
      contributed: 0,
      looted: 0,
      attacks: 0,
      attackLimit: 0,
      logType: 'CLAN_FEED_LOG',
      donationsDelta: 0,
      donationsReceivedDelta: 0
    };
  }

  private roleRank(role: string): number {
    return { member: 1, elder: 2, coLeader: 3, leader: 4 }[role] ?? 0;
  }

  // ── Clan Loop (every 2 min) ───────────────────────────────────────────────

  private async clanTick() {
    try {
      const tags = await this.getTrackedTags();
      for (let i = 0; i < tags.length; i += CONCURRENCY) {
        const batch = tags.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map((tag) => this.pollClan(tag)));
      }
    } catch (err) {
      this.client.logger.error(inspect(err, { depth: 2 }), { label: 'POLLER' });
    } finally {
      if (this.running) this.clanTimer = setTimeout(() => this.clanTick(), CLAN_POLL_INTERVAL);
    }
  }

  private async pollClan(tag: string) {
    const { res, body: clan } = await this.client.coc.getClan(tag);
    if (!res.ok) return;

    const memberMap = new Map(clan.memberList.map((m) => [m.tag, m]));
    const next: ClanSnapshot = { clan, memberMap, lastDonationReset: this.donationWeekKey() };
    const prev = this.clanSnapshots.get(tag);

    if (prev) await this.diffClan(prev, next);
    this.clanSnapshots.set(tag, next);
  }

  private async diffClan(prev: ClanSnapshot, next: ClanSnapshot) {
    const { clan } = next;
    const members: MemberEvent[] = [];

    // Join / leave
    for (const [tag, member] of next.memberMap) {
      if (!prev.memberMap.has(tag)) members.push(this.memberEvent(member, LogActions.JOINED));
    }
    for (const [tag, member] of prev.memberMap) {
      if (!next.memberMap.has(tag)) members.push(this.memberEvent(member, LogActions.LEFT));
    }

    // Member field changes
    for (const [tag, curr] of next.memberMap) {
      const old = prev.memberMap.get(tag);
      if (!old) continue;

      if (old.role !== curr.role) {
        const isPromotion = this.roleRank(curr.role) > this.roleRank(old.role);
        members.push(
          this.memberEvent(curr, isPromotion ? LogActions.PROMOTED : LogActions.DEMOTED)
        );
      }
      if (old.townHallLevel !== curr.townHallLevel)
        members.push(this.memberEvent(curr, LogActions.TOWN_HALL_UPGRADE));
      if (old.name !== curr.name) members.push(this.memberEvent(curr, LogActions.NAME_CHANGE));
      if ((old as any).warPreference !== (curr as any).warPreference)
        members.push(this.memberEvent(curr as any, LogActions.WAR_PREF_CHANGE));

      if (
        next.lastDonationReset === prev.lastDonationReset &&
        (old.donations !== curr.donations || old.donationsReceived !== curr.donationsReceived)
      ) {
        members.push({
          ...this.memberEvent(curr, LogActions.DONATED),
          donations: curr.donations,
          donationsReceived: curr.donationsReceived,
          donationsDelta: curr.donations - old.donations,
          donationsReceivedDelta: curr.donationsReceived - old.donationsReceived
        });
      }

      // lastSeen from clan-visible activity
      const clanActivity =
        old.name !== curr.name ||
        old.townHallLevel !== curr.townHallLevel ||
        (old as any).warPreference !== (curr as any).warPreference ||
        (next.lastDonationReset === prev.lastDonationReset &&
          (old.donations !== curr.donations || old.donationsReceived !== curr.donationsReceived));

      if (clanActivity) {
        const now = new Date();
        await Promise.all([
          this.client.db
            .collection(Collections.PLAYERS)
            .updateOne(
              { tag: curr.tag },
              {
                $set: {
                  tag: curr.tag,
                  name: curr.name,
                  townHallLevel: curr.townHallLevel,
                  lastSeen: now
                },
                $inc: { activityScore: 1 }
              },
              { upsert: true }
            )
            .catch(() => null),
          this.client.db
            .collection('PlayerActivities')
            .insertOne({
              tag: curr.tag,
              name: curr.name,
              clanTag: clan.tag,
              createdAt: now
            })
            .catch(() => null)
        ]);
      }
    }

    // Clan-level events
    const clanPayload = this.buildClanPayload(clan, prev.clan);
    const clanEvents: string[] = [];
    if (prev.clan.clanLevel !== clan.clanLevel) clanEvents.push(LogActions.CLAN_LEVEL_UP);
    if (prev.clan.warLeague?.id !== clan.warLeague?.id)
      clanEvents.push(LogActions.WAR_LEAGUE_CHANGE);
    if (prev.clan.capitalLeague?.id !== clan.capitalLeague?.id)
      clanEvents.push(LogActions.CAPITAL_LEAGUE_CHANGE);
    if (prev.clan.clanCapital?.capitalHallLevel !== clan.clanCapital?.capitalHallLevel)
      clanEvents.push(LogActions.CAPITAL_HALL_LEVEL_UP);

    if (members.length > 0) {
      await this.dispatch({
        op: Flags.CLAN_FEED_LOG,
        tag: clan.tag,
        clan: clanPayload,
        members,
        memberList: clan.memberList.map((m) => ({
          tag: m.tag,
          role: m.role,
          clan: { tag: clan.tag }
        })),
        logType: 'CLAN_FEED_LOG'
      });
    }

    for (const type of clanEvents) {
      await this.dispatch({
        op: Flags.CLAN_EVENT_LOG,
        tag: clan.tag,
        clan: clanPayload,
        type,
        members: [],
        memberList: [],
        logType: 'CLAN_EVENT_LOG'
      });
    }
  }

  // ── War Loop (every 2 min) ────────────────────────────────────────────────

  private async warTick() {
    try {
      const tags = await this.getTrackedTags();
      for (let i = 0; i < tags.length; i += CONCURRENCY) {
        const batch = tags.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map((tag) => this.pollWar(tag)));
      }
    } catch (err) {
      this.client.logger.error(inspect(err, { depth: 2 }), { label: 'WAR_POLLER' });
    } finally {
      if (this.running) this.warTimer = setTimeout(() => this.warTick(), WAR_POLL_INTERVAL);
    }
  }

  private async pollWar(tag: string) {
    const res = await this.client.coc.getCurrentWar(tag).catch(() => null);
    if (!res?.res?.ok) return;

    const war = res.body;
    if (!war || war.state === 'notInWar') return;

    const warTag = `${tag}:${war.preparationStartTime}`;
    const prev = this.warSnapshots.get(tag);

    // Dispatch on state change
    const stateChanged = !prev || prev.warTag !== warTag || prev.war.state !== war.state;
    if (stateChanged) {
      await this.dispatch({
        op: Flags.CLAN_WAR_LOG,
        tag,
        clan: { tag, name: war.clan.tag === tag ? war.clan.name : war.opponent.name },
        state: war.state,
        war,
        logType: 'CLAN_WAR_LOG'
      });
    }

    // Save war snapshot to CLAN_WARS for /stats attacks
    if (['inWar', 'warEnded'].includes(war.state)) {
      await this.client.db
        .collection(Collections.CLAN_WARS)
        .updateOne(
          { warId: warTag },
          {
            $set: {
              warId: warTag,
              ...war,
              warType: (war as any).isFriendly ? 'friendly' : 'random',
              updatedAt: new Date()
            },
            $setOnInsert: { createdAt: new Date() }
          },
          { upsert: true }
        )
        .catch(() => null);
    }

    this.warSnapshots.set(tag, { war, warTag });
  }

  // ── Player Loop (every 5 min) ─────────────────────────────────────────────

  private async playerTick() {
    try {
      // Collect member tags from clan snapshots
      const memberTags = new Set<string>();
      for (const [, snap] of this.clanSnapshots) {
        for (const tag of snap.memberMap.keys()) memberTags.add(tag);
      }

      // Fallback: if snapshots not ready yet, query DB directly
      if (memberTags.size === 0) {
        const tags = await this.getTrackedTags();
        for (const clanTag of tags) {
          const { res, body } = await this.client.coc
            .getClan(clanTag)
            .catch(() => ({ res: { ok: false }, body: null }) as any);
          if (res.ok && body?.memberList) {
            for (const m of body.memberList) memberTags.add(m.tag);
          }
        }
      }

      // Fetch players in batches of 10
      const allTags = [...memberTags];
      for (let i = 0; i < allTags.length; i += CONCURRENCY) {
        const batch = allTags.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map((tag) => this.pollPlayer(tag)));
      }
    } catch (err) {
      this.client.logger.error(inspect(err, { depth: 2 }), { label: 'PLAYER_POLLER' });
    } finally {
      if (this.running)
        this.playerTimer = setTimeout(() => this.playerTick(), PLAYER_POLL_INTERVAL);
    }
  }

  private async pollPlayer(tag: string) {
    const { res, body: player } = await this.client.coc.getPlayer(tag);
    if (!res.ok) return;

    const prev = this.playerCache.get(tag);

    // Helper to get achievement value by name
    const ach = (name: string) =>
      player.achievements?.find((a: any) => a.name === name)?.value ?? 0;

    const curr: Record<string, number> = {
      // Direct fields
      attackWins: player.attackWins ?? 0,
      warStars: player.warStars ?? 0,
      trophies: player.trophies ?? 0,
      clanCapitalContributions: player.clanCapitalContributions ?? 0,
      builderBaseTrophies: player.builderBaseTrophies ?? 0,
      legendTrophies: player.legendStatistics?.currentSeason?.trophies ?? 0,

      // Achievements — resources looted
      goldGrab: ach('Gold Grab'),
      elixirEscapade: ach('Elixir Escapade'),
      heroicHeist: ach('Heroic Heist'),

      // Achievements — clan games
      gamesChampion: ach('Games Champion'),

      // Achievements — obstacles / structures
      niceAndTidy: ach('Nice and Tidy'),
      unbreakable: ach('Unbreakable'),
      sweetVictory: ach('Sweet Victory!'),
      conqueror: ach('Conqueror'),
      siegeBreaker: ach('Siege Breaker'),
      counterspell: ach('Counterspell'),
      wallBuster: ach('Wall Buster'),
      sharingIsCaring: ach('Sharing is Caring'),

      // Achievements — goblin map
      goblinHeist: ach('Goblin Heist'),
      raidGoldGrab: ach('Raid Gold Grab'),

      // Achievements — war attacks
      warHero: ach('War Hero'),
      warLeagueLegend: ach('War League Legend'),

      // Super troops (count how many are active)
      activeSuperTroops: (player.troops ?? []).filter((t: any) => t.superTroopIsActive).length
    };

    this.playerCache.set(tag, curr);
    if (!prev) return; // first poll — no diff yet

    const isActive = Object.keys(curr).some((k) => curr[k] !== prev[k]);
    if (!isActive) return;

    const now = new Date();

    await Promise.all([
      // Update lastSeen and activityScore
      this.client.db
        .collection(Collections.PLAYERS)
        .updateOne(
          { tag },
          {
            $set: { tag, name: player.name, townHallLevel: player.townHallLevel, lastSeen: now },
            $inc: { activityScore: 1 }
          },
          { upsert: true }
        )
        .catch(() => null),
      // Write activity event for /activity command
      // Find which clan this player belongs to
      ...this.getClanTagsForPlayer(tag).map((clanTag) =>
        this.client.db
          .collection('PlayerActivities')
          .insertOne({
            tag,
            name: player.name,
            clanTag,
            createdAt: now
          })
          .catch(() => null)
      )
    ]);
  }

  private getClanTagsForPlayer(playerTag: string): string[] {
    const clanTags: string[] = [];
    for (const [clanTag, snap] of this.clanSnapshots) {
      if (snap.memberMap.has(playerTag)) clanTags.push(clanTag);
    }
    return clanTags;
  }
}

interface MemberEvent {
  op: string;
  tag: string;
  name: string;
  role: string;
  leagueId: number;
  townHallLevel: number;
  donations: number;
  donationsReceived: number;
  contributed: number;
  looted: number;
  attacks: number;
  attackLimit: number;
  logType: string;
  donationsDelta: number;
  donationsReceivedDelta: number;
}
