import { useEffect, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

export default function SmileCashPayoutsPage() {
  const { token, can, admin } = useAuth()
  const canManage = admin?.role === 'super_admin' || can('payouts.manage')
  const [payouts, setPayouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [driverUserId, setDriverUserId] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [narration, setNarration] = useState('Trust Express payout')
  const [submitting, setSubmitting] = useState(false)
  const [onlinePreview, setOnlinePreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [authorizingOnline, setAuthorizingOnline] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      setError('')
      const res = await axios.get(`${BASE_URL}/api/admin/smile-cash/payouts`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setPayouts(res.data?.payouts || [])
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load payouts')
    } finally {
      setLoading(false)
    }
  }

  const loadOnlinePreview = async () => {
    try {
      setPreviewLoading(true)
      const res = await axios.get(`${BASE_URL}/api/admin/smile-cash/online-payouts/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setOnlinePreview(res.data)
    } catch (err) {
      window.alert(err?.response?.data?.error || err.message || 'Could not load online payout preview')
    } finally {
      setPreviewLoading(false)
    }
  }

  const authorizeOnlinePayouts = async () => {
    const confirmation = window.prompt('Type AUTHORIZE to send all withdrawable online passenger-payment earnings to driver Smile Cash wallets.')
    if (String(confirmation || '').trim().toUpperCase() !== 'AUTHORIZE') return
    try {
      setAuthorizingOnline(true)
      const res = await axios.post(
        `${BASE_URL}/api/admin/smile-cash/online-payouts/authorize`,
        { confirmation: 'AUTHORIZE' },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setOnlinePreview(res.data)
      await load()
      window.alert(`Online payouts complete. Success: ${res.data?.summary?.success || 0}. Failed: ${res.data?.summary?.failed || 0}.`)
    } catch (err) {
      window.alert(err?.response?.data?.error || err.message || 'Could not authorize online payouts')
    } finally {
      setAuthorizingOnline(false)
    }
  }

  useEffect(() => {
    if (token) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const submit = async (e) => {
    e.preventDefault()
    try {
      setSubmitting(true)
      await axios.post(
        `${BASE_URL}/api/admin/smile-cash/payouts`,
        {
          driverUserId: driverUserId.trim(),
          amount: Number(amount),
          currency,
          narration,
          purpose: 'manual',
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setAmount('')
      await load()
    } catch (err) {
      window.alert(err?.response?.data?.error || err.message || 'Payout failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Smile Cash payouts</h1>
        <p className="mt-1 text-sm text-slate-500">
          Disburse funds from the Trust Express ZB account into a captain’s Smile Cash wallet.
        </p>
      </div>

      {canManage ? (
        <>
          <div className="border border-blue-100 bg-blue-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Monday online passenger-payment payouts</p>
                <p className="mt-1 text-xs text-slate-600">
                  Admin authorization is required before batch payouts leave Trust Express.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={loadOnlinePreview}
                  disabled={previewLoading}
                  className="rounded border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-60"
                >
                  {previewLoading ? 'Loading…' : 'Preview batch'}
                </button>
                <button
                  type="button"
                  onClick={authorizeOnlinePayouts}
                  disabled={authorizingOnline || !onlinePreview?.summary?.totalDrivers}
                  className="rounded bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {authorizingOnline ? 'Authorizing…' : 'Authorize payouts'}
                </button>
              </div>
            </div>
            {onlinePreview ? (
              <div className="mt-3 rounded bg-white px-3 py-2 text-xs text-slate-700">
                {onlinePreview.skipped ? (
                  <span>Batch skipped because today is not Monday.</span>
                ) : (
                  <span>
                    {onlinePreview.summary?.totalDrivers || 0} driver(s), USD {Number(onlinePreview.summary?.totalAmount || 0).toFixed(2)} ready.
                  </span>
                )}
              </div>
            ) : null}
          </div>

          <form onSubmit={submit} className="grid gap-3 border border-slate-200 bg-white p-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Driver user id (Clerk)</span>
              <input
                value={driverUserId}
                onChange={(e) => setDriverUserId(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2"
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Amount</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                step="0.01"
                min="0.01"
                className="w-full rounded border border-slate-300 px-3 py-2"
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Currency</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2"
              >
                <option value="USD">USD</option>
                <option value="ZWG">ZWG</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Narration</span>
              <input
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {submitting ? 'Sending…' : 'Send Smile Cash payout'}
              </button>
            </div>
          </form>
        </>
      ) : null}

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}

      <div className="overflow-x-auto border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Driver</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Mobile</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">{item.publicId}</td>
                <td className="px-3 py-2 text-slate-700">{item.driverName || item.driverUserId}</td>
                <td className="px-3 py-2 text-slate-700">{item.currency} {Number(item.amount).toFixed(2)}</td>
                <td className="px-3 py-2 text-slate-700">{item.receiverMobile}</td>
                <td className="px-3 py-2 text-slate-700">{item.status}</td>
                <td className="px-3 py-2 text-slate-500">
                  {item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}
                </td>
              </tr>
            ))}
            {!loading && payouts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-slate-500">No Smile Cash payouts yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
