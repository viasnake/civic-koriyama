import type { SearchIndexItem } from "../../shared/types";
import { placeCategoryAliases } from "./constants";

export type SearchResultType = "all" | "place" | "news";

export type LocalSearchFilters = {
  type?: SearchResultType;
  category?: string;
};

export function searchLocalItems(
  query: string,
  indexItems: SearchIndexItem[],
  filters: LocalSearchFilters = {}
): SearchIndexItem[] {
  const normalized = normalizeSearchText(query);
  const category = filters.category ?? placeCategoryAliases[normalized];
  const type = filters.type ?? "all";

  if (!normalized && !category) {
    return [];
  }

  const terms = normalized.split(" ").filter(Boolean);

  return indexItems
    .filter((item) => type === "all" || item.type === type)
    .filter((item) => !category || (item.type === "place" && itemMatchesPlaceCategory(item, category)))
    .map((item) => ({
      item,
      score: scoreSearchItem(item, terms, Boolean(category))
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name, "ja"))
    .map(({ item }) => item);
}

function scoreSearchItem(item: SearchIndexItem, terms: string[], hasCategory: boolean): number {
  if (terms.length === 0) {
    return hasCategory ? 1 : 0;
  }

  const name = normalizeSearchText(item.name);
  const category = normalizeSearchText(`${item.category} ${item.categoryLabel} ${(item.categories ?? []).join(" ")}`);
  const tags = normalizeSearchText((item.tags ?? []).join(" "));
  const address = normalizeSearchText(item.address ?? "");

  if (!terms.every((term) => item.keywords.includes(term))) {
    return 0;
  }

  return terms.reduce((score, term) => {
    if (name === term) {
      return score + 100;
    }
    if (name.startsWith(term)) {
      return score + 80;
    }
    if (name.includes(term)) {
      return score + 60;
    }
    if (category.includes(term)) {
      return score + 42;
    }
    if (tags.includes(term)) {
      // Tags broaden recall, but should not outrank a title or category match.
      return score + 18;
    }
    if (address.includes(term)) {
      return score + 24;
    }
    return score + 10;
  }, 0);
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u30fc\u2212]/g, "-");
}

function itemMatchesPlaceCategory(item: SearchIndexItem, category: string): boolean {
  const values = [item.category, ...(item.categories ?? [])].filter(Boolean);

  if (category === "aed") {
    return values.includes("aed") || values.includes("safety");
  }
  if (category === "public_wifi") {
    return values.includes("public_wifi") || values.includes("wifi");
  }
  if (category === "public_toilets") {
    return values.includes("public_toilets") || values.includes("toilets");
  }
  if (category === "medical") {
    return values.includes("medical") || values.includes("medical_institutions");
  }
  if (category === "education") {
    return values.includes("education") || values.includes("schools");
  }
  if (category === "childcare") {
    return values.includes("childcare") || values.includes("childcare_facilities");
  }
  if (category === "facility") {
    return values.includes("facility") || values.includes("public_facilities");
  }

  return values.includes(category);
}
