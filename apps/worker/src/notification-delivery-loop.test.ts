import type { NotificationOutboxDeliveryStore } from '@clashmate/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeNotificationDeliveryLoopDelayMs,
  computeNotificationRetryAt,
  formatNotificationOutboxMessage,
  runNotificationDeliveryIteration,
} from './notification-delivery-loop.js';

function createDeliveryStore(): NotificationOutboxDeliveryStore {
  return {
    claimDueNotificationOutboxEntries: vi.fn().mockResolvedValue([]),
    markNotificationOutboxSent: vi.fn().mockResolvedValue(undefined),
    markNotificationOutboxFailed: vi.fn().mockResolvedValue(undefined),
  };
}

describe('notification delivery loop', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('computes jittered loop delays', () => {
    expect(computeNotificationDeliveryLoopDelayMs({ baseSeconds: 15, jitterSeconds: 5 }, () => 0)).toBe(
      15_000,
    );
    expect(computeNotificationDeliveryLoopDelayMs({ baseSeconds: 15, jitterSeconds: 5 }, () => 1)).toBe(
      21_000,
    );
  });

  it('computes capped exponential retry times', () => {
    const now = new Date('2026-04-28T00:00:00.000Z');
    expect(computeNotificationRetryAt(now, 0, 30).toISOString()).toBe('2026-04-28T00:00:30.000Z');
    expect(computeNotificationRetryAt(now, 3, 30).toISOString()).toBe('2026-04-28T00:04:00.000Z');
    expect(computeNotificationRetryAt(now, 12, 30).toISOString()).toBe('2026-04-28T00:32:00.000Z');
  });

  it('formats clan member join and leave messages without mentions', () => {
    expect(
      formatNotificationOutboxMessage({
        payload: {
          clanTag: '#ABC123',
          playerTag: '#PLAYER',
          playerName: 'Chief',
          eventType: 'joined',
        },
      }),
    ).toBe('**Chief (#PLAYER)** joined clan **#ABC123**.');
    expect(
      formatNotificationOutboxMessage({
        payload: {
          clanTag: '#ABC123',
          playerTag: '#PLAYER',
          playerName: 'Chief',
          eventType: 'left',
        },
      }),
    ).toBe('**Chief (#PLAYER)** left clan **#ABC123**.');
  });

  it('claims due rows, sends Discord messages, and marks success', async () => {
    const deliveryStore = createDeliveryStore();
    vi.mocked(deliveryStore.claimDueNotificationOutboxEntries).mockResolvedValue([
      {
        id: 'outbox-1',
        guildId: 'guild-1',
        sourceType: 'clan_member_event',
        sourceId: 'event-1',
        targetType: 'discord_channel',
        targetId: 'channel-1',
        attempts: 0,
        payload: {
          clanTag: '#ABC123',
          playerTag: '#PLAYER',
          playerName: 'Chief',
          eventType: 'joined',
        },
      },
    ]);
    const sender = { sendChannelMessage: vi.fn().mockResolvedValue(undefined) };

    await runNotificationDeliveryIteration({ deliveryStore, sender, interval: { baseSeconds: 1, jitterSeconds: 0 } });

    expect(deliveryStore.claimDueNotificationOutboxEntries).toHaveBeenCalledWith({
      limit: 50,
      maxAttempts: 5,
    });
    expect(sender.sendChannelMessage).toHaveBeenCalledWith(
      'channel-1',
      '**Chief (#PLAYER)** joined clan **#ABC123**.',
    );
    expect(deliveryStore.markNotificationOutboxSent).toHaveBeenCalledWith('outbox-1', expect.any(Date));
    expect(deliveryStore.markNotificationOutboxFailed).not.toHaveBeenCalled();
  });

  it('marks failed sends retryable without throwing the whole iteration', async () => {
    const deliveryStore = createDeliveryStore();
    vi.mocked(deliveryStore.claimDueNotificationOutboxEntries).mockResolvedValue([
      {
        id: 'outbox-1',
        guildId: 'guild-1',
        sourceType: 'clan_member_event',
        sourceId: 'event-1',
        targetType: 'discord_channel',
        targetId: 'channel-1',
        attempts: 1,
        payload: {
          clanTag: '#ABC123',
          playerTag: '#PLAYER',
          playerName: 'Chief',
          eventType: 'joined',
        },
      },
    ]);
    const error = new Error('Discord unavailable');
    const sender = { sendChannelMessage: vi.fn().mockRejectedValue(error) };

    await runNotificationDeliveryIteration({
      deliveryStore,
      sender,
      interval: { baseSeconds: 1, jitterSeconds: 0 },
      maxAttempts: 3,
      retryBaseSeconds: 10,
    });

    expect(deliveryStore.markNotificationOutboxFailed).toHaveBeenCalledWith({
      id: 'outbox-1',
      error,
      retryAt: expect.any(Date),
      maxAttempts: 3,
    });
  });
});
