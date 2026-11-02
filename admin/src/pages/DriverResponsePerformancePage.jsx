import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import BASE_URL from '../context/Api'
import { useAuth } from '../authcontext/AuthContext'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export default function DriverResponsePerformancePage() {
  const { token, can, admin } = useAuth()
  const canManage = admin?.role === 'super_admin' || can('account_restrictions.manage')
  const [settings, setSettings] = useState({
    isEnabled: true,
    missedThreshold: 7,
    windowHours: 24,
    restrictionDurationHours: 12,
    restrictionScope: 'accept_rides',
  })
  const [drivers, setDrivers] = useState([])
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/driver-response-policy`, { headers })
      setSettings(data?.settings || settings)
      setDrivers(Array.isArray(data?.drivers) ? data.drivers : [])
      setActions(Array.isArray(data?.actions) ? data.actions : [])
    } catch (requestError) {
      setError(requestError?.response?.data?.error || requestError?.message || 'Failed to load driver response data')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const save = async (event) => {
    event.preventDefault()
    if (!canManage) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const { data } = await axios.put(`${BASE_URL}/api/admin/driver-response-policy/settings`, settings, { headers })
      setSettings(data?.settings || settings)
      setSuccess('Driver response policy saved.')
      await load()
    } catch (requestError) {
      setError(requestError?.response?.data?.error || requestError?.message || 'Failed to save policy')
    } finally {
      setSaving(false)
    }
  }

  const updateNumber = (key, value) => setSettings((current) => ({ ...current, [key]: Number(value) }))

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-slate-800">Driver Response Performance</h1>
        <p className="text-xs text-slate-500">See which drivers received and opened requests, and configure automatic ride restrictions.</p>
      </div>

      {error ? <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div> : null}
      {success ? <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{success}</div> : null}

      <form onSubmit={save} className="border border-slate-300 bg-white p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Automatic restriction rule</h2>
            <p className="text-xs text-slate-500">Only requests actually opened in the app count. Delivered requests that were never opened do not count.</p>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={Boolean(settings.isEnabled)} onChange={(event) => setSettings((current) => ({ ...current, isEnabled: event.target.checked }))} />
            Enabled
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Opened but not taken
            <input type="number" min="1" max="100" value={settings.missedThreshold} onChange={(event) => updateNumber('missedThreshold', event.target.value)} className="mt-1 h-9 w-full border border-slate-300 px-3 text-slate-800" />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Within hours
            <input type="number" min="1" max="720" value={settings.windowHours} onChange={(event) => updateNumber('windowHours', event.target.value)} className="mt-1 h-9 w-full border border-slate-300 px-3 text-slate-800" />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Block duration hours
            <input type="number" min="1" max="720" value={settings.restrictionDurationHours} onChange={(event) => updateNumber('restrictionDurationHours', event.target.value)} className="mt-1 h-9 w-full border border-slate-300 px-3 text-slate-800" />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Restriction
            <select value={settings.restrictionScope} onChange={(event) => setSettings((current) => ({ ...current, restrictionScope: event.target.value }))} className="mt-1 h-9 w-full border border-slate-300 px-3 text-slate-800">
              <option value="accept_rides">Cannot accept rides</option>
              <option value="go_online">Cannot go online</option>
              <option value="all">Block all app activity</option>
            </select>
          </label>
        </div>
        {canManage ? <button disabled={saving} className="mt-4 bg-slate-950 px-5 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save policy'}</button> : null}
      </form>

      <div className="overflow-x-auto border border-slate-300 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">Current {settings.windowHours}-hour activity</div>
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-950 text-white"><tr>
            <th className="px-4 py-3">Driver</th><th className="px-4 py-3">Received</th><th className="px-4 py-3">Opened</th><th className="px-4 py-3">Accepted</th><th className="px-4 py-3">Opened, not taken</th><th className="px-4 py-3">Acceptance</th><th className="px-4 py-3">Last opened</th><th className="px-4 py-3">Status</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {drivers.map((driver) => <tr key={driver.driverUserId}>
              <td className="px-4 py-3"><div className="font-semibold text-slate-800">{driver.driverName}</div><div className="text-slate-500">{driver.email || driver.driverUserId}</div></td>
              <td className="px-4 py-3">{driver.receivedCount}</td><td className="px-4 py-3">{driver.openedCount}</td><td className="px-4 py-3">{driver.acceptedCount}</td><td className="px-4 py-3 font-semibold text-rose-700">{driver.missedCount}</td><td className="px-4 py-3">{driver.acceptanceRate}%</td><td className="px-4 py-3">{formatDate(driver.lastOpenedAt)}</td>
              <td className="px-4 py-3"><span className={driver.isRestricted ? 'bg-rose-50 px-2 py-1 font-semibold text-rose-700' : 'bg-emerald-50 px-2 py-1 font-semibold text-emerald-700'}>{driver.isRestricted ? 'Restricted' : 'Active'}</span></td>
            </tr>)}
            {!loading && !drivers.length ? <tr><td colSpan="8" className="px-4 py-8 text-center text-slate-500">No driver request activity in this period.</td></tr> : null}
            {loading ? <tr><td colSpan="8" className="px-4 py-8 text-center text-slate-500">Loading...</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto border border-slate-300 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">Recent automatic blocks</div>
        <table className="min-w-full text-left text-xs"><thead className="bg-slate-100 text-slate-600"><tr><th className="px-4 py-2">Driver</th><th className="px-4 py-2">Missed</th><th className="px-4 py-2">Restriction</th><th className="px-4 py-2">Created</th></tr></thead>
          <tbody className="divide-y divide-slate-200">{actions.map((action) => <tr key={action.id}><td className="px-4 py-3">{action.driver_name || action.email || action.driver_user_id}</td><td className="px-4 py-3">{action.missed_count} of {action.threshold_value}</td><td className="px-4 py-3">{action.restriction_scope} for {action.restriction_duration_hours}h</td><td className="px-4 py-3">{formatDate(action.created_at)}</td></tr>)}
          {!actions.length ? <tr><td colSpan="4" className="px-4 py-6 text-center text-slate-500">No automatic blocks yet.</td></tr> : null}</tbody>
        </table>
      </div>
    </section>
  )
}
