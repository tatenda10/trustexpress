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

function formatRating(value, review) {
  if (value === null || value === undefined) return '-'
  const ratingText = `${Number(value).toFixed(1)} / 5`
  return review ? `${ratingText} - ${review}` : ratingText
}

function formatTagList(tags) {
  return Array.isArray(tags) && tags.length ? tags.join(', ') : '-'
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
  const [lostItems, setLostItems] = useState([])
  const [panicAlerts, setPanicAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingCaseId, setSavingCaseId] = useState('')
  const fromDriverId = location.state?.fromDriverId || ''
  const fromDriverName = location.state?.fromDriverName || 'driver'

  const refreshRideDetails = async () => {
    const { data } = await axios.get(`${BASE_URL}/api/admin/rides/${rideId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    setRide(data.ride || null)
    setLostItems(Array.isArray(data.lostItems) ? data.lostItems : [])
    setPanicAlerts(Array.isArray(data.panicAlerts) ? data.panicAlerts : [])
  }

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
        setLostItems(Array.isArray(data.lostItems) ? data.lostItems : [])
        setPanicAlerts(Array.isArray(data.panicAlerts) ? data.panicAlerts : [])
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

  const updateLostItemCase = async (item, patch) => {
    if (!token || !item?.id) return
    setSavingCaseId(`lost-${item.id}`)
    setError('')
    try {
      await axios.patch(
        `${BASE_URL}/api/admin/rides/${rideId}/lost-items/${item.id}`,
        patch,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      await refreshRideDetails()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to update lost item case')
    } finally {
      setSavingCaseId('')
    }
  }

  const updatePanicCase = async (alert, patch) => {
    if (!token || !alert?.id) return
    setSavingCaseId(`panic-${alert.id}`)
    setError('')
    try {
      await axios.patch(
        `${BASE_URL}/api/admin/rides/${rideId}/panic-alerts/${alert.id}`,
        patch,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      await refreshRideDetails()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to update panic case')
    } finally {
      setSavingCaseId('')
    }
  }

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
              <DetailField label="Original Fare" value={`$${Number(ride.originalEstimatedAmount || ride.estimatedAmount || 0).toFixed(2)}`} />
              <DetailField label="Discount Code" value={ride.discountCode || '-'} />
              <DetailField label="Discount" value={`$${Number(ride.discountAmount || 0).toFixed(2)}`} />
              <DetailField label="Driver Reimbursement" value={`$${Number(ride.driverReimbursementAmount || 0).toFixed(2)}`} />
              <DetailField label="Tip" value={`$${Number(ride.tipAmount || 0).toFixed(2)}`} />
              <DetailField label="Total" value={`$${Number(ride.totalAmount || 0).toFixed(2)}`} />
              <DetailField label="Estimated Distance" value={`${Number(ride.estimatedDistanceKm || 0).toFixed(1)} km`} />
              <DetailField label="Estimated Time" value={`${Number(ride.estimatedMinutes || 0)} min`} />
              <DetailField label="Driver Rating" value={formatRating(ride.passengerDriverRating, ride.passengerDriverReview)} />
              <DetailField label="Driver Rating Tags" value={formatTagList(ride.passengerDriverFeedbackTags)} />
              <DetailField label="Passenger Rating" value={formatRating(ride.driverPassengerRating, ride.driverPassengerReview)} />
              <DetailField label="Passenger Rating Tags" value={formatTagList(ride.driverPassengerFeedbackTags)} />
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

            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Panic Alerts</p>
                <span className="text-xs font-semibold text-slate-600">{panicAlerts.length}</span>
              </div>
              {panicAlerts.length ? (
                <div className="mt-3 space-y-3">
                  {panicAlerts.map((alert) => (
                    <div key={alert.id} className="border border-rose-200 bg-white px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">{alert.actorName || alert.actorRole}</p>
                        <span className="inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium uppercase text-rose-700 ring-1 ring-rose-200">
                          {alert.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{formatDateTime(alert.createdAt)}</p>
                      <p className="mt-2 text-sm text-slate-700">{alert.message || 'Panic alert sent.'}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Stage: {alert.alertStage || '-'} {alert.latitude !== null && alert.longitude !== null ? `- ${alert.latitude}, ${alert.longitude}` : ''}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        Case: {alert.caseReference || '-'} · Priority: {alert.casePriority || '-'} · Follow-up: {alert.followUpStatus || '-'}
                      </p>
                      {alert.followUpNote ? <p className="mt-2 text-xs text-slate-600">Follow-up note: {alert.followUpNote}</p> : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={savingCaseId === `panic-${alert.id}`}
                          onClick={() => updatePanicCase(alert, { status: 'reviewed', followUpStatus: 'monitoring' })}
                          className="rounded-md bg-slate-900 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
                        >
                          Mark reviewing
                        </button>
                        <button
                          type="button"
                          disabled={savingCaseId === `panic-${alert.id}`}
                          onClick={() => updatePanicCase(alert, { followUpStatus: 'police_alerted', casePriority: 'critical' })}
                          className="rounded-md bg-rose-600 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
                        >
                          Police alerted
                        </button>
                        <button
                          type="button"
                          disabled={savingCaseId === `panic-${alert.id}`}
                          onClick={() => {
                            const followUpNote = window.prompt('Add follow-up note', alert.followUpNote || '')
                            if (followUpNote === null) return
                            updatePanicCase(alert, { status: 'resolved', followUpStatus: 'resolved', followUpNote })
                          }}
                          className="rounded-md bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
                        >
                          Resolve case
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No panic alerts recorded for this ride.</p>
              )}
            </div>

            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Lost Items</p>
                <span className="text-xs font-semibold text-slate-600">{lostItems.length}</span>
              </div>
              {lostItems.length ? (
                <div className="mt-3 space-y-3">
                  {lostItems.map((item) => (
                    <div key={item.id} className="border border-amber-200 bg-white px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">{item.status}</p>
                        <span className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{item.itemDescription}</p>
                      <p className="mt-2 text-xs text-slate-500">Contact: {item.contactPhone || '-'}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Case: {item.caseReference || '-'} · Priority: {item.casePriority || '-'} · Follow-up: {item.followUpStatus || '-'}
                      </p>
                      {item.followUpNote ? <p className="mt-2 text-xs text-slate-600">Follow-up note: {item.followUpNote}</p> : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={savingCaseId === `lost-${item.id}`}
                          onClick={() => updateLostItemCase(item, { status: 'contacted', followUpStatus: 'contacted' })}
                          className="rounded-md bg-slate-900 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
                        >
                          Mark contacted
                        </button>
                        <button
                          type="button"
                          disabled={savingCaseId === `lost-${item.id}`}
                          onClick={() => {
                            const followUpNote = window.prompt('Add follow-up note', item.followUpNote || '')
                            if (followUpNote === null) return
                            updateLostItemCase(item, { status: 'returned', followUpStatus: 'resolved', followUpNote, casePriority: 'high' })
                          }}
                          className="rounded-md bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
                        >
                          Mark returned
                        </button>
                        <button
                          type="button"
                          disabled={savingCaseId === `lost-${item.id}`}
                          onClick={() => {
                            const followUpNote = window.prompt('Add admin note', item.followUpNote || item.adminNote || '')
                            if (followUpNote === null) return
                            updateLostItemCase(item, { status: 'closed', followUpStatus: 'closed', followUpNote })
                          }}
                          className="rounded-md bg-amber-600 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
                        >
                          Close case
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No lost item reports for this ride.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
