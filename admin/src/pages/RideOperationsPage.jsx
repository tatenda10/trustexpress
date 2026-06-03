import { useEffect, useState } from 'react'
import axios from 'axios'
import BASE_URL from '../context/Api'
import { useAuth } from '../authcontext/AuthContext'
import { useNavigate } from 'react-router-dom'

function statusClass(status) {
  if (status === 'In Progress') return 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
  if (status === 'Completed') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (status === 'Requested') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
  return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
}

export default function RideOperationsPage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const [summary, setSummary] = useState({ activeTrips: 0, completed: 0, cancelled: 0, requested: 0, panicAlerts: 0, lostItems: 0 })
  const [rides, setRides] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [appliedStatusFilter, setAppliedStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [appliedDateFrom, setAppliedDateFrom] = useState('')
  const [appliedDateTo, setAppliedDateTo] = useState('')

  useEffect(() => {
    let active = true

    const load = async () => {
      if (!token) return
      setLoading(true)
      setError('')
      try {
        const { data } = await axios.get(`${BASE_URL}/api/admin/rides`, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            page,
            pageSize,
            search: appliedSearch,
            status: appliedStatusFilter,
            dateFrom: appliedDateFrom,
            dateTo: appliedDateTo,
          },
        })
        if (!active) return
        setSummary(data.summary || { activeTrips: 0, completed: 0, cancelled: 0, requested: 0, panicAlerts: 0, lostItems: 0 })
        setRides(Array.isArray(data.rides) ? data.rides : [])
        setTotal(Number(data.total) || 0)
        setTotalPages(Math.max(Number(data.totalPages) || 1, 1))
      } catch (err) {
        if (!active) return
        setError(err?.response?.data?.error || err?.message || 'Failed to load ride operations')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [appliedDateFrom, appliedDateTo, appliedSearch, appliedStatusFilter, page, pageSize, token])

  const safePage = Math.min(page, totalPages)

  const handleSearch = () => {
    setAppliedSearch(searchInput.trim())
    setAppliedStatusFilter(statusFilter)
    setAppliedDateFrom(dateFrom)
    setAppliedDateTo(dateTo)
    setPage(1)
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-slate-800">Ride Operations</h1>
        <p className="text-xs text-slate-500">Monitor requested rides, assigned drivers, completions, and cancellations.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Active Trips</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.activeTrips}</p>
        </article>
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Requested</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.requested}</p>
        </article>
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Completed</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.completed}</p>
        </article>
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Cancelled</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.cancelled}</p>
        </article>
        <article className="border border-rose-200 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-rose-500">Open Panic Alerts</p>
          <p className="mt-1 text-xl font-semibold text-rose-700">{summary.panicAlerts}</p>
        </article>
        <article className="border border-amber-200 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-amber-600">Open Lost Items</p>
          <p className="mt-1 text-xl font-semibold text-amber-700">{summary.lostItems}</p>
        </article>
      </div>

      {error ? <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div> : null}

      <div className="overflow-hidden border border-slate-300 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search trip, rider, driver, pickup, or dropoff..."
              className="h-9 w-full max-w-md border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-500"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-500"
            >
              <option value="all">All statuses</option>
              <option value="requested">Requested</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-9 border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-500"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="h-9 border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={handleSearch}
              className="h-9 border border-indigo-600 bg-indigo-600 px-4 text-xs font-medium text-white transition hover:bg-indigo-700"
            >
              Search
            </button>
          </div>
          <div className="text-xs text-slate-500">
            {total} result{total === 1 ? '' : 's'}
          </div>
        </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-300 bg-[#0f172a] text-left text-[11px] uppercase tracking-wide text-slate-200">
              <th className="rounded-tl-sm px-4 py-2 font-semibold">Trip ID</th>
              <th className="px-4 py-2 font-semibold">Rider</th>
              <th className="px-4 py-2 font-semibold">Driver</th>
              <th className="px-4 py-2 font-semibold">Route</th>
              <th className="px-4 py-2 font-semibold">Tier</th>
              <th className="px-4 py-2 font-semibold">Fare</th>
              <th className="px-4 py-2 font-semibold">Safety</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="rounded-tr-sm px-4 py-2 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-500">Loading rides...</td>
              </tr>
            ) : rides.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-500">No ride activity yet.</td>
              </tr>
            ) : (
              rides.map((row) => (
                <tr key={row.id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{row.id}</td>
                  <td className="px-4 py-3 text-slate-700">{row.rider}</td>
                  <td className="px-4 py-3 text-slate-700">{row.driver}</td>
                  <td className="px-4 py-3 text-slate-700">{row.route}</td>
                  <td className="px-4 py-3 text-slate-700">{row.tierName}</td>
                  <td className="px-4 py-3 text-slate-700">
                    <div className="space-y-1">
                      <div>{row.fare}</div>
                      {Number(row.discountAmount || 0) > 0 ? (
                        <>
                          <div className="text-[11px] font-medium text-emerald-700">
                            Promo{row.discountCode ? ` ${row.discountCode}` : ''}: -${Number(row.discountAmount || 0).toFixed(2)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Original: ${Number(row.originalEstimatedAmount || 0).toFixed(2)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Driver reimbursement: ${Number(row.driverReimbursementAmount || 0).toFixed(2)}
                          </div>
                        </>
                      ) : null}
                      {Number(row.tipAmount || 0) > 0 ? (
                        <div className="text-[11px] font-medium text-emerald-700">
                          Tip: ${Number(row.tipAmount || 0).toFixed(2)}
                        </div>
                      ) : null}
                      {Number(row.tipAmount || 0) > 0 || Number(row.discountAmount || 0) > 0 ? (
                        <div className="text-[11px] text-slate-500">
                          Total: ${Number(row.totalAmount || 0).toFixed(2)}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <div className="flex flex-wrap gap-2">
                      {row.openPanicAlerts > 0 ? (
                        <span className="inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200">
                          {row.openPanicAlerts} panic
                        </span>
                      ) : null}
                      {row.openLostItems > 0 ? (
                        <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                          {row.openLostItems} lost item
                        </span>
                      ) : null}
                      {row.openPanicAlerts <= 0 && row.openLostItems <= 0 ? <span>-</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass(row.status)}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => navigate(`/dashboard/ride-operations/${row.id}`)}
                      title="View details"
                      aria-label="View details"
                      className="inline-flex h-8 w-8 items-center justify-center text-slate-500 transition hover:text-indigo-700"
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">
                        <path d="M1.5 12s3.8-6 10.5-6 10.5 6 10.5 6-3.8 6-10.5 6S1.5 12 1.5 12Z" stroke="currentColor" strokeWidth="1.8" />
                        <circle cx="12" cy="12" r="3" fill="currentColor" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="text-xs text-slate-500">
          Showing {rides.length} of {total} rides
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-500">Rows</label>
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value))
              setPage(1)
            }}
            className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>

          <button
            type="button"
            onClick={() => setPage((current) => Math.max(current - 1, 1))}
            disabled={safePage <= 1}
            className="h-8 border border-slate-300 px-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-xs text-slate-600">Page {safePage} / {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(current + 1, totalPages))}
            disabled={safePage >= totalPages}
            className="h-8 border border-slate-300 px-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
      </div>
    </section>
  )
}
