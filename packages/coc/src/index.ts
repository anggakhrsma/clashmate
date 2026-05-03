import { normalizeClashTag } from '@clashmate/shared';
import { Client, HttpError } from 'clashofclans.js';

export interface ClashMateCocClientOptions {
  readonly token: string;
  readonly client?: ClashOfClansApiClient;
  readonly retry?: ClashApiRetryOptions;
}

export interface ClashApiRetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

export interface ClashOfClansApiClient {
  getClan: (tag: string) => Promise<unknown>;
  getCurrentWar: (tag: string) => Promise<unknown | null>;
  getPlayer: (tag: string) => Promise<unknown>;
  verifyPlayerToken: (tag: string, token: string) => Promise<unknown>;
}

export interface ClashApiErrorDetails {
  readonly status?: number;
  readonly reason: string;
  readonly message: string;
  readonly attempts?: number;
  readonly retryable?: boolean;
}

export class ClashApiError extends Error {
  readonly details: ClashApiErrorDetails;

  constructor(details: ClashApiErrorDetails) {
    super(details.message);
    this.name = 'ClashApiError';
    this.details = details;
  }
}

interface ResolvedRetryOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly sleep: (delayMs: number) => Promise<void>;
}

export class ClashMateCocClient {
  readonly token: string;
  private readonly client: ClashOfClansApiClient;
  private readonly retry: ResolvedRetryOptions;

  constructor(options: ClashMateCocClientOptions) {
    this.token = normalizeApiToken(options.token);
    this.client = options.client ?? new Client({ keys: [this.token] });
    this.retry = resolveRetryOptions(options.retry);
  }

  normalizeTag(tag: string): string {
    return normalizeClashTag(tag);
  }

  async ready(): Promise<boolean> {
    return this.token.length > 0;
  }

  async getClan(tag: string): Promise<ClashClan> {
    const normalizedTag = this.normalizeTag(tag);
    const data = await this.request(() => this.client.getClan(normalizedTag));
    if (!isClanResponse(data)) {
      throw new ClashApiError({
        reason: 'invalid_response',
        message: 'Clash API returned an invalid clan response.',
        retryable: false,
      });
    }

    return {
      tag: normalizeResponseTag(data.tag, 'Clash API returned an invalid clan response.'),
      name: data.name,
      data,
    };
  }

  async getCurrentWar(clanTag: string): Promise<ClashWar> {
    const normalizedTag = this.normalizeTag(clanTag);
    const data = await this.request(() => this.client.getCurrentWar(normalizedTag));
    if (data === null) return { clanTag: normalizedTag, state: 'notInWar', data };
    if (!isWarResponse(data)) {
      throw new ClashApiError({
        reason: 'invalid_response',
        message: 'Clash API returned an invalid current war response.',
        retryable: false,
      });
    }

    return { clanTag: normalizedTag, state: data.state, data };
  }

  async getPlayer(tag: string): Promise<ClashPlayer> {
    const normalizedTag = this.normalizeTag(tag);
    const data = await this.request(() => this.client.getPlayer(normalizedTag));
    if (!isPlayerResponse(data)) {
      throw new ClashApiError({
        reason: 'invalid_response',
        message: 'Clash API returned an invalid player response.',
        retryable: false,
      });
    }

    return {
      tag: normalizeResponseTag(data.tag, 'Clash API returned an invalid player response.'),
      name: data.name,
      data,
    };
  }

  async verifyPlayerToken(tag: string, token: string): Promise<boolean> {
    const normalizedTag = this.normalizeTag(tag);
    const data = await this.request(() => this.client.verifyPlayerToken(normalizedTag, token));
    if (!isVerifyTokenResponse(data)) {
      throw new ClashApiError({
        reason: 'invalid_response',
        message: 'Clash API returned an invalid token verification response.',
        retryable: false,
      });
    }

    return data.status === 'ok';
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: ClashApiError | undefined;

    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const mappedError = mapClashApiError(error, attempt);
        lastError = mappedError;

        if (!mappedError.details.retryable || attempt >= this.retry.maxAttempts) {
          throw mappedError;
        }

        await this.retry.sleep(this.retry.baseDelayMs * 2 ** (attempt - 1));
      }
    }

    throw (
      lastError ??
      new ClashApiError({
        reason: 'request_failed',
        message: 'Clash API request failed.',
        attempts: this.retry.maxAttempts,
        retryable: false,
      })
    );
  }
}

function normalizeApiToken(token: string): string {
  if (typeof token !== 'string') {
    throw new Error('Clash API token must be a non-empty string.');
  }

  const normalizedToken = token.trim();

  if (normalizedToken.length === 0) {
    throw new Error('Clash API token must be a non-empty string.');
  }

  return normalizedToken;
}

function normalizeResponseTag(tag: string, message: string): string {
  try {
    return normalizeClashTag(tag);
  } catch {
    throw new ClashApiError({
      reason: 'invalid_response',
      message,
      retryable: false,
    });
  }
}

export interface ClashClan {
  readonly tag: string;
  readonly name: string;
  readonly data: unknown;
}

export interface ClashWar {
  readonly clanTag: string;
  readonly state: string;
  readonly data: unknown;
}

export interface ClashPlayer {
  readonly tag: string;
  readonly name: string;
  readonly data: unknown;
}

function resolveRetryOptions(options?: ClashApiRetryOptions): ResolvedRetryOptions {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 250;
  const sleep = options?.sleep ?? defaultSleep;

  if (!Number.isFinite(maxAttempts) || !Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error('Clash API retry max attempts must be a positive integer.');
  }

  if (!Number.isFinite(baseDelayMs) || !Number.isInteger(baseDelayMs) || baseDelayMs < 0) {
    throw new Error('Clash API retry base delay must be a non-negative integer.');
  }

  if (typeof sleep !== 'function') {
    throw new Error('Clash API retry sleep must be a function.');
  }

  return {
    maxAttempts,
    baseDelayMs,
    sleep,
  };
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function mapClashApiError(error: unknown, attempts: number): ClashApiError {
  if (error instanceof ClashApiError) return error;

  if (error instanceof HttpError) {
    const retryable = isRetryableStatus(error.status);
    return new ClashApiError({
      status: error.status,
      reason: error.reason,
      message: error.message || `Clash API request failed with status ${error.status}`,
      attempts,
      retryable,
    });
  }

  return new ClashApiError({
    reason: 'request_failed',
    message: error instanceof Error ? error.message : 'Clash API request failed.',
    attempts,
    retryable: false,
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isClanResponse(value: unknown): value is { tag: string; name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tag' in value &&
    typeof value.tag === 'string' &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

function isWarResponse(value: unknown): value is { state: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    typeof value.state === 'string'
  );
}

function isPlayerResponse(value: unknown): value is { tag: string; name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tag' in value &&
    typeof value.tag === 'string' &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

function isVerifyTokenResponse(value: unknown): value is { status: 'ok' | 'invalid' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    (value.status === 'ok' || value.status === 'invalid')
  );
}
