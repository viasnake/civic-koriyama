import type { SearchIndexItem } from "../../shared/types";
import { placeCategoryAliases, placeCategoryEquivalences } from "./constants";
import type { SearchResultHighlight } from "./tagSelection";
import {
  findPreparedSearchMatchRanges,
  matchPreparedSearchFields,
  partitionSearchMatchRangesByValues,
  preparedSearchFieldsHaveMatch,
  type SearchFieldName,
  type SearchMatch,
  type PreparedSearchIndex,
  tokenizeSearchText
} from "./searchMatcher";

export { normalizeSearchText } from "./searchMatcher";

export type SearchResultType = "all" | "place" | "news";

export type LocalSearchFilters = {
  type?: SearchResultType;
  category?: string;
};

export type SuggestionSearchStats = {
  candidateVisits: number;
  matchesFound: number;
  queryPreparations: number;
};

export type { SearchResultHighlight } from "./tagSelection";

export type LocalSearchResult = {
  item: SearchIndexItem;
  score: number;
  match: SearchMatch;
  reason: string;
  highlights: Partial<Record<SearchFieldName, SearchResultHighlight[]>>;
  tagHighlights: SearchResultHighlight[][];
};

export function availableSearchSuggestions(
  suggestions: string[],
  preparedIndex: PreparedSearchIndex,
  limit = 4,
  stats?: SuggestionSearchStats
): string[] {
  const available: string[] = [];
  for (const suggestion of suggestions) {
    const queryTokens = tokenizeSearchText(suggestion);
    stats && (stats.queryPreparations += 1);
    if (queryTokens.length === 0) {
      continue;
    }

    for (const preparedItem of preparedIndex.items) {
      stats && (stats.candidateVisits += 1);
      if (!preparedSearchFieldsHaveMatch(queryTokens, preparedItem.fields)) {
        continue;
      }
      available.push(suggestion);
      stats && (stats.matchesFound += 1);
      break;
    }

    if (available.length >= limit) {
      break;
    }
  }
  return available;
}

export function searchLocalItems(
  query: string,
  index: PreparedSearchIndex,
  filters: LocalSearchFilters = {}
): LocalSearchResult[] {
  const queryTokens = tokenizeSearchText(query);
  const normalized = queryTokens.map((token) => token.text).join(" ");
  const category = filters.category ?? placeCategoryAliases[normalized];
  const type = filters.type ?? "all";

  if (!normalized && !category) {
    return [];
  }

  return index.items
    .filter(({ item }) => type === "all" || item.type === type)
    .filter(({ item }) => !category || (item.type === "place" && itemMatchesPlaceCategory(item, category)))
    .map((preparedItem) => {
      const match = queryTokens.length
        ? matchPreparedSearchFields(queryTokens, preparedItem.fields)
        : { score: 0, evidence: [] };
      const highlights = queryTokens.length
        ? Object.fromEntries(
            preparedItem.fields.map((field) => [
              field.field.name,
              findPreparedSearchMatchRanges(field, queryTokens)
            ])
          ) as Partial<Record<SearchFieldName, SearchResultHighlight[]>>
        : {};
      const tagField = preparedItem.fields.find(({ field }) => field.name === "tags");
      const tagHighlights = tagField?.field.values
        ? partitionSearchMatchRangesByValues(tagField.field.values, highlights.tags ?? [])
        : [];
      const score = queryTokens.length ? match.score : category ? 1 : 0;
      return {
        item: preparedItem.item,
        score,
        match,
        reason: searchMatchReason(match, Boolean(category)),
        highlights,
        tagHighlights
      };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name, "ja"))
}

function searchMatchReason(match: SearchMatch, isCategoryMatch: boolean): string {
  const field = [...match.evidence].sort((left, right) => right.score - left.score)[0]?.field;
  return field === "name"
    ? "名称に一致"
    : field === "category"
      ? "カテゴリに一致"
      : field === "tags"
        ? "タグに一致"
        : field === "address"
        ? "住所に一致"
        : isCategoryMatch
          ? "カテゴリで一致"
          : "関連する情報";
}

function itemMatchesPlaceCategory(item: SearchIndexItem, category: string): boolean {
  const values = [item.category, ...(item.categories ?? [])].filter(Boolean);
  const equivalentValues = placeCategoryEquivalences[category] ?? [category];
  return values.some((value) => equivalentValues.includes(value));
}
