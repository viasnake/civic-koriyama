import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { placeCategoryEquivalences } from "../lib/constants";
import type { SafeRect } from "../lib/mapSafeArea";
import type { FeatureCollection, PointFeature } from "../../shared/types";

type MapCanvasProps = {
  collection: FeatureCollection;
  category: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  active?: boolean;
  safeRect?: SafeRect;
  onMapReady?: () => void;
};

const center: [number, number] = [37.4005, 140.3597];

export default function MapCanvas({ collection, category, selectedId, onSelect, active = true, safeRect, onMapReady }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markerByIdRef = useRef<Map<string, MarkerEntry>>(new Map());
  const selectedOverlayRef = useRef<L.Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  const onMapReadyRef = useRef(onMapReady);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onMapReadyRef.current = onMapReady;
  }, [onMapReady]);

  const features = useMemo(() => {
    if (category === "all") {
      return collection.features;
    }

    return collection.features.filter((feature) => featureMatchesCategory(feature, category));
  }, [category, collection.features]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true
    }).setView(center, 12);

    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 42,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      animate: false
    });

    map.addLayer(cluster);
    mapRef.current = map;
    clusterRef.current = cluster;
    onMapReadyRef.current?.();

    return () => {
      markerByIdRef.current.forEach(({ marker }) => marker.off());
      markerByIdRef.current.clear();
      selectedOverlayRef.current?.remove();
      selectedOverlayRef.current = null;
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!active || !map || !cluster) {
      return;
    }

    map.invalidateSize();
    cluster.refreshClusters();
  }, [active]);

  useEffect(() => {
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map) {
      return;
    }

    markerByIdRef.current.forEach(({ marker }) => marker.off());
    cluster.clearLayers();
    markerByIdRef.current.clear();
    selectedOverlayRef.current?.remove();
    selectedOverlayRef.current = null;
    const bounds = L.latLngBounds([]);

    features.forEach((feature) => {
      const marker = makeMarker(feature, false);
      marker.on("click", () => {
        if (feature.id !== undefined) {
          onSelectRef.current(String(feature.id));
        }
      });
      cluster.addLayer(marker);
      bounds.extend(marker.getLatLng());

      if (feature.id !== undefined) {
        markerByIdRef.current.set(String(feature.id), {
          feature,
          marker
        });
      }
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: 14,
        animate: false
      });
    }
    return () => {
      markerByIdRef.current.forEach(({ marker }) => marker.off());
      markerByIdRef.current.clear();
      selectedOverlayRef.current?.remove();
      selectedOverlayRef.current = null;
      cluster.clearLayers();
    };
  }, [features]);

  useEffect(() => {
    const map = mapRef.current;
    selectedOverlayRef.current?.remove();
    selectedOverlayRef.current = null;

    if (!selectedId || !map) {
      return;
    }

    const entry = markerByIdRef.current.get(selectedId);
    if (!entry) {
      return;
    }

    const overlay = L.marker(entry.marker.getLatLng(), {
      icon: makeIcon(entry.feature, true),
      interactive: true,
      keyboard: false,
      zIndexOffset: 1000,
      title: entry.feature.properties.name
    }).addTo(map);
    selectedOverlayRef.current = overlay;
    map.setView(entry.marker.getLatLng(), Math.max(map.getZoom(), 18), { animate: false });

    return () => {
      overlay.remove();
      if (selectedOverlayRef.current === overlay) {
        selectedOverlayRef.current = null;
      }
    };
  }, [features, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!selectedId || !map) {
      return;
    }

    const entry = markerByIdRef.current.get(selectedId);
    if (!entry) {
      return;
    }

    map.invalidateSize();
    const position = entry.marker.getLatLng();
    map.setView(position, Math.max(map.getZoom(), 18), { animate: false });
    if (safeRect) {
      const point = map.latLngToContainerPoint(position);
      const target = {
        x: (safeRect.left + safeRect.right) / 2,
        y: (safeRect.top + safeRect.bottom) / 2
      };
      map.panBy([point.x - target.x, point.y - target.y], { animate: false });
    }
  }, [active, features, safeRect, selectedId]);

  return <div ref={containerRef} className="map-canvas" aria-label="施設マップ" />;
}

type MarkerEntry = {
  feature: PointFeature;
  marker: L.Marker;
};

function makeMarker(feature: PointFeature, selected: boolean): L.Marker {
  const [lng, lat] = feature.geometry.coordinates;

  return L.marker([lat, lng], {
    icon: makeIcon(feature, selected),
    title: feature.properties.name
  });
}

function makeIcon(feature: PointFeature, selected: boolean): L.DivIcon {
  const category = markerCategory(feature);

  return L.divIcon({
    className: `map-pin map-pin--${category}${selected ? " is-selected" : ""}`,
    html: '<span class="map-pin__glyph"></span>',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

function featureMatchesCategory(feature: PointFeature, category: string): boolean {
  return categoryCandidates(feature).includes(category);
}

function markerCategory(feature: PointFeature): string {
  const candidates = categoryCandidates(feature);

  if (candidates.includes("aed")) {
    return "aed";
  }

  if (candidates.includes("public_wifi")) {
    return "public_wifi";
  }

  if (candidates.includes("public_toilets")) {
    return "public_toilets";
  }

  if (candidates.includes("medical")) {
    return "medical";
  }

  if (candidates.includes("education")) {
    return "education";
  }

  if (candidates.includes("childcare")) {
    return "childcare";
  }

  if (candidates.includes("facility")) {
    return "facility";
  }

  return "other";
}

function categoryCandidates(feature: PointFeature): string[] {
  const values = [feature.properties.category, feature.properties.dataset_id, ...(feature.properties.categories ?? [])].filter(
    (value): value is string => Boolean(value)
  );
  const candidates = new Set(values);

  for (const value of values) {
    for (const [category, aliases] of Object.entries(placeCategoryEquivalences)) {
      if (aliases.includes(value)) {
        candidates.add(category);
      }
    }
  }

  return Array.from(candidates);
}
