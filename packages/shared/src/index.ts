const CLASH_TAG_ALLOWED_CHARACTERS = '0289PYLQGRJCUV';
const CLASH_TAG_PATTERN = /^#[0289PYLQGRJCUV]+$/;

export type ClashTagParseFailureReason = 'not-string' | 'empty' | 'invalid-characters';

export interface ClashTagParseSuccess {
  readonly ok: true;
  readonly tag: string;
  readonly tagWithoutPrefix: string;
}

export interface ClashTagParseFailure {
  readonly ok: false;
  readonly input: unknown;
  readonly reason: ClashTagParseFailureReason;
  readonly message: string;
}

export type ClashTagParseResult = ClashTagParseSuccess | ClashTagParseFailure;

function describeInvalidClashTag(tag: unknown): string {
  if (typeof tag !== 'string') {
    return `Invalid Clash of Clans tag: expected a string, received ${typeof tag}.`;
  }

  if (tag.trim().length === 0) {
    return 'Invalid Clash of Clans tag: expected a non-empty tag.';
  }

  const normalized = toNormalizedClashTagCandidate(tag);

  return `Invalid Clash of Clans tag: ${JSON.stringify(tag)} normalizes to ${JSON.stringify(
    normalized,
  )}, but tags must start with # and contain only ${CLASH_TAG_ALLOWED_CHARACTERS}.`;
}

function invalidClashTagError(tag: unknown): Error {
  return new Error(describeInvalidClashTag(tag));
}

function toNormalizedClashTagCandidate(tag: string): string {
  return tag.trim().toUpperCase().replace(/^#?/, '#').replace(/O/g, '0');
}

export function parseClashTag(tag: unknown): ClashTagParseResult {
  if (typeof tag !== 'string') {
    return {
      ok: false,
      input: tag,
      reason: 'not-string',
      message: describeInvalidClashTag(tag),
    };
  }

  if (tag.trim().length === 0) {
    return {
      ok: false,
      input: tag,
      reason: 'empty',
      message: describeInvalidClashTag(tag),
    };
  }

  const normalized = toNormalizedClashTagCandidate(tag);

  if (!CLASH_TAG_PATTERN.test(normalized)) {
    return {
      ok: false,
      input: tag,
      reason: 'invalid-characters',
      message: describeInvalidClashTag(tag),
    };
  }

  return {
    ok: true,
    tag: normalized,
    tagWithoutPrefix: normalized.slice(1),
  };
}

export function isValidClashTag(tag: unknown): boolean {
  return parseClashTag(tag).ok;
}

export function normalizeClashTag(tag: string): string {
  const result = parseClashTag(tag);

  if (!result.ok) {
    throw invalidClashTagError(tag);
  }

  return result.tag;
}

export function stripClashTagPrefix(tag: string): string {
  return normalizeClashTag(tag).slice(1);
}
