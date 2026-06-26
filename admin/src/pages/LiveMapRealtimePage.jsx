import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import BASE_URL from '../context/Api'
import { useAuth } from '../authcontext/AuthContext'
import GeoPlotMap from '../components/GeoPlotMap'

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

function tripPath(trip) {
  if (Array.isArray(trip?.routeCoordinates) && trip.routeCoordinates.length > 1) {
    return trip.routeCoordinates
      .map((point) => ({
        lat: Number(point?.lat),
        lng: Number(point?.lng),
      }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
  }

  const origin = trip?.driverCoordinate || trip?.pickupCoordinate || null
  const target = trip?.currentTargetCoordinate || trip?.dropoffCoordinate || null
  if (!origin || !target) return null

  return [
    { lat: Number(origin.lat), lng: Number(origin.lng) },
    { lat: Number(target.lat), lng: Number(target.lng) },
  ]
}

export default function LiveMapRealtimePage() {
  const navigate = useNavigate()
  const { token } = useAuth()
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
    return trips.filter((trip) => (
      !term ||
      [trip.id, trip.rider, trip.driver, trip.route, trip.stage, trip.tierName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    ))
  }, [trips, search])

  const shouldShowDriverLabels = useMemo(() => isSpecificDriverSearch(search), [search])

  const selectedDriver = filteredDrivers.find((driver) => driver.id === selectedDriverId) || null
  const selectedTrip = filteredTrips.find((trip) => trip.id === selectedTripId) || null
  const totalDriverPages = Math.max(Math.ceil(filteredDrivers.length / driversPerPage), 1)
  const safeDriverPage = Math.min(driverPage, totalDriverPages)
  const paginatedDrivers = filteredDrivers.slice((safeDriverPage - 1) * driversPerPage, safeDriverPage * driversPerPage)

  useEffect(() => {
    setDriverPage(1)
  }, [search, statusFilter, driversPerPage, appliedPlaceSearch])

  const handlePlaceSearch = () => {
    setAppliedPlaceSearch(placeSearchInput.trim() || DEFAULT_AREA)
    setSelectedDriverId('')
    setSelectedTripId('')
    setDriverPage(1)
  }

  const mapPaths = useMemo(() => (
    filteredTrips
      .map((trip) => {
        const path = tripPath(trip)
        if (!path) return null
        return { id: `trip-line-${trip.id}`, points: path, color: '#2563eb', width: 0.45, dashed: true, opacity: 0.9 }
      })
      .filter(Boolean)
  ), [filteredTrips])

  const mapMarkers = useMemo(() => {
    const tripMarkers = filteredTrips.flatMap((trip) => {
      const markers = []
      if (trip.pickupCoordinate) {
        markers.push({
          id: `pickup-${trip.id}`,
          lat: Number(trip.pickupCoordinate.lat),
          lng: Number(trip.pickupCoordinate.lng),
          color: '#111827',
          title: `Pickup for ${trip.id}`,
          onClick: () => {
            setSelectedTripId(trip.id)
            navigate(`/dashboard/ride-operations/${trip.id}`)
          },
        })
      }
      if (trip.dropoffCoordinate) {
        markers.push({
          id: `dropoff-${trip.id}`,
          lat: Number(trip.dropoffCoordinate.lat),
          lng: Number(trip.dropoffCoordinate.lng),
          color: '#059669',
          title: `Drop-off for ${trip.id}`,
          onClick: () => {
            setSelectedTripId(trip.id)
            navigate(`/dashboard/ride-operations/${trip.id}`)
          },
        })
      }
      if (trip.currentTargetCoordinate) {
        markers.push({
          id: `target-${trip.id}`,
          lat: Number(trip.currentTargetCoordinate.lat),
          lng: Number(trip.currentTargetCoordinate.lng),
          color: '#f59e0b',
          title: `Current target for ${trip.id}`,
          onClick: () => {
            setSelectedTripId(trip.id)
            navigate(`/dashboard/ride-operations/${trip.id}`)
          },
        })
      }
      return markers
    })

    const driverMarkers = filteredDrivers
      .filter((driver) => driver.lat !== null && driver.lng !== null && driver.lat !== undefined && driver.lng !== undefined)
      .map((driver) => ({
        id: `driver-${driver.id}`,
        lat: Number(driver.lat),
        lng: Number(driver.lng),
        color: driverPinColor(driver.status),
        title: driver.name || 'Driver',
        label: shouldShowDriverLabels ? (driver.name || 'Driver') : '',
        variant: 'driver',
        selected: selectedDriverId === driver.id,
        onClick: () => {
          setSelectedDriverId(driver.id)
          setSelectedTripId(driver.publicId || '')
        },
      }))

    return [...tripMarkers, ...driverMarkers]
  }, [filteredDrivers, filteredTrips, navigate, selectedDriverId, shouldShowDriverLabels])

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

            <GeoPlotMap
              bounds={bounds}
              markers={mapMarkers}
              paths={mapPaths}
              emptyMessage="Live coordinates will appear here once drivers or trips are available."
            />

            {selectedDriver ? (
              <div className="absolute bottom-14 left-4 z-10 min-w-[220px] max-w-sm space-y-2 border border-slate-200 bg-white/95 px-4 py-3 text-xs text-slate-700 shadow-sm">
                <p className="text-sm font-semibold text-slate-900">{selectedDriver.name}</p>
                <p>{selectedDriver.route || 'Waiting for trip'}</p>
                <p className="text-slate-500">Status: {selectedDriver.status}</p>
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
            ) : null}

            {selectedTrip ? (
              <div className="absolute bottom-14 right-4 z-10 min-w-[220px] max-w-sm space-y-2 border border-slate-200 bg-white/95 px-4 py-3 text-xs text-slate-700 shadow-sm">
                <p className="text-sm font-semibold text-slate-900">{selectedTrip.id}</p>
                <p>{selectedTrip.route}</p>
                <p className="text-slate-500">{selectedTrip.rider} · {selectedTrip.driver}</p>
                <button
                  type="button"
                  onClick={() => navigate(`/dashboard/ride-operations/${selectedTrip.id}`)}
                  className="h-8 rounded-sm bg-slate-900 px-3 text-[11px] font-semibold text-white"
                >
                  Track Ride
                </button>
              </div>
            ) : null}

            <div className="absolute bottom-3 right-3 z-10 border border-slate-200 bg-white/90 px-3 py-2 text-[11px] text-slate-600">
              {loading ? 'Loading live drivers...' : `${filteredDrivers.length} drivers · ${filteredTrips.length} active trips`}
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
                    <p className="text-xs text-slate-600">{trip.rider} · {trip.driver}</p>
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
