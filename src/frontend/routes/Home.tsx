import { FileText, HeartPulse, Landmark, Recycle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { HomeData, SearchIndexData } from "../../shared/types";
import { CardSkeleton, Section, SectionError } from "../components/Section";
import { NewsCard } from "../components/NewsCard";
import { PlaceCard } from "../components/PlaceCard";
import { SearchBox } from "../components/SearchBox";
import { searchSuggestions } from "../lib/constants";
import { availableSearchSuggestions } from "../lib/localSearch";
import { EMPTY_PREPARED_SEARCH_INDEX, prepareSearchIndex } from "../lib/searchMatcher";
import { generatedFiles, getGeneratedJson } from "../lib/staticDataClient";

const shortcuts = [
  { query: "手続き", label: "手続き", description: "窓口・証明書・申請", icon: FileText },
  { query: "ごみ", label: "ごみ・環境", description: "収集日・分別・環境", icon: Recycle },
  { query: "子育て", label: "子育て", description: "保育・相談・健診", icon: HeartPulse },
  { query: "公共施設", label: "施設を探す", description: "図書館・窓口・AED", icon: Landmark }
] as const;

export default function Home() {
  const navigate = useNavigate();
  const homeQuery = useQuery({
    queryKey: ["home"],
    queryFn: () => getGeneratedJson<HomeData>(generatedFiles.home),
    staleTime: 5 * 60_000
  });
  const searchIndexQuery = useQuery({
    queryKey: ["search-index"],
    queryFn: () => getGeneratedJson<SearchIndexData>(generatedFiles.searchIndex),
    staleTime: 5 * 60_000
  });
  const home = homeQuery.data;
  const preparedSearchIndex = useMemo(
    () => searchIndexQuery.data?.items ? prepareSearchIndex(searchIndexQuery.data.items) : EMPTY_PREPARED_SEARCH_INDEX,
    [searchIndexQuery.data?.items]
  );
  const availableSuggestions = useMemo(
    () => availableSearchSuggestions(searchSuggestions, preparedSearchIndex),
    [preparedSearchIndex]
  );
  const searchPlaceholder = availableSuggestions.length > 0
    ? `例：${availableSuggestions.join("、")}`
    : "キーワードで探す";
  const featuredTopicIds = new Set(home?.featured_topics.map((entry) => entry.id) ?? []);
  const latestNews = home?.news.filter((entry) => !featuredTopicIds.has(entry.id)).slice(0, 3) ?? [];

  return (
    <div className="page page--home">
      <header className="home-intro">
        <div className="home-intro__identity">
          <span className="brand-mark" aria-hidden="true">CK</span>
          <div>
            <p className="home-intro__name">Civic Koriyama</p>
            <p className="home-intro__status">郡山市の公開情報を探しやすくまとめた非公式サイト</p>
          </div>
        </div>
        <h1 aria-label="郡山で必要な情報を、すぐに。"><span>郡山で必要な情報を、</span>{" "}<span>すぐに。</span></h1>
        <p className="home-intro__lead">手続き、暮らしのお知らせ、施設情報をひとつの検索欄から探せます。</p>
        <SearchBox onSearch={(query) => query && navigate(`/search?q=${encodeURIComponent(query)}`)} placeholder={searchPlaceholder} />
        <div className="suggestion-line" aria-label="検索候補">
          <span>よく探される情報</span>
          {availableSuggestions.map((suggestion) => (
            <button
              type="button"
              className="suggestion-link"
              key={suggestion}
              onClick={() => navigate(`/search?q=${encodeURIComponent(suggestion)}`)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </header>

      <section className="home-shortcuts" aria-labelledby="home-shortcuts-title">
        <div className="section__head">
          <h2 id="home-shortcuts-title">何を探していますか？</h2>
        </div>
        <div className="shortcut-list">
          {shortcuts.map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <Link className="shortcut-row" key={shortcut.query} to={`/search?q=${encodeURIComponent(shortcut.query)}`}>
                <span className="shortcut-row__icon"><Icon aria-hidden="true" size={21} /></span>
                <span>
                  <strong>{shortcut.label}</strong>
                  <span>{shortcut.description}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {home?.featured_topics.length ? (
        <Section title="重要なお知らせ" className="home-featured">
          <div className="featured-topic-list">
            {home.featured_topics.map((entry) => (
              <NewsCard key={entry.id} entry={entry} isImportant />
            ))}
          </div>
        </Section>
      ) : null}
      {homeQuery.isLoading ? <CardSkeleton /> : null}

      <Section
        title="最近のお知らせ"
        className="home-news"
        action={<Link to="/news" className="section-link">すべて見る</Link>}
      >
        {homeQuery.isError ? <SectionError message="お知らせを取得できませんでした。公式サイトで最新情報を確認してください。" /> : null}
        {latestNews.map((entry) => <NewsCard key={entry.id} entry={entry} />)}
      </Section>

      <Section
        title="新しい施設"
        className="home-places"
        action={<Link to="/map" className="section-link">施設を地図で見る</Link>}
      >
        {homeQuery.isError ? <SectionError message="施設情報を取得できませんでした。" /> : null}
        {home?.places.slice(0, 3).map((place) => <PlaceCard key={place.id} place={place} showMapLink={false} />)}
      </Section>
    </div>
  );
}
