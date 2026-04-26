export function normalizeClashTag(tag: string): string {
  const normalized = tag.trim().toUpperCase().replace(/^#?/, '#').replace(/O/g, '0');

  if (!/^#[0289PYLQGRJCUV]+$/.test(normalized)) {
    throw new Error(`Invalid Clash of Clans tag: ${tag}`);
  }

  return normalized;
}

export function stripClashTagPrefix(tag: string): string {
  return normalizeClashTag(tag).slice(1);
}
