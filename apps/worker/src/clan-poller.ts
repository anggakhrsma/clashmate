import type { ClashMateCocClient } from '@clashmate/coc';
import type {
  ClaimedPollingLease,
  ClanMemberEventStore,
  ClanMemberSnapshotInput,
  ClanSnapshotStore,
} from '@clashmate/database';

export interface ClanPollerHandlerOptions {
  readonly coc: Pick<ClashMateCocClient, 'getClan'>;
  readonly snapshots: ClanSnapshotStore;
  readonly memberEvents?: ClanMemberEventStore;
  readonly now?: () => Date;
}

export type ClanMemberEventSkipReason = 'clan_not_linked' | 'member_event_store_unavailable';

export interface ClanPollerResult {
  readonly status: 'snapshot_updated' | 'not_linked';
  readonly clanTag: string;
  readonly snapshotSource: 'clash_api';
  readonly snapshotFetchedAt: string;
  readonly snapshotFreshnessMs: number;
  readonly snapshotUpsertStatus: 'upserted' | 'not_linked';
  readonly memberSnapshotSource: ClanMemberSnapshotSource;
  readonly rawMemberCount: number;
  readonly fetchedMemberCount: number;
  readonly memberFieldCoverage: ClanMemberFieldCoverage;
  readonly memberEventProcessingRan: boolean;
  readonly memberEventProcessingStatus: 'processed' | 'not_linked' | 'skipped';
  readonly memberEventSkipReason?: ClanMemberEventSkipReason;
  readonly memberEventSkipContext?: ClanMemberEventSkipContext;
  readonly joined?: number;
  readonly left?: number;
  readonly donationEvents?: number;
  readonly roleChangeEvents?: number;
}

export type ClanMemberSnapshotSource = string;

export interface ClanMemberFieldCoverage {
  readonly total: number;
  readonly playerTag: number;
  readonly name: number;
  readonly role: number;
  readonly expLevel: number;
  readonly leagueId: number;
  readonly trophies: number;
  readonly builderBaseTrophies: number;
  readonly clanRank: number;
  readonly previousClanRank: number;
  readonly donations: number;
  readonly donationsReceived: number;
}

export interface ClanMemberEventSkipContext {
  readonly snapshotUpsertStatus: 'upserted' | 'not_linked';
  readonly memberEventStoreAvailable: boolean;
  readonly rawMemberCount: number;
  readonly extractedMemberCount: number;
}

const MAX_MEMBER_EXP_LEVEL = 500;
const MAX_LEAGUE_ID = 100_000_000;
const MAX_MEMBER_TROPHIES = 100_000;
const MAX_CLAN_RANK = 50;
const MAX_MEMBER_DONATIONS = 1_000_000;

export function createClanPollerHandler(options: ClanPollerHandlerOptions) {
  return async (lease: ClaimedPollingLease): Promise<ClanPollerResult> => {
    if (lease.resourceType !== 'clan') {
      throw new Error(`Clan poller cannot process ${lease.resourceType} leases.`);
    }

    const clan = await options.coc.getClan(lease.resourceId);
    const clanTag = clan.tag;
    const fetchedAt = options.now?.() ?? new Date();
    const result = await options.snapshots.upsertLatestClanSnapshot({
      clanTag: clan.tag,
      name: clan.name,
      snapshot: clan,
      fetchedAt,
    });

    const memberList = getClanMemberListDetails(clan);
    const members = extractClanMemberSnapshotsFromList(memberList.members);
    const memberEvents = options.memberEvents;
    const memberEventSkipReason = getClanMemberEventSkipReason(result.status, memberEvents);
    const memberResult =
      memberEventSkipReason || !memberEvents
        ? null
        : await memberEvents.processClanMemberSnapshots({
            clanTag: clan.tag,
            fetchedAt,
            members,
          });

    return {
      status: result.status === 'upserted' ? 'snapshot_updated' : 'not_linked',
      clanTag,
      snapshotSource: 'clash_api',
      snapshotFetchedAt: fetchedAt.toISOString(),
      snapshotFreshnessMs: Math.max(
        0,
        (options.now?.() ?? new Date()).getTime() - fetchedAt.getTime(),
      ),
      snapshotUpsertStatus: result.status,
      memberSnapshotSource: memberList.source,
      rawMemberCount: memberList.rawMemberCount,
      fetchedMemberCount: members.length,
      memberFieldCoverage: summarizeMemberFieldCoverage(members),
      memberEventProcessingRan: !memberEventSkipReason,
      memberEventProcessingStatus: memberResult?.status ?? 'skipped',
      ...(memberEventSkipReason ? { memberEventSkipReason } : {}),
      ...(memberEventSkipReason
        ? {
            memberEventSkipContext: {
              snapshotUpsertStatus: result.status,
              memberEventStoreAvailable: Boolean(memberEvents),
              rawMemberCount: memberList.rawMemberCount,
              extractedMemberCount: members.length,
            },
          }
        : {}),
      ...(memberResult?.status === 'processed'
        ? {
            joined: memberResult.joined,
            left: memberResult.left,
            donationEvents: memberResult.donationEvents,
            roleChangeEvents: memberResult.roleChangeEvents,
          }
        : {}),
    };
  };
}

function getClanMemberEventSkipReason(
  snapshotStatus: 'upserted' | 'not_linked',
  memberEvents: ClanMemberEventStore | undefined,
): ClanMemberEventSkipReason | null {
  if (snapshotStatus !== 'upserted') return 'clan_not_linked';
  if (!memberEvents) return 'member_event_store_unavailable';
  return null;
}

interface ClanWithMembers {
  readonly memberList?: unknown;
  readonly members?: unknown;
  readonly items?: unknown;
  readonly data?: unknown;
}

interface RawClanMember {
  readonly tag?: unknown;
  readonly name?: unknown;
  readonly role?: unknown;
  readonly expLevel?: unknown;
  readonly playerLevel?: unknown;
  readonly league?: unknown;
  readonly trophies?: unknown;
  readonly builderBaseTrophies?: unknown;
  readonly clanRank?: unknown;
  readonly previousClanRank?: unknown;
  readonly donations?: unknown;
  readonly donationsReceived?: unknown;
  readonly donationsRecieved?: unknown;
}

export function extractClanMemberSnapshots(clan: unknown): ClanMemberSnapshotInput[] {
  return extractClanMemberSnapshotsFromList(getClanMemberList(clan));
}

function extractClanMemberSnapshotsFromList(
  members: readonly RawClanMember[],
): ClanMemberSnapshotInput[] {
  return members.flatMap((member) => {
    const playerTag = normalizeNonBlankString(member.tag);
    if (!playerTag) return [];

    return [
      {
        clanTag: '',
        playerTag,
        name: normalizeNonBlankString(member.name) ?? playerTag,
        role: normalizeNonBlankString(member.role),
        expLevel: asPositiveIntegerInRange(
          firstDefined(member.expLevel, member.playerLevel),
          MAX_MEMBER_EXP_LEVEL,
        ),
        leagueId: extractLeagueId(member.league),
        trophies: asNonNegativeIntegerInRange(member.trophies, MAX_MEMBER_TROPHIES),
        builderBaseTrophies: asNonNegativeIntegerInRange(
          member.builderBaseTrophies,
          MAX_MEMBER_TROPHIES,
        ),
        clanRank: asPositiveIntegerInRange(member.clanRank, MAX_CLAN_RANK),
        previousClanRank: asPositiveIntegerInRange(member.previousClanRank, MAX_CLAN_RANK),
        donations: asNonNegativeIntegerInRange(member.donations, MAX_MEMBER_DONATIONS),
        donationsReceived: asNonNegativeIntegerInRange(
          firstDefined(member.donationsReceived, member.donationsRecieved),
          MAX_MEMBER_DONATIONS,
        ),
        rawMember: member,
      },
    ];
  });
}

function summarizeMemberFieldCoverage(
  members: readonly ClanMemberSnapshotInput[],
): ClanMemberFieldCoverage {
  return {
    total: members.length,
    playerTag: countPresent(members, (member) => member.playerTag),
    name: countPresent(members, (member) => member.name),
    role: countPresent(members, (member) => member.role),
    expLevel: countPresent(members, (member) => member.expLevel),
    leagueId: countPresent(members, (member) => member.leagueId),
    trophies: countPresent(members, (member) => member.trophies),
    builderBaseTrophies: countPresent(members, (member) => member.builderBaseTrophies),
    clanRank: countPresent(members, (member) => member.clanRank),
    previousClanRank: countPresent(members, (member) => member.previousClanRank),
    donations: countPresent(members, (member) => member.donations),
    donationsReceived: countPresent(members, (member) => member.donationsReceived),
  };
}

function countPresent<T>(
  members: readonly ClanMemberSnapshotInput[],
  getValue: (member: ClanMemberSnapshotInput) => T | null | undefined,
): number {
  return members.reduce((total, member) => (getValue(member) == null ? total : total + 1), 0);
}

function getClanMemberList(clan: unknown): readonly RawClanMember[] {
  return getClanMemberListDetails(clan).members;
}

function getClanMemberListDetails(clan: unknown): {
  readonly source: ClanMemberSnapshotSource;
  readonly rawMemberCount: number;
  readonly members: readonly RawClanMember[];
} {
  if (!isRecord(clan)) {
    return {
      source: 'not_found',
      rawMemberCount: 0,
      members: [],
    };
  }

  const memberList = findMemberList(clan);
  const members = memberList?.members.filter(isRecord) ?? [];

  return {
    source: memberList?.source ?? 'not_found',
    rawMemberCount: memberList?.members.length ?? 0,
    members,
  };
}

function findMemberList(
  value: Record<string, unknown>,
  depth = 0,
): { readonly source: ClanMemberSnapshotSource; readonly members: readonly unknown[] } | null {
  const clanWithMembers = value as ClanWithMembers;
  const sourcePrefix = depth === 0 ? '' : `${'data.'.repeat(depth)}`;
  const candidates: readonly (readonly [string, unknown])[] = [
    ['memberList', clanWithMembers.memberList],
    ['members', clanWithMembers.members],
    ['items', clanWithMembers.items],
  ];
  const memberList = candidates.find((entry): entry is readonly [string, readonly unknown[]] =>
    Array.isArray(entry[1]),
  );
  if (memberList) {
    return {
      source: `${sourcePrefix}${memberList[0]}`,
      members: memberList[1],
    };
  }

  return depth < 3 && isRecord(clanWithMembers.data)
    ? findMemberList(clanWithMembers.data, depth + 1)
    : null;
}

function extractLeagueId(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const league = value as { readonly id?: unknown };
  return asPositiveIntegerInRange(league.id, MAX_LEAGUE_ID);
}

function asNonNegativeIntegerInRange(value: unknown, max: number): number | null {
  return asIntegerInRange(value, 0, max);
}

function asPositiveIntegerInRange(value: unknown, max: number): number | null {
  return asIntegerInRange(value, 1, max);
}

function asIntegerInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  return Math.min(Math.max(value, min), max);
}

function firstDefined(...values: readonly unknown[]): unknown {
  return values.find((value) => value !== undefined);
}

function normalizeNonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
