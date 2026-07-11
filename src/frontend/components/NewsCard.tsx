import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import type { NewsEntry } from "../../shared/types";
import { formatDateOnly } from "../lib/format";
import { HighlightedText } from "./HighlightedText";

type NewsCardProps = {
  entry: NewsEntry;
  className?: string;
  highlightQuery?: string;
};

export function NewsCard({ entry, className, highlightQuery }: NewsCardProps) {
  const isInternalLink = entry.link.startsWith("/");
  const title = <HighlightedText text={entry.title} query={highlightQuery} />;
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
      {className?.includes("news-card--featured-primary") ? (
        <span className="news-card__status">重要</span>
      ) : null}
      <div className="card-kicker">
        {entry.categoryLabel}
        {entry.publishedAt ? ` / ${formatDateOnly(entry.publishedAt)}` : ""}
      </div>
      <h3>{titleLink}</h3>
      {visibleTags(entry).length > 0 ? (
        <div className="tag-row">
          {visibleTags(entry).map((tag) => (
            <span key={tag}>
              <HighlightedText text={tag} query={highlightQuery} />
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function visibleTags(entry: NewsEntry): string[] {
  const category = entry.categoryLabel.trim().toLowerCase();
  return entry.tags
    .filter((tag, index, tags) => tag.trim().toLowerCase() !== category && tags.indexOf(tag) === index)
    .slice(0, 2);
}
