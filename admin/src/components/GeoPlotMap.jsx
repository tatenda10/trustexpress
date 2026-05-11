import { useMemo } from 'react'

const DEFAULT_BOUNDS = {
  minLat: -20.260586,
  minLng: 28.382328,
  maxLat: -19.9595617,
  maxLng: 28.6948321,
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value))
}

function normalizePoint(point) {
  const lat = Number(point?.lat)
  const lng = Number(point?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

function expandBounds(bounds, point) {
  if (!point) return bounds
  return {
    minLat: Math.min(bounds.minLat, point.lat),
    minLng: Math.min(bounds.minLng, point.lng),
    maxLat: Math.max(bounds.maxLat, point.lat),
    maxLng: Math.max(bounds.maxLng, point.lng),
  }
}

function computeBounds(markers, paths, providedBounds) {
  if (
    providedBounds &&
    isFiniteNumber(providedBounds.minLat) &&
    isFiniteNumber(providedBounds.minLng) &&
    isFiniteNumber(providedBounds.maxLat) &&
    isFiniteNumber(providedBounds.maxLng)
  ) {
    return {
      minLat: Number(providedBounds.minLat),
      minLng: Number(providedBounds.minLng),
      maxLat: Number(providedBounds.maxLat),
      maxLng: Number(providedBounds.maxLng),
    }
  }

  let nextBounds = null

  for (const marker of markers) {
    const point = normalizePoint(marker)
    if (!point) continue
    nextBounds = nextBounds ? expandBounds(nextBounds, point) : {
      minLat: point.lat,
      minLng: point.lng,
      maxLat: point.lat,
      maxLng: point.lng,
    }
  }

  for (const path of paths) {
    for (const rawPoint of path.points || []) {
      const point = normalizePoint(rawPoint)
      if (!point) continue
      nextBounds = nextBounds ? expandBounds(nextBounds, point) : {
        minLat: point.lat,
        minLng: point.lng,
        maxLat: point.lat,
        maxLng: point.lng,
      }
    }
  }

  return nextBounds || DEFAULT_BOUNDS
}

function addPadding(bounds) {
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.01)
  const lngSpan = Math.max(bounds.maxLng - bounds.minLng, 0.01)
  return {
    minLat: bounds.minLat - latSpan * 0.08,
    minLng: bounds.minLng - lngSpan * 0.08,
    maxLat: bounds.maxLat + latSpan * 0.08,
    maxLng: bounds.maxLng + lngSpan * 0.08,
  }
}

function project(point, bounds) {
  const safePoint = normalizePoint(point)
  if (!safePoint) return null

  const lngSpan = Math.max(bounds.maxLng - bounds.minLng, 0.0001)
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.0001)
  const x = ((safePoint.lng - bounds.minLng) / lngSpan) * 100
  const y = ((bounds.maxLat - safePoint.lat) / latSpan) * 100

  return {
    x: Math.min(Math.max(x, 0), 100),
    y: Math.min(Math.max(y, 0), 100),
  }
}

function buildPolyline(points, bounds) {
  const projected = points.map((point) => project(point, bounds)).filter(Boolean)
  if (projected.length < 2) return ''
  return projected.map((point) => `${point.x},${point.y}`).join(' ')
}

export default function GeoPlotMap({
  bounds,
  markers = [],
  paths = [],
  emptyMessage = 'No coordinates available.',
}) {
  const normalizedBounds = useMemo(
    () => addPadding(computeBounds(markers, paths, bounds)),
    [bounds, markers, paths],
  )

  const hasGeometry = useMemo(() => {
    if (markers.some((marker) => normalizePoint(marker))) return true
    return paths.some((path) => (path.points || []).map(normalizePoint).filter(Boolean).length > 1)
  }, [markers, paths])

  return (
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_top,#f8fbff_0%,#eef4ff_36%,#dce8ff_100%)]">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.15)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.15)_1px,transparent_1px)] bg-[size:52px_52px]" />
      {hasGeometry ? (
        <>
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {paths.map((path) => {
              const points = buildPolyline(path.points || [], normalizedBounds)
              if (!points) return null
              return (
                <polyline
                  key={path.id}
                  points={points}
                  fill="none"
                  stroke={path.color || '#2563eb'}
                  strokeWidth={path.width || 0.7}
                  strokeOpacity={path.opacity ?? 0.95}
                  strokeDasharray={path.dashed ? '1.2 1.1' : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )
            })}
          </svg>

          {markers.map((marker) => {
            const position = project(marker, normalizedBounds)
            if (!position) return null
            const size = marker.size || (marker.variant === 'driver' ? 18 : 12)
            const isSelected = marker.selected === true
            return (
              <button
                key={marker.id}
                type="button"
                onClick={marker.onClick}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm transition hover:scale-105"
                style={{
                  left: `${position.x}%`,
                  top: `${position.y}%`,
                  width: `${isSelected ? size + 6 : size}px`,
                  height: `${isSelected ? size + 6 : size}px`,
                  backgroundColor: marker.color || '#2563eb',
                  zIndex: isSelected ? 3 : 2,
                }}
                title={marker.title || marker.label || 'Map point'}
              >
                <span className="sr-only">{marker.title || marker.label || 'Map point'}</span>
              </button>
            )
          })}

          {markers.map((marker) => {
            if (!marker.label) return null
            const position = project(marker, normalizedBounds)
            if (!position) return null
            return (
              <div
                key={`${marker.id}-label`}
                className="pointer-events-none absolute -translate-x-1/2 rounded-full bg-white/95 px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm"
                style={{
                  left: `${position.x}%`,
                  top: `calc(${position.y}% - 22px)`,
                  zIndex: 4,
                }}
              >
                {marker.label}
              </div>
            )
          })}
        </>
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center">
          <div className="max-w-lg space-y-2">
            <p className="text-sm font-semibold text-slate-900">Map preview unavailable.</p>
            <p className="text-xs text-slate-600">{emptyMessage}</p>
          </div>
        </div>
      )}

      <div className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[11px] text-slate-600 shadow-sm">
        Self-hosted coordinate view
      </div>
    </div>
  )
}
