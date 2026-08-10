import type { NewsEntry } from "./types";

export function mergeAnnouncements(news: NewsEntry[]): NewsEntry[] {
  const byIdentity = new Map<string, NewsEntry>();

  [...news]
    .sort((left, right) => timestamp(right.publishedAt) - timestamp(left.publishedAt))
    .forEach((entry) => {
      const identity = announcementIdentity(entry);
      const existing = byIdentity.get(identity);
      byIdentity.set(identity, existing ? mergeDuplicate(existing, entry) : entry);
    });

  return Array.from(byIdentity.values()).sort(
    (left, right) => timestamp(right.publishedAt) - timestamp(left.publishedAt)
  );
}

export function announcementIdentity(entry: Pick<NewsEntry, "id" | "link" | "canonicalUrl">): string {
  const canonical = entry.canonicalUrl ?? entry.link;
  if (canonical) {
    try {
      const url = new URL(canonical, "https://civic-koriyama.invalid");
      url.hash = "";
      url.searchParams.sort();
      return `url:${url.toString().replace(/\/$/, "")}`;
    } catch {
      return `url:${canonical.trim().replace(/\/$/, "")}`;
    }
  }

  return `id:${entry.id}`;
}

export function newsDateKey(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return "unknown";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(new Date(value))
    .filter((part) => ["year", "month", "day"].includes(part.type))
    .map((part) => part.value)
    .join("-");
}

export function newsDateLabel(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return "日付未設定";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).format(new Date(value));
}

function mergeDuplicate(primary: NewsEntry, duplicate: NewsEntry): NewsEntry {
  return {
    ...primary,
    feedIds: unique([...primary.feedIds ?? [], ...duplicate.feedIds ?? []]),
    feedKinds: unique([...primary.feedKinds ?? [], ...duplicate.feedKinds ?? []]),
    tags: unique([...primary.tags, ...duplicate.tags])
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function timestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
