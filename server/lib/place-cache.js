import { query } from '../db/connection.js'

const MAX_AUTOCOMPLETE_RESULTS = 6

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function normalizePlaceSearchQuery(value) {
  return normalizeText(value).toLowerCase()
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function calculateDistanceKm(start, end) {
  if (!start || !end) return 0
  const earthRadiusKm = 6371
  const dLat = toRadians(end.latitude - start.latitude)
  const dLng = toRadians(end.longitude - start.longitude)
  const lat1 = toRadians(start.latitude)
  const lat2 = toRadians(end.latitude)
  const a = (
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
  )
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

function normalizeCoordinate(coordinate) {
  const latitude = Number(coordinate?.latitude)
  const longitude = Number(coordinate?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

function toContext(row) {
  return {
    district: row?.district || null,
    city: row?.city || null,
    region: row?.region || null,
    country: row?.country || 'Zimbabwe',
  }
}

function toCachedPlaceId(id) {
  return `cache:${id}`
}

function parseCachedPlaceId(placeId) {
  const value = String(placeId || '').trim()
  if (!value.startsWith('cache:')) return null
  const parsed = Number(value.slice('cache:'.length))
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

function buildProviderPlaceKey(provider, providerPlaceId, suggestion) {
  const normalizedProvider = normalizeText(provider).toLowerCase() || 'unknown'
  const externalId = normalizeText(providerPlaceId)
  if (externalId) return `${normalizedProvider}:${externalId}`

  const latitude = Number(suggestion?.coordinate?.latitude || 0).toFixed(6)
  const longitude = Number(suggestion?.coordinate?.longitude || 0).toFixed(6)
  const title = normalizeText(suggestion?.title).toLowerCase().slice(0, 80)
  return `${normalizedProvider}:coord:${latitude},${longitude}:${title}`
}

function buildSearchText({ normalizedQuery, title, subtitle, displayName }) {
  return normalizeText([
    normalizedQuery,
    title,
    subtitle,
    displayName,
  ].filter(Boolean).join(' ')).toLowerCase()
}

function mapRowToSuggestion(row, originCoordinate) {
  const coordinate = normalizeCoordinate({
    latitude: Number(row?.latitude),
    longitude: Number(row?.longitude),
  })
  return {
    id: toCachedPlaceId(row.id),
    placeId: toCachedPlaceId(row.id),
    title: row?.title || row?.display_name || 'Selected place',
    subtitle: row?.subtitle || row?.display_name || 'Zimbabwe',
    coordinate,
    distanceKm: originCoordinate && coordinate ? calculateDistanceKm(originCoordinate, coordinate) : 0,
  }
}

function mapRowToPlace(row) {
  const coordinate = normalizeCoordinate({
    latitude: Number(row?.latitude),
    longitude: Number(row?.longitude),
  })
  return {
    coordinate,
    title: row?.title || row?.display_name || 'Selected place',
    subtitle: row?.subtitle || row?.display_name || 'Zimbabwe',
    context: toContext(row),
  }
}

export async function findCachedPlaceSuggestions({
  query: searchQuery,
  originCoordinate,
  limit = MAX_AUTOCOMPLETE_RESULTS,
}) {
  const normalizedQuery = normalizePlaceSearchQuery(searchQuery)
  if (normalizedQuery.length < 3) return []
  const safeLimit = Math.max(1, Math.min(Number(limit) || MAX_AUTOCOMPLETE_RESULTS, 20))

  const rows = await query(
    `SELECT
        id,
        title,
        subtitle,
        display_name,
        latitude,
        longitude,
        district,
        city,
        region,
        country,
        usage_count,
        last_used_at,
        updated_at
      FROM place_search_cache
      WHERE search_text LIKE ?
      ORDER BY
        CASE
          WHEN normalized_query = ? THEN 0
          WHEN LOWER(title) LIKE ? THEN 1
          WHEN LOWER(display_name) LIKE ? THEN 2
          ELSE 3
        END ASC,
        usage_count DESC,
        COALESCE(last_used_at, updated_at) DESC
      LIMIT ${safeLimit}`,
    [`%${normalizedQuery}%`, normalizedQuery, `%${normalizedQuery}%`, `%${normalizedQuery}%`],
  )

  const normalizedOrigin = normalizeCoordinate(originCoordinate)
  return (Array.isArray(rows) ? rows : []).map((row) => mapRowToSuggestion(row, normalizedOrigin))
}

export async function getCachedPlaceById(placeId) {
  const cachedId = parseCachedPlaceId(placeId)
  if (!cachedId) return null

  const rows = await query(
    `SELECT
        id,
        title,
        subtitle,
        display_name,
        latitude,
        longitude,
        district,
        city,
        region,
        country
      FROM place_search_cache
      WHERE id = ?
      LIMIT 1`,
    [cachedId],
  )

  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return null
  await markCachedPlaceUsed(cachedId)
  return mapRowToPlace(row)
}

export async function getCachedPlaceByProviderKey(provider, providerPlaceId) {
  const providerPlaceKey = buildProviderPlaceKey(provider, providerPlaceId, null)
  const rows = await query(
    `SELECT
        id,
        title,
        subtitle,
        display_name,
        latitude,
        longitude,
        district,
        city,
        region,
        country
      FROM place_search_cache
      WHERE provider_place_key = ?
      LIMIT 1`,
    [providerPlaceKey],
  )

  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return null
  await markCachedPlaceUsed(row.id)
  return {
    placeId: toCachedPlaceId(row.id),
    place: mapRowToPlace(row),
  }
}

export async function markCachedPlaceUsed(id) {
  const numericId = Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0) return

  await query(
    `UPDATE place_search_cache
      SET usage_count = COALESCE(usage_count, 0) + 1,
          last_used_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [numericId],
  )
}

function deriveDisplayName(suggestion) {
  return normalizeText(suggestion?.displayName || suggestion?.subtitle || suggestion?.title || 'Selected place')
}

function deriveContext(suggestion) {
  return {
    district: normalizeText(suggestion?.context?.district) || null,
    city: normalizeText(suggestion?.context?.city) || null,
    region: normalizeText(suggestion?.context?.region) || null,
    country: normalizeText(suggestion?.context?.country) || 'Zimbabwe',
  }
}

export async function cacheResolvedSuggestions({
  provider,
  normalizedQuery,
  suggestions,
}) {
  const rows = []
  const safeQuery = normalizePlaceSearchQuery(normalizedQuery)

  for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
    const coordinate = normalizeCoordinate(suggestion?.coordinate)
    if (!coordinate) continue

    const title = normalizeText(suggestion?.title) || 'Selected place'
    const subtitle = normalizeText(suggestion?.subtitle)
    const displayName = deriveDisplayName(suggestion)
    const context = deriveContext(suggestion)
    const providerPlaceId = normalizeText(suggestion?.providerPlaceId || suggestion?.placeId)
    const providerPlaceKey = buildProviderPlaceKey(provider, providerPlaceId, suggestion)
    const searchText = buildSearchText({
      normalizedQuery: safeQuery,
      title,
      subtitle,
      displayName,
    })

    const result = await query(
      `INSERT INTO place_search_cache (
          provider,
          provider_place_id,
          provider_place_key,
          normalized_query,
          title,
          subtitle,
          display_name,
          search_text,
          latitude,
          longitude,
          district,
          city,
          region,
          country,
          raw_payload_json,
          usage_count,
          last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          id = LAST_INSERT_ID(id),
          normalized_query = VALUES(normalized_query),
          title = VALUES(title),
          subtitle = VALUES(subtitle),
          display_name = VALUES(display_name),
          search_text = VALUES(search_text),
          latitude = VALUES(latitude),
          longitude = VALUES(longitude),
          district = VALUES(district),
          city = VALUES(city),
          region = VALUES(region),
          country = VALUES(country),
          raw_payload_json = VALUES(raw_payload_json),
          usage_count = COALESCE(usage_count, 0) + 1,
          last_used_at = CURRENT_TIMESTAMP`,
      [
        normalizeText(provider).toLowerCase() || 'unknown',
        providerPlaceId || null,
        providerPlaceKey,
        safeQuery,
        title,
        subtitle || null,
        displayName,
        searchText,
        coordinate.latitude,
        coordinate.longitude,
        context.district,
        context.city,
        context.region,
        context.country,
        JSON.stringify(suggestion?.rawPayload || null),
      ],
    )

    const cachedId = Number(result?.insertId)
    if (!Number.isInteger(cachedId) || cachedId <= 0) continue

    rows.push({
      id: toCachedPlaceId(cachedId),
      placeId: toCachedPlaceId(cachedId),
      title,
      subtitle: subtitle || displayName || 'Zimbabwe',
      coordinate,
      distanceKm: Number(suggestion?.distanceKm || 0),
    })
  }

  return rows
}
