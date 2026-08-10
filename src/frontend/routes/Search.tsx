import { useQuery } from "@tanstack/react-query";
import { Map as MapIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { FeatureCollection, PlaceListData, SearchIndexData } from "../../shared/types";
import { OfficialSearchResults } from "../components/OfficialSiteSearch";
import { CardSkeleton, EmptyState, Section, SectionError } from "../components/Section";
import { SearchResultCard } from "../components/SearchResultCard";
import { SearchBox } from "../components/SearchBox";
import { placeCategories } from "../lib/constants";
import { type LocalSearchResult, type SearchResultType, searchLocalItems } from "../lib/localSearch";
import { mapEligiblePlaceIds } from "../lib/placeMatching";
import { searchConfig } from "../lib/searchConfig";
import { EMPTY_PREPARED_SEARCH_INDEX, prepareSearchIndex } from "../lib/searchMatcher";
import { generatedFiles, getGeneratedJson } from "../lib/staticDataClient";

const initialResultLimit = 5;

export default function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const query = params.get("q") ?? "";
  const officialSearchQuery = query.trim();
  const category = resolvePlaceCategory(params.get("category"));
  const resultType = resolveResultType(params.get("type"));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const indexQuery = useQuery({
    queryKey: ["search-index"],
    queryFn: () => getGeneratedJson<SearchIndexData>(generatedFiles.searchIndex),
    enabled: Boolean(query.trim() || category)
  });
  const placesQuery = useQuery({
    queryKey: ["places", "search-map"],
    queryFn: () => getGeneratedJson<PlaceListData>(generatedFiles.places),
    enabled: Boolean(query.trim() || category)
  });
  const geoQuery = useQuery({
    queryKey: ["places.geojson", "search-map"],
    queryFn: () => getGeneratedJson<FeatureCollection>(generatedFiles.geojson),
    enabled: Boolean(query.trim() || category)
  });

  const preparedSearchIndex = useMemo(
    () => indexQuery.data?.items ? prepareSearchIndex(indexQuery.data.items) : EMPTY_PREPARED_SEARCH_INDEX,
    [indexQuery.data?.items]
  );
  const items = useMemo(
    () => searchLocalItems(query, preparedSearchIndex, { type: resultType, category: category ?? undefined }),
    [category, preparedSearchIndex, query, resultType]
  );
  const featuredItems = items.slice(0, initialResultLimit);
  const featuredKeys = new Set(featuredItems.map((result) => `${result.item.type}:${result.item.id}`));
  const facilityItems = items.filter((result) => result.item.type === "place" && !featuredKeys.has(`${result.item.type}:${result.item.id}`));
  const newsItems = items.filter((result) => result.item.type === "news" && !featuredKeys.has(`${result.item.type}:${result.item.id}`));
  const mapCount = useMemo(() => {
    if (!placesQuery.data || !geoQuery.data) {
      return 0;
    }
    const eligibleIds = mapEligiblePlaceIds(placesQuery.data.places, geoQuery.data);
    return items.filter((result) => result.item.type === "place" && eligibleIds.has(result.item.id)).length;
  }, [geoQuery.data, items, placesQuery.data]);
  const mapPath = `/map?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(category ? { category } : {}) }).toString()}`;
  const setQuery = (nextQuery: string) => {
    const next = new URLSearchParams();
    if (nextQuery.trim()) next.set("q", nextQuery.trim());
    if (category) next.set("category", category);
    navigate(next.toString() ? `/search?${next.toString()}` : "/search");
    setExpanded({});
  };

  return (
    <div className="page page--search">
      <header className="compact-head">
        <p className="page-kicker">探す</p>
        <h1>必要な情報を検索</h1>
        <p>このサイトの施設・お知らせをまとめて検索します。公式サイトの結果も同じ画面で確認できます。</p>
      </header>

      <SearchBox defaultValue={query} onSearch={setQuery} />

      {category ? (
        <div className="active-filter" role="status">
          <span>施設カテゴリ</span>
          <strong>{placeCategories.find((item) => item.id === category)?.label ?? category}</strong>
          <Link to={query ? `/search?q=${encodeURIComponent(query)}` : "/search"}>解除</Link>
        </div>
      ) : null}

      {!query && !category ? <SearchPrompt /> : null}
      {(query || category) && indexQuery.isLoading ? <CardSkeleton /> : null}
      {indexQuery.isError ? <SectionError message="検索結果を取得できませんでした。時間をおいて再度お試しください。" /> : null}

      {(query || category) && !indexQuery.isError ? (
        <>
          <Section
            title={`関連する情報 ${items.length}件`}
            action={mapCount > 0 ? <Link to={mapPath} className="section-link"><MapIcon aria-hidden="true" size={16} />地図で見る（{mapCount}施設）</Link> : null}
          >
            {featuredItems.length > 0 ? featuredItems.map((result) => (
              <SearchResultCard key={`${result.item.type}:${result.item.id}`} result={result} />
            )) : <ZeroResults />}
          </Section>

          {searchConfig.programmableSearch.enabled && officialSearchQuery.length > 0 ? (
            <Section title="郡山市公式サイト">
              <p className="section-intro">制度や手続きの正式な案内を、郡山市公式サイトから確認できます。</p>
              <OfficialSearchResults cx={searchConfig.programmableSearch.cx} query={officialSearchQuery} />
            </Section>
          ) : null}

          <ResultGroup
            title="施設"
            items={facilityItems}
            expanded={Boolean(expanded.place)}
            onToggle={() => setExpanded((current) => ({ ...current, place: !current.place }))}
          />
          <ResultGroup
            title="お知らせ"
            items={newsItems}
            expanded={Boolean(expanded.news)}
            onToggle={() => setExpanded((current) => ({ ...current, news: !current.news }))}
          />
        </>
      ) : null}
    </div>
  );
}

function ResultGroup({
  title,
  items,
  expanded,
  onToggle
}: {
  title: string;
  items: LocalSearchResult[];
  expanded: boolean;
  onToggle: () => void;
}) {
  if (items.length === 0) {
    return null;
  }

  const visibleItems = expanded ? items : items.slice(0, initialResultLimit);
  return (
    <Section title={`${title} ${items.length}件`}>
      {visibleItems.map((result) => <SearchResultCard key={`${result.item.type}:${result.item.id}`} result={result} />)}
      {items.length > initialResultLimit ? (
        <button type="button" className="load-more-button" onClick={onToggle}>
          {expanded ? "表示を減らす" : `さらに表示（残り${items.length - initialResultLimit}件）`}
        </button>
      ) : null}
    </Section>
  );
}

function resolveResultType(value: string | null): SearchResultType {
  return value === "place" || value === "news" ? value : "all";
}

function resolvePlaceCategory(value: string | null): string | null {
  return value && placeCategories.some((item) => item.id === value && item.id !== "all") ? value : null;
}

function SearchPrompt() {
  return (
    <EmptyState title="検索語を入力してください">
      ごみ、住民票、図書館など、調べたい言葉を入力してください。
    </EmptyState>
  );
}

function ZeroResults() {
  return (
    <EmptyState title="見つかりませんでした">
      言葉を短くするか、「ごみ」「防災」「イベント」など別の言葉で試してください。
    </EmptyState>
  );
}
