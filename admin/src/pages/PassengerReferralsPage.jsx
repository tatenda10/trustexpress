import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

function formatDateTime(value) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleString('en-ZW', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatCard({ label, value, hint }) {
  return (
    <div className="min-w-[140px] border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  )
}

export default function PassengerReferralsPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('referralCount')
  const [sortOrder, setSortOrder] = useState('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState(null)
  const [referrers, setReferrers] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const headers = useMemo(() => ({
    Authorization: `Bearer ${token}`,
  }), [token])

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timeout)
  }, [searchInput])

  const loadReferrals = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/passenger-referrals`, {
        headers,
        params: {
          search: search || undefined,
          sortBy,
          sortOrder,
          page,
          pageSize,
        },
      })
      setSummary(data?.summary || null)
      setReferrers(Array.isArray(data?.referrers) ? data.referrers : [])
      setTotal(Number(data?.total || 0))
      setTotalPages(Math.max(1, Number(data?.totalPages || 1)))
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load passenger referrals')
      setReferrers([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    loadReferrals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, search, sortBy, sortOrder, page, pageSize])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Passenger referrals</h1>
          <p className="mt-1 text-xs text-slate-500">
            See how many passengers joined through peer referrals, then drill into each referrer.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <StatCard
          label="Referred passengers"
          value={summary?.totalReferredPassengers ?? '-'}
          hint="Accounts that came via a friend referral"
        />
        <StatCard
          label="Active referrers"
          value={summary?.totalReferrers ?? '-'}
          hint="Passengers who have referred at least one person"
        />
        {(summary?.bySource || []).map((item) => (
          <StatCard
            key={item.source}
            label={`Source: ${item.source}`}
            value={item.count}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 border border-slate-200 bg-white p-3">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search referrer name, email, or user id"
          className="min-w-[240px] flex-1 border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400"
        />
        <select
          value={sortBy}
          onChange={(event) => {
            setSortBy(event.target.value)
            setPage(1)
          }}
          className="border border-slate-200 px-3 py-2 text-sm text-slate-800"
        >
          <option value="referralCount">Sort by referrals</option>
          <option value="lastReferralAt">Sort by latest referral</option>
          <option value="name">Sort by name</option>
          <option value="email">Sort by email</option>
        </select>
        <select
          value={sortOrder}
          onChange={(event) => {
            setSortOrder(event.target.value)
            setPage(1)
          }}
          className="border border-slate-200 px-3 py-2 text-sm text-slate-800"
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
        <select
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value))
            setPage(1)
          }}
          className="border border-slate-200 px-3 py-2 text-sm text-slate-800"
        >
          <option value={10}>10 / page</option>
          <option value={20}>20 / page</option>
          <option value={50}>50 / page</option>
        </select>
      </div>

      {error ? (
        <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="overflow-hidden border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Referrer</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">People referred</th>
              <th className="px-4 py-3 font-semibold">First referral</th>
              <th className="px-4 py-3 font-semibold">Latest referral</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">Loading referrals...</td>
              </tr>
            ) : referrers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">No passenger referrals found.</td>
              </tr>
            ) : (
              referrers.map((referrer) => (
                <tr key={referrer.referrerUserId} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{referrer.fullName || 'Unknown passenger'}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{referrer.referrerUserId}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{referrer.email || '-'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
                      {referrer.referralCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(referrer.firstReferralAt)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(referrer.lastReferralAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/dashboard/passenger-referrals/${encodeURIComponent(referrer.referrerUserId)}`)}
                        className="border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        View referrals
                      </button>
                      <Link
                        to={`/dashboard/passengers/${encodeURIComponent(referrer.referrerUserId)}`}
                        className="border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                      >
                        Passenger
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <p>Showing {referrers.length} of {total} referrers</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40"
          >
            Previous
          </button>
          <span>Page {page} / {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            className="border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
