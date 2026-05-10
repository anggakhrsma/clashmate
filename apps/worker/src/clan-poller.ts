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

export interface ClanPollerResult {
  readonly status: 'snapshot_updated' | 'not_linked';
  readonly clanTag: string;
  readonly joined?: number;
  readonly left?: number;
  readonly donationEvents?: number;
  readonly roleChangeEvents?: number;
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

    const memberResult =
      result.status === 'upserted' && options.memberEvents
        ? await options.memberEvents.processClanMemberSnapshots({
            clanTag: clan.tag,
            fetchedAt,
            members: extractClanMemberSnapshots(clan),
          })
        : null;

    return {
      status: result.status === 'upserted' ? 'snapshot_updated' : 'not_linked',
      clanTag,
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
  return getClanMemberList(clan).flatMap((member) => {
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

function getClanMemberList(clan: unknown): readonly RawClanMember[] {
  if (!isRecord(clan)) return [];

  const memberList = findMemberList(clan);

  return memberList?.filter(isRecord) ?? [];
}

function findMemberList(value: Record<string, unknown>, depth = 0): readonly unknown[] | null {
  const clanWithMembers = value as ClanWithMembers;
  const memberList = [
    clanWithMembers.memberList,
    clanWithMembers.members,
    clanWithMembers.items,
  ].find(Array.isArray);
  if (memberList) return memberList;

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
