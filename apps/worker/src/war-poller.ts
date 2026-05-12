import type { ClashMateCocClient } from '@clashmate/coc';
import type {
  ClaimedPollingLease,
  MissedWarAttackEventInput,
  MissedWarAttackEventStore,
  NormalizedLatestWarSnapshot,
  WarAttackEventInput,
  WarAttackEventStore,
  WarSnapshotStore,
  WarStateEventInput,
  WarStateEventStore,
} from '@clashmate/database';

export const CURRENT_WAR_RESOURCE_PREFIX = 'current-war:';

const MAX_WAR_ATTACK_STARS = 3;
const MAX_DESTRUCTION_PERCENTAGE = 100;
const MAX_WAR_ATTACK_DURATION_SECONDS = 3600;

export interface WarPollerHandlerOptions {
  readonly coc: Pick<ClashMateCocClient, 'getCurrentWar'>;
  readonly snapshots: WarSnapshotStore;
  readonly attackEvents?: WarAttackEventStore;
  readonly stateEvents?: WarStateEventStore;
  readonly missedAttackEvents?: MissedWarAttackEventStore;
  readonly now?: () => Date;
}

export interface WarPollerResult {
  readonly status: 'snapshot_updated' | 'not_linked';
  readonly linkedOutcome: 'upserted' | 'not_linked';
  readonly clanTag: string;
  readonly state: string;
  readonly normalizedState: string | null;
  readonly warKey: string;
  readonly snapshotSource: 'current-war';
  readonly snapshotFreshnessMs: number | null;
  readonly snapshotHadPrevious: boolean;
  readonly attackEventsGenerated: number;
  readonly attackEventsInserted: number;
  readonly attackEventCoverage: WarPollerInsertionCoverage;
  readonly stateEventsGenerated: number;
  readonly stateEventsInserted: number;
  readonly stateEventCoverage: WarPollerInsertionCoverage;
  readonly missedAttackEventsGenerated: number;
  readonly missedAttackEventsInserted: number;
  readonly missedAttackEventCoverage: WarPollerInsertionCoverage;
  readonly retentionRan: boolean;
  readonly retentionStatus: 'retained' | 'skipped';
  readonly skipReasonContext: WarPollerSkipReasonContext;
  readonly retentionSkipReason?: WarPollerSkipReason;
  readonly attackEventsSkipReason?: WarPollerSkipReason;
  readonly stateEventsSkipReason?: WarPollerSkipReason;
  readonly missedAttackEventsSkipReason?: WarPollerSkipReason;
}

export type WarPollerSkipReason = 'snapshot_not_upserted' | 'store_unavailable' | 'no_events';

export type WarPollerInsertionCoverage =
  | 'inserted_all'
  | 'inserted_partial'
  | 'inserted_none'
  | 'none_generated'
  | 'skipped';

export interface WarPollerSkipReasonContext {
  readonly snapshotUpserted: boolean;
  readonly attackEventStoreAvailable: boolean;
  readonly stateEventStoreAvailable: boolean;
  readonly missedAttackEventStoreAvailable: boolean;
  readonly retentionStoreAvailable: boolean;
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
    const resolvedClanTag = resolveWarClanTag(war, clanTag) ?? clanTag;
    const result = await options.snapshots.upsertLatestWarSnapshot({
      clanTag: resolvedClanTag,
      state: war.state,
      snapshot: war,
      fetchedAt,
    });
    const warKey = buildCurrentWarKey(war);
    const snapshotWasUpserted = result.status === 'upserted';
    const skipReasonContext = {
      snapshotUpserted: snapshotWasUpserted,
      attackEventStoreAvailable: Boolean(options.attackEvents),
      stateEventStoreAvailable: Boolean(options.stateEvents),
      missedAttackEventStoreAvailable: Boolean(options.missedAttackEvents),
      retentionStoreAvailable: Boolean(options.snapshots.retainWarSnapshot),
    } satisfies WarPollerSkipReasonContext;
    let retentionRan = false;
    if (snapshotWasUpserted && options.snapshots.retainWarSnapshot) {
      await options.snapshots.retainWarSnapshot({
        clanTag: resolvedClanTag,
        warKey,
        state: war.state,
        snapshot: war,
        fetchedAt,
      });
      retentionRan = true;
    }

    const attacks = detectWarAttackEvents(war, fetchedAt);
    const attackEventsSkipReason = getWarPollerStoreSkipReason(
      snapshotWasUpserted,
      options.attackEvents,
      attacks.length,
    );
    const attackResult =
      snapshotWasUpserted && options.attackEvents
        ? await options.attackEvents.insertWarAttackEvents(attacks)
        : { inserted: 0 };
    const stateEvent = detectWarStateTransitionEvent(previousSnapshot, war, fetchedAt);
    const stateEvents = stateEvent ? [stateEvent] : [];
    const stateEventsSkipReason = getWarPollerStoreSkipReason(
      snapshotWasUpserted,
      options.stateEvents,
      stateEvents.length,
    );
    const stateResult =
      snapshotWasUpserted && stateEvent && options.stateEvents
        ? await options.stateEvents.insertWarStateEvents(stateEvents)
        : { inserted: 0 };
    const missedAttacks = detectMissedWarAttackEvents(war, fetchedAt);
    const missedAttackEventsSkipReason = getWarPollerStoreSkipReason(
      snapshotWasUpserted,
      options.missedAttackEvents,
      missedAttacks.length,
    );
    const missedAttackResult =
      snapshotWasUpserted && options.missedAttackEvents
        ? await options.missedAttackEvents.insertMissedWarAttackEvents(missedAttacks)
        : { inserted: 0 };

    return {
      status: snapshotWasUpserted ? 'snapshot_updated' : 'not_linked',
      linkedOutcome: result.status,
      clanTag: resolvedClanTag,
      state: war.state,
      normalizedState: normalizeState(war.state),
      warKey,
      snapshotSource: 'current-war',
      snapshotFreshnessMs: previousSnapshot
        ? Math.max(0, fetchedAt.getTime() - previousSnapshot.fetchedAt.getTime())
        : null,
      snapshotHadPrevious: previousSnapshot !== null,
      attackEventsGenerated: attacks.length,
      attackEventsInserted: attackResult.inserted,
      attackEventCoverage: getWarPollerInsertionCoverage(
        snapshotWasUpserted,
        options.attackEvents,
        attacks.length,
        attackResult.inserted,
      ),
      stateEventsGenerated: stateEvents.length,
      stateEventsInserted: stateResult.inserted,
      stateEventCoverage: getWarPollerInsertionCoverage(
        snapshotWasUpserted,
        options.stateEvents,
        stateEvents.length,
        stateResult.inserted,
      ),
      missedAttackEventsGenerated: missedAttacks.length,
      missedAttackEventsInserted: missedAttackResult.inserted,
      missedAttackEventCoverage: getWarPollerInsertionCoverage(
        snapshotWasUpserted,
        options.missedAttackEvents,
        missedAttacks.length,
        missedAttackResult.inserted,
      ),
      retentionRan,
      retentionStatus: retentionRan ? 'retained' : 'skipped',
      skipReasonContext,
      ...(!retentionRan
        ? {
            retentionSkipReason: snapshotWasUpserted
              ? ('store_unavailable' as const)
              : ('snapshot_not_upserted' as const),
          }
        : {}),
      ...(attackEventsSkipReason ? { attackEventsSkipReason } : {}),
      ...(stateEventsSkipReason ? { stateEventsSkipReason } : {}),
      ...(missedAttackEventsSkipReason ? { missedAttackEventsSkipReason } : {}),
    };
  };
}

function getWarPollerStoreSkipReason(
  snapshotWasUpserted: boolean,
  store: unknown,
  generatedCount: number,
): WarPollerSkipReason | undefined {
  if (!snapshotWasUpserted) return 'snapshot_not_upserted';
  if (!store) return 'store_unavailable';
  if (generatedCount === 0) return 'no_events';
  return undefined;
}

function getWarPollerInsertionCoverage(
  snapshotWasUpserted: boolean,
  store: unknown,
  generatedCount: number,
  insertedCount: number,
): WarPollerInsertionCoverage {
  if (!snapshotWasUpserted || !store) return 'skipped';
  if (generatedCount === 0) return 'none_generated';
  if (insertedCount === generatedCount) return 'inserted_all';
  if (insertedCount > 0) return 'inserted_partial';
  return 'inserted_none';
}

export function detectWarStateTransitionEvent(
  previous: NormalizedLatestWarSnapshot | null,
  current: { clanTag?: unknown; state: string; data?: unknown },
  fetchedAt: Date,
): WarStateEventInput | null {
  if (!previous) return null;

  const currentData = extractWarData(current.data ?? current);
  const clanTag = resolveWarClanTag(current);
  if (!clanTag) return null;

  const previousState = normalizeState(previous.state);
  const currentState = normalizeState(current.state);
  if (!previousState || !currentState || previousState === currentState) return null;

  return {
    clanTag,
    warKey: buildCurrentWarKey({ clanTag, data: currentData }),
    previousState,
    currentState,
    previousSnapshot: previous.snapshot,
    currentSnapshot: current,
    sourceFetchedAt: fetchedAt,
    occurredAt: chooseWarStateTransitionOccurredAt(
      currentState,
      currentData ?? undefined,
      fetchedAt,
    ),
    detectedAt: fetchedAt,
  };
}

export function detectWarAttackEvents(
  war: { clanTag?: unknown; data?: unknown },
  fetchedAt: Date,
): WarAttackEventInput[] {
  const data = extractWarData(war.data ?? war);
  if (!data) return [];

  const clanTag = resolveWarClanTag(war);
  if (!clanTag) return [];

  const warKey = buildCurrentWarKey({ clanTag, data });
  const defenderBestOrder = new Map<string, number>();
  for (const member of getWarMembers(data.opponent)) {
    const defenderTag = normalizeTag(member.tag);
    const bestOrder = asPositiveInteger(member.bestOpponentAttack?.order);
    if (defenderTag && bestOrder !== null) {
      defenderBestOrder.set(defenderTag, bestOrder);
    }
  }

  return getWarMembers(data.clan).flatMap((member) =>
    getWarAttacks(member).flatMap((attack) => {
      const normalized = normalizeWarAttack(attack);
      if (!normalized) return [];

      return [
        {
          clanTag,
          warKey,
          attackerTag: normalized.attackerTag,
          defenderTag: normalized.defenderTag,
          attackOrder: normalized.order,
          stars: normalized.stars,
          destructionPercentage: normalized.destructionPercentage,
          duration: normalized.duration,
          freshAttack: defenderBestOrder.get(normalized.defenderTag) === normalized.order,
          rawAttack: attack,
          sourceFetchedAt: fetchedAt,
          occurredAt: fetchedAt,
          detectedAt: fetchedAt,
        },
      ];
    }),
  );
}

export function detectMissedWarAttackEvents(
  war: { clanTag?: unknown; state: string; data?: unknown },
  fetchedAt: Date,
): MissedWarAttackEventInput[] {
  const data = extractWarData(war.data ?? war);
  if (normalizeState(war.state) !== 'warended' || !data) return [];

  const clanTag = normalizeTag(war.clanTag);
  if (!clanTag) return [];
  const perspectiveClan = choosePerspectiveWarClan(clanTag, data);
  if (!perspectiveClan) return [];
  const members = getWarMembers(perspectiveClan);
  if (members.length === 0) return [];

  const attacksAvailable = resolveAttacksPerMember(war, data);
  if (attacksAvailable === null) return [];

  const warKey = buildCurrentWarKey({ clanTag, data });
  const warStartedAt = parseWarTimestamp(data.startTime);
  const warEndedAt = parseWarTimestamp(data.endTime);
  const occurredAt = warEndedAt ?? fetchedAt;
  const membersByTag = new Map<string, WarMember>();
  for (const member of members) {
    const playerTag = normalizeTag(member.tag);
    if (playerTag && !membersByTag.has(playerTag)) {
      membersByTag.set(playerTag, member);
    }
  }

  return [...membersByTag.entries()].flatMap(([playerTag, member]) => {
    const playerName = normalizeNonBlankString(member.name);
    if (!playerName) return [];

    const attacksUsed = getWarAttacks(member).length;
    if (attacksUsed >= attacksAvailable) return [];

    return [
      {
        clanTag,
        warKey,
        playerTag,
        playerName,
        attacksUsed,
        attacksAvailable,
        warSnapshot: war,
        memberSnapshot: member,
        sourceFetchedAt: fetchedAt,
        warStartedAt,
        warEndedAt,
        occurredAt,
        detectedAt: fetchedAt,
      },
    ];
  });
}

export function buildCurrentWarKey(war: { clanTag?: unknown; data?: unknown }): string {
  const clanTag = resolveWarClanTag(war) ?? normalizeNonBlankString(war.clanTag) ?? 'unknown-clan';
  const data = extractWarData(war.data ?? war) ?? {};
  const warTag = normalizeTag(data.warTag) ?? normalizeNonBlankString(data.warTag);
  if (warTag) return `cwl:${warTag}`.toLowerCase();

  const start = normalizeNonBlankString(data.startTime) ?? 'unknown-start';
  const opponentTag = normalizeTag(data.opponent?.tag) ?? 'unknown-opponent';
  return `current:${(normalizeTag(clanTag) ?? clanTag).toUpperCase()}:${opponentTag}:${start}`.toLowerCase();
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

  return parseWarTimestamp(timestamp) ?? fetchedAt;
}

interface WarData {
  readonly warTag?: unknown;
  readonly preparationStartTime?: unknown;
  readonly startTime?: unknown;
  readonly endTime?: unknown;
  readonly attacksPerMember?: unknown;
  readonly clan?: WarClan;
  readonly opponent?: WarClan;
}

interface WarClan {
  readonly tag?: unknown;
  readonly members?: unknown;
  readonly memberList?: unknown;
  readonly attacks?: unknown;
  readonly data?: unknown;
}

interface WarMember {
  readonly tag?: unknown;
  readonly name?: unknown;
  readonly attacks?: unknown;
  readonly bestOpponentAttack?: { readonly order?: unknown };
  readonly data?: unknown;
}

interface WarAttack {
  readonly attackerTag?: unknown;
  readonly defenderTag?: unknown;
  readonly stars?: unknown;
  readonly destructionPercentage?: unknown;
  readonly order?: unknown;
  readonly duration?: unknown;
}

function isWarData(value: unknown): value is WarData {
  return isRecord(value) && 'clan' in value;
}

function extractWarData(value: unknown): WarData | null {
  const unwrapped = unwrapWarRecord(value);
  return isWarData(unwrapped) ? unwrapped : null;
}

function unwrapWarRecord(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const record = value as { readonly data?: unknown; readonly snapshot?: unknown };
  const data = record.data;
  if (isRecord(data)) return unwrapWarRecord(data);

  const snapshot = record.snapshot;
  if (isRecord(snapshot)) return unwrapWarRecord(snapshot);

  return value;
}

function resolveWarClanTag(
  war: { clanTag?: unknown; data?: unknown },
  fallback?: string,
): string | null {
  const directClanTag = normalizeTag(war.clanTag);
  if (directClanTag) return directClanTag;

  const data = extractWarData(war.data ?? war);
  const dataClanTag = normalizeTag(data?.clan?.tag);
  if (dataClanTag) return dataClanTag;

  return normalizeTag(fallback);
}

function choosePerspectiveWarClan(clanTag: string, data: WarData): WarClan | undefined {
  if (normalizeTag(data.clan?.tag) === clanTag) return data.clan;
  if (normalizeTag(data.opponent?.tag) === clanTag) return data.opponent;
  return undefined;
}

function parseWarTimestamp(timestamp: unknown): Date | null {
  if (typeof timestamp !== 'string' || timestamp.trim().length === 0) return null;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getWarMembers(clan: WarClan | undefined): readonly WarMember[] {
  const unwrapped = unwrapWarRecord(clan);
  if (!isRecord(unwrapped)) return [];
  const clanRecord = unwrapped as { readonly members?: unknown; readonly memberList?: unknown };

  const members = Array.isArray(clanRecord.members)
    ? clanRecord.members
    : Array.isArray(clanRecord.memberList)
      ? clanRecord.memberList
      : [];

  return members.map(unwrapWarRecord).filter(isRecord);
}

function getWarAttacks(member: WarMember): readonly WarAttack[] {
  const unwrapped = unwrapWarRecord(member);
  if (!isRecord(unwrapped)) return [];
  const attackRecord = unwrapped as { readonly attacks?: unknown };
  const attacks = attackRecord.attacks;
  return Array.isArray(attacks) ? attacks.map(unwrapWarRecord).filter(isRecord) : [];
}

function normalizeWarAttack(attack: WarAttack): {
  readonly attackerTag: string;
  readonly defenderTag: string;
  readonly order: number;
  readonly stars: number;
  readonly destructionPercentage: number;
  readonly duration: number | null;
} | null {
  const attackerTag = normalizeTag(attack.attackerTag);
  const defenderTag = normalizeTag(attack.defenderTag);
  const order = asPositiveInteger(attack.order);
  const stars = asIntegerInRange(attack.stars, 0, MAX_WAR_ATTACK_STARS);
  const destructionPercentage = asIntegerInRange(
    attack.destructionPercentage,
    0,
    MAX_DESTRUCTION_PERCENTAGE,
  );
  const duration =
    attack.duration === undefined
      ? null
      : asIntegerInRange(attack.duration, 0, MAX_WAR_ATTACK_DURATION_SECONDS);
  const hasMalformedDuration = attack.duration !== undefined && duration === null;

  if (
    !attackerTag ||
    !defenderTag ||
    order === null ||
    stars === null ||
    destructionPercentage === null ||
    hasMalformedDuration
  ) {
    return null;
  }

  return { attackerTag, defenderTag, order, stars, destructionPercentage, duration };
}

function normalizeAttacksPerMember(value: unknown): number | null {
  if (value === undefined) return 2;
  const attacksPerMember = asNonNegativeInteger(value);
  return attacksPerMember !== null && attacksPerMember > 0 ? attacksPerMember : null;
}

function resolveAttacksPerMember(war: { readonly data?: unknown }, data: WarData): number | null {
  for (const candidate of getAttacksPerMemberCandidates(war, data)) {
    if (candidate === undefined) continue;
    const attacksPerMember = normalizeAttacksPerMember(candidate);
    if (attacksPerMember !== null) return attacksPerMember;
  }

  return normalizeAttacksPerMember(undefined);
}

function getAttacksPerMemberCandidates(war: { readonly data?: unknown }, data: WarData): unknown[] {
  const candidates: unknown[] = [];
  const pushCandidate = (value: unknown) => {
    if (!isRecord(value)) return;
    const record = value as { readonly attacksPerMember?: unknown };
    candidates.push(record.attacksPerMember);
  };

  pushCandidate(war);
  pushCandidate(war.data);
  pushCandidate(unwrapWarRecord(war));
  pushCandidate(data);

  return candidates;
}

function asNonNegativeInteger(value: unknown): number | null {
  return asIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

function asPositiveInteger(value: unknown): number | null {
  return asIntegerInRange(value, 1, Number.MAX_SAFE_INTEGER);
}

function asIntegerInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

function normalizeState(value: unknown): string | null {
  return normalizeNonBlankString(value)?.toLowerCase() ?? null;
}

function normalizeTag(value: unknown): string | null {
  return normalizeNonBlankString(value)?.toUpperCase() ?? null;
}

function normalizeNonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseCurrentWarResourceId(resourceId: string): string {
  if (!resourceId.startsWith(CURRENT_WAR_RESOURCE_PREFIX)) {
    throw new Error(`Unsupported war polling resource id: ${resourceId}`);
  }

  const clanTag = resourceId.slice(CURRENT_WAR_RESOURCE_PREFIX.length).trim().toUpperCase();
  if (!clanTag) throw new Error('War polling resource id requires a clan tag.');
  return clanTag;
}
