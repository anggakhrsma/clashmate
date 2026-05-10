import type {
  FanOutClanDonationEventNotificationsInput,
  FanOutClanGamesEventNotificationsInput,
  FanOutClanMemberEventNotificationsInput,
  FanOutClanRoleChangeEventNotificationsInput,
  FanOutMissedWarAttackEventNotificationsInput,
  FanOutWarAttackEventNotificationsInput,
  FanOutWarStateEventNotificationsInput,
  NotificationFanOutStore,
} from '@clashmate/database';
import type { Logger } from '@clashmate/logger';

export interface NotificationFanOutLoopIntervalConfig {
  readonly baseSeconds: number;
  readonly jitterSeconds: number;
}

export interface NotificationFanOutLoopOptions {
  readonly fanOutStore: NotificationFanOutStore;
  readonly interval: NotificationFanOutLoopIntervalConfig;
  readonly batchSize?: number;
  readonly logger: Pick<Logger, 'debug' | 'error' | 'info'>;
  readonly random?: () => number;
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
}

export interface NotificationFanOutLoopController {
  stop: () => void;
  runOnce: () => Promise<void>;
}

export type NotificationFanOutSource =
  | 'clanMember'
  | 'warAttack'
  | 'warState'
  | 'missedWarAttack'
  | 'clanDonation'
  | 'clanRoleChange'
  | 'clanGames';

export interface NotificationFanOutSourceResultSummary {
  readonly source: NotificationFanOutSource;
  readonly attempted: number;
  readonly created: number;
  readonly skipped: number;
  readonly failed: number;
  readonly cursorAdvanced: boolean;
  readonly eventsScanned: number;
  readonly matchedTargets: number;
  readonly insertedOutboxEntries: number;
  readonly errorMessage?: string;
}

export interface NotificationFanOutTotalsSummary {
  readonly attempted: number;
  readonly created: number;
  readonly skipped: number;
  readonly failed: number;
  readonly cursorsAdvanced: number;
  readonly totalOutboxRowsCreated: number;
  readonly eventsScanned: number;
  readonly matchedTargets: number;
  readonly insertedOutboxEntries: number;
}

export interface NotificationFanOutIterationSummary {
  readonly sources: readonly NotificationFanOutSourceResultSummary[];
  readonly totals: NotificationFanOutTotalsSummary;
  readonly failedFamilies: readonly { source: NotificationFanOutSource; message: string }[];
  readonly error: boolean;
  readonly errorMessage?: string;
}

type NotificationFanOutSourceStoreResult = Pick<
  NotificationFanOutTotalsSummary,
  'eventsScanned' | 'matchedTargets' | 'insertedOutboxEntries'
>;

const MAX_NOTIFICATION_FANOUT_BATCH_SIZE = 1000;

function resolveNotificationFanOutIterationLimit(
  batchSize: number | undefined,
): number | undefined {
  if (batchSize === undefined) return undefined;
  if (!Number.isFinite(batchSize) || !Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('Notification fan-out batchSize must be a finite positive integer.');
  }
  if (batchSize > MAX_NOTIFICATION_FANOUT_BATCH_SIZE) {
    throw new Error(
      `Notification fan-out batchSize must not exceed ${MAX_NOTIFICATION_FANOUT_BATCH_SIZE}.`,
    );
  }
  return batchSize;
}

function createNotificationFanOutInput(limit: number | undefined): { limit?: number } {
  return limit === undefined ? {} : { limit };
}

function summarizeNotificationFanOutSourceResult(
  source: NotificationFanOutSource,
  result: NotificationFanOutSourceStoreResult,
): NotificationFanOutSourceResultSummary {
  return {
    source,
    attempted: result.eventsScanned,
    created: result.insertedOutboxEntries,
    skipped: Math.max(result.matchedTargets - result.insertedOutboxEntries, 0),
    failed: 0,
    cursorAdvanced: result.eventsScanned > 0,
    eventsScanned: result.eventsScanned,
    matchedTargets: result.matchedTargets,
    insertedOutboxEntries: result.insertedOutboxEntries,
  };
}

function summarizeNotificationFanOutSourceFailure(
  source: NotificationFanOutSource,
  error: unknown,
): NotificationFanOutSourceResultSummary {
  return {
    source,
    attempted: 0,
    created: 0,
    skipped: 0,
    failed: 1,
    cursorAdvanced: false,
    eventsScanned: 0,
    matchedTargets: 0,
    insertedOutboxEntries: 0,
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

function createNotificationFanOutIterationSummary(
  sources: readonly NotificationFanOutSourceResultSummary[],
): NotificationFanOutIterationSummary {
  return {
    sources,
    totals: sources.reduce<NotificationFanOutTotalsSummary>(
      (totals, source) => ({
        attempted: totals.attempted + source.attempted,
        created: totals.created + source.created,
        skipped: totals.skipped + source.skipped,
        failed: totals.failed + source.failed,
        cursorsAdvanced: totals.cursorsAdvanced + (source.cursorAdvanced ? 1 : 0),
        totalOutboxRowsCreated: totals.totalOutboxRowsCreated + source.insertedOutboxEntries,
        eventsScanned: totals.eventsScanned + source.eventsScanned,
        matchedTargets: totals.matchedTargets + source.matchedTargets,
        insertedOutboxEntries: totals.insertedOutboxEntries + source.insertedOutboxEntries,
      }),
      {
        attempted: 0,
        created: 0,
        skipped: 0,
        failed: 0,
        cursorsAdvanced: 0,
        totalOutboxRowsCreated: 0,
        eventsScanned: 0,
        matchedTargets: 0,
        insertedOutboxEntries: 0,
      },
    ),
    failedFamilies: sources
      .filter((source) => source.failed > 0)
      .map((source) => ({
        source: source.source,
        message: source.errorMessage ?? 'Unknown error',
      })),
    error: sources.some((source) => source.failed > 0),
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

async function runNotificationFanOutSource(
  source: NotificationFanOutSource,
  run: () => Promise<NotificationFanOutSourceStoreResult>,
  logger: Pick<Logger, 'error'>,
): Promise<NotificationFanOutSourceResultSummary> {
  try {
    return summarizeNotificationFanOutSourceResult(source, await run());
  } catch (error) {
    const summary = summarizeNotificationFanOutSourceFailure(source, error);
    logger.error({ error, source }, 'Notification fan-out source failed');
    return summary;
  }
}

function validateNotificationFanOutLoopOptions(options: NotificationFanOutLoopOptions): void {
  if (!isObjectRecord(options)) {
    throw new Error('Notification fan-out options must be an object.');
  }

  const { fanOutStore, logger } = options;
  if (!isObjectRecord(fanOutStore)) {
    throw new Error('Notification fan-out fanOutStore must be an object.');
  }

  for (const method of [
    'fanOutClanMemberEventNotifications',
    'fanOutWarAttackEventNotifications',
    'fanOutWarStateEventNotifications',
    'fanOutMissedWarAttackEventNotifications',
    'fanOutClanDonationEventNotifications',
    'fanOutClanRoleChangeEventNotifications',
  ] as const) {
    if (typeof fanOutStore[method] !== 'function') {
      throw new Error(`Notification fan-out fanOutStore.${method} must be a function.`);
    }
  }

  if (
    fanOutStore.fanOutClanGamesEventNotifications !== undefined &&
    typeof fanOutStore.fanOutClanGamesEventNotifications !== 'function'
  ) {
    throw new Error(
      'Notification fan-out fanOutStore.fanOutClanGamesEventNotifications must be a function when provided.',
    );
  }

  if (!isObjectRecord(logger)) {
    throw new Error('Notification fan-out logger must be an object.');
  }
  if (typeof logger.info !== 'function') {
    throw new Error('Notification fan-out logger.info must be a function.');
  }
  if (typeof logger.error !== 'function') {
    throw new Error('Notification fan-out logger.error must be a function.');
  }

  if (options.random !== undefined && typeof options.random !== 'function') {
    throw new Error('Notification fan-out random must be a function when provided.');
  }
  if (options.setTimeout !== undefined && typeof options.setTimeout !== 'function') {
    throw new Error('Notification fan-out setTimeout must be a function when provided.');
  }
  if (options.clearTimeout !== undefined && typeof options.clearTimeout !== 'function') {
    throw new Error('Notification fan-out clearTimeout must be a function when provided.');
  }
}

export function computeNotificationFanOutLoopDelayMs(
  interval: NotificationFanOutLoopIntervalConfig,
  random = Math.random,
): number {
  if (
    !Number.isFinite(interval.baseSeconds) ||
    !Number.isFinite(interval.jitterSeconds) ||
    interval.baseSeconds <= 0 ||
    interval.jitterSeconds < 0
  ) {
    throw new Error(
      'Notification fan-out loop intervals must be finite and positive with non-negative jitter.',
    );
  }

  const jitter = Math.floor(random() * (interval.jitterSeconds + 1));
  return (interval.baseSeconds + jitter) * 1000;
}

export async function runNotificationFanOutIteration(
  options: NotificationFanOutLoopOptions,
): Promise<NotificationFanOutIterationSummary> {
  validateNotificationFanOutLoopOptions(options);
  const limit = resolveNotificationFanOutIterationLimit(options.batchSize);

  const sources: NotificationFanOutSourceResultSummary[] = [];
  const clanMemberInput: FanOutClanMemberEventNotificationsInput =
    createNotificationFanOutInput(limit);
  sources.push(
    await runNotificationFanOutSource(
      'clanMember',
      () => options.fanOutStore.fanOutClanMemberEventNotifications(clanMemberInput),
      options.logger,
    ),
  );

  const warAttackInput: FanOutWarAttackEventNotificationsInput =
    createNotificationFanOutInput(limit);
  sources.push(
    await runNotificationFanOutSource(
      'warAttack',
      () => options.fanOutStore.fanOutWarAttackEventNotifications(warAttackInput),
      options.logger,
    ),
  );

  const warStateInput: FanOutWarStateEventNotificationsInput = createNotificationFanOutInput(limit);
  sources.push(
    await runNotificationFanOutSource(
      'warState',
      () => options.fanOutStore.fanOutWarStateEventNotifications(warStateInput),
      options.logger,
    ),
  );

  const missedWarAttackInput: FanOutMissedWarAttackEventNotificationsInput =
    createNotificationFanOutInput(limit);
  sources.push(
    await runNotificationFanOutSource(
      'missedWarAttack',
      () => options.fanOutStore.fanOutMissedWarAttackEventNotifications(missedWarAttackInput),
      options.logger,
    ),
  );

  const donationInput: FanOutClanDonationEventNotificationsInput =
    createNotificationFanOutInput(limit);
  sources.push(
    await runNotificationFanOutSource(
      'clanDonation',
      () => options.fanOutStore.fanOutClanDonationEventNotifications(donationInput),
      options.logger,
    ),
  );

  const roleChangeInput: FanOutClanRoleChangeEventNotificationsInput =
    createNotificationFanOutInput(limit);
  sources.push(
    await runNotificationFanOutSource(
      'clanRoleChange',
      () => options.fanOutStore.fanOutClanRoleChangeEventNotifications(roleChangeInput),
      options.logger,
    ),
  );

  const fanOutClanGames = options.fanOutStore.fanOutClanGamesEventNotifications;
  if (typeof fanOutClanGames === 'function') {
    const clanGamesInput: FanOutClanGamesEventNotificationsInput =
      createNotificationFanOutInput(limit);
    sources.push(
      await runNotificationFanOutSource(
        'clanGames',
        () => fanOutClanGames.call(options.fanOutStore, clanGamesInput),
        options.logger,
      ),
    );
  }

  const summary = createNotificationFanOutIterationSummary(sources);
  options.logger.info(
    {
      sources: summary.sources,
      totals: summary.totals,
      failedFamilies: summary.failedFamilies,
    },
    'Notification fan-out iteration completed',
  );
  return summary;
}

export function startNotificationFanOutLoop(
  options: NotificationFanOutLoopOptions,
): NotificationFanOutLoopController {
  validateNotificationFanOutLoopOptions(options);

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleTimeout = options.setTimeout ?? setTimeout;
  const clearScheduledTimeout = options.clearTimeout ?? clearTimeout;

  const runOnce = async () => {
    await runNotificationFanOutIteration(options);
  };

  const scheduleNext = () => {
    if (stopped) return;
    const delayMs = computeNotificationFanOutLoopDelayMs(options.interval, options.random);
    timer = scheduleTimeout(() => {
      void runOnce().finally(scheduleNext);
    }, delayMs);
  };

  void runOnce().finally(scheduleNext);
  options.logger.info(
    { interval: options.interval },
    'Clan member notification fan-out loop started',
  );

  return {
    stop: () => {
      stopped = true;
      if (timer) clearScheduledTimeout(timer);
    },
    runOnce,
  };
}
