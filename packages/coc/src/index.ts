import { normalizeClashTag } from '@clashmate/shared';

export interface ClashMateCocClientOptions {
  readonly token: string;
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

  constructor(options: ClashMateCocClientOptions) {
    this.token = options.token;
  }

  normalizeTag(tag: string): string {
    return normalizeClashTag(tag);
  }

  async ready(): Promise<boolean> {
    return this.token.length > 0;
  }

  async getClan(tag: string): Promise<{ tag: string; name: string }> {
    const normalizedTag = this.normalizeTag(tag);
    const response = await fetch(
      `https://api.clashofclans.com/v1/clans/${encodeURIComponent(normalizedTag)}`,
      { headers: { authorization: `Bearer ${this.token}` } },
    );

    if (!response.ok) {
      throw new ClashApiError({
        status: response.status,
        reason: response.statusText,
        message: `Clash API request failed with status ${response.status}`,
      });
    }

    const data = await response.json();
    if (!isClanResponse(data)) {
      throw new ClashApiError({
        reason: 'invalid_response',
        message: 'Clash API returned an invalid clan response.',
      });
    }

    return { tag: this.normalizeTag(data.tag), name: data.name };
  }
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
