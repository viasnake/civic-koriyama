import type { SearchIndexItem } from "../../shared/types";

export const SEARCH_FIELD_WEIGHTS = {
  name: 100,
  category: 42,
  tags: 32,
  address: 24,
  keywords: 10
} as const;

const prefixScoreFactor = 0.8;

export type SearchFieldName = keyof typeof SEARCH_FIELD_WEIGHTS;

export type SearchField = {
  name: SearchFieldName;
  value: string;
  values?: string[];
};

export type SearchToken = {
  text: string;
  start: number;
  end: number;
};

export type SearchTokenizer = (value: string) => SearchToken[];

export type SearchMatchEvidence = {
  field: SearchFieldName;
  queryToken: string;
  fieldToken: SearchToken;
  score: number;
};

export type SearchMatch = {
  score: number;
  evidence: SearchMatchEvidence[];
};

export type PreparedSearchField = {
  field: SearchField;
  value: string;
  tokens: SearchToken[];
  sourceStart: number[];
  sourceEnd: number[];
};

export type PreparedSearchItem = {
  item: SearchIndexItem;
  fields: PreparedSearchField[];
};

export type PreparedSearchIndex = {
  items: PreparedSearchItem[];
};

export const EMPTY_PREPARED_SEARCH_INDEX: PreparedSearchIndex = { items: [] };

export type SearchMatchRange = { start: number; end: number };

export type SearchPreparationStats = {
  itemsPrepared: number;
  fieldsPrepared: number;
};

type SegmenterPart = {
  segment: string;
  index: number;
  isWordLike?: boolean;
};

type Segmenter = {
  segment(value: string): Iterable<SegmenterPart>;
};

type IntlWithSegmenter = typeof Intl & {
  Segmenter?: new (locale?: string | string[], options?: { granularity?: "word" | "grapheme" | "sentence" }) => Segmenter;
};

type NormalizedText = {
  value: string;
  sourceStart: number[];
  sourceEnd: number[];
};

let cachedWordSegmenter: Segmenter | null | undefined;
let cachedGraphemeSegmenter: Segmenter | null | undefined;

export function normalizeSearchText(value: string): string {
  return normalizeWithOffsets(value).value;
}

export function tokenizeSearchText(value: string): SearchToken[] {
  const normalized = normalizeWithOffsets(value);
  return tokenizeNormalizedText(normalized.value);
}

export function fallbackTokenizeSearchText(value: string): SearchToken[] {
  const normalized = normalizeWithOffsets(value);
  return fallbackTokenizeNormalizedText(normalized.value);
}

export function searchFieldsForItem(item: SearchIndexItem): SearchField[] {
  const tags = item.tags ?? [];
  return [
    { name: "name", value: item.name },
    { name: "category", value: [item.category, item.categoryLabel, ...(item.categories ?? [])].join(" ") },
    { name: "tags", value: tags.join(" "), values: tags },
    { name: "address", value: item.address ?? "" },
    { name: "keywords", value: item.keywords }
  ];
}

export function filterSearchTags(tags: string[], context: string[]): string[] {
  const contextTokens = new Set(context.flatMap((value) => tokenizeSearchText(value).map((token) => token.text)));
  return tags.filter((tag) => tokenizeSearchText(tag).some((token) => contextTokens.has(token.text)));
}

export function prepareSearchFields(
  fields: SearchField[],
  tokenizer: SearchTokenizer = tokenizeSearchText,
  stats?: SearchPreparationStats,
  tokenCache = new Map<string, SearchToken[]>()
): PreparedSearchField[] {
  return fields.map((field) => {
    const normalized = normalizeWithOffsets(field.value);
    stats && (stats.fieldsPrepared += 1);
    const cachedTokens = tokenCache.get(normalized.value);
    const tokens = cachedTokens ?? tokenizeNormalizedValue(normalized.value, tokenizer);
    if (!cachedTokens) {
      tokenCache.set(normalized.value, tokens);
    }
    return {
      field,
      value: normalized.value,
      tokens,
      sourceStart: normalized.sourceStart,
      sourceEnd: normalized.sourceEnd
    };
  });
}

export function prepareSearchIndex(
  indexItems: SearchIndexItem[],
  tokenizer: SearchTokenizer = tokenizeSearchText,
  stats?: SearchPreparationStats
): PreparedSearchIndex {
  const tokenCache = new Map<string, SearchToken[]>();
  return {
    items: indexItems.map((item) => {
      stats && (stats.itemsPrepared += 1);
      return { item, fields: prepareSearchFields(searchFieldsForItem(item), tokenizer, stats, tokenCache) };
    })
  };
}

export function matchSearchFields(
  query: string | SearchToken[],
  fields: SearchField[],
  tokenizer: SearchTokenizer = tokenizeSearchText
): SearchMatch {
  return matchPreparedSearchFields(query, prepareSearchFields(fields, tokenizer), tokenizer);
}

export function matchPreparedSearchFields(
  query: string | SearchToken[],
  fields: PreparedSearchField[],
  tokenizer: SearchTokenizer = tokenizeSearchText
): SearchMatch {
  const queryTokens = typeof query === "string" ? tokenizer(query) : query;

  if (queryTokens.length === 0) {
    return { score: 0, evidence: [] };
  }

  const evidence = queryTokens.map((queryToken, queryIndex) => bestEvidence(queryToken, queryIndex, queryTokens, fields));
  if (evidence.some((item) => item === undefined)) {
    return { score: 0, evidence: [] };
  }

  const matches = evidence.filter((item): item is SearchMatchEvidence => Boolean(item));
  return {
    score: matches.reduce((total, item) => total + item.score, 0),
    evidence: matches
  };
}

export function preparedSearchFieldsHaveMatch(
  query: string | SearchToken[],
  fields: PreparedSearchField[],
  tokenizer: SearchTokenizer = tokenizeSearchText
): boolean {
  const queryTokens = typeof query === "string" ? tokenizer(query) : query;
  if (queryTokens.length === 0) {
    return false;
  }

  return queryTokens.every((queryToken, queryIndex) => fields.some(({ value, tokens }) => Boolean(findMatchingFieldToken(queryTokens, queryIndex, tokens, value))));
}

export function findSearchMatchRanges(
  value: string,
  query: string,
  tokenizer: SearchTokenizer = tokenizeSearchText
): Array<{ start: number; end: number }> {
  const source = normalizeWithOffsets(value);
  return findPreparedSearchMatchRanges({
    field: { name: "name", value },
    value: source.value,
    tokens: tokenizeNormalizedValue(source.value, tokenizer),
    sourceStart: source.sourceStart,
    sourceEnd: source.sourceEnd
  }, tokenizer(query), tokenizer);
}

export function findPreparedSearchMatchRanges(
  field: PreparedSearchField,
  query: string | SearchToken[],
  tokenizer: SearchTokenizer = tokenizeSearchText
): SearchMatchRange[] {
  const queryTokens = typeof query === "string" ? tokenizer(query) : query;
  const normalizedRanges: Array<{ start: number; end: number }> = [];

  for (let queryIndex = 0; queryIndex < queryTokens.length; queryIndex += 1) {
    const queryToken = queryTokens[queryIndex];
    const matchingToken = findMatchingFieldToken(queryTokens, queryIndex, field.tokens, field.value);
    if (!matchingToken) {
      continue;
    }
    const { fieldToken, offset } = matchingToken;
    normalizedRanges.push({
      start: fieldToken.start + offset,
      end: fieldToken.start + offset + queryToken.text.length
    });
  }

  const sourceRanges = normalizedRanges
    .map((range) => ({
      start: field.sourceStart[range.start],
      end: field.sourceEnd[range.end - 1]
    }))
    .filter((range): range is { start: number; end: number } => range.start !== undefined && range.end !== undefined)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  return sourceRanges.reduce<Array<{ start: number; end: number }>>((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
    return merged;
  }, []);
}

/** Maps ranges in a joined multi-value field back to each original value. */
export function partitionSearchMatchRangesByValues(
  values: string[],
  ranges: SearchMatchRange[],
  separator = " "
): SearchMatchRange[][] {
  const partitions = values.map(() => [] as SearchMatchRange[]);
  let valueStart = 0;

  values.forEach((value, valueIndex) => {
    const valueEnd = valueStart + value.length;
    for (const range of ranges) {
      const start = Math.max(valueStart, Math.min(valueEnd, range.start));
      const end = Math.max(valueStart, Math.min(valueEnd, range.end));
      if (end > start) {
        partitions[valueIndex].push({ start: start - valueStart, end: end - valueStart });
      }
    }
    partitions[valueIndex] = mergeSearchMatchRanges(partitions[valueIndex]);
    valueStart = valueEnd + separator.length;
  });

  return partitions;
}

function mergeSearchMatchRanges(ranges: SearchMatchRange[]): SearchMatchRange[] {
  return [...ranges].sort((left, right) => left.start - right.start || left.end - right.end).reduce<SearchMatchRange[]>((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else if (range.end > range.start) {
      merged.push({ ...range });
    }
    return merged;
  }, []);
}

function bestEvidence(
  queryToken: SearchToken,
  queryIndex: number,
  queryTokens: SearchToken[],
  fields: Array<{ field: SearchField; value: string; tokens: SearchToken[] }>
): SearchMatchEvidence | undefined {
  let best: SearchMatchEvidence | undefined;

  for (const { field, value, tokens } of fields) {
    const matchingToken = findMatchingFieldToken(queryTokens, queryIndex, tokens, value);
    if (!matchingToken) {
      continue;
    }
    const { fieldToken } = matchingToken;
    const score = SEARCH_FIELD_WEIGHTS[field.name] * (fieldToken.text === queryToken.text ? 1 : prefixScoreFactor);
    if (!best || score > best.score) {
      best = { field: field.name, queryToken: queryToken.text, fieldToken, score };
    }
  }

  return best;
}

function isTokenMatch(queryToken: SearchToken, fieldToken: SearchToken, fieldValue: string): boolean {
  if (fieldToken.text !== queryToken.text && !fieldToken.text.startsWith(queryToken.text)) {
    return false;
  }
  return !isEmbeddedKanaRange(queryToken.text, fieldToken.start, fieldToken.start + queryToken.text.length, fieldValue);
}

function findMatchingFieldToken(
  queryTokens: SearchToken[],
  queryIndex: number,
  fieldTokens: SearchToken[],
  fieldValue: string
): { fieldToken: SearchToken; offset: number } | undefined {
  const queryToken = queryTokens[queryIndex];

  const kanaSequence = findKanaSequenceMatch(queryTokens, queryIndex, fieldTokens, fieldValue);
  if (kanaSequence) {
    return kanaSequence;
  }

  for (const fieldToken of fieldTokens) {
    if (isTokenMatch(queryToken, fieldToken, fieldValue)) {
      return { fieldToken, offset: 0 };
    }
  }

  if (queryIndex === 0) {
    return findFollowingPhraseToken(queryTokens, queryIndex, fieldTokens, fieldValue);
  }

  for (let queryStart = 0; queryStart < queryIndex; queryStart += 1) {
    const phrase = queryTokens.slice(queryStart, queryIndex + 1).map((token) => token.text).join("");
    if (phrase.length === queryToken.text.length) {
      continue;
    }

    for (const fieldToken of fieldTokens) {
      if (isPhraseMatch(phrase, fieldToken, fieldValue)) {
        return { fieldToken, offset: phrase.length - queryToken.text.length };
      }
    }

    for (let fieldStart = 0; fieldStart + queryIndex - queryStart < fieldTokens.length; fieldStart += 1) {
      const fieldSlice = fieldTokens.slice(fieldStart, fieldStart + queryIndex - queryStart + 1);
      const querySlice = queryTokens.slice(queryStart, queryIndex + 1);
      if (fieldSlice.length === querySlice.length && fieldSlice.every((token, index) => isTokenMatch(querySlice[index], token, fieldValue))) {
        return { fieldToken: fieldSlice[queryIndex - queryStart], offset: 0 };
      }
    }
  }

  return undefined;
}

function findKanaSequenceMatch(
  queryTokens: SearchToken[],
  queryIndex: number,
  fieldTokens: SearchToken[],
  fieldValue: string
): { fieldToken: SearchToken; offset: number } | undefined {
  const script = kanaScript(queryTokens[queryIndex].text);
  if (!script) {
    return undefined;
  }

  let queryStart = queryIndex;
  while (
    queryStart > 0 &&
    queryTokens[queryStart - 1].end === queryTokens[queryStart].start &&
    kanaScript(queryTokens[queryStart - 1].text) === script
  ) {
    queryStart -= 1;
  }

  let queryEnd = queryIndex;
  while (
    queryEnd + 1 < queryTokens.length &&
    queryTokens[queryEnd].end === queryTokens[queryEnd + 1].start &&
    kanaScript(queryTokens[queryEnd + 1].text) === script
  ) {
    queryEnd += 1;
  }

  if (queryStart === queryEnd && queryTokens[queryIndex].text.length === 1) {
    return undefined;
  }

  const queryPhrase = queryTokens.slice(queryStart, queryEnd + 1).map((token) => token.text).join("");
  for (let fieldStart = 0; fieldStart < fieldTokens.length; fieldStart += 1) {
    let fieldEnd = fieldStart;
    let fieldPhrase = "";
    while (fieldEnd < fieldTokens.length) {
      const current = fieldTokens[fieldEnd];
      if (fieldEnd > fieldStart && fieldTokens[fieldEnd - 1].end !== current.start) {
        break;
      }
      fieldPhrase += current.text;
      if (fieldPhrase.length >= queryPhrase.length) {
        break;
      }
      fieldEnd += 1;
    }

    if (!fieldPhrase.startsWith(queryPhrase)) {
      continue;
    }

    const matchStart = fieldTokens[fieldStart].start;
    const matchEnd = matchStart + queryPhrase.length;
    if (isEmbeddedKanaRange(queryPhrase, matchStart, matchEnd, fieldValue)) {
      continue;
    }

    const queryOffset = queryTokens.slice(queryStart, queryIndex).reduce((total, token) => total + token.text.length, 0);
    let fieldOffset = queryOffset;
    for (let index = fieldStart; index <= fieldEnd; index += 1) {
      const fieldToken = fieldTokens[index];
      if (fieldOffset < fieldToken.text.length) {
        return { fieldToken, offset: fieldOffset };
      }
      fieldOffset -= fieldToken.text.length;
    }
  }

  return undefined;
}

function findFollowingPhraseToken(
  queryTokens: SearchToken[],
  queryIndex: number,
  fieldTokens: SearchToken[],
  fieldValue: string
): { fieldToken: SearchToken; offset: number } | undefined {
  for (let queryEnd = queryIndex + 1; queryEnd < queryTokens.length; queryEnd += 1) {
    const phrase = queryTokens.slice(queryIndex, queryEnd + 1).map((token) => token.text).join("");
    for (const fieldToken of fieldTokens) {
      if (isPhraseMatch(phrase, fieldToken, fieldValue)) {
        return { fieldToken, offset: 0 };
      }
    }
    for (let fieldStart = 0; fieldStart + queryEnd - queryIndex < fieldTokens.length; fieldStart += 1) {
      const fieldSlice = fieldTokens.slice(fieldStart, fieldStart + queryEnd - queryIndex + 1);
      const querySlice = queryTokens.slice(queryIndex, queryEnd + 1);
      if (fieldSlice.length === querySlice.length && fieldSlice.every((token, index) => isTokenMatch(querySlice[index], token, fieldValue))) {
        return { fieldToken: fieldSlice[0], offset: 0 };
      }
    }
  }
  return undefined;
}

function isPhraseMatch(queryText: string, fieldToken: SearchToken, fieldValue: string): boolean {
  return fieldToken.text === queryText || (fieldToken.text.startsWith(queryText) && !isEmbeddedKanaRange(queryText, fieldToken.start, fieldToken.start + queryText.length, fieldValue));
}

function isEmbeddedKanaRange(queryText: string, start: number, end: number, normalizedFieldValue: string): boolean {
  const script = kanaScript(queryText);
  if (!script) {
    return false;
  }

  const before = normalizedFieldValue[start - 1];
  return kanaScript(before) === script;
}

function kanaScript(value: string | undefined): "hiragana" | "katakana" | undefined {
  if (!value) {
    return undefined;
  }
  if (/^\p{Script=Hiragana}+$/u.test(value)) {
    return "hiragana";
  }
  if (/^(?:\p{Script=Katakana}|\u30fc)+$/u.test(value)) {
    return "katakana";
  }
  return undefined;
}

function tokenizeNormalizedText(value: string): SearchToken[] {
  const segmenter = getWordSegmenter();
  if (!segmenter) {
    return fallbackTokenizeNormalizedText(value);
  }

  return Array.from(segmenter.segment(value))
    .filter((part) => part.isWordLike !== false && part.segment.length > 0)
    .map((part) => ({ text: part.segment, start: part.index, end: part.index + part.segment.length }));
}

function tokenizeNormalizedValue(value: string, tokenizer: SearchTokenizer): SearchToken[] {
  if (tokenizer === tokenizeSearchText) {
    return tokenizeNormalizedText(value);
  }
  if (tokenizer === fallbackTokenizeSearchText) {
    return fallbackTokenizeNormalizedText(value);
  }
  return tokenizer(value);
}

function fallbackTokenizeNormalizedText(value: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  let start = -1;
  let tokenClass: TokenClass | undefined;

  const flush = (end: number) => {
    if (start >= 0) {
      tokens.push({ text: value.slice(start, end), start, end });
      start = -1;
      tokenClass = undefined;
    }
  };

  let offset = 0;
  for (const character of value) {
    const currentClass = classify(character);
    const end = offset + character.length;
    if (currentClass === "delimiter") {
      flush(offset);
      offset = end;
      continue;
    }
    if (currentClass === "mark" && start >= 0) {
      offset = end;
      continue;
    }
    if (start < 0) {
      start = offset;
      tokenClass = currentClass;
      offset = end;
      continue;
    }
    if (currentClass !== tokenClass) {
      flush(offset);
      start = offset;
      tokenClass = currentClass;
    }
    offset = end;
  }
  flush(offset);
  return tokens;
}

type TokenClass = "hiragana" | "katakana" | "han" | "latin" | "number" | "mark" | "other" | "delimiter";

function classify(value: string): TokenClass {
  if (/\s|[\p{P}\p{S}]/u.test(value)) return "delimiter";
  if (/\p{Script=Hiragana}/u.test(value)) return "hiragana";
  if (/\p{Script=Katakana}/u.test(value) || value === "ー") return "katakana";
  if (/\p{Script=Han}/u.test(value)) return "han";
  if (/\p{Letter}/u.test(value)) return "latin";
  if (/\p{Number}/u.test(value)) return "number";
  if (/\p{Mark}/u.test(value)) return "mark";
  return "other";
}

function getWordSegmenter(): Segmenter | undefined {
  if (cachedWordSegmenter !== undefined) {
    return cachedWordSegmenter ?? undefined;
  }

  const constructor = typeof Intl === "undefined" ? undefined : (Intl as IntlWithSegmenter).Segmenter;
  cachedWordSegmenter = constructor ? new constructor("ja", { granularity: "word" }) : null;
  return cachedWordSegmenter ?? undefined;
}

function getGraphemeSegmenter(): Segmenter | undefined {
  if (cachedGraphemeSegmenter !== undefined) {
    return cachedGraphemeSegmenter ?? undefined;
  }

  const constructor = typeof Intl === "undefined" ? undefined : (Intl as IntlWithSegmenter).Segmenter;
  cachedGraphemeSegmenter = constructor ? new constructor("ja", { granularity: "grapheme" }) : null;
  return cachedGraphemeSegmenter ?? undefined;
}

function graphemeSegments(value: string): SegmenterPart[] {
  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    return Array.from(segmenter.segment(value));
  }

  const segments: SegmenterPart[] = [];
  let current: SegmenterPart | undefined;
  let offset = 0;

  for (const character of value) {
    const end = offset + character.length;
    if (current && isGraphemeExtend(character)) {
      current.segment += character;
    } else {
      if (current) {
        segments.push(current);
      }
      current = { segment: character, index: offset };
    }
    offset = end;
  }

  if (current) {
    segments.push(current);
  }
  return segments;
}

function normalizeWithOffsets(value: string): NormalizedText {
  let normalizedValue = "";
  const sourceStart: number[] = [];
  const sourceEnd: number[] = [];
  let pendingSpace: { start: number; end: number } | undefined;

  for (const part of graphemeSegments(value)) {
    const start = part.index;
    const end = part.index + part.segment.length;
    const normalizedPart = normalizeCharacter(part.segment);
    let normalizedOffset = 0;

    for (const character of normalizedPart) {
      const characterEnd = normalizedOffset + character.length;
      normalizedOffset = characterEnd;

      if (/^\s$/u.test(character)) {
        if (normalizedValue.length > 0) {
          pendingSpace = pendingSpace ? { start: pendingSpace.start, end } : { start, end };
        }
        continue;
      }

      if (pendingSpace) {
        normalizedValue += " ";
        sourceStart.push(pendingSpace.start);
        sourceEnd.push(pendingSpace.end);
        pendingSpace = undefined;
      }

      for (let unitIndex = 0; unitIndex < character.length; unitIndex += 1) {
        normalizedValue += character[unitIndex];
        sourceStart.push(start);
        sourceEnd.push(end);
      }
    }
  }

  return { value: normalizedValue, sourceStart, sourceEnd };
}

function normalizeCharacter(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
}

function isGraphemeExtend(value: string): boolean {
  return /\p{Mark}/u.test(value) || /^[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]$/u.test(value);
}
