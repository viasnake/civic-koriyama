import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Phone } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { FeatureCollection, Place, PlaceListData } from "../../shared/types";
import MapCanvas from "../components/MapCanvas";
import { PlaceDetailSheet } from "../components/PlaceDetailSheet";
import { CardSkeleton, SectionError } from "../components/Section";
import { placeCategories, placeCategoryAliases } from "../lib/constants";
import { generatedFiles, getGeneratedJson } from "../lib/staticDataClient";

const mapListPageSize = 60;

export default function MapPage() {
  const [params, setParams] = useSearchParams();
  const initialCategory = categoryFromQuery(params.get("q") ?? params.get("category") ?? "");
  const [category, setCategory] = useState(initialCategory);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [visibleListCount, setVisibleListCount] = useState(mapListPageSize);
  const mapStageRef = useRef<HTMLDivElement | null>(null);

  const geoQuery = useQuery({
    queryKey: ["places.geojson"],
    queryFn: () => getGeneratedJson<FeatureCollection>(generatedFiles.geojson)
  });

  const placesQuery = useQuery({
    queryKey: ["places"],
    queryFn: () => getGeneratedJson<PlaceListData>(generatedFiles.places),
    enabled: Boolean(geoQuery.data) || Boolean(selectedId)
  });

  const selectedPlace = useMemo(() => {
    if (!selectedId) {
      return undefined;
    }

    return placesQuery.data?.places.find((place) => place.id === selectedId);
  }, [placesQuery.data, selectedId]);

  const filteredPlaces = useMemo(() => {
    const places = placesQuery.data?.places ?? [];
    if (category === "all") {
      return places;
    }

    return places.filter((place) => placeMatchesCategory(place, category));
  }, [category, placesQuery.data]);

  const displayedCount = placesQuery.data ? filteredPlaces.length : undefined;

  const visiblePlaces = filteredPlaces.slice(0, visibleListCount);

  useEffect(() => {
    setVisibleListCount(mapListPageSize);
  }, [category]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleListSelect = useCallback((id: string) => {
    setSelectedId(id);
    window.setTimeout(() => {
      mapStageRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
    }, 0);
  }, []);

  const handleCategorySelect = useCallback((nextCategory: string) => {
    setCategory(nextCategory);
    setSelectedId(undefined);
    setParams(nextCategory === "all" ? {} : { category: nextCategory });
  }, [setParams]);

  const handleCloseDetail = useCallback(() => {
    setSelectedId(undefined);
  }, []);

  return (
    <div className="page page--map">
      <header className="compact-head">
        <h1>地図</h1>
        <p>
          {displayedCount === undefined
            ? "施設を読み込んでいます。"
            : `${displayedCount.toLocaleString("ja-JP")}件の施設があります。`}
        </p>
      </header>

      <div className="map-category-scroll">
        <div className="tab-row tab-row--sticky" role="group" aria-label="施設の絞り込み">
          {placeCategories.map((item) => (
            <button
              type="button"
              aria-pressed={category === item.id}
              className={`tab${category === item.id ? " is-active" : ""}`}
              key={item.id}
              onClick={() => handleCategorySelect(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {geoQuery.isLoading ? <CardSkeleton /> : null}
      {geoQuery.isError ? <SectionError message="地図データを取得できませんでした。" /> : null}
      {geoQuery.data ? (
        <div className="map-layout">
          <div className="map-layout__map">
            <div className="map-stage" ref={mapStageRef}>
              <MapCanvas
                collection={geoQuery.data}
                category={category}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
              <p className="map-stage__notice">地図の位置は目安です。訪問前に公式情報を確認してください。</p>
              {selectedId ? (
                <div className="map-detail-popover">
                  <PlaceDetailSheet
                    place={selectedPlace}
                    isLoading={placesQuery.isLoading}
                    errorMessage={placesQuery.isError ? "地点の詳細を取得できませんでした。" : undefined}
                    onClose={handleCloseDetail}
                    variant="compact"
                  />
                </div>
              ) : null}
            </div>
          </div>

          <aside className="map-list-panel" aria-label="施設一覧">
            <div className="map-list-panel__head">
              <h2>施設一覧</h2>
              <p>{filteredPlaces.length.toLocaleString("ja-JP")}件</p>
            </div>
            {placesQuery.isLoading ? <CardSkeleton /> : null}
            {placesQuery.isError ? <SectionError message="施設一覧を取得できませんでした。" /> : null}
            <div className="map-place-list">
              {visiblePlaces.map((place) => (
                <button
                  type="button"
                  className={`map-place-select${selectedId === place.id ? " is-selected" : ""}`}
                  key={place.id}
                  aria-pressed={selectedId === place.id}
                  aria-label={`${place.name}を地図上で選択`}
                  onClick={() => handleListSelect(place.id)}
                >
                  <span className="card-kicker">{place.categoryLabel}</span>
                  <span className="map-place-select__name">{place.name}</span>
                  {place.address ? (
                    <span className="card-line">
                      <MapPin aria-hidden="true" size={16} />
                      {place.address}
                    </span>
                  ) : null}
                  {place.phone ? (
                    <span className="card-line">
                      <Phone aria-hidden="true" size={16} />
                      {place.phone}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            {visibleListCount < filteredPlaces.length ? (
              <button
                type="button"
                className="load-more-button"
                onClick={() => setVisibleListCount((count) => count + mapListPageSize)}
              >
                さらに表示
              </button>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function categoryFromQuery(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u30fc\u2212]/g, "-");

  return placeCategoryAliases[normalized] ?? "all";
}

function placeMatchesCategory(place: Place, category: string): boolean {
  const values = [place.category, place.subcategory, ...(place.categories ?? [])].filter(
    (value): value is string => Boolean(value)
  );

  return valuesMatchCategory(values, category);
}

function valuesMatchCategory(values: string[], category: string): boolean {
  if (category === "aed") {
    return values.includes("aed") || values.includes("safety");
  }
  if (category === "public_wifi") {
    return values.includes("public_wifi") || values.includes("wifi");
  }
  if (category === "public_toilets") {
    return values.includes("public_toilets") || values.includes("toilets");
  }
  if (category === "medical") {
    return values.includes("medical") || values.includes("medical_institutions");
  }
  if (category === "education") {
    return values.includes("education") || values.includes("schools");
  }
  if (category === "childcare") {
    return values.includes("childcare") || values.includes("childcare_facilities");
  }
  if (category === "facility") {
    return values.includes("facility") || values.includes("public_facilities");
  }

  return values.includes(category);
}
