import type { ReactNode } from "react";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, useLocation } from "react-router-dom";
import type { BuildMeta, HomeData } from "../../shared/types";
import { formatDate } from "../lib/format";
import { generatedFiles, getGeneratedJson, useBuildMeta } from "../lib/staticDataClient";
import { BottomNav } from "./BottomNav";

type AppShellProps = {
  children: ReactNode;
};

const navItems = [
  { to: "/", label: "ホーム" },
  { to: "/search", label: "探す" },
  { to: "/map", label: "地図" },
  { to: "/news", label: "お知らせ" }
] as const;

const defaultSiteUrl = "https://civic-koriyama.alflag.org";
const configuredSiteUrl = normalizeSiteUrl(import.meta.env.VITE_SITE_URL) ?? defaultSiteUrl;

export function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const buildMetaQuery = useBuildMeta();
  const homeQuery = useQuery({
    queryKey: ["home"],
    queryFn: () => getGeneratedJson<HomeData>(generatedFiles.home),
    staleTime: 5 * 60_000
  });
  const freshnessLabel = dataFreshnessLabel(buildMetaQuery.data, homeQuery.data?.health.status);

  useEffect(() => {
    const meta = routeDocumentMeta(location.pathname);
    const canonicalUrl = absoluteSiteUrl(location.pathname);
    const imageUrl = absoluteSiteUrl("/og-image.svg");
    document.title = meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", meta.description);
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", canonicalUrl);
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", meta.title);
    document.querySelector('meta[property="og:url"]')?.setAttribute("content", canonicalUrl);
    document.querySelector('meta[property="og:image"]')?.setAttribute("content", imageUrl);
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", meta.description);
    document.querySelector('meta[name="twitter:image"]')?.setAttribute("content", imageUrl);
    const structuredData = document.getElementById("website-structured-data");
    if (structuredData) {
      structuredData.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Civic Koriyama",
        alternateName: "郡山市の施設・お知らせ検索",
        url: absoluteSiteUrl("/"),
        potentialAction: {
          "@type": "SearchAction",
          target: `${absoluteSiteUrl("/search")}?q={search_term_string}`,
          "query-input": "required name=search_term_string"
        }
      });
    }
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        本文へ
      </a>
      <header className="desktop-header">
        <div className="desktop-header__inner">
          <Link to="/" className="desktop-header__brand">
            Civic Koriyama
          </Link>
          <nav className="desktop-nav" aria-label="主要ナビゲーション">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => `desktop-nav__item${isActive ? " is-active" : ""}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="content" className="app-main">
        <DataStatusBanner meta={buildMetaQuery.data} healthStatus={homeQuery.data?.health.status} />
        {children}
      </main>
      <footer className="site-footer" aria-label="サイト情報">
        <div className="site-footer__inner">
          <p className="site-footer__notice">
            <strong>非公式サイトです。</strong>
            正確な情報は
            <a href="https://www.city.koriyama.lg.jp/" target="_blank" rel="noreferrer">
              郡山市公式サイト
              <span className="sr-only">（新しいタブで開きます）</span>
            </a>
            で確認してください。
          </p>
          <div className="site-footer__links">
            {freshnessLabel ? <span>{freshnessLabel}</span> : null}
            <Link to="/about">このサイトについて</Link>
          </div>
        </div>
      </footer>
      <BottomNav />
    </div>
  );
}

function routeDocumentMeta(pathname: string) {
  if (pathname === "/search") {
    return {
      title: "郡山市の情報を探す | Civic Koriyama",
      description: "郡山市の手続き、くらしのお知らせ、施設情報を検索できます。"
    };
  }
  if (pathname === "/news") {
    return {
      title: "郡山市のお知らせ | Civic Koriyama",
      description: "郡山市のお知らせをカテゴリ別に確認できます。非公式の市民向けデータサイトです。"
    };
  }
  if (pathname === "/map") {
    return {
      title: "郡山市の施設マップ | Civic Koriyama",
      description: "郡山市内の施設情報を地図で確認できます。"
    };
  }
  if (pathname.startsWith("/place/")) {
    return {
      title: "郡山市の施設詳細 | Civic Koriyama",
      description: "郡山市内の施設情報を確認できます。訪問前に公式情報も確認してください。"
    };
  }
  if (pathname === "/about") {
    return {
      title: "このサイトについて | Civic Koriyama",
      description: "Civic Koriyamaのデータ利用、非公式サイトとしての位置づけ、確認方法について。"
    };
  }

  return {
    title: "郡山市の施設・お知らせ検索 | Civic Koriyama",
    description: "郡山市の手続き、くらしのお知らせ、施設情報を探せる非公式の市民向けデータサイトです。"
  };
}

function dataFreshnessLabel(meta: BuildMeta | undefined, healthStatus: HomeData["health"]["status"] | undefined) {
  if (!meta) {
    return null;
  }

  const formattedAt = formatDate(meta.generated_at);
  if (meta.status === "stale") {
    return `データ更新が遅れています。最終取得 ${formattedAt}`;
  }
  if (healthStatus === "degraded" || meta.warnings.length > 0) {
    return `一部の情報を取得できていません。最終更新 ${formattedAt}`;
  }

  return `最終更新 ${formattedAt}`;
}

function DataStatusBanner({
  meta,
  healthStatus
}: {
  meta?: BuildMeta;
  healthStatus?: HomeData["health"]["status"];
}) {
  if (!meta) {
    return null;
  }

  const isDegraded = meta.status === "stale" || healthStatus === "degraded" || meta.warnings.length > 0;
  if (!isDegraded) {
    return (
      <p className="data-status data-status--quiet">
        <span className="data-status__dot" aria-hidden="true" />
        データは定期的に更新しています。最終取得 {formatDate(meta.generated_at)}
      </p>
    );
  }

  return (
    <div className="data-status data-status--degraded" role="status">
      <strong>一部の情報を確認できません</strong>
      <p>
        画面に表示されている情報が古い可能性があります。最終取得は {formatDate(meta.generated_at)} です。
        正確な内容は <a href="https://www.city.koriyama.lg.jp/" target="_blank" rel="noreferrer">郡山市公式サイト</a> で確認してください。
      </p>
    </div>
  );
}

function normalizeSiteUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  return value.replace(/\/+$/, "");
}

function absoluteSiteUrl(pathname: string): string {
  const origin = configuredSiteUrl ?? window.location.origin;
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;

  return `${origin}${path}`;
}
