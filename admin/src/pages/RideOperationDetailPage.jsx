import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import BASE_URL from '../context/Api'
import { useAuth } from '../authcontext/AuthContext'
import GeoPlotMap from '../components/GeoPlotMap'

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
  const [ride, setRide] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const fromDriverId = location.state?.fromDriverId || ''
  const fromDriverName = location.state?.fromDriverName || 'driver'

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
      return []
    }
    return [
      { lat: Number(ride.pickupLat), lng: Number(ride.pickupLng) },
      { lat: Number(ride.dropoffLat), lng: Number(ride.dropoffLng) },
    ]
  }, [ride])

  const mapMarkers = useMemo(() => {
    if (routePath.length < 2) return []
    return [
      {
        id: 'pickup',
        lat: routePath[0].lat,
        lng: routePath[0].lng,
        color: '#111827',
        title: 'Pickup',
        label: 'Pickup',
        selected: true,
      },
      {
        id: 'dropoff',
        lat: routePath[routePath.length - 1].lat,
        lng: routePath[routePath.length - 1].lng,
        color: '#059669',
        title: 'Drop-off',
        label: 'Drop-off',
      },
    ]
  }, [routePath])

  const mapPaths = useMemo(() => (
    routePath.length > 1
      ? [{ id: 'ride-route', points: routePath, color: '#2563eb', width: 0.8 }]
      : []
  ), [routePath])

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
        <p className="text-xs text-slate-500">View the full trip route, trip state, and timing from pickup to drop-off.</p>
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
                <GeoPlotMap
                  markers={mapMarkers}
                  paths={mapPaths}
                  emptyMessage={routePath.length ? 'Map points are still being prepared.' : 'Pickup and drop-off coordinates are missing for this ride.'}
                />
              </div>
            </div>

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
