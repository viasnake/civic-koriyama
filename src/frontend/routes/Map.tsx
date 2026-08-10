import { useQuery } from "@tanstack/react-query";
import { List, Map as MapIcon, MapPin, Phone } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { FeatureCollection, Place, PlaceListData, SearchIndexData } from "../../shared/types";
import MapCanvas from "../components/MapCanvas";
import { PlaceDetailSheet } from "../components/PlaceDetailSheet";
import { CardSkeleton, EmptyState, SectionError } from "../components/Section";
import { placeCategories } from "../lib/constants";
import { searchLocalItems } from "../lib/localSearch";
import { largestUncoveredRect, type SafeRect } from "../lib/mapSafeArea";
import { filterMapFeatures, mapEligiblePlaceIds, placeMatchesCategory } from "../lib/placeMatching";
import { generatedFiles, getGeneratedJson } from "../lib/staticDataClient";
import { EMPTY_PREPARED_SEARCH_INDEX, prepareSearchIndex } from "../lib/searchMatcher";

const mapListPageSize = 60;
type MapView = "list" | "map";

export default function MapPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const category = resolveCategory(params.get("category"));
  const view = resolveView(params.get("view"));
  const selectedId = params.get("selected") ?? undefined;
  const [visibleListCount, setVisibleListCount] = useState(mapListPageSize);
  const selectedHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const selectionOriginRef = useRef<HTMLButtonElement | null>(null);
  const mapListPanelRef = useRef<HTMLElement | null>(null);
  const mapStageRef = useRef<HTMLDivElement | null>(null);
  const mapDetailRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusIdRef = useRef<string | null>(null);
  const [mapSafeRect, setMapSafeRect] = useState<SafeRect | undefined>();
  const [mapLayoutVersion, setMapLayoutVersion] = useState(0);

  const geoQuery = useQuery({
    queryKey: ["places.geojson"],
    queryFn: () => getGeneratedJson<FeatureCollection>(generatedFiles.geojson)
  });
  const placesQuery = useQuery({
    queryKey: ["places"],
    queryFn: () => getGeneratedJson<PlaceListData>(generatedFiles.places)
  });
  const indexQuery = useQuery({
    queryKey: ["search-index"],
    queryFn: () => getGeneratedJson<SearchIndexData>(generatedFiles.searchIndex)
  });
  const preparedSearchIndex = useMemo(
    () => indexQuery.data?.items ? prepareSearchIndex(indexQuery.data.items) : EMPTY_PREPARED_SEARCH_INDEX,
    [indexQuery.data?.items]
  );

  const matchingIds = useMemo(() => {
    const places = placesQuery.data?.places ?? [];
    const geojson = geoQuery.data;
    if (!geojson) return new Set<string>();
    const eligible = mapEligiblePlaceIds(places, geojson);
    const searchIds = query.trim()
      ? new Set(searchLocalItems(query, preparedSearchIndex, { type: "place" }).map((result) => result.item.id))
      : null;
    const categoryPlaces = new Set(places.filter((place) => placeMatchesCategory(place, category)).map((place) => place.id));
    const categoryFeatures = new Set(filterMapFeatures(geojson, category, eligible).map((feature) => String(feature.id)));
    return new Set(
      Array.from(eligible).filter((id) => categoryPlaces.has(id) && categoryFeatures.has(id) && (!searchIds || searchIds.has(id)))
    );
  }, [category, geoQuery.data, placesQuery.data?.places, preparedSearchIndex, query]);

  const filteredPlaces = useMemo(
    () => (placesQuery.data?.places ?? []).filter((place) => matchingIds.has(place.id)),
    [matchingIds, placesQuery.data?.places]
  );
  const filteredFeatures = useMemo(
    () => (geoQuery.data ? filterMapFeatures(geoQuery.data, "all", matchingIds) : []),
    [geoQuery.data, matchingIds]
  );
  const selectedPlace = filteredPlaces.find((place) => place.id === selectedId);
  const visiblePlaces = filteredPlaces.slice(0, visibleListCount);

  useEffect(() => setVisibleListCount(mapListPageSize), [category, query]);
  useEffect(() => {
    if (selectedPlace) {
      requestAnimationFrame(() => selectedHeadingRef.current?.focus());
    }
  }, [selectedPlace]);

  useEffect(() => {
    if (selectedId || !pendingFocusIdRef.current) {
      return;
    }

    const originId = pendingFocusIdRef.current;
    const origin = document.querySelector<HTMLButtonElement>(`[data-place-id="${originId}"]`);
    if (origin) {
      origin.focus();
      pendingFocusIdRef.current = null;
    }
  }, [matchingIds, selectedId, view]);

  useEffect(() => {
    const panel = mapListPanelRef.current;
    if (!panel) {
      return;
    }

    const updateAvailableHeight = () => {
      if (window.innerWidth >= 720 || view !== "list") {
        panel.style.removeProperty("--map-list-available-height");
        return;
      }

      const navigation = document.querySelector<HTMLElement>(".bottom-nav");
      const navigationHeight = navigation && getComputedStyle(navigation).position === "fixed"
        ? navigation.getBoundingClientRect().height
        : 0;
      const availableHeight = Math.max(140, window.innerHeight - panel.getBoundingClientRect().top - navigationHeight - 4);
      panel.style.setProperty("--map-list-available-height", `${availableHeight}px`);
    };

    updateAvailableHeight();
    window.addEventListener("resize", updateAvailableHeight);
    return () => window.removeEventListener("resize", updateAvailableHeight);
  }, [matchingIds.size, view]);

  useLayoutEffect(() => {
    const stage = mapStageRef.current;
    if (!stage || !selectedId || view !== "map") {
      setMapSafeRect(undefined);
      return;
    }

    const mapElement = stage.querySelector<HTMLElement>(".map-canvas");
    if (!mapElement) {
      return;
    }

    const updateSafeRect = () => {
      const mapRect = mapElement.getBoundingClientRect();
      const obstacleElements = [
        mapDetailRef.current,
        stage.querySelector<HTMLElement>(".map-stage__notice"),
        ...Array.from(stage.querySelectorAll<HTMLElement>(".leaflet-control-zoom, .leaflet-control-attribution")),
        document.querySelector<HTMLElement>(".bottom-nav")
      ];
      const obstacles = obstacleElements
        .map((element) => element?.getBoundingClientRect())
        .filter((rect): rect is DOMRect => Boolean(rect && rect.width > 0 && rect.height > 0))
        .map((rect) => ({
          left: rect.left - mapRect.left,
          top: rect.top - mapRect.top,
          right: rect.right - mapRect.left,
          bottom: rect.bottom - mapRect.top
        }))
        .filter((rect) => rect.right > 0 && rect.left < mapRect.width && rect.bottom > 0 && rect.top < mapRect.height);

      const nextRect = largestUncoveredRect(mapRect.width, mapRect.height, obstacles, mapMarkerClearance);
      setMapSafeRect((current) => sameSafeRect(current, nextRect) ? current : nextRect);
    };

    updateSafeRect();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateSafeRect);
    resizeObserver?.observe(stage);
    resizeObserver?.observe(mapElement);
    if (mapDetailRef.current) {
      resizeObserver?.observe(mapDetailRef.current);
    }
    window.addEventListener("resize", updateSafeRect);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateSafeRect);
    };
  }, [mapLayoutVersion, selectedId, selectedPlace, view]);

  const updateParams = useCallback((updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    setParams(next);
  }, [params, setParams]);

  const handleSelect = useCallback((id: string, origin?: HTMLButtonElement) => {
    selectionOriginRef.current = origin ?? null;
    updateParams({ selected: id, ...(origin ? { view: "map" } : {}) });
  }, [updateParams]);
  const handleCloseDetail = useCallback(() => {
    const originId = selectionOriginRef.current?.dataset.placeId;
    pendingFocusIdRef.current = originId ?? null;
    updateParams({ selected: undefined, view: selectionOriginRef.current ? "list" : undefined });
  }, [updateParams]);

  return (
    <div className="page page--map">
      <header className="compact-head">
        <p className="page-kicker">施設マップ</p>
        <h1>{query ? `「${query}」の施設` : "施設を地図から探す"}</h1>
        <p>{matchingIds.size.toLocaleString("ja-JP")}施設を表示しています。地図の位置は目安です。</p>
      </header>

      <div className="map-filter-bar">
        <label htmlFor="map-category">カテゴリで絞り込む</label>
        <select id="map-category" value={category} onChange={(event) => updateParams({ category: event.target.value === "all" ? undefined : event.target.value, selected: undefined })}>
          {placeCategories.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
        </select>
        <div className="map-view-switch" role="group" aria-label="表示方法">
          <button type="button" className={view === "list" ? "is-active" : ""} aria-pressed={view === "list"} onClick={() => updateParams({ view: "list" })}><List aria-hidden="true" size={17} />一覧</button>
          <button type="button" className={view === "map" ? "is-active" : ""} aria-pressed={view === "map"} onClick={() => updateParams({ view: "map" })}><MapIcon aria-hidden="true" size={17} />地図</button>
        </div>
      </div>

      {geoQuery.isLoading || placesQuery.isLoading || indexQuery.isLoading ? <CardSkeleton /> : null}
      {geoQuery.isError || placesQuery.isError || indexQuery.isError ? <SectionError message="施設データを取得できませんでした。" /> : null}
      {!geoQuery.isLoading && !placesQuery.isLoading && !indexQuery.isLoading && matchingIds.size === 0 ? (
        <EmptyState title="該当する施設がありません">カテゴリや検索語を変えて、もう一度試してください。</EmptyState>
      ) : null}

      {matchingIds.size > 0 ? (
        <div className={`map-layout map-layout--${view}`}>
          <div className="map-layout__map">
            <div ref={mapStageRef} className="map-stage">
              <MapCanvas collection={{ type: "FeatureCollection", features: filteredFeatures }} category="all" selectedId={selectedId} onSelect={handleSelect} active={view === "map"} safeRect={mapSafeRect} onMapReady={() => setMapLayoutVersion((version) => version + 1)} />
              <p className="map-stage__notice">地図の位置は目安です。訪問前に公式情報を確認してください。</p>
              {selectedId ? (
                <div ref={mapDetailRef} className="map-detail-popover">
                  <PlaceDetailSheet place={selectedPlace} isLoading={placesQuery.isLoading} errorMessage={selectedPlace ? undefined : "地点の詳細を取得できませんでした。"} onClose={handleCloseDetail} variant="compact" headingRef={selectedHeadingRef} />
                </div>
              ) : null}
            </div>
          </div>
          <aside ref={mapListPanelRef} className="map-list-panel" aria-label="施設一覧">
            <div className="map-list-panel__head"><h2>施設一覧</h2><p>{matchingIds.size.toLocaleString("ja-JP")}件</p></div>
            <div className="map-place-list">
              {visiblePlaces.map((place) => (
                <MapPlaceRow key={place.id} place={place} selected={selectedId === place.id} onSelect={(button) => handleSelect(place.id, button)} />
              ))}
            </div>
            {visibleListCount < filteredPlaces.length ? <button type="button" className="load-more-button" onClick={() => setVisibleListCount((count) => count + mapListPageSize)}>さらに表示</button> : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

const mapMarkerClearance = 24;

function sameSafeRect(left: SafeRect | undefined, right: SafeRect | undefined): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.left === right.left && left.top === right.top && left.right === right.right && left.bottom === right.bottom;
}

function MapPlaceRow({ place, selected, onSelect }: { place: Place; selected: boolean; onSelect: (button: HTMLButtonElement) => void }) {
  return (
    <button type="button" data-place-id={place.id} className={`map-place-select${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={(event) => onSelect(event.currentTarget)}>
      <span className="card-kicker">{place.categoryLabel}</span>
      <span className="map-place-select__name">{place.name}</span>
      {place.address ? <span className="card-line"><MapPin aria-hidden="true" size={16} />{place.address}</span> : null}
      {place.phone ? <span className="card-line"><Phone aria-hidden="true" size={16} />{place.phone}</span> : null}
    </button>
  );
}

function resolveCategory(value: string | null): string {
  return placeCategories.some((item) => item.id === value) ? value ?? "all" : "all";
}

function resolveView(value: string | null): MapView {
  return value === "map" ? "map" : "list";
}
