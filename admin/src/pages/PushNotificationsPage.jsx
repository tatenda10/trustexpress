import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function audienceLabel(value) {
  if (value === 'drivers') return 'Drivers'
  if (value === 'passengers') return 'Passengers'
  return 'Everyone'
}

export default function PushNotificationsPage() {
  const { token, can, admin } = useAuth()
  const canManage = admin?.role === 'super_admin' || can('notifications.manage')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const [audience, setAudience] = useState('drivers')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [broadcasts, setBroadcasts] = useState([])

  const loadHistory = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/notifications`, { headers })
      setBroadcasts(Array.isArray(data?.broadcasts) ? data.broadcasts : [])
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load notification history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const sendBroadcast = async (event) => {
    event.preventDefault()
    if (!canManage) return
    setSending(true)
    setError('')
    setSuccess('')
    try {
      const { data } = await axios.post(
        `${BASE_URL}/api/admin/notifications`,
        { audience, title: title.trim(), body: body.trim() },
        { headers }
      )
      setTitle('')
      setBody('')
      setSuccess(
        `Sent to ${audienceLabel(audience).toLowerCase()}: ${Number(data?.expoSent || 0) + Number(data?.fcmSent || 0)} devices.`
      )
      await loadHistory()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to send notification')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Operations</p>
        <h1 className="text-xl font-semibold text-slate-900">Push Notifications</h1>
        <p className="mt-1 text-xs text-slate-500">
          Send a message to driver phones, passenger phones, or everyone who has the app installed.
        </p>
      </div>

      {error ? <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
      {success ? <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div> : null}

      <form onSubmit={sendBroadcast} className="border border-slate-300 bg-white px-4 py-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Audience</span>
            <select
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="drivers">Drivers</option>
              <option value="passengers">Passengers</option>
              <option value="all">Everyone</option>
            </select>
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={80}
              placeholder="Trust Express update"
              className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <label className="mt-3 block text-sm">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Message</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={400}
            rows={4}
            placeholder="Write the notification drivers or passengers should see."
            className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={!canManage || sending || !title.trim() || !body.trim()}
          className="mt-3 rounded-md bg-[#6f54ff] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          {sending ? 'Sending...' : 'Send push notification'}
        </button>
      </form>

      <div className="border border-slate-300 bg-white px-4 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recent broadcasts</p>
        {loading ? (
          <p className="mt-2 text-sm text-slate-500">Loading history...</p>
        ) : broadcasts.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2 pr-4">Sent</th>
                  <th className="pb-2 pr-4">Audience</th>
                  <th className="pb-2 pr-4">Title</th>
                  <th className="pb-2">Devices</th>
                </tr>
              </thead>
              <tbody>
                {broadcasts.map((item) => (
                  <tr key={item.id} className="border-t border-slate-200">
                    <td className="py-2 pr-4 text-slate-600">{formatDateTime(item.createdAt)}</td>
                    <td className="py-2 pr-4">{audienceLabel(item.audience)}</td>
                    <td className="py-2 pr-4">
                      <p className="font-medium text-slate-900">{item.title}</p>
                      <p className="text-xs text-slate-500">{item.body}</p>
                    </td>
                    <td className="py-2 text-slate-700">{Number(item.expoSent || 0) + Number(item.fcmSent || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No broadcasts yet.</p>
        )}
      </div>
    </section>
  )
}
