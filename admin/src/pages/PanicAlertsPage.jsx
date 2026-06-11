import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import BASE_URL from '../context/Api'
import { useAuth } from '../authcontext/AuthContext'

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function statusBadge(status) {
  if (status === 'resolved') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (status === 'reviewed') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
  return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
}

function priorityBadge(priority) {
  if (priority === 'critical') return 'bg-rose-100 text-rose-800 ring-1 ring-rose-200'
  return 'bg-orange-100 text-orange-800 ring-1 ring-orange-200'
}

export default function PanicAlertsPage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

  const loadAlerts = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/rides/panic-alerts`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          status: statusFilter,
          search: appliedSearch,
        },
      })
      setAlerts(Array.isArray(data?.panicAlerts) ? data.panicAlerts : [])
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load panic alerts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAlerts()
  }, [token, statusFilter, appliedSearch])

  const updateAlert = async (alert, patch) => {
    if (!token || !alert?.id) return
    setSavingId(String(alert.id))
    setError('')
    try {
      await axios.patch(`${BASE_URL}/api/admin/rides/panic-alerts/${alert.id}`, patch, {
        headers: { Authorization: `Bearer ${token}` },
      })
      await loadAlerts()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to update panic alert')
    } finally {
      setSavingId('')
    }
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-slate-800">Panic Alerts</h1>
        <p className="text-xs text-slate-500">Safety CRM for incoming driver and passenger emergency alerts.</p>
      </div>

      {error ? <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div> : null}

      <div className="border border-slate-300 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search rider, driver, ride, route, or case..."
              className="h-9 w-full max-w-md border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-500"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-500"
            >
              <option value="open">Open only</option>
              <option value="reviewed">Reviewed only</option>
              <option value="resolved">Resolved only</option>
              <option value="all">All alerts</option>
            </select>
            <button
              type="button"
              onClick={() => setAppliedSearch(searchInput.trim())}
              className="h-9 border border-indigo-600 bg-indigo-600 px-4 text-xs font-medium text-white transition hover:bg-indigo-700"
            >
              Search
            </button>
          </div>
          <div className="text-xs text-slate-500">{alerts.length} alert{alerts.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="border border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">Loading panic alerts...</div>
        ) : alerts.length === 0 ? (
          <div className="border border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">No panic alerts found.</div>
        ) : (
          alerts.map((alert) => (
            <article key={alert.id} className="border border-slate-300 bg-white px-4 py-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium uppercase ${statusBadge(alert.status)}`}>
                      {alert.status}
                    </span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium uppercase ${priorityBadge(alert.casePriority)}`}>
                      {alert.casePriority || 'critical'}
                    </span>
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase text-slate-600">
                      {alert.followUpStatus || 'pending'}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-slate-500">
                      {alert.actorRole} alert
                    </span>
                  </div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {alert.actorName || alert.actorRole} on {alert.ridePublicId || `ride #${alert.rideRequestId}`}
                  </h2>
                  <p className="text-xs text-slate-500">{formatDateTime(alert.createdAt)}</p>
                  <p className="text-sm text-slate-700">{alert.message || 'Panic alert sent.'}</p>
                  <div className="grid gap-2 text-xs text-slate-500 md:grid-cols-2">
                    <p>Rider: {alert.rider}</p>
                    <p>Driver: {alert.driver}</p>
                    <p>Route: {alert.route}</p>
                    <p>Stage: {alert.alertStage || '-'}</p>
                    <p>Case ref: {alert.caseReference || '-'}</p>
                    <p>
                      Coordinates:{' '}
                      {alert.latitude !== null && alert.longitude !== null ? `${alert.latitude}, ${alert.longitude}` : '-'}
                    </p>
                  </div>
                  {alert.followUpNote ? (
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      Follow-up note: {alert.followUpNote}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2 xl:min-w-[220px]">
                  <button
                    type="button"
                    onClick={() => navigate(`/dashboard/ride-operations/${alert.ridePublicId || alert.rideRequestId}`)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Open ride case
                  </button>
                  <button
                    type="button"
                    disabled={savingId === String(alert.id)}
                    onClick={() => updateAlert(alert, { status: 'reviewed', followUpStatus: 'monitoring' })}
                    className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    Mark reviewing
                  </button>
                  <button
                    type="button"
                    disabled={savingId === String(alert.id)}
                    onClick={() => updateAlert(alert, { followUpStatus: 'police_alerted', casePriority: 'critical' })}
                    className="rounded-md bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    Police alerted
                  </button>
                  <button
                    type="button"
                    disabled={savingId === String(alert.id)}
                    onClick={() => {
                      const followUpNote = window.prompt('Add follow-up note', alert.followUpNote || '')
                      if (followUpNote === null) return
                      updateAlert(alert, {
                        status: 'resolved',
                        followUpStatus: 'resolved',
                        followUpNote,
                      })
                    }}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    Resolve case
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
