export type SearchResultHighlight = { start: number; end: number };

export type TagHighlightRanges = ReadonlyArray<ReadonlyArray<SearchResultHighlight> | undefined>;

export function selectVisibleTagIndices(
  tags: readonly string[],
  ranges: TagHighlightRanges | undefined,
  limit = 3
): number[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (safeLimit === 0 || tags.length === 0) {
    return [];
  }

  const selected = new Set<number>();
  for (let index = 0; index < tags.length && selected.size < safeLimit; index += 1) {
    if ((ranges?.[index]?.length ?? 0) > 0) {
      selected.add(index);
    }
  }
  for (let index = 0; index < tags.length && selected.size < safeLimit; index += 1) {
    selected.add(index);
  }
  return [...selected].sort((left, right) => left - right);
}
