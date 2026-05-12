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
  getClans?: (query: { name: string; limit?: number }) => Promise<unknown>;
  getCapitalRaidSeasons?: (tag: string, options?: { limit?: number }) => Promise<unknown>;
  getCurrentWar: (tag: string) => Promise<unknown | null>;
  getPlayer: (tag: string) => Promise<unknown>;
  verifyPlayerToken: (tag: string, token: string) => Promise<unknown>;
}

export interface ClashApiErrorDetails {
  readonly status?: number;
  readonly reason: string;
  readonly message: string;
  readonly attempt?: number;
  readonly attempts?: number;
  readonly maxAttempts?: number;
  readonly retryable?: boolean;
  readonly retryableStatus?: boolean;
  readonly nextBackoffMs?: number;
  readonly responseContext?: string;
  readonly expectedCapability?: string;
  readonly missingCapabilities?: readonly string[];
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
    const normalizedOptions = validateClientOptions(options);
    this.token = normalizeApiToken(normalizedOptions.token);
    this.client = normalizedOptions.client ?? new Client({ keys: [this.token] });
    this.retry = resolveRetryOptions(normalizedOptions.retry);
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
      throwInvalidResponse('Clash API returned an invalid clan response.', 'getClan');
    }

    return {
      tag: normalizeResponseTag(data.tag, 'Clash API returned an invalid clan response.'),
      name: data.name,
      data,
    };
  }

  async getClans(input: ClashClanSearchInput): Promise<ClashClanSearchResult> {
    const query = normalizeClanSearchInput(input);
    if (typeof this.client.getClans !== 'function') {
      throw new ClashApiError({
        reason: 'unsupported_client',
        message: 'Clash API client does not support clan search.',
        retryable: false,
        expectedCapability: 'getClans',
        missingCapabilities: ['getClans'],
      });
    }

    const data = await this.request(() => this.client.getClans?.(query) ?? Promise.resolve(null));
    if (!isClanSearchResponse(data)) {
      throwInvalidResponse('Clash API returned an invalid clan search response.', 'getClans');
    }

    return {
      items: data.items.map((item) => ({
        tag: normalizeResponseTag(item.tag, 'Clash API returned an invalid clan search response.'),
        name: item.name,
        data: item,
      })),
      data,
    };
  }

  async getCapitalRaidSeasons(
    input: ClashCapitalRaidSeasonsInput,
  ): Promise<ClashCapitalRaidSeasonsResult> {
    const query = normalizeCapitalRaidSeasonsInput(input, this.normalizeTag(input.clanTag));
    if (typeof this.client.getCapitalRaidSeasons !== 'function') {
      throw new ClashApiError({
        reason: 'unsupported_client',
        message: 'Clash API client does not support capital raid seasons.',
        retryable: false,
        expectedCapability: 'getCapitalRaidSeasons',
        missingCapabilities: ['getCapitalRaidSeasons'],
      });
    }

    const data = await this.request(
      () =>
        this.client.getCapitalRaidSeasons?.(query.clanTag, { limit: query.limit }) ??
        Promise.resolve(null),
    );
    if (!isCapitalRaidSeasonsResponse(data)) {
      throwInvalidResponse(
        'Clash API returned an invalid capital raid seasons response.',
        'getCapitalRaidSeasons',
      );
    }

    return {
      clanTag: query.clanTag,
      items: data.map((season) => ({
        clanTag: query.clanTag,
        state: season.state,
        startTime: normalizeSeasonTimestamp(
          season.startTime,
          'Clash API returned an invalid capital raid seasons response.',
        ),
        endTime: normalizeSeasonTimestamp(
          season.endTime,
          'Clash API returned an invalid capital raid seasons response.',
        ),
        data: season,
      })),
      data,
    };
  }

  async getCurrentWar(clanTag: string): Promise<ClashWar> {
    const normalizedTag = this.normalizeTag(clanTag);
    const data = await this.request(() => this.client.getCurrentWar(normalizedTag));
    if (data === null) return { clanTag: normalizedTag, state: 'notInWar', data };
    if (!isWarResponse(data)) {
      throwInvalidCurrentWarResponse();
    }

    const responseClanTag = normalizeOptionalWarClanTag(data.clan);
    normalizeOptionalWarClanTag(data.opponent);

    return { clanTag: responseClanTag ?? normalizedTag, state: data.state, data };
  }

  async getPlayer(tag: string): Promise<ClashPlayer> {
    const normalizedTag = this.normalizeTag(tag);
    const data = await this.request(() => this.client.getPlayer(normalizedTag));
    if (!isPlayerResponse(data)) {
      throwInvalidResponse('Clash API returned an invalid player response.', 'getPlayer');
    }

    return {
      tag: normalizeResponseTag(data.tag, 'Clash API returned an invalid player response.'),
      name: data.name,
      data,
    };
  }

  async verifyPlayerToken(tag: string, token: string): Promise<boolean> {
    const normalizedTag = this.normalizeTag(tag);
    const normalizedToken = normalizePlayerToken(token);
    const data = await this.request(() =>
      this.client.verifyPlayerToken(normalizedTag, normalizedToken),
    );
    if (!isVerifyTokenResponse(data)) {
      throwInvalidResponse(
        'Clash API returned an invalid token verification response.',
        'verifyPlayerToken',
      );
    }

    return data.status === 'ok';
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: ClashApiError | undefined;

    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const retryableError = mapClashApiError(error, attempt, this.retry.maxAttempts);
        const nextBackoffMs =
          retryableError.details.retryable && attempt < this.retry.maxAttempts
            ? this.retry.baseDelayMs * 2 ** (attempt - 1)
            : undefined;
        const mappedError = withRetryMetadata(retryableError, { nextBackoffMs });
        lastError = mappedError;

        if (!mappedError.details.retryable || attempt >= this.retry.maxAttempts) {
          throw mappedError;
        }

        await this.retry.sleep(nextBackoffMs ?? 0);
      }
    }

    throw (
      lastError ??
      new ClashApiError({
        reason: 'request_failed',
        message: 'Clash API request failed.',
        attempts: this.retry.maxAttempts,
        maxAttempts: this.retry.maxAttempts,
        retryable: false,
      })
    );
  }
}

function validateClientOptions(options: unknown): ClashMateCocClientOptions {
  if (!isClientOptionsObject(options)) {
    throw new Error('Clash API client options must be an object.');
  }

  const client = options.client;
  if (client !== undefined) validateCustomClient(client);

  return options as ClashMateCocClientOptions;
}

function validateCustomClient(client: unknown): asserts client is ClashOfClansApiClient {
  if (!isPlainObject(client)) {
    throw new Error('Clash API client custom client must be an object.');
  }

  const requiredMethods = ['getClan', 'getCurrentWar', 'getPlayer', 'verifyPlayerToken'] as const;
  const missingCapabilities: string[] = [];
  for (const methodName of requiredMethods) {
    if (typeof client[methodName] !== 'function') {
      missingCapabilities.push(methodName);
    }
  }

  if (missingCapabilities.length > 0) {
    throw new ClashApiError({
      reason: 'unsupported_client',
      message: `Clash API client custom client is missing required capabilities: ${missingCapabilities.join(', ')}.`,
      retryable: false,
      missingCapabilities,
    });
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

function normalizePlayerToken(token: unknown): string {
  if (typeof token !== 'string') {
    throw new Error('Clash API player token must be a non-empty string.');
  }

  const normalizedToken = token.trim();

  if (normalizedToken.length === 0) {
    throw new Error('Clash API player token must be a non-empty string.');
  }

  return normalizedToken;
}

function normalizeClanSearchInput(input: ClashClanSearchInput): ClashClanSearchInput {
  if (!isPlainObject(input)) {
    throw new Error('Clash API clan search input must be an object.');
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length === 0) {
    throw new Error('Clash API clan search name must be a non-empty string.');
  }

  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Clash API clan search limit must be a positive integer.');
  }

  return { name, limit };
}

function normalizeCapitalRaidSeasonsInput(
  input: ClashCapitalRaidSeasonsInput,
  clanTag: string,
): Required<ClashCapitalRaidSeasonsInput> {
  if (!isPlainObject(input)) {
    throw new Error('Clash API capital raid seasons input must be an object.');
  }

  const limit = input.limit ?? 10;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 50) {
    throw new Error('Clash API capital raid seasons limit must be an integer between 1 and 50.');
  }

  return { clanTag, limit };
}

function normalizeResponseTag(tag: string, message: string): string {
  try {
    return normalizeClashTag(tag);
  } catch {
    throw new ClashApiError({
      reason: 'invalid_response',
      message,
      retryable: false,
      responseContext: 'tag',
    });
  }
}

function throwInvalidCurrentWarResponse(): never {
  throwInvalidResponse('Clash API returned an invalid current war response.', 'getCurrentWar');
}

function throwInvalidResponse(message: string, responseContext: string): never {
  throw new ClashApiError({
    reason: 'invalid_response',
    message,
    retryable: false,
    responseContext,
  });
}

function normalizeOptionalWarClanTag(value: unknown): string | null {
  const tag = getRecordValue(value, 'tag');
  if (tag === undefined) return null;
  if (typeof tag !== 'string') throwInvalidCurrentWarResponse();

  try {
    return normalizeClashTag(tag);
  } catch {
    throwInvalidCurrentWarResponse();
  }
}

export interface ClashClan {
  readonly tag: string;
  readonly name: string;
  readonly data: unknown;
}

export interface ClashClanSearchInput {
  readonly name: string;
  readonly limit?: number;
}

export interface ClashClanSearchResult {
  readonly items: readonly ClashClan[];
  readonly data: unknown;
}

export interface ClashCapitalRaidSeasonsInput {
  readonly clanTag: string;
  readonly limit?: number;
}

export interface ClashCapitalRaidSeason {
  readonly clanTag: string;
  readonly state: 'ongoing' | 'ended';
  readonly startTime: string;
  readonly endTime: string;
  readonly data: unknown;
}

export interface ClashCapitalRaidSeasonsResult {
  readonly clanTag: string;
  readonly items: readonly ClashCapitalRaidSeason[];
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

function mapClashApiError(error: unknown, attempt: number, maxAttempts: number): ClashApiError {
  if (error instanceof ClashApiError) return error;

  if (error instanceof HttpError) {
    const retryable = isRetryableStatus(error.status);
    return new ClashApiError({
      status: error.status,
      reason: error.reason,
      message: error.message || `Clash API request failed with status ${error.status}`,
      attempt,
      attempts: attempt,
      maxAttempts,
      retryable,
      retryableStatus: retryable,
    });
  }

  return new ClashApiError({
    reason: 'request_failed',
    message: error instanceof Error ? error.message : 'Clash API request failed.',
    attempt,
    attempts: attempt,
    maxAttempts,
    retryable: false,
  });
}

function withRetryMetadata(
  error: ClashApiError,
  metadata: { readonly nextBackoffMs: number | undefined },
): ClashApiError {
  if (metadata.nextBackoffMs === undefined) return error;

  return new ClashApiError({
    ...error.details,
    nextBackoffMs: metadata.nextBackoffMs,
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

function isClanSearchResponse(value: unknown): value is { items: { tag: string; name: string }[] } {
  const items = getRecordValue(value, 'items');
  return Array.isArray(items) && items.every(isClanResponse);
}

function isCapitalRaidSeasonsResponse(value: unknown): value is {
  readonly state: 'ongoing' | 'ended';
  readonly startTime: Date | string;
  readonly endTime: Date | string;
}[] {
  return Array.isArray(value) && value.every(isCapitalRaidSeasonResponse);
}

function isCapitalRaidSeasonResponse(value: unknown): value is {
  readonly state: 'ongoing' | 'ended';
  readonly startTime: Date | string;
  readonly endTime: Date | string;
} {
  if (!isRecord(value)) return false;
  const state = getRecordValue(value, 'state');
  return (
    (state === 'ongoing' || state === 'ended') &&
    isValidSeasonTimestamp(getRecordValue(value, 'startTime')) &&
    isValidSeasonTimestamp(getRecordValue(value, 'endTime'))
  );
}

function isValidSeasonTimestamp(value: unknown): value is Date | string {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function normalizeSeasonTimestamp(value: Date | string, message: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ClashApiError({
      reason: 'invalid_response',
      message,
      retryable: false,
      responseContext: 'capitalRaidSeason.timestamp',
    });
  }

  return date.toISOString();
}

function isWarResponse(value: unknown): value is {
  readonly state: 'notInWar' | 'preparation' | 'inWar' | 'warEnded';
  readonly clan?: unknown;
  readonly opponent?: unknown;
} {
  return isKnownWarState(getRecordValue(value, 'state'));
}

function isKnownWarState(
  value: unknown,
): value is 'notInWar' | 'preparation' | 'inWar' | 'warEnded' {
  return (
    value === 'notInWar' || value === 'preparation' || value === 'inWar' || value === 'warEnded'
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

function isClientOptionsObject(value: unknown): value is {
  readonly token?: unknown;
  readonly client?: unknown;
  readonly retry?: unknown;
} {
  return isPlainObject(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRecordValue(value: unknown, key: string): unknown {
  return isRecord(value) && key in value ? value[key] : undefined;
}
