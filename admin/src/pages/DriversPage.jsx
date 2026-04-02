import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import { useNavigate } from 'react-router-dom'
import Can from '../components/Can'
import BASE_URL from '../context/Api'
import AdminTabs from '../components/AdminTabs'

const tabs = [
  {
    key: 'all',
    label: 'All Drivers',
    icon: function DriversTabIcon({ active = false }) {
      const color = active ? '#4f46e5' : '#64748b'
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <path d="M7 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" fill={color} />
          <path d="M3.5 20c0-2.1 2-3.5 4.5-3.5s4.5 1.4 4.5 3.5M13.5 19c.3-1.4 1.8-2.5 3.9-2.5 2 0 3.4 1 3.7 2.4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
    },
  },
  {
    key: 'pending',
    label: 'Pending',
    icon: function PendingTabIcon({ active = false }) {
      const color = active ? '#4f46e5' : '#64748b'
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8" stroke={color} strokeWidth="1.7" />
          <path d="M12 8v4l2.5 1.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    },
  },
  {
    key: 'approved',
    label: 'Approved',
    icon: function ApprovedTabIcon({ active = false }) {
      const color = active ? '#4f46e5' : '#64748b'
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8" stroke={color} strokeWidth="1.7" />
          <path d="m8.5 12 2.3 2.4 4.7-5" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    },
  },
  {
    key: 'rejected',
    label: 'Rejected',
    icon: function RejectedTabIcon({ active = false }) {
      const color = active ? '#4f46e5' : '#64748b'
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8" stroke={color} strokeWidth="1.7" />
          <path d="m9 9 6 6M15 9l-6 6" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      )
    },
  },
]

function badgeClass(status) {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (status === 'rejected') return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
  return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
}

function formatJoined(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function getDriverName(driver) {
  const fullName = [driver?.firstName, driver?.lastName].filter(Boolean).join(' ').trim()
  if (fullName) return fullName
  if (driver?.email) return driver.email
  return 'Unknown driver'
}

export default function DriversPage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const [activeTab, setActiveTab] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [drivers, setDrivers] = useState([])

  const loadDrivers = async () => {
    setLoading(true)
    setError('')

    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/drivers`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          verificationStatus: activeTab,
          search: search || undefined,
          sortBy,
          sortOrder,
          page,
          pageSize,
        },
      })

      setDrivers(data.drivers || [])
      setTotalPages(data.totalPages || 1)
      setTotal(data.total || 0)
    } catch (err) {
      const apiError = err?.response?.data?.error
      setError(apiError || err?.message || 'Failed to load drivers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDrivers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTab, search, sortBy, sortOrder, page, pageSize])

  const rows = useMemo(() => drivers, [drivers])
  const approvedCount = useMemo(() => rows.filter((driver) => driver.profile?.status === 'approved').length, [rows])
  const pendingCount = useMemo(
    () => rows.filter((driver) => ['pending', 'partially_submitted'].includes(driver.profile?.status)).length,
    [rows],
  )
  const verifiedPhoneCount = useMemo(() => rows.filter((driver) => driver.phoneVerified).length, [rows])

  const handleDelete = async (driverId) => {
    const confirmed = window.confirm('Delete this driver account permanently?')
    if (!confirmed) return

    try {
      await axios.delete(`${BASE_URL}/api/admin/drivers/${driverId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      await loadDrivers()
    } catch (err) {
      const apiError = err?.response?.data?.error
      setError(apiError || err?.message || 'Failed to delete driver')
    }
  }

  const exportCsv = async () => {
    try {
      const response = await axios.get(`${BASE_URL}/api/admin/drivers/export.csv`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          verificationStatus: activeTab,
          search: search || undefined,
        },
        responseType: 'blob',
      })

      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }))
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = `drivers_export_${Date.now()}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(blobUrl)
    } catch (err) {
      const apiError = err?.response?.data?.error
      setError(apiError || err?.message || 'Failed to export drivers CSV')
    }
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Users / Drivers</p>
        <div className="mt-1 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Drivers</h1>
            <p className="text-xs text-slate-500">Manage driver accounts, verification progress, and vehicle onboarding.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Loaded</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{rows.length}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Approved</p>
              <p className="mt-1 text-lg font-semibold text-emerald-700">{approvedCount}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Pending</p>
              <p className="mt-1 text-lg font-semibold text-amber-700">{pendingCount}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Phone OK</p>
              <p className="mt-1 text-lg font-semibold text-indigo-700">{verifiedPhoneCount}</p>
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
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_116px_88px_110px]">
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
                placeholder="Search name, car, plate, email, phone, clerk id..."
                className="h-10 w-full border border-slate-300 bg-white pl-9 pr-3 text-xs outline-none focus:border-indigo-500"
              />
            </div>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="h-10 border border-slate-300 bg-white px-2 text-xs"
            >
              <option value="createdAt">Joined</option>
              <option value="email">Email</option>
              <option value="profileStatus">Profile status</option>
              <option value="vehicleStatus">Vehicle status</option>
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

          <div className="flex h-10 items-center justify-between gap-3 border border-slate-200 bg-slate-50 px-3 xl:min-w-[220px] xl:justify-end">
            <div className="whitespace-nowrap text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">{total}</span> total drivers
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
                <th className="px-4 py-3 font-semibold">Profile Status</th>
                <th className="px-4 py-3 font-semibold">Vehicle Status</th>
                <th className="px-4 py-3 font-semibold">Vehicle</th>
                <th className="px-4 py-3 font-semibold">Joined</th>
                <th className="rounded-tr-sm px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">Loading drivers...</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">No drivers found.</td>
                </tr>
              ) : (
                rows.map((driver) => (
                  <tr key={driver.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <p className="font-medium text-slate-800">{getDriverName(driver)}</p>
                        <p className="text-[11px] text-slate-400">{driver.id || '-'}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {driver.profile ? (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeClass(driver.profile.status)}`}>
                          {driver.profile.status}
                        </span>
                      ) : (
                        <span className="text-slate-400">Not submitted</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {driver.vehicle ? (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeClass(driver.vehicle.status)}`}>
                          {driver.vehicle.status}
                        </span>
                      ) : (
                        <span className="text-slate-400">Not submitted</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {driver.vehicle ? `${driver.vehicle.make || ''} ${driver.vehicle.model || ''} ${driver.vehicle.numberPlate ? `(${driver.vehicle.numberPlate})` : ''}`.trim() : '-'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatJoined(driver.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => navigate(`/dashboard/drivers/${driver.id}`, { state: { driver } })}
                          className="text-slate-700 transition hover:text-indigo-600"
                          title="View"
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" stroke="currentColor" strokeWidth="1.8" />
                            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                          </svg>
                        </button>
                        <Can
                          permission="drivers.delete"
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
                            onClick={() => handleDelete(driver.id)}
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
          <p>Showing {rows.length} of {total} drivers</p>
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
