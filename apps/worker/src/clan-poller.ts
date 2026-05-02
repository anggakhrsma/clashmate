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
  readonly data?: unknown;
}

interface RawClanMember {
  readonly tag?: unknown;
  readonly name?: unknown;
  readonly role?: unknown;
  readonly expLevel?: unknown;
  readonly league?: unknown;
  readonly trophies?: unknown;
  readonly builderBaseTrophies?: unknown;
  readonly clanRank?: unknown;
  readonly previousClanRank?: unknown;
  readonly donations?: unknown;
  readonly donationsReceived?: unknown;
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
        expLevel: asNonNegativeInteger(member.expLevel),
        leagueId: extractLeagueId(member.league),
        trophies: asNonNegativeInteger(member.trophies),
        builderBaseTrophies: asNonNegativeInteger(member.builderBaseTrophies),
        clanRank: asNonNegativeInteger(member.clanRank),
        previousClanRank: asNonNegativeInteger(member.previousClanRank),
        donations: asNonNegativeInteger(member.donations),
        donationsReceived: asNonNegativeInteger(member.donationsReceived),
        rawMember: member,
      },
    ];
  });
}

function getClanMemberList(clan: unknown): readonly RawClanMember[] {
  if (!isRecord(clan)) return [];

  const clanWithMembers = clan as ClanWithMembers;
  const data = isRecord(clanWithMembers.data) ? (clanWithMembers.data as ClanWithMembers) : null;
  const memberList = [
    clanWithMembers.memberList,
    clanWithMembers.members,
    data?.memberList,
    data?.members,
  ].find(Array.isArray);

  return memberList?.filter(isRecord) ?? [];
}

function extractLeagueId(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const league = value as { readonly id?: unknown };
  return asNonNegativeInteger(league.id);
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function normalizeNonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
