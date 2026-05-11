export const DEFAULT_BULAWAYO_CENTER = { lat: -20.1596, lng: 28.581 }

export const OSM_RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
}

export function createLngLat(coordinate) {
  if (!coordinate) return null
  const lat = Number(coordinate.lat ?? coordinate.latitude)
  const lng = Number(coordinate.lng ?? coordinate.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return [lng, lat]
}

export function createBoundsFromCoordinates(coordinates = []) {
  const valid = coordinates
    .map((coordinate) => createLngLat(coordinate))
    .filter(Boolean)

  if (valid.length === 0) return null

  const [firstLng, firstLat] = valid[0]
  const bounds = {
    minLng: firstLng,
    minLat: firstLat,
    maxLng: firstLng,
    maxLat: firstLat,
  }

  valid.forEach(([lng, lat]) => {
    bounds.minLng = Math.min(bounds.minLng, lng)
    bounds.minLat = Math.min(bounds.minLat, lat)
    bounds.maxLng = Math.max(bounds.maxLng, lng)
    bounds.maxLat = Math.max(bounds.maxLat, lat)
  })

  return bounds
}

export function areBoundsEmpty(bounds) {
  if (!bounds) return true
  return (
    !Number.isFinite(bounds.minLng) ||
    !Number.isFinite(bounds.minLat) ||
    !Number.isFinite(bounds.maxLng) ||
    !Number.isFinite(bounds.maxLat)
  )
}
