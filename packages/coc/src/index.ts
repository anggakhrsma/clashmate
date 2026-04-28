import { normalizeClashTag } from '@clashmate/shared';
import { Client, HttpError } from 'clashofclans.js';

export interface ClashMateCocClientOptions {
  readonly token: string;
  readonly client?: ClashOfClansApiClient;
}

export interface ClashOfClansApiClient {
  getClan: (tag: string) => Promise<unknown>;
  getCurrentWar: (tag: string) => Promise<unknown | null>;
  getPlayer: (tag: string) => Promise<unknown>;
}

export interface ClashApiErrorDetails {
  readonly status?: number;
  readonly reason: string;
  readonly message: string;
}

export class ClashApiError extends Error {
  readonly details: ClashApiErrorDetails;

  constructor(details: ClashApiErrorDetails) {
    super(details.message);
    this.name = 'ClashApiError';
    this.details = details;
  }
}

export class ClashMateCocClient {
  readonly token: string;
  private readonly client: ClashOfClansApiClient;

  constructor(options: ClashMateCocClientOptions) {
    this.token = options.token;
    this.client = options.client ?? new Client({ keys: [options.token] });
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
      });
    }

    return { tag: this.normalizeTag(data.tag), name: data.name, data };
  }

  async getCurrentWar(clanTag: string): Promise<ClashWar> {
    const normalizedTag = this.normalizeTag(clanTag);
    const data = await this.request(() => this.client.getCurrentWar(normalizedTag));
    if (data === null) return { clanTag: normalizedTag, state: 'notInWar', data };
    if (!isWarResponse(data)) {
      throw new ClashApiError({
        reason: 'invalid_response',
        message: 'Clash API returned an invalid current war response.',
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
      });
    }

    return { tag: this.normalizeTag(data.tag), name: data.name, data };
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ClashApiError) throw error;
      if (error instanceof HttpError) {
        throw new ClashApiError({
          status: error.status,
          reason: error.reason,
          message: error.message || `Clash API request failed with status ${error.status}`,
        });
      }

      throw new ClashApiError({
        reason: 'request_failed',
        message: error instanceof Error ? error.message : 'Clash API request failed.',
      });
    }
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
