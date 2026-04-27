import type { NotificationFanOutStore } from '@clashmate/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeNotificationFanOutLoopDelayMs,
  runNotificationFanOutIteration,
  startNotificationFanOutLoop,
} from './notification-fanout-loop.js';

function createFanOutStore(): NotificationFanOutStore {
  return {
    fanOutClanMemberEventNotifications: vi.fn().mockResolvedValue({
      eventsScanned: 2,
      matchedTargets: 3,
      insertedOutboxEntries: 1,
    }),
  };
}

function createLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };
}

describe('notification fan-out loop', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('runs clan member notification fan-out and logs the result counts', async () => {
    const fanOutStore = createFanOutStore();
    const logger = createLogger();

    await runNotificationFanOutIteration({
      fanOutStore,
      interval: { baseSeconds: 30, jitterSeconds: 5 },
      batchSize: 250,
      logger,
    });

    expect(fanOutStore.fanOutClanMemberEventNotifications).toHaveBeenCalledWith({ limit: 250 });
    expect(logger.info).toHaveBeenCalledWith(
      { eventsScanned: 2, matchedTargets: 3, insertedOutboxEntries: 1 },
      'Clan member notification fan-out completed',
    );
  });

  it('reschedules with a safe interval plus jitter', () => {
    expect(
      computeNotificationFanOutLoopDelayMs({ baseSeconds: 30, jitterSeconds: 10 }, () => 0),
    ).toBe(30_000);
    expect(
      computeNotificationFanOutLoopDelayMs({ baseSeconds: 30, jitterSeconds: 10 }, () => 1),
    ).toBe(41_000);
  });

  it('catches and logs fan-out errors without throwing', async () => {
    const fanOutStore = createFanOutStore();
    const logger = createLogger();
    vi.mocked(fanOutStore.fanOutClanMemberEventNotifications).mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(
      runNotificationFanOutIteration({
        fanOutStore,
        interval: { baseSeconds: 30, jitterSeconds: 5 },
        logger,
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      { error: expect.any(Error) },
      'Clan member notification fan-out failed',
    );
  });

  it('starts immediately, schedules future runs, and stop cancels the scheduled run', async () => {
    vi.useFakeTimers();
    const fanOutStore = createFanOutStore();
    const logger = createLogger();
    const clearTimeoutSpy = vi.fn(clearTimeout);

    const controller = startNotificationFanOutLoop({
      fanOutStore,
      interval: { baseSeconds: 30, jitterSeconds: 10 },
      logger,
      random: () => 0.5,
      setTimeout,
      clearTimeout: clearTimeoutSpy,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(fanOutStore.fanOutClanMemberEventNotifications).toHaveBeenCalledTimes(1);

    controller.stop();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(36_000);
    expect(fanOutStore.fanOutClanMemberEventNotifications).toHaveBeenCalledTimes(1);
  });
});
