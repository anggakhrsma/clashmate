import { HttpError } from 'clashofclans.js';
import { describe, expect, it, vi } from 'vitest';
import { ClashApiError, ClashMateCocClient, type ClashOfClansApiClient } from './index.js';

function createApiClient(overrides: Partial<ClashOfClansApiClient>): ClashOfClansApiClient {
  return {
    getClan: vi.fn(),
    getCurrentWar: vi.fn(),
    getPlayer: vi.fn(),
    ...overrides,
  };
}

function httpError(status: number, reason = 'unknownException'): HttpError {
  return new HttpError(
    { reason, message: `HTTP ${status}` },
    status,
    '/clans/%23ABC123',
    0,
  );
}

describe('ClashMateCocClient', () => {
  it('normalizes tags before fetching clans and returned clan tags', async () => {
    const apiClient = createApiClient({
      getClan: vi.fn().mockResolvedValue({ tag: '2ppj99', name: 'Alpha', members: [] }),
    });
    const client = new ClashMateCocClient({ token: 'token', client: apiClient });

    await expect(client.getClan('2ppj99')).resolves.toEqual({
      tag: '#2PPJ99',
      name: 'Alpha',
      data: { tag: '2ppj99', name: 'Alpha', members: [] },
    });
    expect(apiClient.getClan).toHaveBeenCalledWith('#2PPJ99');
  });

  it('returns successful clan, player, and current war reads', async () => {
    const apiClient = createApiClient({
      getClan: vi.fn().mockResolvedValue({ tag: '#2PPJ99', name: 'Alpha' }),
      getPlayer: vi.fn().mockResolvedValue({ tag: '#P9YQ2', name: 'Player One' }),
      getCurrentWar: vi.fn().mockResolvedValue({ state: 'inWar' }),
    });
    const client = new ClashMateCocClient({ token: 'token', client: apiClient });

    await expect(client.getClan('#2PPJ99')).resolves.toMatchObject({ tag: '#2PPJ99' });
    await expect(client.getPlayer('p9yq2')).resolves.toEqual({
      tag: '#P9YQ2',
      name: 'Player One',
      data: { tag: '#P9YQ2', name: 'Player One' },
    });
    await expect(client.getCurrentWar('2ppj99')).resolves.toEqual({
      clanTag: '#2PPJ99',
      state: 'inWar',
      data: { state: 'inWar' },
    });
    expect(apiClient.getPlayer).toHaveBeenCalledWith('#P9YQ2');
    expect(apiClient.getCurrentWar).toHaveBeenCalledWith('#2PPJ99');
  });

  it('maps a null current war response to notInWar', async () => {
    const apiClient = createApiClient({ getCurrentWar: vi.fn().mockResolvedValue(null) });
    const client = new ClashMateCocClient({ token: 'token', client: apiClient });

    await expect(client.getCurrentWar('#2PPJ99')).resolves.toEqual({
      clanTag: '#2PPJ99',
      state: 'notInWar',
      data: null,
    });
  });

  it('maps invalid responses without retrying', async () => {
    const apiClient = createApiClient({ getClan: vi.fn().mockResolvedValue({ tag: '#2PPJ99' }) });
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const client = new ClashMateCocClient({
      token: 'token',
      client: apiClient,
      retry: { maxAttempts: 3, sleep },
    });

    await expect(client.getClan('#2PPJ99')).rejects.toMatchObject({
      name: 'ClashApiError',
      details: { reason: 'invalid_response', retryable: false },
    });
    expect(apiClient.getClan).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries transient failures and returns a later success', async () => {
    const getClan = vi
      .fn()
      .mockRejectedValueOnce(httpError(429, 'requestThrottled'))
      .mockResolvedValue({ tag: '#2PPJ99', name: 'Alpha' });
    const apiClient = createApiClient({ getClan });
    const sleep = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = new ClashMateCocClient({
      token: 'token',
      client: apiClient,
      retry: { maxAttempts: 3, baseDelayMs: 10, sleep },
    });

    await expect(client.getClan('#2PPJ99')).resolves.toMatchObject({ name: 'Alpha' });
    expect(getClan).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('does not retry non-retryable failures', async () => {
    const apiClient = createApiClient({
      getClan: vi.fn().mockRejectedValue(httpError(404, 'notFound')),
    });
    const sleep = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = new ClashMateCocClient({
      token: 'token',
      client: apiClient,
      retry: { maxAttempts: 3, sleep },
    });

    await expect(client.getClan('#2PPJ99')).rejects.toMatchObject({
      details: { status: 404, reason: 'notFound', attempts: 1, retryable: false },
    });
    expect(apiClient.getClan).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns a ClashApiError after retry exhaustion', async () => {
    const apiClient = createApiClient({
      getPlayer: vi.fn().mockRejectedValue(httpError(503, 'inMaintenance')),
    });
    const sleep = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = new ClashMateCocClient({
      token: 'token',
      client: apiClient,
      retry: { maxAttempts: 3, baseDelayMs: 5, sleep },
    });

    await expect(client.getPlayer('#P9YQ2')).rejects.toBeInstanceOf(ClashApiError);
    await expect(client.getPlayer('#P9YQ2')).rejects.toMatchObject({
      details: { status: 503, reason: 'inMaintenance', attempts: 3, retryable: true },
    });
    expect(apiClient.getPlayer).toHaveBeenCalledTimes(6);
    expect(sleep).toHaveBeenCalledWith(5);
    expect(sleep).toHaveBeenCalledWith(10);
  });
});
