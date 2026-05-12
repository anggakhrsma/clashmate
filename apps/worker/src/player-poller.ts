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
  readonly achievements?: unknown;
  readonly clan?: unknown;
  readonly data?: unknown;
}

export interface ClanGamesSeasonConfig {
  readonly seasonId: string;
  readonly eventMaxPoints: number;
}

export interface ClanGamesWindow {
  readonly seasonId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export type ClanGamesSeasonConfigProvider = (now: Date) => ClanGamesSeasonConfig | null;

export interface PlayerPollerHandlerOptions {
  readonly coc: Pick<ClashMateCocClient, 'getPlayer'>;
  readonly snapshots: PlayerSnapshotStore;
  readonly clanGames?: ClanGamesEventStore;
  readonly clanGamesSeasonConfig?: ClanGamesSeasonConfigProvider;
  readonly now?: () => Date;
}

export type PlayerPollerSnapshotStatus = 'upserted' | 'not_linked';

export type PlayerPollerSnapshotSource = 'clash_api';

export type PlayerPollerSnapshotFreshness = 'fresh';

export type PlayerPollerClanGamesEligibility = 'eligible' | 'ineligible' | 'unassessed';

export type PlayerPollerClanGamesWindowStatus = 'active' | 'inactive' | 'unassessed';

export type PlayerPollerAchievementCoverage = 'present' | 'missing';

export interface PlayerPollerSkipContext {
  readonly snapshotStatus: PlayerPollerSnapshotStatus;
  readonly snapshotSource: PlayerPollerSnapshotSource;
  readonly clanTagKnown: boolean;
  readonly achievementCoverage: PlayerPollerAchievementCoverage;
  readonly seasonId?: string;
  readonly seasonWindowStatus?: PlayerPollerClanGamesWindowStatus;
}

export interface PlayerPollerResult {
  readonly status: 'snapshot_updated' | 'not_linked';
  readonly snapshotStatus: PlayerPollerSnapshotStatus;
  readonly snapshotSource: PlayerPollerSnapshotSource;
  readonly snapshotFetchedAt: Date;
  readonly snapshotFreshness: PlayerPollerSnapshotFreshness;
  readonly playerTag: string;
  readonly clanGamesEligibility: PlayerPollerClanGamesEligibility;
  readonly clanGamesWindowStatus: PlayerPollerClanGamesWindowStatus;
  readonly achievementCoverage: PlayerPollerAchievementCoverage;
  readonly clanGamesConsidered: boolean;
  readonly clanGamesSkipReason?:
    | 'player_not_linked'
    | 'clan_games_store_missing'
    | 'missing_clan_tag'
    | 'missing_games_champion_achievement'
    | 'no_active_clan_games_season';
  readonly clanGamesSkipContext?: PlayerPollerSkipContext;
  readonly clanTag?: string;
  readonly gamesChampionAchievementValue?: number;
  readonly clanGamesSeasonId?: string;
  readonly clanGamesEventMaxPoints?: number;
  readonly clanGames?: ProcessClanGamesProgressResult;
}

function addPlayerPollerDiagnostics(
  result: Pick<PlayerPollerResult, 'status' | 'playerTag' | 'clanGamesConsidered'> &
    Partial<PlayerPollerResult>,
  diagnostics: Partial<
    Pick<
      PlayerPollerResult,
      | 'snapshotStatus'
      | 'snapshotSource'
      | 'snapshotFetchedAt'
      | 'snapshotFreshness'
      | 'clanGamesEligibility'
      | 'clanGamesWindowStatus'
      | 'achievementCoverage'
      | 'clanGamesSkipContext'
    >
  >,
): PlayerPollerResult {
  Object.defineProperties(result, {
    snapshotStatus: {
      value: diagnostics.snapshotStatus,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    snapshotSource: {
      value: diagnostics.snapshotSource,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    snapshotFetchedAt: {
      value: diagnostics.snapshotFetchedAt,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    snapshotFreshness: {
      value: diagnostics.snapshotFreshness,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    clanGamesEligibility: {
      value: diagnostics.clanGamesEligibility,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    clanGamesWindowStatus: {
      value: diagnostics.clanGamesWindowStatus,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    achievementCoverage: {
      value: diagnostics.achievementCoverage,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    clanGamesSkipContext: {
      value: diagnostics.clanGamesSkipContext,
      enumerable: false,
      configurable: true,
      writable: true,
    },
  });

  return result as PlayerPollerResult;
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

    const snapshotStatus: PlayerPollerSnapshotStatus = result.status;

    const pollerResult: PlayerPollerResult = addPlayerPollerDiagnostics(
      {
        status: snapshotStatus === 'upserted' ? 'snapshot_updated' : 'not_linked',
        playerTag,
        clanGamesConsidered: false,
      },
      {
        snapshotStatus,
        snapshotSource: 'clash_api',
        snapshotFetchedAt: fetchedAt,
        snapshotFreshness: 'fresh',
        clanGamesEligibility: snapshotStatus === 'upserted' ? 'unassessed' : 'ineligible',
        clanGamesWindowStatus: 'unassessed',
        achievementCoverage: 'missing',
      },
    );

    if (pollerResult.status !== 'snapshot_updated') {
      return addPlayerPollerDiagnostics(
        {
          ...pollerResult,
          clanGamesSkipReason: 'player_not_linked',
        },
        {
          snapshotStatus,
          snapshotSource: 'clash_api',
          snapshotFreshness: 'fresh',
          clanGamesEligibility: 'ineligible',
          clanGamesWindowStatus: 'unassessed',
          achievementCoverage: 'missing',
          clanGamesSkipContext: {
            snapshotStatus,
            snapshotSource: 'clash_api',
            clanTagKnown: false,
            achievementCoverage: 'missing',
          },
        },
      );
    }

    if (!options.clanGames) {
      return addPlayerPollerDiagnostics(
        {
          ...pollerResult,
          clanGamesSkipReason: 'clan_games_store_missing',
        },
        {
          snapshotStatus,
          snapshotSource: 'clash_api',
          snapshotFreshness: 'fresh',
          clanGamesEligibility: 'ineligible',
          clanGamesWindowStatus: 'unassessed',
          achievementCoverage: 'missing',
          clanGamesSkipContext: {
            snapshotStatus,
            snapshotSource: 'clash_api',
            clanTagKnown: false,
            achievementCoverage: 'missing',
          },
        },
      );
    }

    const clanTag = extractPlayerClanTag(player);
    const currentAchievementValue = extractGamesChampionAchievementValue(player);
    const seasonConfig = normalizeClanGamesSeasonConfig(
      (options.clanGamesSeasonConfig ?? defaultClanGamesSeasonConfig)(fetchedAt),
    );
    const achievementCoverage: PlayerPollerAchievementCoverage =
      currentAchievementValue === null ? 'missing' : 'present';
    const seasonWindowStatus: PlayerPollerClanGamesWindowStatus = seasonConfig
      ? 'active'
      : 'inactive';
    const clanGamesEligibility: PlayerPollerClanGamesEligibility =
      clanTag && currentAchievementValue !== null && seasonConfig ? 'eligible' : 'ineligible';

    const clanGamesContext: PlayerPollerResult = addPlayerPollerDiagnostics(
      {
        ...pollerResult,
        clanGamesConsidered: true,
        ...(clanTag ? { clanTag } : {}),
        ...(currentAchievementValue === null
          ? {}
          : { gamesChampionAchievementValue: currentAchievementValue }),
        ...(seasonConfig
          ? {
              clanGamesSeasonId: seasonConfig.seasonId,
              clanGamesEventMaxPoints: seasonConfig.eventMaxPoints,
            }
          : {}),
      },
      {
        snapshotStatus,
        snapshotSource: 'clash_api',
        snapshotFetchedAt: fetchedAt,
        snapshotFreshness: 'fresh',
        clanGamesEligibility,
        clanGamesWindowStatus: seasonWindowStatus,
        achievementCoverage,
      },
    );

    if (!clanTag) {
      return addPlayerPollerDiagnostics(
        {
          ...clanGamesContext,
          clanGamesSkipReason: 'missing_clan_tag',
        },
        {
          snapshotStatus,
          snapshotSource: 'clash_api',
          snapshotFreshness: 'fresh',
          clanGamesEligibility,
          clanGamesWindowStatus: seasonWindowStatus,
          achievementCoverage,
          clanGamesSkipContext: {
            snapshotStatus,
            snapshotSource: 'clash_api',
            clanTagKnown: false,
            achievementCoverage,
            ...(seasonConfig?.seasonId ? { seasonId: seasonConfig.seasonId } : {}),
            seasonWindowStatus,
          },
        },
      );
    }
    if (currentAchievementValue === null) {
      return addPlayerPollerDiagnostics(
        {
          ...clanGamesContext,
          clanGamesSkipReason: 'missing_games_champion_achievement',
        },
        {
          snapshotStatus,
          snapshotSource: 'clash_api',
          snapshotFreshness: 'fresh',
          clanGamesEligibility,
          clanGamesWindowStatus: seasonWindowStatus,
          achievementCoverage,
          clanGamesSkipContext: {
            snapshotStatus,
            snapshotSource: 'clash_api',
            clanTagKnown: true,
            achievementCoverage,
            ...(seasonConfig?.seasonId ? { seasonId: seasonConfig.seasonId } : {}),
            seasonWindowStatus,
          },
        },
      );
    }
    if (!seasonConfig) {
      return addPlayerPollerDiagnostics(
        {
          ...clanGamesContext,
          clanGamesSkipReason: 'no_active_clan_games_season',
        },
        {
          snapshotStatus,
          snapshotSource: 'clash_api',
          snapshotFreshness: 'fresh',
          clanGamesEligibility,
          clanGamesWindowStatus: seasonWindowStatus,
          achievementCoverage,
          clanGamesSkipContext: {
            snapshotStatus,
            snapshotSource: 'clash_api',
            clanTagKnown: true,
            achievementCoverage,
            seasonWindowStatus,
          },
        },
      );
    }

    return addPlayerPollerDiagnostics(
      {
        ...clanGamesContext,
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
      },
      {
        snapshotStatus,
        snapshotSource: 'clash_api',
        snapshotFetchedAt: fetchedAt,
        snapshotFreshness: 'fresh',
        clanGamesEligibility,
        clanGamesWindowStatus: seasonWindowStatus,
        achievementCoverage,
      },
    );
  };
}

export function getClanGamesWindowForSeason(seasonId: string): ClanGamesWindow {
  const match = /^(\d{4})-(\d{2})$/.exec(seasonId);
  if (!match) throw new Error(`Invalid Clan Games season id: ${seasonId}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid Clan Games season id: ${seasonId}`);
  }

  const startsAt = new Date(Date.UTC(year, month - 1, 22, 8, 0, 0, 0));
  const endsAt = new Date(startsAt.getTime() + 6 * 24 * 60 * 60 * 1000);

  return { seasonId, startsAt, endsAt };
}

export function getActiveClanGamesSeasonConfig(now: Date): ClanGamesSeasonConfig | null {
  const seasonId = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const window = getClanGamesWindowForSeason(seasonId);

  if (now < window.startsAt || now >= window.endsAt) return null;

  return {
    seasonId,
    eventMaxPoints: DEFAULT_CLAN_GAMES_EVENT_MAX_POINTS,
  };
}

export const defaultClanGamesSeasonConfig = getActiveClanGamesSeasonConfig;

export function normalizeClanGamesSeasonConfig(value: unknown): ClanGamesSeasonConfig | null {
  if (!isRecord(value)) return null;

  const candidate = value as { readonly seasonId?: unknown; readonly eventMaxPoints?: unknown };
  const seasonId = candidate.seasonId;
  const eventMaxPoints = candidate.eventMaxPoints;

  if (typeof seasonId !== 'string') return null;

  const trimmedSeasonId = seasonId.trim();
  if (trimmedSeasonId.length === 0) return null;
  if (
    typeof eventMaxPoints !== 'number' ||
    !Number.isFinite(eventMaxPoints) ||
    !Number.isInteger(eventMaxPoints) ||
    eventMaxPoints < 0
  ) {
    return null;
  }

  return { seasonId: trimmedSeasonId, eventMaxPoints };
}

export function extractGamesChampionAchievementValue(player: {
  readonly achievements?: unknown;
  readonly data?: unknown;
}): number | null {
  const achievements = resolvePlayerAchievements(player);
  if (!achievements) return null;

  const achievement = achievements.find((item): item is PlayerAchievementPayload => {
    if (!isRecord(item)) return false;
    return (item as PlayerAchievementPayload).name === GAMES_CHAMPION_ACHIEVEMENT_NAME;
  });

  const value = achievement?.value;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return null;
  }

  return value;
}

function extractPlayerClanTag(player: {
  readonly clan?: unknown;
  readonly data?: unknown;
}): string | null {
  const clan = resolvePlayerClan(player);
  if (!clan) return null;

  return normalizeNonBlankClanTag(clan.tag);
}

function resolvePlayerAchievements(player: {
  readonly achievements?: unknown;
  readonly data?: unknown;
}): readonly unknown[] | null {
  if (Array.isArray(player.achievements)) return player.achievements;

  const data = asPlayerDataPayload(player.data);
  return Array.isArray(data?.achievements) ? data.achievements : null;
}

function resolvePlayerClan(player: {
  readonly clan?: unknown;
  readonly data?: unknown;
}): PlayerClanPayload | null {
  if (isRecord(player.clan)) return player.clan as PlayerClanPayload;

  const data = asPlayerDataPayload(player.data);
  return isRecord(data?.clan) ? (data.clan as PlayerClanPayload) : null;
}

function normalizeNonBlankClanTag(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const clanTag = value.trim();
  if (clanTag.length === 0) return null;

  try {
    return normalizeClashTagLikeApi(clanTag);
  } catch {
    return null;
  }
}

function normalizeClashTagLikeApi(tag: string): string {
  const normalized = tag.trim().toUpperCase().replace(/^#?/, '#').replace(/O/g, '0');
  if (!/^#[0289PYLQGRJCUV]+$/.test(normalized)) {
    throw new Error('Invalid Clash of Clans tag.');
  }

  return normalized;
}

function asPlayerDataPayload(value: unknown): PlayerDataPayload | null {
  return isRecord(value) ? (value as PlayerDataPayload) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
