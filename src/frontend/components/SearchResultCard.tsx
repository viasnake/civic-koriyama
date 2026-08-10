import { MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import type { NewsEntry, SearchIndexItem } from "../../shared/types";
import type { LocalSearchResult } from "../lib/localSearch";
import { HighlightedText } from "./HighlightedText";
import { NewsCard } from "./NewsCard";

type SearchResultCardProps = {
  result: LocalSearchResult;
};

export function SearchResultCard({ result }: SearchResultCardProps) {
  const { item } = result;
  if (item.type === "news") {
    return <NewsCard entry={toNewsEntry(item)} highlightRanges={result.highlights.name} tagHighlightRanges={result.tagHighlights} />;
  }

  return (
    <article className="place-card search-result-row">
      <div className="card-kicker">施設 · {item.categoryLabel} · 郡山市オープンデータ</div>
      <h3>
        <Link to={`/place/${encodeURIComponent(item.id)}`}>
          <HighlightedText text={item.name} ranges={result.highlights.name} />
        </Link>
      </h3>
      {item.address ? (
        <p className="card-line">
          <MapPin aria-hidden="true" size={16} />
          <HighlightedText text={item.address} ranges={result.highlights.address} />
        </p>
      ) : null}
      <p className="result-reason">{result.reason}</p>
    </article>
  );
}

function toNewsEntry(item: SearchIndexItem): NewsEntry {
  return {
    id: item.id,
    title: item.name,
    link: item.url ?? "/news",
    category: item.category,
    categoryLabel: item.categoryLabel,
    publishedAt: item.publishedAt,
    tags: item.tags ?? []
  };
}
