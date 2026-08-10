import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import type { NewsEntry } from "../../shared/types";
import type { SearchResultHighlight } from "../lib/localSearch";
import { formatDateOnly } from "../lib/format";
import { selectVisibleTagIndices, type TagHighlightRanges } from "../lib/tagSelection";
import { HighlightedText } from "./HighlightedText";

type NewsCardProps = {
  entry: NewsEntry;
  className?: string;
  highlightRanges?: SearchResultHighlight[];
  tagHighlightRanges?: TagHighlightRanges;
  isImportant?: boolean;
  showDate?: boolean;
};

export function NewsCard({ entry, className, highlightRanges, tagHighlightRanges, isImportant = false, showDate = true }: NewsCardProps) {
  const isInternalLink = entry.link.startsWith("/");
  const title = <HighlightedText text={entry.title} ranges={highlightRanges} />;
  const titleLink = isInternalLink ? (
    <Link to={entry.link}>{title}</Link>
  ) : (
    <a href={entry.link} target="_blank" rel="noreferrer">
      {title}
      <span className="sr-only">（新しいタブで開きます）</span>
      <ExternalLink aria-hidden="true" size={15} />
    </a>
  );

  return (
    <article className={`news-card${className ? ` ${className}` : ""}`}>
      <div className="card-kicker">
        {isImportant ? <span className="importance-label">重要</span> : null}
        {entry.categoryLabel}
        {showDate && entry.publishedAt ? ` / ${formatDateOnly(entry.publishedAt)}` : ""}
      </div>
      <h3>{titleLink}</h3>
      {entry.tags.length > 0 ? (
        <div className="tag-row">
          {selectVisibleTagIndices(entry.tags, tagHighlightRanges).map((tagIndex) => (
            <span key={`${entry.tags[tagIndex]}:${tagIndex}`}>
              <HighlightedText text={entry.tags[tagIndex]} ranges={tagHighlightRanges?.[tagIndex]} />
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
