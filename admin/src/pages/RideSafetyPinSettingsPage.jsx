import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return {
    value: hour,
    label: `${String(hour).padStart(2, '0')}:00 (${twelve}:00 ${suffix})`,
  }
})

function formatWindow(startHour, endHour) {
  const start = HOUR_OPTIONS.find((item) => item.value === Number(startHour))?.label || startHour
  const end = HOUR_OPTIONS.find((item) => item.value === Number(endHour))?.label || endHour
  return `${start} → ${end}`
}

export default function RideSafetyPinSettingsPage() {
  const { token, can, admin } = useAuth()
  const isSuperAdmin = admin?.role === 'super_admin'
  const canManage = isSuperAdmin || can('ride_ops.manage')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [settings, setSettings] = useState({
    enabled: true,
    nightStartHour: 18,
    nightEndHour: 6,
    maxAttempts: 3,
    updatedAt: null,
  })

  const loadSettings = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/ride-safety-pin`, { headers })
      setSettings((prev) => ({
        ...prev,
        ...(data?.settings || {}),
      }))
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load safety PIN settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const saveSettings = async (event) => {
    event.preventDefault()
    if (!canManage) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const { data } = await axios.put(
        `${BASE_URL}/api/admin/ride-safety-pin`,
        {
          enabled: !!settings.enabled,
          nightStartHour: Number(settings.nightStartHour),
          nightEndHour: Number(settings.nightEndHour),
          maxAttempts: Number(settings.maxAttempts),
        },
        { headers }
      )
      setSettings((prev) => ({
        ...prev,
        ...(data?.settings || {}),
      }))
      setSuccess('Safety PIN settings saved.')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save safety PIN settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Night safety PIN</h1>
        <p className="mt-1 text-xs text-slate-500">
          Control when passenger/driver PIN verification is required at trip start, and how many wrong attempts are allowed.
        </p>
      </div>

      {error ? (
        <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}
      {success ? (
        <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div>
      ) : null}

      {loading ? (
        <div className="border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">Loading settings...</div>
      ) : (
        <form onSubmit={saveSettings} className="space-y-4 border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-3">
            <div className={`min-w-[160px] border px-3 py-2 ${settings.enabled ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Feature</p>
              <p className={`mt-1 text-sm font-semibold ${settings.enabled ? 'text-emerald-700' : 'text-slate-700'}`}>
                {settings.enabled ? 'Enabled' : 'Disabled'}
              </p>
            </div>
            <div className="min-w-[220px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Active window</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {settings.enabled
                  ? formatWindow(settings.nightStartHour, settings.nightEndHour)
                  : 'Not enforcing PIN'}
              </p>
            </div>
            <div className="min-w-[140px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Max attempts</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{settings.maxAttempts}</p>
            </div>
          </div>

          <label className="flex items-start gap-3 border border-slate-200 bg-slate-50 px-3 py-3">
            <input
              type="checkbox"
              checked={!!settings.enabled}
              disabled={!canManage}
              onChange={(event) => setSettings((prev) => ({ ...prev, enabled: event.target.checked }))}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800">Require night safety PIN</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                When enabled, rides assigned during the night window generate a 4-digit PIN the driver must enter before starting.
              </span>
            </span>
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Night starts
              </span>
              <select
                value={Number(settings.nightStartHour)}
                disabled={!canManage}
                onChange={(event) => setSettings((prev) => ({ ...prev, nightStartHour: Number(event.target.value) }))}
                className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
              >
                {HOUR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Night ends
              </span>
              <select
                value={Number(settings.nightEndHour)}
                disabled={!canManage}
                onChange={(event) => setSettings((prev) => ({ ...prev, nightEndHour: Number(event.target.value) }))}
                className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
              >
                {HOUR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Max wrong attempts
              </span>
              <input
                type="number"
                min={1}
                max={10}
                value={Number(settings.maxAttempts)}
                disabled={!canManage}
                onChange={(event) => setSettings((prev) => ({ ...prev, maxAttempts: Number(event.target.value) }))}
                className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
              />
              <span className="mt-1 block text-[11px] text-slate-500">Allowed range: 1–10</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canManage || saving}
              className="border border-indigo-600 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save settings'}
            </button>
            {!canManage ? (
              <p className="text-xs text-amber-700">You need ride ops manage permission to edit these settings.</p>
            ) : null}
            <p className="text-xs text-slate-500">
              Last updated: {settings.updatedAt ? new Date(settings.updatedAt).toLocaleString('en-ZW') : 'Not yet saved'}
            </p>
          </div>

          <div className="border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
            Example with the current values: if night starts at{' '}
            <strong>{HOUR_OPTIONS.find((item) => item.value === Number(settings.nightStartHour))?.label}</strong>
            {' '}and ends at{' '}
            <strong>{HOUR_OPTIONS.find((item) => item.value === Number(settings.nightEndHour))?.label}</strong>,
            new assigned rides in that window require PIN verification. Drivers get{' '}
            <strong>{settings.maxAttempts}</strong> wrong tries before the PIN locks.
          </div>
        </form>
      )}
    </div>
  )
}
