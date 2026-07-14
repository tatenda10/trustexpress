import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import axios from 'axios'
import { toast } from 'react-toastify'
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

function StatCard({ label, value }) {
  return (
    <div className="min-w-[140px] border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  )
}

export default function PassengerReferralDetailPage() {
  const { referrerUserId } = useParams()
  const { token } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  const headers = useMemo(() => ({
    Authorization: `Bearer ${token}`,
  }), [token])

  const loadDetail = async () => {
    setLoading(true)
    try {
      const { data: response } = await axios.get(
        `${BASE_URL}/api/admin/passenger-referrals/${encodeURIComponent(referrerUserId)}`,
        { headers }
      )
      setData(response)
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to load referral detail')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token || !referrerUserId) return
    loadDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, referrerUserId])

  const referrer = data?.referrer
  const stats = data?.stats
  const referrals = Array.isArray(data?.referrals) ? data.referrals : []

  return (
    <div className="space-y-4">
      <div>
        <Link to="/dashboard/passenger-referrals" className="text-sm font-semibold text-indigo-700 hover:text-indigo-500">
          Back to passenger referrals
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">
          {loading ? 'Loading referrer...' : (referrer?.fullName || 'Referrer detail')}
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Drill-down for one passenger referrer and everyone they brought in.
        </p>
      </div>

      {loading ? (
        <div className="border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">Loading...</div>
      ) : !data ? (
        <div className="border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-700">
          Referrer detail could not be loaded.
        </div>
      ) : (
        <>
          <div className="border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Referrer</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{referrer?.fullName || '-'}</p>
                <p className="mt-1 text-sm text-slate-600">{referrer?.email || 'No email on file'}</p>
                <p className="mt-1 text-[11px] text-slate-400">{referrer?.id}</p>
                {referrer?.phoneNumber ? (
                  <p className="mt-1 text-sm text-slate-600">{referrer.phoneNumber}</p>
                ) : null}
              </div>
              <Link
                to={`/dashboard/passengers/${encodeURIComponent(referrer?.id || referrerUserId)}`}
                className="border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                Open passenger profile
              </Link>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <StatCard label="People referred" value={stats?.totalReferrals ?? 0} />
              <StatCard label="First referral" value={formatDateTime(stats?.firstReferralAt)} />
              <StatCard label="Latest referral" value={formatDateTime(stats?.lastReferralAt)} />
            </div>

            {data?.referredBy ? (
              <div className="mt-4 border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This passenger was also referred by{' '}
                <Link
                  to={`/dashboard/passenger-referrals/${encodeURIComponent(data.referredBy.referrerUserId)}`}
                  className="font-semibold underline"
                >
                  {data.referredBy.referrerName || data.referredBy.referrerEmail || data.referredBy.referrerUserId}
                </Link>
                {data.referredBy.createdAt ? ` on ${formatDateTime(data.referredBy.createdAt)}` : ''}.
              </div>
            ) : null}
          </div>

          <div className="overflow-hidden border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Referred passengers</h2>
              <p className="mt-0.5 text-xs text-slate-500">{referrals.length} people referred by this passenger</p>
            </div>
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Passenger</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <th className="px-4 py-3 font-semibold">Referred at</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {referrals.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">
                      This passenger has not referred anyone yet.
                    </td>
                  </tr>
                ) : (
                  referrals.map((item) => (
                    <tr key={item.id || item.referredUserId} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{item.fullName || 'Unknown passenger'}</div>
                        <div className="mt-0.5 text-[11px] text-slate-400">{item.referredUserId}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{item.email || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{item.source || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{formatDateTime(item.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            to={`/dashboard/passengers/${encodeURIComponent(item.referredUserId)}`}
                            className="border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Passenger
                          </Link>
                          <Link
                            to={`/dashboard/passenger-referrals/${encodeURIComponent(item.referredUserId)}`}
                            className="border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                          >
                            Their referrals
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
