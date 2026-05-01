import type { ClashMateCocClient } from '@clashmate/coc';
import type {
  ClaimedPollingLease,
  ClanGamesEventStore,
  PlayerSnapshotStore,
  ProcessClanGamesProgressResult,
} from '@clashmate/database';

const GAMES_CHAMPION_ACHIEVEMENT_NAME = 'Games Champion';
// Current public Clan Games cap is 4,000 points per player; keep worker-local until configurable.
const DEFAULT_CLAN_GAMES_EVENT_MAX_POINTS = 4000;

interface PlayerAchievementPayload {
  readonly name?: unknown;
  readonly value?: unknown;
}

interface PlayerClanPayload {
  readonly tag?: unknown;
}

interface PlayerDataPayload {
  readonly achievements?: unknown;
  readonly clan?: unknown;
}

interface PlayerPayload {
  readonly tag: string;
  readonly name: string;
  readonly data?: unknown;
}

export interface ClanGamesSeasonConfig {
  readonly seasonId: string;
  readonly eventMaxPoints: number;
}

export type ClanGamesSeasonConfigProvider = (now: Date) => ClanGamesSeasonConfig | null;

export interface PlayerPollerHandlerOptions {
  readonly coc: Pick<ClashMateCocClient, 'getPlayer'>;
  readonly snapshots: PlayerSnapshotStore;
  readonly clanGames?: ClanGamesEventStore;
  readonly clanGamesSeasonConfig?: ClanGamesSeasonConfigProvider;
  readonly now?: () => Date;
}

export interface PlayerPollerResult {
  readonly status: 'snapshot_updated' | 'not_linked';
  readonly playerTag: string;
  readonly clanGames?: ProcessClanGamesProgressResult;
}

export function createPlayerPollerHandler(options: PlayerPollerHandlerOptions) {
  return async (lease: ClaimedPollingLease): Promise<PlayerPollerResult> => {
    if (lease.resourceType !== 'player') {
      throw new Error(`Player poller cannot process ${lease.resourceType} leases.`);
    }

    const fetchedAt = options.now?.() ?? new Date();
    const player = (await options.coc.getPlayer(lease.resourceId)) as PlayerPayload;
    const playerTag = player.tag;
    const result = await options.snapshots.upsertLatestPlayerSnapshot({
      playerTag: player.tag,
      name: player.name,
      snapshot: player,
      fetchedAt,
    });

    const pollerResult: PlayerPollerResult = {
      status: result.status === 'upserted' ? 'snapshot_updated' : 'not_linked',
      playerTag,
    };

    if (pollerResult.status !== 'snapshot_updated' || !options.clanGames) return pollerResult;

    const clanTag = extractPlayerClanTag(player);
    const currentAchievementValue = extractGamesChampionAchievementValue(player);
    const seasonConfig = (options.clanGamesSeasonConfig ?? defaultClanGamesSeasonConfig)(fetchedAt);

    if (!clanTag || currentAchievementValue === null || !seasonConfig) return pollerResult;

    return {
      ...pollerResult,
      clanGames: await options.clanGames.processClanGamesProgress({
        clanTag,
        seasonId: seasonConfig.seasonId,
        eventMaxPoints: seasonConfig.eventMaxPoints,
        fetchedAt,
        players: [
          {
            playerTag: player.tag,
            playerName: player.name,
            currentAchievementValue,
            rawPlayer: player,
          },
        ],
      }),
    };
  };
}

export function defaultClanGamesSeasonConfig(now: Date): ClanGamesSeasonConfig {
  return {
    seasonId: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
    eventMaxPoints: DEFAULT_CLAN_GAMES_EVENT_MAX_POINTS,
  };
}

export function extractGamesChampionAchievementValue(player: {
  readonly data?: unknown;
}): number | null {
  const data = asPlayerDataPayload(player.data);
  if (!Array.isArray(data?.achievements)) return null;

  const achievement = data.achievements.find((item): item is PlayerAchievementPayload => {
    if (!isRecord(item)) return false;
    return (item as PlayerAchievementPayload).name === GAMES_CHAMPION_ACHIEVEMENT_NAME;
  });

  return typeof achievement?.value === 'number' ? achievement.value : null;
}

function extractPlayerClanTag(player: { readonly data?: unknown }): string | null {
  const data = asPlayerDataPayload(player.data);
  const clan = isRecord(data?.clan) ? (data.clan as PlayerClanPayload) : null;

  return typeof clan?.tag === 'string' && clan.tag.length > 0 ? clan.tag : null;
}

function asPlayerDataPayload(value: unknown): PlayerDataPayload | null {
  return isRecord(value) ? (value as PlayerDataPayload) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
