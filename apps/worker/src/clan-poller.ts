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

    if (result.status === 'upserted' && options.memberEvents) {
      await options.memberEvents.processClanMemberSnapshots({
        clanTag: clan.tag,
        fetchedAt,
        members: extractClanMemberSnapshots(clan),
      });
    }

    return { status: result.status === 'upserted' ? 'snapshot_updated' : 'not_linked', clanTag };
  };
}

interface ClanWithMembers {
  readonly memberList?: readonly RawClanMember[];
  readonly members?: readonly RawClanMember[];
  readonly data?: {
    readonly memberList?: readonly RawClanMember[];
    readonly members?: readonly RawClanMember[];
  };
}

interface RawClanMember {
  readonly tag?: string;
  readonly name?: string;
  readonly role?: string | null;
  readonly expLevel?: number | null;
  readonly league?: { readonly id?: number | null } | null;
  readonly trophies?: number | null;
  readonly builderBaseTrophies?: number | null;
  readonly clanRank?: number | null;
  readonly previousClanRank?: number | null;
  readonly donations?: number | null;
  readonly donationsReceived?: number | null;
}

export function extractClanMemberSnapshots(clan: unknown): ClanMemberSnapshotInput[] {
  const clanWithMembers = clan as ClanWithMembers;
  const memberList =
    clanWithMembers.memberList ??
    clanWithMembers.members ??
    clanWithMembers.data?.memberList ??
    clanWithMembers.data?.members ??
    [];
  return memberList.map((member) => {
    if (!member.tag?.trim()) throw new Error('Clan member payload is missing a player tag.');
    return {
      clanTag: '',
      playerTag: member.tag,
      name: member.name ?? member.tag,
      role: member.role ?? null,
      expLevel: member.expLevel ?? null,
      leagueId: member.league?.id ?? null,
      trophies: member.trophies ?? null,
      builderBaseTrophies: member.builderBaseTrophies ?? null,
      clanRank: member.clanRank ?? null,
      previousClanRank: member.previousClanRank ?? null,
      donations: member.donations ?? null,
      donationsReceived: member.donationsReceived ?? null,
      rawMember: member,
    };
  });
}
