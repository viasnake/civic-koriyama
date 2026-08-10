import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { NewsEntry, NewsListData } from "../../shared/types";
import { mergeAnnouncements, newsDateKey, newsDateLabel } from "../../shared/announcements";
import { NewsCard } from "../components/NewsCard";
import { CardSkeleton, Section, SectionError } from "../components/Section";
import { newsCategories } from "../lib/constants";
import { generatedFiles, getGeneratedJson } from "../lib/staticDataClient";

const newsPageSize = 24;

export default function News() {
  const [params, setParams] = useSearchParams();
  const [visibleCount, setVisibleCount] = useState(newsPageSize);
  const requestedCategory = params.get("category") ?? "all";
  const category = newsCategories.some((item) => item.id === requestedCategory) ? requestedCategory : "all";
  const categoryLabel = newsCategories.find((item) => item.id === category)?.label ?? "すべて";
  const newsQuery = useQuery({
    queryKey: ["news"],
    queryFn: () => getGeneratedJson<NewsListData>(generatedFiles.news)
  });
  const entries = useMemo(
    () => filterNews(mergeAnnouncements(newsQuery.data?.entries ?? []), category),
    [category, newsQuery.data?.entries]
  );
  const visibleEntries = entries.slice(0, visibleCount);
  const groups = useMemo(() => groupNewsByDate(visibleEntries), [visibleEntries]);

  useEffect(() => {
    setVisibleCount(newsPageSize);
  }, [category]);

  return (
    <div className="page page--news">
      <header className="compact-head">
        <p className="page-kicker">お知らせ</p>
        <h1>郡山市からのお知らせ</h1>
        <p>公開情報をカテゴリと日付で確認できます。掲載内容は公式サイトでもご確認ください。</p>
      </header>

      <div className="news-category-control">
        <label htmlFor="news-category">カテゴリで絞り込む</label>
        <select
          id="news-category"
          value={category}
          onChange={(event) => setParams(event.target.value === "all" ? {} : { category: event.target.value })}
        >
          {newsCategories.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
        </select>
        <div className="news-category-tabs" role="group" aria-label="お知らせカテゴリ">
          {newsCategories.map((item) => (
            <button
              type="button"
              aria-pressed={category === item.id}
              className={`tab${category === item.id ? " is-active" : ""}`}
              key={item.id}
              onClick={() => setParams(item.id === "all" ? {} : { category: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <Section
        title={`${categoryLabel}のお知らせ ${entries.length.toLocaleString("ja-JP")}件`}
        action={<a className="section-link" href="https://www.city.koriyama.lg.jp/" target="_blank" rel="noreferrer">公式サイト <span className="sr-only">（新しいタブで開きます）</span><ExternalLink aria-hidden="true" size={14} /></a>}
      >
        {newsQuery.isLoading ? <CardSkeleton /> : null}
        {newsQuery.isError ? <SectionError message="お知らせを取得できませんでした。公式サイトで最新情報を確認してください。" /> : null}
        {!newsQuery.isLoading && !newsQuery.isError && groups.length === 0 ? (
          <div className="empty-state"><strong>このカテゴリのお知らせはありません</strong><p>別のカテゴリを選ぶか、公式サイトを確認してください。</p></div>
        ) : null}
        {groups.map((group) => (
          <section className="news-date-group" key={group.id} aria-labelledby={`news-date-${group.id}`}>
            <h3 id={`news-date-${group.id}`}>{group.label}</h3>
            <div className="news-date-group__items">
              {group.entries.map((entry) => <NewsCard key={entry.id} entry={entry} showDate={false} />)}
            </div>
          </section>
        ))}
        {visibleCount < entries.length ? (
          <button type="button" className="load-more-button" onClick={() => setVisibleCount((count) => count + newsPageSize)}>さらに表示</button>
        ) : null}
      </Section>
    </div>
  );
}

function filterNews(entries: NewsEntry[], category: string): NewsEntry[] {
  return category === "all" ? entries : entries.filter((entry) => entry.category === category);
}

type NewsDateGroup = { id: string; label: string; entries: NewsEntry[] };

function groupNewsByDate(entries: NewsEntry[]): NewsDateGroup[] {
  const groups = new Map<string, NewsDateGroup>();
  entries.forEach((entry) => {
    const id = newsDateKey(entry.publishedAt);
    const group = groups.get(id) ?? { id, label: newsDateLabel(entry.publishedAt), entries: [] };
    group.entries.push(entry);
    groups.set(id, group);
  });
  return Array.from(groups.values());
}
