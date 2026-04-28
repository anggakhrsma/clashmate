import { describe, expect, it } from 'vitest';

import {
  buildClanMemberNotificationOutboxValues,
  buildNotificationOutboxIdempotencyKey,
  createNotificationOutboxDeliveryStore,
  schema,
} from './index.js';

describe('notification outbox schema foundation', () => {
  it('builds deterministic per-target notification idempotency keys', () => {
    expect(
      buildNotificationOutboxIdempotencyKey({
        guildId: ' 1234567890 ',
        sourceType: 'clan_member_event',
        sourceId: ' ABCDEF12-3456-7890-ABCD-EF1234567890 ',
        targetType: 'discord_channel',
        targetId: '9876543210',
      }),
    ).toBe(
      'notification:guild:1234567890:source:clan_member_event:abcdef12-3456-7890-abcd-ef1234567890:target:discord_channel:9876543210',
    );
  });

  it('rejects incomplete notification idempotency key inputs', () => {
    expect(() =>
      buildNotificationOutboxIdempotencyKey({
        guildId: '1234567890',
        sourceType: 'clan_member_event',
        sourceId: ' ',
        targetType: 'discord_channel',
        targetId: '9876543210',
      }),
    ).toThrow('Notification outbox idempotency keys require guild, source, and target IDs.');
  });

  it('builds idempotent clan member notification outbox rows per Discord target', () => {
    const now = new Date('2026-04-28T00:00:00.000Z');
    const baseTarget = {
      eventId: 'abcdef12-3456-7890-abcd-ef1234567890',
      guildId: '1234567890',
      configId: '11111111-1111-1111-1111-111111111111',
      discordChannelId: '9876543210',
      clanTag: '#ABC123',
      playerTag: '#PLAYER',
      playerName: 'Chief',
      eventType: 'joined',
      eventKey: 'clan:#ABC123:member:#PLAYER:joined:2026-04-28T00:00:00.000Z',
      occurredAt: now,
      detectedAt: now,
    };

    const [first, duplicate, otherChannel] = buildClanMemberNotificationOutboxValues(
      [
        baseTarget,
        baseTarget,
        {
          ...baseTarget,
          configId: '22222222-2222-2222-2222-222222222222',
          discordChannelId: '2222222222',
        },
      ],
      now,
    );

    expect(first?.idempotencyKey).toBe(duplicate?.idempotencyKey);
    expect(otherChannel?.idempotencyKey).not.toBe(first?.idempotencyKey);
    expect(first).toMatchObject({
      guildId: '1234567890',
      sourceType: 'clan_member_event',
      sourceId: 'abcdef12-3456-7890-abcd-ef1234567890',
      targetType: 'discord_channel',
      targetId: '9876543210',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      updatedAt: now,
    });
  });

  it('stores restart-safe delivery state without soft deletes', () => {
    expect(schema.notificationOutbox.idempotencyKey.name).toBe('idempotency_key');
    expect(schema.notificationOutbox.status.name).toBe('status');
    expect(schema.notificationOutbox.attempts.name).toBe('attempts');
    expect(schema.notificationOutbox.nextAttemptAt.name).toBe('next_attempt_at');
    expect(schema.notificationOutbox.ownerId.name).toBe('owner_id');
    expect(schema.notificationOutbox.lockedUntil.name).toBe('locked_until');
    expect(schema.notificationOutbox.lastError.name).toBe('last_error');
    expect('deletedAt' in schema.notificationOutbox).toBe(false);
  });

  it('rejects blank delivery lease owner IDs before mutating outbox rows', async () => {
    const store = createNotificationOutboxDeliveryStore({} as never);

    await expect(
      store.claimDueNotificationOutboxEntries({ ownerId: ' ', lockForSeconds: 60 }),
    ).rejects.toThrow('Notification delivery ownerId is required.');
    await expect(store.markNotificationOutboxSent('outbox-1', ' ')).rejects.toThrow(
      'Notification delivery ownerId is required.',
    );
    await expect(
      store.markNotificationOutboxFailed({
        id: 'outbox-1',
        ownerId: ' ',
        error: new Error('nope'),
        retryAt: new Date('2026-04-28T00:00:00.000Z'),
      }),
    ).rejects.toThrow('Notification delivery ownerId is required.');
  });

  it('rejects invalid notification delivery lock durations', async () => {
    const store = createNotificationOutboxDeliveryStore({} as never);

    await expect(
      store.claimDueNotificationOutboxEntries({ ownerId: 'worker-1', lockForSeconds: 0 }),
    ).rejects.toThrow('Notification delivery lockForSeconds must be a positive integer.');
  });

  it('keeps clan member notification targets focused and guild-scoped', () => {
    expect(schema.clanMemberNotificationConfigs.guildId.name).toBe('guild_id');
    expect(schema.clanMemberNotificationConfigs.trackedClanId.name).toBe('tracked_clan_id');
    expect(schema.clanMemberNotificationConfigs.discordChannelId.name).toBe('discord_channel_id');
    expect(schema.clanMemberNotificationConfigs.eventType.name).toBe('event_type');
    expect('deletedAt' in schema.clanMemberNotificationConfigs).toBe(false);
  });
});
