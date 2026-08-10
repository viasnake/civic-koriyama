import type { FeatureCollection, Place, PointFeature } from "../../shared/types";
import { placeCategoryAliases, placeCategoryEquivalences } from "./constants";

export function normalizePlaceQuery(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u30fc\u2212]/g, "-");

  return placeCategoryAliases[normalized] ?? normalized;
}

export function placeIdFromFeature(feature: PointFeature): string | undefined {
  return feature.id === undefined ? undefined : String(feature.id);
}

export function mapEligiblePlaceIds(places: Place[], collection: FeatureCollection): Set<string> {
  const placeIds = new Set(
    places
      .filter((place) => place.lat !== undefined && place.lng !== undefined)
      .map((place) => place.id)
  );
  const featureIds = new Set(
    collection.features.map(placeIdFromFeature).filter((id): id is string => Boolean(id))
  );

  return new Set(Array.from(placeIds).filter((id) => featureIds.has(id)));
}

export function placeMatchesCategory(place: Place, category: string): boolean {
  if (category === "all") {
    return true;
  }

  return valuesMatchCategory(placeValues(place), category);
}

export function featureMatchesCategory(feature: PointFeature, category: string): boolean {
  if (category === "all") {
    return true;
  }

  return valuesMatchCategory(
    [feature.properties.category, feature.properties.dataset_id, ...(feature.properties.categories ?? [])].filter(
      (value): value is string => Boolean(value)
    ),
    category
  );
}

export function filterMapPlaces(
  places: Place[],
  collection: FeatureCollection,
  category: string,
  matchingIds?: Set<string>
): Place[] {
  const eligibleIds = matchingIds ?? mapEligiblePlaceIds(places, collection);
  return places.filter((place) => eligibleIds.has(place.id) && placeMatchesCategory(place, category));
}

export function filterMapFeatures(
  collection: FeatureCollection,
  category: string,
  matchingIds: Set<string>
): PointFeature[] {
  return collection.features.filter((feature) => {
    const id = placeIdFromFeature(feature);
    return Boolean(id && matchingIds.has(id) && featureMatchesCategory(feature, category));
  });
}

function placeValues(place: Place): string[] {
  return [place.category, place.subcategory, ...(place.categories ?? [])].filter(
    (value): value is string => Boolean(value)
  );
}

function valuesMatchCategory(values: string[], category: string): boolean {
  const candidates = placeCategoryEquivalences[category] ?? [category];
  return values.some((value) => candidates.includes(value));
}
