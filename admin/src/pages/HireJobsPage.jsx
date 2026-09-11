import { useEffect, useState } from 'react'
import axios from 'axios'
import BASE_URL from '../context/Api'
import { useAuth } from '../authcontext/AuthContext'
import { useNavigate } from 'react-router-dom'

function statusClass(status) {
  const value = String(status || '').toLowerCase()
  if (value === 'open') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
  if (value === 'quoted') return 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
  if (value === 'booked') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (value === 'cancelled') return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
  if (value === 'expired') return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
  return 'bg-slate-50 text-slate-600 ring-1 ring-slate-200'
}

function formatMoney(amount, currency = 'USD') {
  if (amount == null || Number.isNaN(Number(amount))) return '-'
  return `${currency || 'USD'} ${Number(amount).toFixed(2)}`
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

export default function HireJobsPage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const [summary, setSummary] = useState({
    openJobs: 0,
    booked: 0,
    cancelled: 0,
    expired: 0,
    withOffer: 0,
    totalQuotes: 0,
    totalBookings: 0,
  })
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
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
        const { data } = await axios.get(`${BASE_URL}/api/admin/hire/requests`, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            page,
            pageSize,
            search: appliedSearch,
            status: appliedStatusFilter === 'all' ? undefined : appliedStatusFilter,
            dateFrom: appliedDateFrom || undefined,
            dateTo: appliedDateTo || undefined,
          },
        })
        if (!active) return
        setSummary(data.summary || {
          openJobs: 0,
          booked: 0,
          cancelled: 0,
          expired: 0,
          withOffer: 0,
          totalQuotes: 0,
          totalBookings: 0,
        })
        setRequests(Array.isArray(data.requests) ? data.requests : [])
        setTotal(Number(data.total) || 0)
        setTotalPages(Math.max(Number(data.totalPages) || 1, 1))
      } catch (err) {
        if (!active) return
        setError(err?.response?.data?.error || err?.message || 'Failed to load hire jobs')
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
        <h1 className="text-sm font-semibold text-slate-800">Hire Jobs</h1>
        <p className="text-xs text-slate-500">
          View every posted hire request, passenger offers, driver quotes, and bookings.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Open / Quoted</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.openJobs}</p>
        </article>
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Booked</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.booked}</p>
        </article>
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Driver quotes</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.totalQuotes}</p>
        </article>
        <article className="border border-slate-300 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Bookings</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary.totalBookings}</p>
        </article>
      </div>

      <div className="border border-slate-300 bg-white p-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search id, title, passenger, route..."
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="quoted">Quoted</option>
            <option value="booked">Booked</option>
            <option value="cancelled">Cancelled</option>
            <option value="expired">Expired</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handleSearch}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Search
          </button>
        </div>
      </div>

      {error ? (
        <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="overflow-hidden border border-slate-300 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#0f172a] text-white">
            <tr>
              <th className="rounded-tl-sm px-4 py-2 font-semibold">Job</th>
              <th className="px-4 py-2 font-semibold">Passenger</th>
              <th className="px-4 py-2 font-semibold">Route</th>
              <th className="px-4 py-2 font-semibold">Offer</th>
              <th className="px-4 py-2 font-semibold">Quotes</th>
              <th className="px-4 py-2 font-semibold">Booking</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="rounded-tr-sm px-4 py-2 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-500">Loading hire jobs...</td>
              </tr>
            ) : requests.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-500">No hire jobs yet.</td>
              </tr>
            ) : (
              requests.map((row) => (
                <tr key={row.id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{row.title || row.publicId}</div>
                    <div className="text-[11px] text-slate-500">{row.publicId}</div>
                    <div className="text-[11px] text-slate-400">{formatDateTime(row.createdAt)}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <div>{row.passengerName || '-'}</div>
                    <div className="text-[11px] text-slate-500">{row.passengerPhone || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <div>{row.pickupLabel}</div>
                    {row.dropoffLabel ? <div className="text-[11px] text-slate-500">To {row.dropoffLabel}</div> : null}
                    <div className="text-[11px] text-slate-400">{formatDateTime(row.startAt)}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatMoney(row.passengerOfferAmount, row.fareCurrency)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.quoteCount || 0}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {row.booking ? (
                      <div>
                        <div>{row.booking.amountLabel || formatMoney(row.booking.amount, row.booking.currency)}</div>
                        <div className="text-[11px] text-slate-500">{row.booking.driverName || '-'}</div>
                        <div className="text-[11px] uppercase text-slate-400">{row.booking.status}</div>
                      </div>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${statusClass(row.status)}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => navigate(`/dashboard/hire-jobs/${row.id}`)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border border-slate-300 bg-white px-4 py-3 text-sm">
        <p className="text-slate-500">
          Page {safePage} of {totalPages} · {total} jobs
        </p>
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value))
              setPage(1)
            }}
            className="rounded border border-slate-300 px-2 py-1"
          >
            {[10, 20, 50].map((size) => (
              <option key={size} value={size}>{size} / page</option>
            ))}
          </select>
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  )
}
