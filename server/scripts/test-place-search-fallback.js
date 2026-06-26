import 'dotenv/config';
import { query } from '../db/connection.js';
import {
  fetchCachedPlaceAutocomplete,
  fetchCachedPlaceDetails,
  getPlacesProviderName,
} from '../lib/maps-places.js';
import { fetchHerePlaceAutocomplete, hasHerePlacesProvider } from '../lib/here-places.js';
import { hasOsmPlacesProvider } from '../lib/osm-places.js';

function getArg(name, fallback = '') {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const argv = Array.isArray(process.argv) ? process.argv : [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '');
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length).trim();
    }
    if (arg === exact) {
      const next = String(argv[index + 1] || '').trim();
      if (next && !next.startsWith('--')) return next;
    }
  }

  return fallback;
}

function printSection(title, value) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function normalizeCoordinate(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

async function getCachedRowsForQuery(searchQuery) {
  return query(
    `SELECT
       id,
       provider,
       provider_place_id,
       normalized_query,
       title,
       subtitle,
       latitude,
       longitude,
       usage_count,
       last_used_at,
       created_at,
       updated_at
     FROM place_search_cache
     WHERE normalized_query = ?
        OR LOWER(title) LIKE ?
        OR LOWER(display_name) LIKE ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 10`,
    [
      String(searchQuery || '').trim().toLowerCase(),
      `%${String(searchQuery || '').trim().toLowerCase()}%`,
      `%${String(searchQuery || '').trim().toLowerCase()}%`,
    ],
  );
}

async function lookupCachedProvider(placeId) {
  const value = String(placeId || '').trim();
  if (!value.startsWith('cache:')) return null;
  const numericId = Number(value.slice('cache:'.length));
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  const rows = await query(
    `SELECT
       id,
       provider,
       provider_place_id,
       title,
       subtitle,
       latitude,
       longitude,
       usage_count,
       last_used_at
     FROM place_search_cache
     WHERE id = ?
     LIMIT 1`,
    [numericId],
  );

  return Array.isArray(rows) ? rows[0] || null : null;
}

async function main() {
  const searchQuery = String(getArg('query', process.argv[2] || 'ZRP WEST COMM HALL')).trim();
  const originCoordinate = normalizeCoordinate(
    getArg('lat', '-20.1535'),
    getArg('lng', '28.5870'),
  );

  if (!searchQuery) {
    throw new Error('Usage: node scripts/test-place-search-fallback.js --query="ZRP WEST COMM HALL" [--lat=-20.1535 --lng=28.5870]');
  }

  printSection('Environment', {
    query: searchQuery,
    originCoordinate,
    placesProviderChain: getPlacesProviderName(),
    hasOsmPlacesProvider: hasOsmPlacesProvider(),
    hasHerePlacesProvider: hasHerePlacesProvider(),
    hasHereApiKey: Boolean(process.env.HERE_API_KEY || process.env.HERE_MAPS_API_KEY),
  });

  const cachedBefore = await getCachedRowsForQuery(searchQuery);
  printSection('Cache Before Search', cachedBefore.length ? cachedBefore : 'No matching cached rows yet');

  if (hasHerePlacesProvider()) {
    try {
      const directHere = await fetchHerePlaceAutocomplete({
        query: searchQuery,
        originCoordinate,
      });
      printSection(
        'Direct HERE Autocomplete',
        Array.isArray(directHere?.suggestions)
          ? directHere.suggestions.map((item) => ({
              providerPlaceId: item.providerPlaceId,
              title: item.title,
              subtitle: item.subtitle,
              coordinate: item.coordinate,
            }))
          : [],
      );
    } catch (error) {
      printSection('Direct HERE Error', error?.message || String(error));
    }
  }

  const autocompleteResult = await fetchCachedPlaceAutocomplete({
    query: searchQuery,
    originCoordinate,
  });

  printSection('Unified Autocomplete Result', {
    cacheHit: Boolean(autocompleteResult?.cacheHit),
    suggestionCount: Array.isArray(autocompleteResult?.suggestions) ? autocompleteResult.suggestions.length : 0,
    suggestions: (Array.isArray(autocompleteResult?.suggestions) ? autocompleteResult.suggestions : []).map((item) => ({
      id: item.id,
      placeId: item.placeId,
      title: item.title,
      subtitle: item.subtitle,
      coordinate: item.coordinate,
      distanceKm: item.distanceKm,
    })),
  });

  const firstSuggestion = Array.isArray(autocompleteResult?.suggestions)
    ? autocompleteResult.suggestions[0] || null
    : null;

  if (firstSuggestion?.placeId) {
    const cachedProviderRow = await lookupCachedProvider(firstSuggestion.placeId);
    printSection('Stored Provider Row For First Suggestion', cachedProviderRow || 'First suggestion is not a locally cached place id');

    const detailsResult = await fetchCachedPlaceDetails({
      placeId: firstSuggestion.placeId,
    });

    printSection('Place Details For First Suggestion', detailsResult);
  }

  const cachedAfter = await getCachedRowsForQuery(searchQuery);
  printSection('Cache After Search', cachedAfter.length ? cachedAfter : 'No matching cached rows after search');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\ntest-place-search-fallback failed:', error?.message || error);
    process.exit(1);
  });
