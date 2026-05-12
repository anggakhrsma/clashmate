import type {
  ClanMemberSnapshotReader,
  DatabaseAutoroleSettingsStore,
  DatabaseNicknameConfigStore,
  DatabaseReconciliationPlanningOutcomeStore,
  GuildAutoroleSettingsRecord,
  GuildNicknameConfigRecord,
} from '@clashmate/database';

interface LoggerLike {
  debug?: (payload: unknown, message?: string) => void;
  error?: (payload: unknown, message?: string) => void;
  info?: (payload: unknown, message?: string) => void;
}

export interface ReconciliationPlanningLoopOptions {
  readonly autoroles: Pick<DatabaseAutoroleSettingsStore, 'listAutoroleSettings'>;
  readonly nicknames: Pick<DatabaseNicknameConfigStore, 'listNicknameConfigs'>;
  readonly snapshots: ClanMemberSnapshotReader;
  readonly outcomes?: Pick<
    DatabaseReconciliationPlanningOutcomeStore,
    'insertReconciliationPlanningOutcome'
  >;
  readonly interval: {
    readonly baseSeconds: number;
    readonly jitterSeconds: number;
  };
  readonly logger?: LoggerLike;
  readonly random?: () => number;
}

export interface ReconciliationPlanningLoopController {
  readonly stop: () => void;
}

export interface ReconciliationPlanningIterationResult {
  readonly autoroleSettingsScanned: number;
  readonly autoroleRunsPlanned: number;
  readonly autoroleSkipsPlanned: number;
  readonly nicknameSettingsScanned: number;
  readonly nicknameRunsPlanned: number;
  readonly nicknameSkipsPlanned: number;
}

interface ReconciliationPlanningIterationDiagnostics {
  readonly guildsScanned: number;
  readonly settingsScanned: {
    readonly autorole: number;
    readonly nickname: number;
  };
  readonly runsPlanned: {
    readonly autorole: number;
    readonly nickname: number;
  };
  readonly skipped: {
    readonly autorole: number;
    readonly nickname: number;
    readonly total: number;
  };
  readonly candidateActions: {
    readonly autorole: number;
    readonly nickname: number;
    readonly total: number;
  };
  readonly snapshotContext: {
    readonly guildsWithSnapshots: number;
    readonly guildsMissingSnapshots: number;
    readonly clans: number;
    readonly members: number;
    readonly snapshotsWithoutMembers: number;
    readonly oldestFetchedAt: string | null;
    readonly newestFetchedAt: string | null;
  };
  readonly skipReasons: Record<string, number>;
}

export interface PlannedReconciliationOutcome {
  readonly guildId: string;
  readonly feature: 'autorole' | 'nickname';
  readonly enabled: boolean;
  readonly shouldRun: boolean;
  readonly reason: string;
  readonly snapshotClanCount: number;
  readonly snapshotMemberCount: number;
  readonly candidateActions: number;
}

type Snapshot = Awaited<
  ReturnType<ClanMemberSnapshotReader['listClanMemberSnapshotsForGuild']>
>[number];

export async function runReconciliationPlanningIteration(
  options: ReconciliationPlanningLoopOptions,
): Promise<ReconciliationPlanningIterationResult> {
  validateReconciliationPlanningLoopOptions(options);

  const [autoroleSettings, nicknameConfigs] = await Promise.all([
    options.autoroles.listAutoroleSettings(),
    options.nicknames.listNicknameConfigs(),
  ]);
  const snapshotCache = new Map<string, readonly Snapshot[]>();
  const outcomes: PlannedReconciliationOutcome[] = [];

  for (const settings of autoroleSettings) {
    try {
      const snapshots = await getGuildSnapshots(options.snapshots, snapshotCache, settings.guildId);
      outcomes.push(planAutorole(settings, snapshots));
    } catch (error) {
      options.logger?.error?.(
        { error, guildId: settings.guildId, feature: 'autorole' },
        'Background reconciliation planning failed for guild',
      );
      throw error;
    }
  }

  for (const config of nicknameConfigs) {
    try {
      const snapshots = await getGuildSnapshots(options.snapshots, snapshotCache, config.guildId);
      outcomes.push(planNickname(config, snapshots));
    } catch (error) {
      options.logger?.error?.(
        { error, guildId: config.guildId, feature: 'nickname' },
        'Background reconciliation planning failed for guild',
      );
      throw error;
    }
  }

  const plannedAt = new Date();
  for (const outcome of outcomes) {
    options.logger?.info?.(outcome, 'Background reconciliation planning outcome');
    try {
      await options.outcomes?.insertReconciliationPlanningOutcome({
        guildId: outcome.guildId,
        feature: outcome.feature,
        enabled: outcome.enabled,
        shouldRun: outcome.shouldRun,
        reason: outcome.reason,
        snapshotClanCount: outcome.snapshotClanCount,
        snapshotMemberCount: outcome.snapshotMemberCount,
        candidateActionCount: outcome.candidateActions,
        plannedAt,
      });
    } catch (error) {
      options.logger?.error?.(
        { error, guildId: outcome.guildId, feature: outcome.feature },
        'Background reconciliation planning outcome persistence failed for guild',
      );
      throw error;
    }
  }

  const autoroleRunsPlanned = outcomes.filter(
    (outcome) => outcome.feature === 'autorole' && outcome.shouldRun,
  ).length;
  const nicknameRunsPlanned = outcomes.filter(
    (outcome) => outcome.feature === 'nickname' && outcome.shouldRun,
  ).length;

  const result = {
    autoroleSettingsScanned: autoroleSettings.length,
    autoroleRunsPlanned,
    autoroleSkipsPlanned: autoroleSettings.length - autoroleRunsPlanned,
    nicknameSettingsScanned: nicknameConfigs.length,
    nicknameRunsPlanned,
    nicknameSkipsPlanned: nicknameConfigs.length - nicknameRunsPlanned,
  } satisfies ReconciliationPlanningIterationResult;

  options.logger?.debug?.(result, 'Background reconciliation planning iteration completed');
  options.logger?.info?.(
    buildReconciliationPlanningIterationDiagnostics(
      outcomes,
      snapshotCache,
      autoroleSettings.length,
      nicknameConfigs.length,
      autoroleRunsPlanned,
      nicknameRunsPlanned,
    ),
    'Background reconciliation planning iteration diagnostics',
  );
  return result;
}

export function startReconciliationPlanningLoop(
  options: ReconciliationPlanningLoopOptions,
): ReconciliationPlanningLoopController {
  validateReconciliationPlanningLoopOptions(options);

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (stopped) return;
    const delayMs = computeReconciliationPlanningLoopDelayMs(options.interval, options.random);
    timer = setTimeout(async () => {
      await runReconciliationPlanningIteration(options).catch((error: unknown) => {
        options.logger?.error?.({ error }, 'Background reconciliation planning iteration failed');
      });
      schedule();
    }, delayMs);
  };

  void runReconciliationPlanningIteration(options).catch((error: unknown) => {
    options.logger?.error?.(
      { error },
      'Initial background reconciliation planning iteration failed',
    );
  });
  schedule();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export function computeReconciliationPlanningLoopDelayMs(
  interval: ReconciliationPlanningLoopOptions['interval'],
  random: () => number = Math.random,
): number {
  const baseMs = Math.max(1, Math.trunc(interval.baseSeconds)) * 1000;
  const jitterMs = Math.max(0, Math.trunc(interval.jitterSeconds)) * 1000;
  return baseMs + Math.floor(random() * (jitterMs + 1));
}

function planAutorole(
  settings: GuildAutoroleSettingsRecord,
  snapshots: readonly Snapshot[],
): PlannedReconciliationOutcome {
  const snapshotMemberCount = countSnapshotMembers(snapshots);
  const configuredRoleCount = countConfiguredAutoroleRoles(settings);
  const enabled = settings.config.autoUpdateRoles === true;
  const hasMappings = configuredRoleCount > 0;
  const shouldRun = enabled && hasMappings && snapshotMemberCount > 0;

  return {
    guildId: settings.guildId,
    feature: 'autorole',
    enabled,
    shouldRun,
    reason: !enabled
      ? 'auto_update_roles is disabled'
      : !hasMappings
        ? 'no autorole mappings are configured'
        : snapshotMemberCount === 0
          ? 'no linked-clan member snapshots are available'
          : 'scheduled autorole reconciliation is safe to run',
    snapshotClanCount: snapshots.length,
    snapshotMemberCount,
    candidateActions: shouldRun ? configuredRoleCount * snapshotMemberCount : 0,
  };
}

function planNickname(
  config: GuildNicknameConfigRecord,
  snapshots: readonly Snapshot[],
): PlannedReconciliationOutcome {
  const snapshotMemberCount = countSnapshotMembers(snapshots);
  const format = config.familyNicknameFormat ?? config.nonFamilyNicknameFormat;
  const enabled = config.changeNicknames === 'true';
  const shouldRun = enabled && Boolean(format) && snapshotMemberCount > 0;

  return {
    guildId: config.guildId,
    feature: 'nickname',
    enabled,
    shouldRun,
    reason: !enabled
      ? 'change_nicknames is disabled'
      : !format
        ? 'no nickname format is configured'
        : snapshotMemberCount === 0
          ? 'no linked-clan member snapshots are available'
          : 'scheduled nickname reconciliation is safe to run with Discord permission and hierarchy checks',
    snapshotClanCount: snapshots.length,
    snapshotMemberCount,
    candidateActions: shouldRun ? snapshotMemberCount : 0,
  };
}

async function getGuildSnapshots(
  reader: ClanMemberSnapshotReader,
  cache: Map<string, readonly Snapshot[]>,
  guildId: string,
): Promise<readonly Snapshot[]> {
  const cached = cache.get(guildId);
  if (cached) return cached;
  const snapshots = await reader.listClanMemberSnapshotsForGuild({ guildId });
  cache.set(guildId, snapshots);
  return snapshots;
}

function countSnapshotMembers(snapshots: readonly Snapshot[]): number {
  return snapshots.reduce((total, snapshot) => total + snapshot.members.length, 0);
}

function countConfiguredAutoroleRoles(settings: GuildAutoroleSettingsRecord): number {
  return new Set(
    [
      ...Object.values(settings.townHallRoles),
      ...Object.values(settings.leagueRoles),
      ...Object.values(settings.familyRoles),
      ...Object.values(settings.clanRoles).flatMap((roles) => Object.values(roles)),
    ].filter(Boolean),
  ).size;
}

function buildReconciliationPlanningIterationDiagnostics(
  outcomes: readonly PlannedReconciliationOutcome[],
  snapshotsByGuild: ReadonlyMap<string, readonly Snapshot[]>,
  autoroleSettingsScanned: number,
  nicknameSettingsScanned: number,
  autoroleRunsPlanned: number,
  nicknameRunsPlanned: number,
): ReconciliationPlanningIterationDiagnostics {
  const guildIds = new Set(outcomes.map((outcome) => outcome.guildId));
  const skippedOutcomes = outcomes.filter((outcome) => !outcome.shouldRun);
  const skipReasons = skippedOutcomes.reduce<Record<string, number>>((counts, outcome) => {
    counts[outcome.reason] = (counts[outcome.reason] ?? 0) + 1;
    return counts;
  }, {});
  const candidateAutoroleActions = sumCandidateActions(outcomes, 'autorole');
  const candidateNicknameActions = sumCandidateActions(outcomes, 'nickname');
  const snapshotContext = summarizeSnapshotContext(snapshotsByGuild);

  return {
    guildsScanned: guildIds.size,
    settingsScanned: {
      autorole: autoroleSettingsScanned,
      nickname: nicknameSettingsScanned,
    },
    runsPlanned: {
      autorole: autoroleRunsPlanned,
      nickname: nicknameRunsPlanned,
    },
    skipped: {
      autorole: autoroleSettingsScanned - autoroleRunsPlanned,
      nickname: nicknameSettingsScanned - nicknameRunsPlanned,
      total: skippedOutcomes.length,
    },
    candidateActions: {
      autorole: candidateAutoroleActions,
      nickname: candidateNicknameActions,
      total: candidateAutoroleActions + candidateNicknameActions,
    },
    snapshotContext,
    skipReasons,
  };
}

function sumCandidateActions(
  outcomes: readonly PlannedReconciliationOutcome[],
  feature: PlannedReconciliationOutcome['feature'],
): number {
  return outcomes
    .filter((outcome) => outcome.feature === feature)
    .reduce((total, outcome) => total + outcome.candidateActions, 0);
}

function summarizeSnapshotContext(
  snapshotsByGuild: ReadonlyMap<string, readonly Snapshot[]>,
): ReconciliationPlanningIterationDiagnostics['snapshotContext'] {
  let guildsWithSnapshots = 0;
  let clans = 0;
  let members = 0;
  let snapshotsWithoutMembers = 0;
  let oldestFetchedAt: Date | null = null;
  let newestFetchedAt: Date | null = null;

  for (const snapshots of snapshotsByGuild.values()) {
    const guildMemberCount = countSnapshotMembers(snapshots);
    if (snapshots.length > 0 && guildMemberCount > 0) guildsWithSnapshots += 1;
    clans += snapshots.length;
    members += guildMemberCount;
    snapshotsWithoutMembers += snapshots.filter((snapshot) => snapshot.members.length === 0).length;

    for (const snapshot of snapshots) {
      for (const member of snapshot.members) {
        if (!oldestFetchedAt || member.lastFetchedAt < oldestFetchedAt) {
          oldestFetchedAt = member.lastFetchedAt;
        }
        if (!newestFetchedAt || member.lastFetchedAt > newestFetchedAt) {
          newestFetchedAt = member.lastFetchedAt;
        }
      }
    }
  }

  return {
    guildsWithSnapshots,
    guildsMissingSnapshots: snapshotsByGuild.size - guildsWithSnapshots,
    clans,
    members,
    snapshotsWithoutMembers,
    oldestFetchedAt: oldestFetchedAt?.toISOString() ?? null,
    newestFetchedAt: newestFetchedAt?.toISOString() ?? null,
  };
}

function validateReconciliationPlanningLoopOptions(
  options: ReconciliationPlanningLoopOptions,
): void {
  if (!options.autoroles) throw new Error('Reconciliation planning autorole store is required.');
  if (!options.nicknames) throw new Error('Reconciliation planning nickname store is required.');
  if (!options.snapshots) throw new Error('Reconciliation planning snapshot reader is required.');
  if (!options.interval) throw new Error('Reconciliation planning interval config is required.');
  if (!Number.isFinite(options.interval.baseSeconds) || options.interval.baseSeconds < 1) {
    throw new Error('Reconciliation planning base interval must be at least 1 second.');
  }
  if (!Number.isFinite(options.interval.jitterSeconds) || options.interval.jitterSeconds < 0) {
    throw new Error('Reconciliation planning jitter interval cannot be negative.');
  }
}
