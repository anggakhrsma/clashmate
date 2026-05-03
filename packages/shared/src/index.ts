function invalidClashTagError(tag: unknown): Error {
  return new Error(`Invalid Clash of Clans tag: ${String(tag)}`);
}

export function normalizeClashTag(tag: string): string {
  if (typeof tag !== 'string' || tag.trim().length === 0) {
    throw invalidClashTagError(tag);
  }

  const normalized = tag.trim().toUpperCase().replace(/^#?/, '#').replace(/O/g, '0');

  if (!/^#[0289PYLQGRJCUV]+$/.test(normalized)) {
    throw invalidClashTagError(tag);
  }

  return normalized;
}

export function stripClashTagPrefix(tag: string): string {
  return normalizeClashTag(tag).slice(1);
}
