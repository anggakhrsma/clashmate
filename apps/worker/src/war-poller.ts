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
  readonly clanTag: string;
  readonly state: string;
  readonly attackEventsInserted: number;
  readonly stateEventsInserted: number;
  readonly missedAttackEventsInserted: number;
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
    const warKey = buildCurrentWarKey(war);
    if (result.status === 'upserted' && options.snapshots.retainWarSnapshot) {
      await options.snapshots.retainWarSnapshot({
        clanTag: war.clanTag,
        warKey,
        state: war.state,
        snapshot: war,
        fetchedAt,
      });
    }

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
    const missedAttacks = detectMissedWarAttackEvents(war, fetchedAt);
    const missedAttackResult =
      result.status === 'upserted' && options.missedAttackEvents
        ? await options.missedAttackEvents.insertMissedWarAttackEvents(missedAttacks)
        : { inserted: 0 };

    return {
      status: result.status === 'upserted' ? 'snapshot_updated' : 'not_linked',
      clanTag: war.clanTag,
      state: war.state,
      attackEventsInserted: attackResult.inserted,
      stateEventsInserted: stateResult.inserted,
      missedAttackEventsInserted: missedAttackResult.inserted,
    };
  };
}

export function detectWarStateTransitionEvent(
  previous: NormalizedLatestWarSnapshot | null,
  current: { clanTag: string; state: string; data?: unknown },
  fetchedAt: Date,
): WarStateEventInput | null {
  if (!previous) return null;

  const clanTag = normalizeTag(current.clanTag);
  if (!clanTag) return null;

  const previousState = normalizeState(previous.state);
  const currentState = normalizeState(current.state);
  if (!previousState || !currentState || previousState === currentState) return null;

  const currentData = isWarData(current.data) ? current.data : undefined;
  return {
    clanTag,
    warKey: buildCurrentWarKey({ clanTag, data: currentData }),
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

  const clanTag = normalizeTag(war.clanTag);
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
  war: { clanTag: string; state: string; data?: unknown },
  fetchedAt: Date,
): MissedWarAttackEventInput[] {
  const data = war.data;
  if (normalizeState(war.state) !== 'warended' || !isWarData(data)) return [];

  const clanTag = normalizeTag(war.clanTag);
  if (!clanTag) return [];
  const perspectiveClan = choosePerspectiveWarClan(clanTag, data);
  const members = getWarMembers(perspectiveClan);
  if (members.length === 0) return [];

  const attacksAvailable = normalizeAttacksPerMember(data.attacksPerMember);
  if (attacksAvailable === null) return [];

  const warKey = buildCurrentWarKey({ clanTag, data });
  const warStartedAt = parseWarTimestamp(data.startTime);
  const warEndedAt = parseWarTimestamp(data.endTime);
  const occurredAt = warEndedAt ?? fetchedAt;

  return members.flatMap((member) => {
    const playerTag = normalizeTag(member.tag);
    const playerName = normalizeNonBlankString(member.name);
    if (!playerTag || !playerName) return [];

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

export function buildCurrentWarKey(war: { clanTag: string; data?: unknown }): string {
  const clanTag = normalizeTag(war.clanTag) ?? war.clanTag;
  const data = isWarData(war.data) ? war.data : {};
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
}

interface WarMember {
  readonly tag?: unknown;
  readonly name?: unknown;
  readonly attacks?: unknown;
  readonly bestOpponentAttack?: { readonly order?: unknown };
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

function choosePerspectiveWarClan(clanTag: string, data: WarData): WarClan | undefined {
  if (normalizeTag(data.clan?.tag) === clanTag) return data.clan;
  if (normalizeTag(data.opponent?.tag) === clanTag) return data.opponent;
  return data.clan;
}

function parseWarTimestamp(timestamp: unknown): Date | null {
  if (typeof timestamp !== 'string' || timestamp.trim().length === 0) return null;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getWarMembers(clan: WarClan | undefined): readonly WarMember[] {
  return Array.isArray(clan?.members) ? clan.members.filter(isRecord) : [];
}

function getWarAttacks(member: WarMember): readonly WarAttack[] {
  return Array.isArray(member.attacks) ? member.attacks.filter(isRecord) : [];
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
