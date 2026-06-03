import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import Can from '../components/Can'
import BASE_URL from '../context/Api'
import AdminTabs from '../components/AdminTabs'

const tabs = [
  { key: 'all', label: 'All Passengers' },
  { key: 'active', label: 'Active' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'blocked', label: 'Blocked' },
]

function statusClass(status) {
  if (status === 'active') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (status === 'blocked') return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
  return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
}

function identityClass(status) {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (status === 'rejected') return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
  if (status === 'pending') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
  return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
}

function formatJoined(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function getPassengerName(passenger) {
  const fullName = passenger?.fullName || [passenger?.firstName, passenger?.lastName].filter(Boolean).join(' ').trim()
  return fullName || passenger?.email || 'Unknown passenger'
}

export default function PassengersPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState('desc')
  const [identityFilter, setIdentityFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [passengers, setPassengers] = useState([])

  const loadPassengers = async () => {
    setLoading(true)
    setError('')

    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/passengers`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          status: activeTab,
          identityStatus: identityFilter,
          search: search || undefined,
          sortBy,
          sortOrder,
          page,
          pageSize,
        },
      })
      setPassengers(data.passengers || [])
      setTotalPages(data.totalPages || 1)
      setTotal(data.total || 0)
    } catch (err) {
      const apiError = err?.response?.data?.error
      setError(apiError || err?.message || 'Failed to load passengers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPassengers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTab, identityFilter, search, sortBy, sortOrder, page, pageSize])

  const rows = useMemo(() => passengers, [passengers])
  const activeCount = useMemo(() => rows.filter((passenger) => passenger.status === 'active').length, [rows])
  const flaggedCount = useMemo(() => rows.filter((passenger) => passenger.status === 'flagged').length, [rows])
  const verifiedIdentityCount = useMemo(
    () => rows.filter((passenger) => passenger.passengerIdentity?.status === 'approved').length,
    [rows],
  )
  const pendingIdentityCount = useMemo(
    () => rows.filter((passenger) => passenger.passengerIdentity?.status === 'pending').length,
    [rows],
  )

  const handleDelete = async (passengerId) => {
    const confirmed = window.confirm('Delete this passenger account permanently?')
    if (!confirmed) return

    try {
      await axios.delete(`${BASE_URL}/api/admin/passengers/${passengerId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      await loadPassengers()
    } catch (err) {
      const apiError = err?.response?.data?.error
      setError(apiError || err?.message || 'Failed to delete passenger')
    }
  }

  const exportCsv = async () => {
    try {
      const response = await axios.get(`${BASE_URL}/api/admin/passengers/export.csv`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          status: activeTab,
          identityStatus: identityFilter,
          search: search || undefined,
        },
        responseType: 'blob',
      })

      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }))
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = `passengers_export_${Date.now()}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(blobUrl)
    } catch (err) {
      const apiError = err?.response?.data?.error
      setError(apiError || err?.message || 'Failed to export passengers CSV')
    }
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Users / Passengers</p>
        <div className="mt-1 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Passengers</h1>
            <p className="text-xs text-slate-500">Manage passenger accounts, account state, and identity verification.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Loaded</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{rows.length}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Active</p>
              <p className="mt-1 text-lg font-semibold text-emerald-700">{activeCount}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Flagged</p>
              <p className="mt-1 text-lg font-semibold text-amber-700">{flaggedCount}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">ID Pending</p>
              <p className="mt-1 text-lg font-semibold text-amber-700">{pendingIdentityCount}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">ID OK</p>
              <p className="mt-1 text-lg font-semibold text-indigo-700">{verifiedIdentityCount}</p>
            </div>
          </div>
        </div>
      </div>

      <AdminTabs
        label="Views"
        tabs={tabs}
        activeTab={activeTab}
        onChange={(key) => {
          setActiveTab(key)
          setPage(1)
        }}
      />

      <div className="border border-slate-300 bg-white px-4 py-3">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_140px_116px_88px_110px]">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                  <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" />
                  <path d="m20 20-4.2-4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              <input
                type="text"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search name, email, phone, passenger id..."
                className="h-10 w-full border border-slate-300 bg-white pl-9 pr-3 text-xs outline-none focus:border-indigo-500"
              />
            </div>
            <select
              value={identityFilter}
              onChange={(event) => {
                setIdentityFilter(event.target.value)
                setPage(1)
              }}
              className="h-10 border border-slate-300 bg-white px-2 text-xs"
            >
              <option value="all">All identity</option>
              <option value="pending">Pending review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="not_submitted">Not submitted</option>
            </select>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="h-10 border border-slate-300 bg-white px-2 text-xs"
            >
              <option value="createdAt">Joined</option>
              <option value="email">Email</option>
              <option value="status">Status</option>
              <option value="totalRides">Total rides</option>
              <option value="totalSpend">Total spend</option>
            </select>
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              className="h-10 border border-slate-300 bg-white px-2 text-xs"
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
            <button
              type="button"
              onClick={() => {
                setSearch(searchInput.trim())
                setPage(1)
              }}
              className="h-10 bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Search
            </button>
          </div>

          <div className="flex h-10 items-center justify-between gap-3 border border-slate-200 bg-slate-50 px-3 xl:min-w-[236px] xl:justify-end">
            <div className="whitespace-nowrap text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">{total}</span> total passengers
            </div>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex h-10 items-center gap-2 bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v2h14v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {error ? <p className="border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</p> : null}

      <div className="overflow-hidden border border-slate-300 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#0f172a] text-left text-[11px] uppercase tracking-wide text-slate-200">
                <th className="rounded-tl-sm px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Identity</th>
                <th className="px-4 py-3 font-semibold">Total Rides</th>
                <th className="px-4 py-3 font-semibold">Total Spend</th>
                <th className="px-4 py-3 font-semibold">Last Ride</th>
                <th className="px-4 py-3 font-semibold">Joined</th>
                <th className="rounded-tr-sm px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">Loading passengers...</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">No passengers found.</td>
                </tr>
              ) : (
                rows.map((passenger) => (
                  <tr key={passenger.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <p className="font-medium text-slate-800">{getPassengerName(passenger)}</p>
                        <p className="text-[11px] text-slate-400">{passenger.id || '-'}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass(passenger.status)}`}>
                        {passenger.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${identityClass(passenger.passengerIdentity?.status || 'not_submitted')}`}>
                          {passenger.passengerIdentity?.status || 'not_submitted'}
                        </span>
                        {passenger.passengerIdentity?.submittedAt ? (
                          <p className="text-[11px] text-slate-400">
                            Submitted {formatJoined(passenger.passengerIdentity.submittedAt)}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{passenger.totalRides}</td>
                    <td className="px-4 py-3 text-slate-700">${Number(passenger.totalSpend || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-slate-700">{passenger.lastRideAt ? formatJoined(passenger.lastRideAt) : '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{formatJoined(passenger.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => navigate(`/dashboard/passengers/${passenger.id}`, { state: { passenger } })}
                          className="text-slate-700 transition hover:text-indigo-600"
                          title={passenger.passengerIdentity?.status === 'pending' ? 'Review verification' : 'View'}
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" stroke="currentColor" strokeWidth="1.8" />
                            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                          </svg>
                        </button>
                        <Can
                          permission="passengers.delete"
                          fallback={
                            <button
                              type="button"
                              disabled
                              className="cursor-not-allowed text-rose-300"
                              title="Delete"
                            >
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                              </svg>
                            </button>
                          }
                        >
                          <button
                            type="button"
                            onClick={() => handleDelete(passenger.id)}
                            className="text-rose-600 transition hover:text-rose-500"
                            title="Delete"
                          >
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                          </button>
                        </Can>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
          <p>Showing {rows.length} of {total} passengers</p>
          <div className="flex items-center gap-2">
            <label className="text-xs">Page size</label>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
              className="h-8 border border-slate-300 bg-white px-2 text-xs"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
              disabled={page <= 1}
              className="h-8 border border-slate-300 px-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Prev
            </button>
            <span>Page {page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
              disabled={page >= totalPages}
              className="h-8 border border-slate-300 px-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
