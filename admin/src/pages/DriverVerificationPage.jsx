import { useEffect, useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'
import AdminTabs from '../components/AdminTabs'

function IncomingTabIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M12 4v8m0 0 3-3m-3 3-3-3" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="5" y="14" width="14" height="5" rx="1.5" stroke={color} strokeWidth="1.6" />
    </svg>
  )
}

function VerifiedTabIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.4 3 8.5 7 10 4-1.5 7-5.6 7-10V6l-7-3Z" fill={active ? '#eef2ff' : 'none'} stroke={color} strokeWidth="1.6" />
      <path d="m9.5 12.5 1.6 1.7 3.7-4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AllDriversTabIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="6" height="6" rx="1" fill={color} />
      <rect x="14" y="5" width="6" height="6" rx="1" fill={color} opacity="0.75" />
      <rect x="4" y="13" width="6" height="6" rx="1" fill={color} opacity="0.75" />
      <rect x="14" y="13" width="6" height="6" rx="1" fill={color} />
    </svg>
  )
}

const tabs = [
  { key: 'incoming', label: 'Incoming Verifications', icon: IncomingTabIcon },
  { key: 'verified', label: 'Verified', icon: VerifiedTabIcon },
  { key: 'all', label: 'All Drivers', icon: AllDriversTabIcon },
]

function statusStyle(status) {
  if (status === 'incoming') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
  if (status === 'partial') return 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
  if (status === 'verified') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (status === 'all') return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
  return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
}

function typeStyle(type) {
  if (type === 'vehicle') return 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
  if (type === 'profile_image') return 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
  return 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'
}

function deriveVerificationRow(driver) {
  const profileStatus = driver.profile?.status || null
  const vehicleStatus = driver.vehicle?.status || null
  const profileImageReviewStatus = driver.profileImageReview?.status || null
  const hasIncomingProfile = profileStatus === 'pending' && !!driver.profile?.submittedAt && !!driver.profile?.hasDocuments
  const hasIncomingVehicle = vehicleStatus === 'pending' && !!driver.vehicle?.submittedAt && !!driver.vehicle?.hasDocuments
  const hasIncomingProfileImage = profileImageReviewStatus === 'pending' && !!driver.profileImageReview?.pendingImageUrl
  const hasApprovedProfile = profileStatus === 'approved' && !!driver.profile?.hasDocuments
  const hasApprovedVehicle = vehicleStatus === 'approved' && !!driver.vehicle?.hasDocuments
  const hasIncoming = hasIncomingProfile || hasIncomingVehicle || hasIncomingProfileImage
  const isPartial =
    (driver.profile?.hasDocuments && Number(driver.profile?.missingRequiredCount || 0) > 0) ||
    (driver.vehicle?.hasDocuments && Number(driver.vehicle?.missingRequiredCount || 0) > 0)
  const isVerified = hasApprovedProfile || hasApprovedVehicle
  const verificationType =
    hasIncomingProfileImage
      ? 'profile_image'
      : hasIncomingVehicle || hasApprovedVehicle
      ? 'vehicle'
      : 'identity'
  const verificationLabel = verificationType === 'vehicle'
    ? 'Vehicle Verification'
    : verificationType === 'profile_image'
      ? 'Profile Photo Verification'
      : 'Identity Verification'
  const submittedAt = verificationType === 'vehicle'
    ? driver.vehicle?.submittedAt
    : verificationType === 'profile_image'
      ? driver.profileImageReview?.submittedAt
      : driver.profile?.submittedAt
  const name = driver.email || driver.id

  return {
    id: driver.id,
    name,
    phone: driver.phoneNumber || '-',
    submittedAt: submittedAt || '-',
    verificationType,
    verificationLabel,
    status: hasIncoming ? 'incoming' : isVerified ? 'verified' : isPartial ? 'partial' : 'all',
    raw: driver,
  }
}

function statusLabel(status) {
  if (status === 'incoming') return 'Incoming'
  if (status === 'partial') return 'Partially submitted'
  if (status === 'verified') return 'Verified'
  return 'Not submitted'
}

export default function DriverVerificationPage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const [activeTab, setActiveTab] = useState('incoming')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [appliedTypeFilter, setAppliedTypeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  useEffect(() => {
    const loadDrivers = async () => {
      setLoading(true)
      setError('')
      try {
        const { data } = await axios.get(`${BASE_URL}/api/admin/drivers`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            verificationBucket: activeTab,
            verificationType: appliedTypeFilter,
            search: appliedSearch,
            verificationStatus: 'all',
            page,
            pageSize,
            sortBy: 'createdAt',
            sortOrder: 'desc',
          },
        })

        const driverRows = Array.isArray(data.drivers) ? data.drivers.map(deriveVerificationRow) : []
        setRows(driverRows)
        setTotal(Number(data.total) || 0)
        setTotalPages(Math.max(Number(data.totalPages) || 1, 1))
      } catch (err) {
        setError(err?.response?.data?.error || err?.message || 'Failed to load driver verification queue')
      } finally {
        setLoading(false)
      }
    }

    loadDrivers()
  }, [activeTab, appliedSearch, appliedTypeFilter, page, pageSize, token])

  useEffect(() => {
    setPage(1)
  }, [activeTab, pageSize])

  useEffect(() => {
    setPage(1)
  }, [appliedSearch, appliedTypeFilter])

  const safePage = Math.min(page, totalPages)

  const handleSearch = () => {
    setAppliedSearch(searchInput.trim())
    setAppliedTypeFilter(typeFilter)
    setPage(1)
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-slate-900">Driver Verification</h1>
        <p className="text-xs text-slate-500">Track real driver verification requests from the admin API.</p>
      </div>

      <AdminTabs label="Actions" tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {error ? <p className="border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</p> : null}

      <div className="overflow-hidden border border-slate-300 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
          <input
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search driver, phone, or verification type..."
            className="h-9 w-full max-w-md border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-500"
          />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="h-9 border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-500"
          >
            <option value="all">All types</option>
            <option value="identity">Identity only</option>
            <option value="vehicle">Vehicle only</option>
            <option value="profile_image">Profile photo only</option>
          </select>
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
              <th className="rounded-tl-sm px-4 py-2 font-semibold">Driver</th>
              <th className="px-4 py-2 font-semibold">Phone</th>
              <th className="px-4 py-2 font-semibold">Submitted</th>
              <th className="px-4 py-2 font-semibold">Incoming Type</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="rounded-tr-sm px-4 py-2 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                  Loading verification queue...
                </td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{row.name}</td>
                <td className="px-4 py-3 text-slate-700">{row.phone}</td>
                <td className="px-4 py-3 text-slate-700">{row.submittedAt}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${typeStyle(row.verificationType)}`}>
                    {row.verificationLabel}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyle(row.status)}`}>
                    {statusLabel(row.status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => navigate(`/dashboard/driver-verification/${row.id}`)}
                    title="Review"
                    aria-label="Review"
                    className="inline-flex h-8 w-8 items-center justify-center text-slate-500 transition hover:text-indigo-700"
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">
                      <path d="M1.5 12s3.8-6 10.5-6 10.5 6 10.5 6-3.8 6-10.5 6S1.5 12 1.5 12Z" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="12" r="3" fill="currentColor" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                  No drivers found in this tab.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="text-xs text-slate-500">
          Showing {rows.length} of {total} drivers
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
