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
    // The concrete clashofclans.js adapter will be implemented behind this package.
    return this.token.length > 0;
  }
}
