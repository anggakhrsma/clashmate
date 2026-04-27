import type { PollingEnrollmentStore } from '@clashmate/database';

export interface SyncPollingLeasesResult {
  readonly clan: { enrolled: number; removed: number };
  readonly player: { enrolled: number; removed: number };
  readonly war: { enrolled: number; removed: number };
}

export async function syncPollingLeasesFromLinkedResources(
  enrollment: PollingEnrollmentStore,
  runAfter = new Date(),
): Promise<SyncPollingLeasesResult> {
  const [clan, player, war] = await Promise.all([
    enrollment.syncClanPollingLeases(runAfter),
    enrollment.syncLinkedPlayerPollingLeases(runAfter),
    enrollment.syncWarPollingLeasesFromLinkedClans(runAfter),
  ]);

  return { clan, player, war };
}
