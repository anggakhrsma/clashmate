import type {
  ClanMemberSnapshotReader,
  DatabaseAutoroleSettingsStore,
  DatabaseNicknameConfigStore,
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
    const snapshots = await getGuildSnapshots(options.snapshots, snapshotCache, settings.guildId);
    outcomes.push(planAutorole(settings, snapshots));
  }

  for (const config of nicknameConfigs) {
    const snapshots = await getGuildSnapshots(options.snapshots, snapshotCache, config.guildId);
    outcomes.push(planNickname(config, snapshots));
  }

  for (const outcome of outcomes) {
    options.logger?.info?.(outcome, 'Background reconciliation planning outcome');
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

function validateReconciliationPlanningLoopOptions(
  options: ReconciliationPlanningLoopOptions,
): void {
  if (!options.autoroles) throw new Error('Reconciliation planning autorole store is required.');
  if (!options.nicknames) throw new Error('Reconciliation planning nickname store is required.');
  if (!options.snapshots) throw new Error('Reconciliation planning snapshot reader is required.');
  if (!Number.isFinite(options.interval.baseSeconds) || options.interval.baseSeconds < 1) {
    throw new Error('Reconciliation planning base interval must be at least 1 second.');
  }
  if (!Number.isFinite(options.interval.jitterSeconds) || options.interval.jitterSeconds < 0) {
    throw new Error('Reconciliation planning jitter interval cannot be negative.');
  }
}
