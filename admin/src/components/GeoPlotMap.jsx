import { useEffect, useMemo, useRef, useState } from 'react'
import { OSM_RASTER_STYLE, createBoundsFromCoordinates } from '../lib/osmMap'

const DEFAULT_CENTER = { lat: -20.1596, lng: 28.581 }
const MAPLIBRE_SCRIPT_SRC = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js'
const MAPLIBRE_STYLE_HREF = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'

function isFiniteNumber(value) {
  return Number.isFinite(Number(value))
}

function normalizePoint(point) {
  const lat = Number(point?.lat)
  const lng = Number(point?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

function toLngLat(point) {
  const normalized = normalizePoint(point)
  if (!normalized) return null
  return [normalized.lng, normalized.lat]
}

function ensureMapLibreAssets() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl)
  return new Promise((resolve, reject) => {
    let link = document.querySelector(`link[data-maplibre="1"]`)
    if (!link) {
      link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = MAPLIBRE_STYLE_HREF
      link.dataset.maplibre = '1'
      document.head.appendChild(link)
    }

    const existing = document.querySelector(`script[src="${MAPLIBRE_SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(window.maplibregl), { once: true })
      existing.addEventListener('error', () => reject(new Error('Failed to load map library')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = MAPLIBRE_SCRIPT_SRC
    script.async = true
    script.onload = () => resolve(window.maplibregl)
    script.onerror = () => reject(new Error('Failed to load map library'))
    document.body.appendChild(script)
  })
}

export default function GeoPlotMap({
  bounds: providedBounds,
  markers = [],
  paths = [],
  emptyMessage = 'No coordinates available.',
}) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRefs = useRef([])
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState('')

  const normalizedMarkers = useMemo(
    () => (markers || []).map((marker) => {
      const point = normalizePoint(marker)
      if (!point) return null
      return { ...marker, lat: point.lat, lng: point.lng }
    }).filter(Boolean),
    [markers],
  )

  const normalizedPaths = useMemo(
    () => (paths || []).map((path) => ({
      ...path,
      points: Array.isArray(path?.points) ? path.points.map((point) => normalizePoint(point)).filter(Boolean) : [],
    })),
    [paths],
  )

  const hasGeometry = useMemo(() => {
    if (normalizedMarkers.length) return true
    return normalizedPaths.some((path) => (path.points || []).length > 1)
  }, [normalizedMarkers, normalizedPaths])

  const coordinateList = useMemo(
    () => normalizedMarkers.map((marker) => ({
      id: marker.id,
      label: marker.label || marker.title || marker.id || 'Point',
      lat: marker.lat,
      lng: marker.lng,
    })).slice(0, 8),
    [normalizedMarkers],
  )

  useEffect(() => {
    let cancelled = false

    const initMap = async () => {
      try {
        const maplibregl = await ensureMapLibreAssets()
        if (cancelled || !mapContainerRef.current || mapRef.current) return

        const map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: OSM_RASTER_STYLE,
          center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
          zoom: 12,
          attributionControl: true,
        })

        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
        map.on('load', () => {
          if (cancelled) return
          mapRef.current = map
          setMapReady(true)
        })
      } catch (error) {
        if (cancelled) return
        setMapError(error?.message || 'Map failed to load')
      }
    }

    initMap()
    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      markerRefs.current = []
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current
    const maplibregl = window.maplibregl
    if (!maplibregl) return

    markerRefs.current.forEach((m) => m.remove())
    markerRefs.current = []

    const lineFeatures = normalizedPaths
      .filter((path) => Array.isArray(path.points) && path.points.length > 1)
      .map((path) => ({
        type: 'Feature',
        properties: {
          color: path.color || '#2563eb',
        },
        geometry: {
          type: 'LineString',
          coordinates: path.points.map((point) => [point.lng, point.lat]),
        },
      }))

    const sourceId = 'geo-plot-lines'
    const layerId = 'geo-plot-lines-layer'
    const source = map.getSource(sourceId)
    const data = { type: 'FeatureCollection', features: lineFeatures }
    if (source) {
      source.setData(data)
    } else {
      map.addSource(sourceId, { type: 'geojson', data })
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#2563eb'],
          'line-width': 4,
          'line-opacity': 0.85,
        },
      })
    }

    normalizedMarkers.forEach((marker) => {
      const element = document.createElement('button')
      element.type = 'button'
      const size = marker.size || (marker.variant === 'driver' ? 18 : 12)
      const isSelected = marker.selected === true
      element.style.width = `${isSelected ? size + 6 : size}px`
      element.style.height = `${isSelected ? size + 6 : size}px`
      element.style.borderRadius = '50%'
      element.style.border = '2px solid #ffffff'
      element.style.backgroundColor = marker.color || '#2563eb'
      element.style.boxShadow = '0 1px 3px rgba(0,0,0,0.25)'
      element.style.cursor = marker.onClick ? 'pointer' : 'default'
      if (marker.title || marker.label) {
        element.title = marker.title || marker.label
      }
      if (typeof marker.onClick === 'function') {
        element.addEventListener('click', marker.onClick)
      }
      const markerInstance = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([marker.lng, marker.lat])
        .addTo(map)
      if (marker.label) {
        markerInstance.setPopup(new maplibregl.Popup({ offset: 16 }).setText(String(marker.label)))
      }
      markerRefs.current.push(markerInstance)
    })

    const allPoints = [
      ...normalizedMarkers.map((marker) => ({ lat: marker.lat, lng: marker.lng })),
      ...normalizedPaths.flatMap((path) => path.points || []),
    ]
    const autoBounds = createBoundsFromCoordinates(allPoints)
    const boundsToUse = (
      providedBounds &&
      isFiniteNumber(providedBounds.minLat) &&
      isFiniteNumber(providedBounds.minLng) &&
      isFiniteNumber(providedBounds.maxLat) &&
      isFiniteNumber(providedBounds.maxLng)
    )
      ? {
          minLat: Number(providedBounds.minLat),
          minLng: Number(providedBounds.minLng),
          maxLat: Number(providedBounds.maxLat),
          maxLng: Number(providedBounds.maxLng),
        }
      : autoBounds

    if (boundsToUse) {
      map.fitBounds(
        [
          [boundsToUse.minLng, boundsToUse.minLat],
          [boundsToUse.maxLng, boundsToUse.maxLat],
        ],
        { padding: 48, duration: 450, maxZoom: 16 },
      )
    } else {
      map.flyTo({ center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat], zoom: 12, duration: 450 })
    }
  }, [mapReady, normalizedMarkers, normalizedPaths, providedBounds])

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-100">
      <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" />

      {!hasGeometry ? (
        <div className="absolute inset-x-6 top-6 z-10 rounded-md border border-slate-200 bg-white/95 px-4 py-3 text-sm text-slate-700 shadow-sm">
          {emptyMessage}
        </div>
      ) : null}

      {mapError ? (
        <div className="absolute inset-x-6 top-6 z-10 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
          {mapError}
        </div>
      ) : null}

      {coordinateList.length ? (
        <div className="absolute right-3 top-3 max-w-[320px] space-y-1 rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-[11px] text-slate-700 shadow-sm">
          <p className="font-semibold uppercase tracking-wide text-slate-500">Coordinates</p>
          {coordinateList.map((item) => (
            <p key={item.id}>
              <span className="font-semibold">{item.label}:</span> {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
            </p>
          ))}
        </div>
      ) : null}

      <div className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[11px] text-slate-600 shadow-sm">
        Interactive map + coordinates
      </div>
    </div>
  )
}
