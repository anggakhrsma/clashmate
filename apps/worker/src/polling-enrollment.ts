import type { PollingEnrollmentStore } from '@clashmate/database';

export interface SyncPollingLeasesResult {
  readonly clan: { enrolled: number; removed: number };
  readonly player: { enrolled: number; removed: number };
  readonly war: { enrolled: number; removed: number };
}

export async function syncPollingLeases(
  enrollment: PollingEnrollmentStore,
  runAfter = new Date(),
): Promise<SyncPollingLeasesResult> {
  const [clan, player, war] = await Promise.all([
    enrollment.syncClanPollingLeases(runAfter),
    enrollment.syncPlayerPollingLeases(runAfter),
    enrollment.syncWarPollingLeases(runAfter),
  ]);

  return { clan, player, war };
}
