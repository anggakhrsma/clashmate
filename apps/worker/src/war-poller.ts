import type { ClashMateCocClient } from '@clashmate/coc';
import type {
  ClaimedPollingLease,
  NormalizedLatestWarSnapshot,
  WarAttackEventInput,
  WarAttackEventStore,
  WarSnapshotStore,
  WarStateEventInput,
  WarStateEventStore,
} from '@clashmate/database';

export const CURRENT_WAR_RESOURCE_PREFIX = 'current-war:';

export interface WarPollerHandlerOptions {
  readonly coc: Pick<ClashMateCocClient, 'getCurrentWar'>;
  readonly snapshots: WarSnapshotStore;
  readonly attackEvents?: WarAttackEventStore;
  readonly stateEvents?: WarStateEventStore;
  readonly now?: () => Date;
}

export interface WarPollerResult {
  readonly status: 'snapshot_updated' | 'not_linked';
  readonly clanTag: string;
  readonly state: string;
  readonly attackEventsInserted: number;
  readonly stateEventsInserted: number;
}

export function createWarPollerHandler(options: WarPollerHandlerOptions) {
  return async (lease: ClaimedPollingLease): Promise<WarPollerResult> => {
    if (lease.resourceType !== 'war') {
      throw new Error(`War poller cannot process ${lease.resourceType} leases.`);
    }

    const clanTag = parseCurrentWarResourceId(lease.resourceId);
    const previousSnapshot = await options.snapshots.getLatestWarSnapshot(clanTag);
    const war = await options.coc.getCurrentWar(clanTag);
    const fetchedAt = options.now?.() ?? new Date();
    const result = await options.snapshots.upsertLatestWarSnapshot({
      clanTag: war.clanTag,
      state: war.state,
      snapshot: war,
      fetchedAt,
    });

    const attacks = detectWarAttackEvents(war, fetchedAt);
    const attackResult =
      result.status === 'upserted' && options.attackEvents
        ? await options.attackEvents.insertWarAttackEvents(attacks)
        : { inserted: 0 };
    const stateEvent = detectWarStateTransitionEvent(previousSnapshot, war, fetchedAt);
    const stateResult =
      result.status === 'upserted' && stateEvent && options.stateEvents
        ? await options.stateEvents.insertWarStateEvents([stateEvent])
        : { inserted: 0 };

    return {
      status: result.status === 'upserted' ? 'snapshot_updated' : 'not_linked',
      clanTag: war.clanTag,
      state: war.state,
      attackEventsInserted: attackResult.inserted,
      stateEventsInserted: stateResult.inserted,
    };
  };
}

export function detectWarStateTransitionEvent(
  previous: NormalizedLatestWarSnapshot | null,
  current: { clanTag: string; state: string; data?: unknown },
  fetchedAt: Date,
): WarStateEventInput | null {
  if (!previous) return null;

  const previousState = previous.state.trim().toLowerCase();
  const currentState = current.state.trim().toLowerCase();
  if (!previousState || !currentState || previousState === currentState) return null;

  const currentData = isWarData(current.data) ? current.data : undefined;
  return {
    clanTag: current.clanTag,
    warKey: buildWarKey(current.clanTag, currentData ?? {}),
    previousState,
    currentState,
    previousSnapshot: previous.snapshot,
    currentSnapshot: current,
    sourceFetchedAt: fetchedAt,
    occurredAt: chooseWarStateTransitionOccurredAt(currentState, currentData, fetchedAt),
    detectedAt: fetchedAt,
  };
}

export function detectWarAttackEvents(
  war: { clanTag: string; data?: unknown },
  fetchedAt: Date,
): WarAttackEventInput[] {
  const data = war.data;
  if (!isWarData(data)) return [];

  const warKey = buildWarKey(war.clanTag, data);
  const defenderBestOrder = new Map<string, number>();
  for (const member of data.opponent?.members ?? []) {
    if (typeof member.tag === 'string' && typeof member.bestOpponentAttack?.order === 'number') {
      defenderBestOrder.set(member.tag.toUpperCase(), member.bestOpponentAttack.order);
    }
  }

  return (data.clan?.members ?? []).flatMap((member) =>
    (member.attacks ?? []).map((attack) => ({
      clanTag: war.clanTag,
      warKey,
      attackerTag: attack.attackerTag,
      defenderTag: attack.defenderTag,
      attackOrder: attack.order,
      stars: attack.stars,
      destructionPercentage: attack.destructionPercentage,
      duration: attack.duration ?? null,
      freshAttack: defenderBestOrder.get(attack.defenderTag.toUpperCase()) === attack.order,
      rawAttack: attack,
      sourceFetchedAt: fetchedAt,
      occurredAt: fetchedAt,
      detectedAt: fetchedAt,
    })),
  );
}

function buildWarKey(clanTag: string, data: WarData): string {
  const start = data.startTime ?? 'unknown-start';
  const opponentTag = data.opponent?.tag ?? 'unknown-opponent';
  return `current:${clanTag.trim().toUpperCase()}:${opponentTag.trim().toUpperCase()}:${start}`.toLowerCase();
}

function chooseWarStateTransitionOccurredAt(
  currentState: string,
  data: WarData | undefined,
  fetchedAt: Date,
): Date {
  const timestamp =
    currentState === 'preparation'
      ? data?.preparationStartTime
      : currentState === 'inwar'
        ? data?.startTime
        : currentState === 'warended'
          ? data?.endTime
          : undefined;

  if (!timestamp) return fetchedAt;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? fetchedAt : parsed;
}

interface WarData {
  readonly preparationStartTime?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly clan?: { readonly members?: readonly WarMember[] };
  readonly opponent?: { readonly tag?: string; readonly members?: readonly WarMember[] };
}

interface WarMember {
  readonly tag?: string;
  readonly attacks?: readonly WarAttack[];
  readonly bestOpponentAttack?: { readonly order?: number };
}

interface WarAttack {
  readonly attackerTag: string;
  readonly defenderTag: string;
  readonly stars: number;
  readonly destructionPercentage: number;
  readonly order: number;
  readonly duration?: number;
}

function isWarData(value: unknown): value is WarData {
  return typeof value === 'object' && value !== null && 'clan' in value;
}

export function parseCurrentWarResourceId(resourceId: string): string {
  if (!resourceId.startsWith(CURRENT_WAR_RESOURCE_PREFIX)) {
    throw new Error(`Unsupported war polling resource id: ${resourceId}`);
  }

  const clanTag = resourceId.slice(CURRENT_WAR_RESOURCE_PREFIX.length).trim().toUpperCase();
  if (!clanTag) throw new Error('War polling resource id requires a clan tag.');
  return clanTag;
}
