import { isCoordinateInBulawayoServiceArea } from './service-area.js'

const DEFAULT_HERE_GEOCODER_BASE_URL = 'https://geocode.search.hereapi.com'

function normalizeQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeCoordinate(coordinate) {
  const latitude = Number(coordinate?.latitude)
  const longitude = Number(coordinate?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
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

function getHereApiKey() {
  return String(process.env.HERE_API_KEY || process.env.HERE_MAPS_API_KEY || '').trim()
}

function getHereBaseUrl() {
  return (
    process.env.HERE_GEOCODER_BASE_URL ||
    process.env.HERE_PLACES_BASE_URL ||
    DEFAULT_HERE_GEOCODER_BASE_URL
  ).replace(/\/+$/, '')
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'TrustCars/1.0',
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload?.title || payload?.error_description || `HERE request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return payload
}

function mapHereItem(item, index, query, originCoordinate) {
  const coordinate = normalizeCoordinate({
    latitude: item?.position?.lat,
    longitude: item?.position?.lng,
  })
  const address = item?.address || {}
  const title = item?.title || address?.label || query || `Result ${index + 1}`
  const subtitle = [
    address?.district,
    address?.city || address?.county,
    address?.state,
    address?.countryName || 'Zimbabwe',
  ].filter(Boolean).join(', ') || address?.label || 'Zimbabwe'

  return {
    providerPlaceId: String(item?.id || '').trim() || null,
    title,
    subtitle,
    coordinate,
    distanceKm: originCoordinate && coordinate ? calculateDistanceKm(originCoordinate, coordinate) : 0,
    context: {
      district: address?.district || null,
      city: address?.city || address?.county || null,
      region: address?.state || null,
      country: address?.countryName || 'Zimbabwe',
    },
    rawPayload: item,
  }
}

export function hasHerePlacesProvider() {
  return Boolean(getHereApiKey())
}

export async function fetchHerePlaceAutocomplete({
  query,
  originCoordinate,
}) {
  const normalizedQuery = normalizeQuery(query)
  const normalizedOrigin = normalizeCoordinate(originCoordinate)

  if (normalizedQuery.length < 3) {
    return { suggestions: [], cacheHit: false }
  }

  const params = new URLSearchParams({
    q: normalizedQuery,
    apiKey: getHereApiKey(),
    in: 'countryCode:ZWE',
    limit: '6',
    lang: 'en-US',
  })

  if (normalizedOrigin) {
    params.set('at', `${normalizedOrigin.latitude},${normalizedOrigin.longitude}`)
  }

  const payload = await fetchJson(`${getHereBaseUrl()}/v1/geocode?${params.toString()}`)
  const suggestions = (Array.isArray(payload?.items) ? payload.items : [])
    .map((item, index) => mapHereItem(item, index, normalizedQuery, normalizedOrigin))
    .filter((suggestion) => suggestion.coordinate && isCoordinateInBulawayoServiceArea(suggestion.coordinate))
    .slice(0, 6)

  return { suggestions, cacheHit: false }
}
