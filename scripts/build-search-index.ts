import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  NewsEntry,
  NewsListData,
  OfficialSite,
  PlaceListData,
  SearchIndexData,
  SearchIndexItem
} from "../src/shared/types";
import { filterSearchTags, normalizeSearchText } from "../src/frontend/lib/searchMatcher";

const generatedDir = join(process.cwd(), "public", "generated");

async function main(): Promise<void> {
  const placesData = await readGenerated<PlaceListData>("places.json");
  const newsData = await readGenerated<NewsListData>("news.json");
  const searchIndex: SearchIndexData = {
    generated_at: placesData.generated_at,
    items: [
      ...placesData.places.map(toPlaceSearchItem),
      ...newsData.entries.map(toNewsSearchItem),
      ...(newsData.official_sites ?? []).map(toOfficialSiteSearchItem)
    ]
  };

  await writeFile(
    join(generatedDir, "search-index.json"),
    `${JSON.stringify(searchIndex, null, 2)}\n`,
    "utf8"
  );
  console.log(`generated ${searchIndex.items.length} search index items`);
}

async function readGenerated<T>(name: string): Promise<T> {
  const content = await readFile(join(generatedDir, name), "utf8");
  return JSON.parse(content) as T;
}

function toPlaceSearchItem(place: PlaceListData["places"][number]): SearchIndexItem {
  const keywords = [
    place.phone
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return {
    id: place.id,
    type: "place",
    name: place.name,
    category: place.subcategory ?? place.category,
    categoryLabel: place.categoryLabel,
    categories: place.categories,
    address: place.address,
    keywords: normalizeSearchText(keywords)
  };
}

function toNewsSearchItem(entry: NewsEntry): SearchIndexItem {
  const keywords = [
    entry.feedId,
    ...(entry.feedIds ?? []),
    ...(entry.feedKinds ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return {
    id: entry.id,
    type: "news",
    name: entry.title,
    category: entry.category,
    categoryLabel: entry.categoryLabel,
    url: entry.link,
    publishedAt: entry.publishedAt,
    tags: filterSearchTags(entry.tags, [entry.title, entry.category, entry.categoryLabel]),
    keywords: normalizeSearchText(keywords)
  };
}

function toOfficialSiteSearchItem(site: OfficialSite): SearchIndexItem {
  const keywords = [
    site.title,
    site.url,
    site.feedId,
    site.feedKind,
    site.feedUrl,
    ...site.tags
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return {
    id: site.id,
    type: "news",
    name: site.title,
    category: "official_site",
    categoryLabel: "公式サイト",
    url: site.url,
    tags: filterSearchTags(site.tags, [site.title]),
    keywords: normalizeSearchText(keywords)
  };
}

void main();
