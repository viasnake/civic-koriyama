import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, MapPin, Phone } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { PlaceListData } from "../../shared/types";
import { CardSkeleton, Section, SectionError } from "../components/Section";
import { googleMapsUrl } from "../lib/format";
import { generatedFiles, getGeneratedJson } from "../lib/staticDataClient";
import { formatDate } from "../lib/format";

const PlaceMap = lazy(() => import("../components/PlaceMap"));

export default function Place() {
  const params = useParams();
  const id = params.id ?? "";
  const placeQuery = useQuery({
    queryKey: ["place", id],
    queryFn: async () => {
      const placesData = await getGeneratedJson<PlaceListData>(generatedFiles.places);
      return placesData.places.find((item) => item.id === id) ?? null;
    },
    enabled: Boolean(id)
  });
  const place = placeQuery.data;
  const mapsUrl = place ? googleMapsUrl(place) : undefined;
  const hasMap = place?.lat !== undefined && place?.lng !== undefined;

  return (
    <div className="page page--place">
      <header className="compact-head">
        <Link to="/search" className="section-link">
          探すへ
        </Link>
        <h1>{place?.name ?? "地点詳細"}</h1>
        {place ? <p>{place.categoryLabel}</p> : null}
      </header>

      {placeQuery.isLoading ? <CardSkeleton /> : null}
      {placeQuery.isError ? <SectionError message="地点情報を取得できませんでした。" /> : null}

      {place ? (
        <div className="place-detail-layout">
          <Section title="施設情報" className="place-detail-info">
          <div className="place-detail-actions" aria-label="主要な操作">
            {place.phone ? <a className="primary-link" href={`tel:${place.phone}`}><Phone aria-hidden="true" size={16} />電話する</a> : null}
            {mapsUrl ? <a className="text-link action-link" href={mapsUrl} target="_blank" rel="noreferrer">Google Maps <span className="sr-only">（新しいタブで開きます）</span><ExternalLink aria-hidden="true" size={14} /></a> : null}
            {place.officialUrl ? <a className="text-link action-link" href={place.officialUrl} target="_blank" rel="noreferrer">公式ページ <span className="sr-only">（新しいタブで開きます）</span><ExternalLink aria-hidden="true" size={14} /></a> : null}
          </div>
          {place.address ? (
            <p className="card-line card-line--large">
              <MapPin aria-hidden="true" size={18} />
              {place.address}
            </p>
          ) : null}
          {place.phone ? (
            <p className="card-line card-line--large">
              <Phone aria-hidden="true" size={18} />
              <a href={`tel:${place.phone}`}>{place.phone}</a>
            </p>
          ) : null}
          <dl className="place-detail-meta">
            <div><dt>出典</dt><dd>{place.sourceUrl ? <a href={place.sourceUrl} target="_blank" rel="noreferrer">郡山市オープンデータ<span className="sr-only">（新しいタブで開きます）</span></a> : "郡山市の公開情報"}</dd></div>
            <div><dt>最終取得</dt><dd>{formatDate(place.lastSeenAt) || "日付未設定"}</dd></div>
            <div><dt>位置</dt><dd>地図の位置は目安です</dd></div>
          </dl>
          </Section>

          {hasMap ? (
            <Section title="地図" className="place-detail-map">
          <Suspense fallback={<CardSkeleton />}>
            <PlaceMap place={place} />
          </Suspense>
          <p className="notice-line">地図の位置は目安です。訪問前に公式情報を確認してください。</p>
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
