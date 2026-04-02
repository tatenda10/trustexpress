import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import { DirectionsRenderer, GoogleMap, MarkerF, useJsApiLoader } from '@react-google-maps/api'
import BASE_URL from '../context/Api'
import { useAuth } from '../authcontext/AuthContext'
import {
  DEFAULT_BULAWAYO_CENTER,
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_LIBRARIES,
  GOOGLE_MAPS_LOADER_ID,
} from '../lib/googleMaps'


function DetailField({ label, value }) {
  return (
    <div className="border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-800">{value || '-'}</p>
    </div>
  )
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function coalesceNumber(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      return Number(value)
    }
  }
  return 0
}

function decodePolyline(encoded) {
  if (!encoded) return []
  let index = 0
  let latitude = 0
  let longitude = 0
  const coordinates = []

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte = null

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1)
    latitude += deltaLat

    shift = 0
    result = 0

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const deltaLng = (result & 1) ? ~(result >> 1) : (result >> 1)
    longitude += deltaLng

    coordinates.push({
      lat: latitude / 1e5,
      lng: longitude / 1e5,
    })
  }

  return coordinates
}

export default function RideOperationDetailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { rideId } = useParams()
  const { token } = useAuth()
  const mapRef = useRef(null)
  const [ride, setRide] = useState(null)
  const [directions, setDirections] = useState(null)
  const [directionsError, setDirectionsError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const fromDriverId = location.state?.fromDriverId || ''
  const fromDriverName = location.state?.fromDriverName || 'driver'

  const { isLoaded: isMapLoaded, loadError } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  })

  useEffect(() => {
    let active = true

    const load = async () => {
      if (!token) return
      setLoading(true)
      setError('')
      try {
        const { data } = await axios.get(`${BASE_URL}/api/admin/rides/${rideId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!active) return
        setRide(data.ride || null)
      } catch (err) {
        if (!active) return
        setError(err?.response?.data?.error || err?.message || 'Failed to load ride details')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [rideId, token])

  const routePath = useMemo(() => {
    const savedRoute = decodePolyline(ride?.routePolyline)
    if (savedRoute.length > 1) return savedRoute
    if (
      ride?.pickupLat === null ||
      ride?.pickupLat === undefined ||
      ride?.pickupLng === null ||
      ride?.pickupLng === undefined ||
      ride?.dropoffLat === null ||
      ride?.dropoffLat === undefined ||
      ride?.dropoffLng === null ||
      ride?.dropoffLng === undefined
    ) {
      return null
    }
    return [
      { lat: Number(ride.pickupLat), lng: Number(ride.pickupLng) },
      { lat: Number(ride.dropoffLat), lng: Number(ride.dropoffLng) },
    ]
  }, [ride])

  useEffect(() => {
    if (!isMapLoaded || !mapRef.current || !routePath || !window.google?.maps) return
    if (directions?.routes?.[0]?.bounds) {
      mapRef.current.fitBounds(directions.routes[0].bounds, 72)
      return
    }
    const bounds = new window.google.maps.LatLngBounds()
    routePath.forEach((point) => bounds.extend(point))
    if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, 72)
    }
  }, [directions, isMapLoaded, routePath])

  useEffect(() => {
    let active = true

    const loadDirections = async () => {
      if (!isMapLoaded || !routePath || !window.google?.maps || ride?.routePolyline) {
        setDirections(null)
        return
      }

      try {
        const service = new window.google.maps.DirectionsService()
        const result = await service.route({
          origin: routePath[0],
          destination: routePath[1],
          travelMode: window.google.maps.TravelMode.DRIVING,
        })
        if (!active) return
        setDirections(result)
        setDirectionsError('')
      } catch (err) {
        if (!active) return
        setDirections(null)
        setDirectionsError(err?.message || 'Could not load road route')
      }
    }

    loadDirections()
    return () => {
      active = false
    }
  }, [isMapLoaded, ride?.routePolyline, routePath])

  if (loading) {
    return <section className="border border-slate-300 bg-white p-6 text-sm text-slate-600">Loading ride details...</section>
  }

  if (!ride) {
    return <section className="border border-slate-300 bg-white p-6 text-sm text-slate-700">{error || 'Ride not found.'}</section>
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        {fromDriverId ? (
          <button
            type="button"
            onClick={() => navigate(`/dashboard/drivers/${fromDriverId}`)}
            className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 hover:text-slate-800"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
              <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back To {fromDriverName}
          </button>
        ) : null}
        <h1 className="text-sm font-semibold text-slate-900">Ride Details</h1>
        <p className="text-xs text-slate-500">View the full trip route, trip state, and timing from pickup to dropoff.</p>
      </div>

      <div className="overflow-hidden border border-slate-300 bg-white">
        <div className="border-b border-slate-300 bg-[#0f172a] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-200">
          {ride.publicId || `Ride #${ride.id}`}
        </div>

        <div className="grid gap-3 p-4 xl:grid-cols-[1.35fr_1fr]">
          <div className="space-y-3">
            <div className="overflow-hidden border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Trip Map</h2>
              </div>
              <div className="h-[420px] bg-slate-100">
                {GOOGLE_MAPS_API_KEY && isMapLoaded && !loadError && routePath ? (
                  <GoogleMap
                    mapContainerClassName="h-full w-full"
                    center={DEFAULT_BULAWAYO_CENTER}
                    zoom={12}
                    onLoad={(map) => {
                      mapRef.current = map
                    }}
                    onUnmount={() => {
                      mapRef.current = null
                    }}
                    options={{
                      streetViewControl: false,
                      mapTypeControl: false,
                      fullscreenControl: false,
                      gestureHandling: 'greedy',
                    }}
                  >
                    {directions && !ride?.routePolyline ? (
                      <DirectionsRenderer
                        directions={directions}
                        options={{
                          suppressMarkers: true,
                          polylineOptions: {
                            strokeColor: '#2563eb',
                            strokeOpacity: 0.95,
                            strokeWeight: 5,
                          },
                        }}
                      />
                    ) : null}
                    <MarkerF
                      position={routePath[0]}
                      icon={{
                        path: window.google.maps.SymbolPath.CIRCLE,
                        scale: 7,
                        fillColor: '#111827',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 2,
                      }}
                    />
                    <MarkerF
                      position={routePath[1]}
                      icon={{
                        path: window.google.maps.SymbolPath.CIRCLE,
                        scale: 7,
                        fillColor: '#059669',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 2,
                      }}
                    />
                  </GoogleMap>
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-900">Trip map unavailable.</p>
                      <p className="text-xs text-slate-600">
                        {routePath
                          ? 'Add VITE_GOOGLE_MAPS_API_KEY to the admin environment to view the full trip map.'
                          : 'Pickup and dropoff coordinates are missing for this ride.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {directionsError ? (
              <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                Showing saved pickup and dropoff points only because Google road directions could not be loaded.
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <DetailField label="Pickup" value={ride.pickupLabel} />
              <DetailField label="Dropoff" value={ride.dropoffLabel} />
              <DetailField label="Actual Distance" value={`${coalesceNumber(ride.actualDistanceKm, ride.routeDistanceKm, ride.estimatedDistanceKm).toFixed(1)} km`} />
              <DetailField label="Actual Time" value={`${coalesceNumber(ride.actualMinutes, ride.routeDurationMinutes, ride.estimatedMinutes)} min`} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <DetailField label="Rider" value={ride.rider} />
              <DetailField label="Driver" value={ride.driver} />
              <DetailField label="Status" value={ride.status} />
              <DetailField label="Tier" value={ride.tierName || ride.tierKey} />
              <DetailField label="Fare" value={`$${Number(ride.estimatedAmount || 0).toFixed(2)}`} />
              <DetailField label="Estimated Distance" value={`${Number(ride.estimatedDistanceKm || 0).toFixed(1)} km`} />
              <DetailField label="Estimated Time" value={`${Number(ride.estimatedMinutes || 0)} min`} />
              <DetailField label="Requested At" value={formatDateTime(ride.requestedAt)} />
              <DetailField label="Assigned At" value={formatDateTime(ride.assignedAt)} />
              <DetailField label="Arrived At" value={formatDateTime(ride.arrivedAt)} />
              <DetailField label="Started At" value={formatDateTime(ride.startedAt)} />
              <DetailField label="Completed At" value={formatDateTime(ride.completedAt)} />
              <DetailField label="Cancelled At" value={formatDateTime(ride.cancelledAt)} />
            </div>

            {ride.cancellationReason ? (
              <div className="border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Cancellation Reason</p>
                <p className="mt-1 text-sm text-slate-700">{ride.cancellationReason}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
