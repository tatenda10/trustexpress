import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { GoogleMap, InfoWindowF, MarkerF, Polyline, useJsApiLoader } from '@react-google-maps/api'
import BASE_URL from '../context/Api'
import { useAuth } from '../authcontext/AuthContext'
import {
  DEFAULT_BULAWAYO_CENTER,
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_LIBRARIES,
  GOOGLE_MAPS_LOADER_ID,
} from '../lib/googleMaps'

const DEFAULT_AREA = 'Bulawayo'

function statusBadge(status) {
  if (status === 'Available') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (status === 'On Trip') return 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
  if (status === 'Pickup') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
}

function driverPinColor(status) {
  if (status === 'Available') return '#059669'
  if (status === 'Pickup') return '#d97706'
  if (status === 'On Trip') return '#2563eb'
  return '#64748b'
}

function driverCarIcon(status, selected = false) {
  const body = selected ? '#1d4ed8' : driverPinColor(status)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="15" fill="white" stroke="${selected ? '#0f172a' : '#cbd5e1'}" stroke-width="${selected ? 3 : 2}"/>
      <path d="M10 19.5v-4.1c0-1.4.8-2.6 2-3.2l1.9-1 1.3-3.1c.4-.9 1.2-1.5 2.2-1.5h2.8c1 0 1.9.6 2.2 1.5l1.3 3.1 1.9 1c1.2.6 2 1.9 2 3.2v4.1c0 .8-.7 1.5-1.5 1.5h-.8a2.6 2.6 0 0 1-5.2 0h-5a2.6 2.6 0 0 1-5.2 0h-.8c-.8 0-1.5-.7-1.5-1.5Z" fill="${body}" stroke="#ffffff" stroke-width="1.1" stroke-linejoin="round"/>
      <circle cx="14.1" cy="21.1" r="2.1" fill="#0f172a"/>
      <circle cx="21.9" cy="21.1" r="2.1" fill="#0f172a"/>
      <rect x="13.4" y="11.2" width="9.2" height="3.3" rx="1.4" fill="#dbeafe"/>
    </svg>
  `.trim()

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(selected ? 36 : 32, selected ? 36 : 32),
    anchor: new window.google.maps.Point(selected ? 18 : 16, selected ? 18 : 16),
  }
}

function isSpecificDriverSearch(value) {
  const term = String(value || '').trim()
  if (!term) return false
  return term.length >= 5 && !term.includes(' ')
    ? true
    : term.length >= 7
}

function formatRefreshTime(value) {
  if (!value) return 'Waiting for data'
  return `Last refresh: ${new Date(value).toLocaleTimeString()}`
}

function mapBoundsFromApi(bounds) {
  if (!bounds || typeof window === 'undefined' || !window.google?.maps) return null
  return new window.google.maps.LatLngBounds(
    { lat: Number(bounds.minLat), lng: Number(bounds.minLng) },
    { lat: Number(bounds.maxLat), lng: Number(bounds.maxLng) }
  )
}

function tripPath(trip) {
  if (!trip?.pickupCoordinate || !trip?.dropoffCoordinate) return null
  return [
    { lat: Number(trip.pickupCoordinate.lat), lng: Number(trip.pickupCoordinate.lng) },
    { lat: Number(trip.dropoffCoordinate.lat), lng: Number(trip.dropoffCoordinate.lng) },
  ]
}

export default function LiveMapRealtimePage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const mapRef = useRef(null)
  const [drivers, setDrivers] = useState([])
  const [trips, setTrips] = useState([])
  const [summary, setSummary] = useState({ totalDrivers: 0, availableDrivers: 0, pickupDrivers: 0, onTripDrivers: 0, activeTrips: 0 })
  const [bounds, setBounds] = useState(null)
  const [refreshedAt, setRefreshedAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [placeSearchInput, setPlaceSearchInput] = useState(DEFAULT_AREA)
  const [appliedPlaceSearch, setAppliedPlaceSearch] = useState(DEFAULT_AREA)
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedDriverId, setSelectedDriverId] = useState('')
  const [selectedTripId, setSelectedTripId] = useState('')
  const [driverPage, setDriverPage] = useState(1)
  const [driversPerPage, setDriversPerPage] = useState(6)
  const [searchContext, setSearchContext] = useState(null)

  const { isLoaded: isMapLoaded, loadError } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  })

  useEffect(() => {
    let active = true

    const load = async () => {
      if (!token) return
      try {
        const { data } = await axios.get(`${BASE_URL}/api/admin/rides/live-map`, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            placeSearch: appliedPlaceSearch,
          },
        })
        if (!active) return
        setDrivers(Array.isArray(data?.drivers) ? data.drivers : [])
        setTrips(Array.isArray(data?.trips) ? data.trips : [])
        setSummary(data?.summary || { totalDrivers: 0, availableDrivers: 0, pickupDrivers: 0, onTripDrivers: 0, activeTrips: 0 })
        setBounds(data?.bounds || null)
        setSearchContext(data?.searchContext || null)
        setRefreshedAt(data?.refreshedAt || '')
        setError('')
      } catch (err) {
        if (!active) return
        setError(err?.response?.data?.error || err?.message || 'Failed to load live map data')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    const interval = setInterval(load, 5000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [appliedPlaceSearch, token])

  const filteredDrivers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return drivers.filter((driver) => {
      const matchesSearch =
        !term ||
        [driver.name, driver.passengerName, driver.route, driver.publicId]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(term)
      const normalizedStatus = String(driver.status || '').toLowerCase().replace(/\s+/g, '_')
      const matchesStatus = statusFilter === 'all' || normalizedStatus === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [drivers, search, statusFilter])

  const filteredTrips = useMemo(() => {
    const term = search.trim().toLowerCase()
    return trips.filter((trip) => {
      return (
        !term ||
        [trip.id, trip.rider, trip.driver, trip.route, trip.stage, trip.tierName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(term)
      )
    })
  }, [trips, search])

  const shouldShowDriverLabels = useMemo(() => {
    return isSpecificDriverSearch(search)
  }, [search])

  const selectedDriver = filteredDrivers.find((driver) => driver.id === selectedDriverId) || null
  const selectedTrip = filteredTrips.find((trip) => trip.id === selectedTripId) || null
  const totalDriverPages = Math.max(Math.ceil(filteredDrivers.length / driversPerPage), 1)
  const safeDriverPage = Math.min(driverPage, totalDriverPages)
  const paginatedDrivers = filteredDrivers.slice((safeDriverPage - 1) * driversPerPage, safeDriverPage * driversPerPage)

  useEffect(() => {
    setDriverPage(1)
  }, [search, statusFilter, driversPerPage, appliedPlaceSearch])

  useEffect(() => {
    if (!isMapLoaded || !mapRef.current) return

    const nextBounds = mapBoundsFromApi(bounds)
    if (nextBounds && !nextBounds.isEmpty()) {
      mapRef.current.fitBounds(nextBounds, 64)
      return
    }

    mapRef.current.setCenter(DEFAULT_BULAWAYO_CENTER)
    mapRef.current.setZoom(12)
  }, [bounds, isMapLoaded, filteredDrivers.length, filteredTrips.length])

  const handlePlaceSearch = () => {
    setAppliedPlaceSearch(placeSearchInput.trim() || DEFAULT_AREA)
    setSelectedDriverId('')
    setSelectedTripId('')
    setDriverPage(1)
  }

  return (
    <section className="space-y-3">
      <header className="border border-slate-300 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-slate-800">Live Map</h1>
        <p className="text-xs text-slate-500">Track live drivers and active trips using current coordinates from the backend.</p>
      </header>

      <div className="grid gap-3 md:grid-cols-5">
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Drivers Seen</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.totalDrivers}</p>
        </article>
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Available</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.availableDrivers}</p>
        </article>
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Pickup</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.pickupDrivers}</p>
        </article>
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">On Trip</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.onTripDrivers}</p>
        </article>
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Active Trips</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.activeTrips}</p>
        </article>
      </div>

      {error ? (
        <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div>
      ) : null}

      <div className="space-y-3">
        <article className="overflow-hidden border border-slate-300 bg-white">
          <div className="border-b border-slate-300 px-4 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Map Canvas</h2>
          </div>

          <div className="relative h-[620px] overflow-hidden bg-slate-100">
            <div className="absolute left-4 right-4 top-4 z-10 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
                <div className="flex w-full max-w-lg items-center overflow-hidden border border-slate-300 bg-white">
                  <input
                    type="text"
                    value={placeSearchInput}
                    onChange={(event) => setPlaceSearchInput(event.target.value)}
                    placeholder="Search place or region to show nearby drivers and active rides..."
                    className="h-10 flex-1 px-3 text-xs text-slate-800 outline-none"
                  />
                  <button
                    type="button"
                    onClick={handlePlaceSearch}
                    className="h-10 border-l border-slate-300 bg-slate-900 px-4 text-xs font-semibold text-white"
                  >
                    Search Area
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Filter drivers or trips..."
                    className="h-10 w-full max-w-xs border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-500"
                  />
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="h-10 border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-500"
                  >
                    <option value="all">All driver states</option>
                    <option value="available">Available</option>
                    <option value="pickup">Pickup</option>
                    <option value="on_trip">On Trip</option>
                    <option value="offline">Offline</option>
                  </select>
                </div>
              </div>
              <div className="bg-white/95 px-3 py-2 text-xs text-slate-600">
                {formatRefreshTime(refreshedAt)}
              </div>
            </div>

            {appliedPlaceSearch ? (
              <div className="absolute left-4 top-[68px] z-10 max-w-xl bg-white/95 px-3 py-2 text-xs text-slate-700">
                {searchContext?.matchedPlaces
                  ? `Showing drivers and active rides within ${searchContext.radiusKm} km of "${appliedPlaceSearch}" based on matched trip locations.`
                  : `No mapped trip locations matched "${appliedPlaceSearch}".`}
              </div>
            ) : null}

            {GOOGLE_MAPS_API_KEY && isMapLoaded && !loadError ? (
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
                {filteredTrips.map((trip) => {
                  const path = tripPath(trip)
                  if (!path) return null
                  return (
                    <Polyline
                      key={`trip-line-${trip.id}`}
                      path={path}
                      options={{
                        strokeColor: '#2563eb',
                        strokeOpacity: 0.85,
                        strokeWeight: 3,
                        icons: [
                          {
                            icon: {
                              path: 'M 0,-1 0,1',
                              strokeOpacity: 1,
                              scale: 3,
                            },
                            offset: '0',
                            repeat: '14px',
                          },
                        ],
                      }}
                    />
                  )
                })}

                {filteredTrips.map((trip) => {
                  if (!trip.pickupCoordinate || !trip.dropoffCoordinate) return null
                  return (
                    <MarkerF
                      key={`pickup-${trip.id}`}
                      position={{ lat: Number(trip.pickupCoordinate.lat), lng: Number(trip.pickupCoordinate.lng) }}
                      onClick={() => {
                        setSelectedTripId(trip.id)
                        navigate(`/dashboard/ride-operations/${trip.id}`)
                      }}
                      icon={{
                        path: window.google.maps.SymbolPath.CIRCLE,
                        scale: 6,
                        fillColor: '#111827',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 2,
                      }}
                    />
                  )
                })}

                {filteredTrips.map((trip) => {
                  if (!trip.dropoffCoordinate) return null
                  return (
                    <MarkerF
                      key={`dropoff-${trip.id}`}
                      position={{ lat: Number(trip.dropoffCoordinate.lat), lng: Number(trip.dropoffCoordinate.lng) }}
                      onClick={() => {
                        setSelectedTripId(trip.id)
                        navigate(`/dashboard/ride-operations/${trip.id}`)
                      }}
                      icon={{
                        path: window.google.maps.SymbolPath.CIRCLE,
                        scale: 6,
                        fillColor: '#059669',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 2,
                      }}
                    />
                  )
                })}

                {filteredDrivers.map((driver) => {
                  if (driver.lat === null || driver.lng === null || driver.lat === undefined || driver.lng === undefined) return null
                  return (
                    <MarkerF
                      key={driver.id}
                      position={{ lat: Number(driver.lat), lng: Number(driver.lng) }}
                      zIndex={selectedDriverId === driver.id ? 1300 : 1000}
                      onClick={() => {
                        setSelectedDriverId(driver.id)
                        setSelectedTripId(driver.publicId || '')
                      }}
                      label={
                        shouldShowDriverLabels
                          ? {
                              text: driver.name || 'Driver',
                              color: '#0f172a',
                              fontSize: '11px',
                              fontWeight: '600',
                            }
                          : undefined
                      }
                      icon={driverCarIcon(driver.status, selectedDriverId === driver.id)}
                    />
                  )
                })}

                {selectedDriver ? (
                  <InfoWindowF
                    position={{ lat: Number(selectedDriver.lat), lng: Number(selectedDriver.lng) }}
                    onCloseClick={() => setSelectedDriverId('')}
                  >
                    <div className="min-w-[220px] space-y-2 pr-2">
                      <p className="text-sm font-semibold text-slate-900">{selectedDriver.name}</p>
                      <p className="text-xs text-slate-600">{selectedDriver.route || 'Waiting for trip'}</p>
                      <p className="text-xs text-slate-500">Status: {selectedDriver.status}</p>
                      {selectedDriver.publicId ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/dashboard/ride-operations/${selectedDriver.publicId}`)}
                          className="h-8 rounded-sm bg-slate-900 px-3 text-[11px] font-semibold text-white"
                        >
                          Track Ride
                        </button>
                      ) : null}
                    </div>
                  </InfoWindowF>
                ) : null}

                {selectedTrip && selectedTrip.pickupCoordinate ? (
                  <InfoWindowF
                    position={{ lat: Number(selectedTrip.pickupCoordinate.lat), lng: Number(selectedTrip.pickupCoordinate.lng) }}
                    onCloseClick={() => setSelectedTripId('')}
                  >
                    <div className="min-w-[220px] space-y-2 pr-2">
                      <p className="text-sm font-semibold text-slate-900">{selectedTrip.id}</p>
                      <p className="text-xs text-slate-600">{selectedTrip.route}</p>
                      <p className="text-xs text-slate-500">{selectedTrip.rider} • {selectedTrip.driver}</p>
                      <button
                        type="button"
                        onClick={() => navigate(`/dashboard/ride-operations/${selectedTrip.id}`)}
                        className="h-8 rounded-sm bg-slate-900 px-3 text-[11px] font-semibold text-white"
                      >
                        Track Ride
                      </button>
                    </div>
                  </InfoWindowF>
                ) : null}
              </GoogleMap>
            ) : (
              <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,#dbeafe_0%,#eff6ff_40%,#f8fafc_100%)] px-6 text-center">
                <div className="max-w-lg space-y-2">
                  <p className="text-sm font-semibold text-slate-900">Google Maps background is not configured yet.</p>
                  <p className="text-xs text-slate-600">
                    Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to the admin environment to show the real map background here.
                  </p>
                </div>
              </div>
            )}

            <div className="absolute bottom-3 right-3 z-10 border border-slate-200 bg-white/90 px-3 py-2 text-[11px] text-slate-600">
              {loading ? 'Loading live drivers...' : `${filteredDrivers.length} drivers • ${filteredTrips.length} active trips`}
            </div>
          </div>
        </article>

        <div className="grid gap-3 xl:grid-cols-[1.15fr_1fr]">
          <article className="overflow-hidden border border-slate-300 bg-white">
            <div className="border-b border-slate-300 px-4 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Live Drivers</h2>
            </div>
            <ul className="divide-y divide-slate-200">
              {loading ? (
                <li className="px-4 py-6 text-center text-xs text-slate-500">Loading drivers...</li>
              ) : filteredDrivers.length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-slate-500">No live drivers found.</li>
              ) : (
                paginatedDrivers.map((driver) => (
                  <li
                    key={driver.id}
                    className={`cursor-pointer space-y-1 px-4 py-3 ${selectedDriverId === driver.id ? 'bg-slate-50' : ''}`}
                    onClick={() => {
                      setSelectedDriverId(driver.id)
                      setSelectedTripId(driver.publicId || '')
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">{driver.name}</p>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge(driver.status)}`}>
                        {driver.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">{driver.route || 'Waiting for trip'}</p>
                    <p className="text-[11px] text-slate-500">{driver.lat}, {driver.lng}</p>
                  </li>
                ))
              )}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
              <div className="text-xs text-slate-500">
                Showing {paginatedDrivers.length} of {filteredDrivers.length} drivers
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={driversPerPage}
                  onChange={(event) => setDriversPerPage(Number(event.target.value))}
                  className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none"
                >
                  <option value={6}>6</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                </select>
                <button
                  type="button"
                  onClick={() => setDriverPage((current) => Math.max(current - 1, 1))}
                  disabled={safeDriverPage <= 1}
                  className="h-8 border border-slate-300 px-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Prev
                </button>
                <span className="text-xs text-slate-600">Page {safeDriverPage} / {totalDriverPages}</span>
                <button
                  type="button"
                  onClick={() => setDriverPage((current) => Math.min(current + 1, totalDriverPages))}
                  disabled={safeDriverPage >= totalDriverPages}
                  className="h-8 border border-slate-300 px-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </article>

          <article className="overflow-hidden border border-slate-300 bg-white">
            <div className="border-b border-slate-300 px-4 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Active Trips</h2>
            </div>
            <ul className="divide-y divide-slate-200">
              {loading ? (
                <li className="px-4 py-6 text-center text-xs text-slate-500">Loading trips...</li>
              ) : filteredTrips.length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-slate-500">No active trips.</li>
              ) : (
                filteredTrips.map((trip) => (
                  <li
                    key={trip.id}
                    className={`cursor-pointer px-4 py-3 ${selectedTripId === trip.id ? 'bg-slate-50' : ''}`}
                    onClick={() => {
                      setSelectedTripId(trip.id)
                      navigate(`/dashboard/ride-operations/${trip.id}`)
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">{trip.id}</p>
                      <span className="text-[11px] font-semibold text-indigo-700">{trip.stage}</span>
                    </div>
                    <p className="text-xs text-slate-600">{trip.rider} • {trip.driver}</p>
                    <p className="text-[11px] text-slate-500">{trip.route}</p>
                  </li>
                ))
              )}
            </ul>
          </article>
        </div>
      </div>
    </section>
  )
}
