import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

function formatMoney(value, currency = 'USD') {
  return `${currency} ${Number(value || 0).toFixed(2)}`
}

function bandsFromSettings(settings) {
  return Array.isArray(settings?.bands) ? settings.bands.map((band) => ({
    ...band,
    categorySlugsText: Array.isArray(band.categorySlugs) ? band.categorySlugs.join(', ') : '',
  })) : []
}

export default function HireCommissionSettingsPage() {
  const { token, can, admin } = useAuth()
  const isSuperAdmin = admin?.role === 'super_admin'
  const canManage = isSuperAdmin || can('payouts.manage')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [intercityDistanceKm, setIntercityDistanceKm] = useState(80)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [bands, setBands] = useState([])
  const [examples, setExamples] = useState([])

  const loadSettings = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/hire-commission/settings`, { headers })
      setEnabled(data?.settings?.enabled !== false)
      setIntercityDistanceKm(Number(data?.settings?.intercityDistanceKm || 80))
      setUpdatedAt(data?.settings?.updatedAt || null)
      setBands(bandsFromSettings(data?.settings))
      setExamples(Array.isArray(data?.examples) ? data.examples : [])
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load hire commission settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const setBandPatch = (index, patch) => {
    setBands((current) => current.map((band, bandIndex) => (
      bandIndex === index ? { ...band, ...patch } : band
    )))
  }

  const saveSettings = async (event) => {
    event.preventDefault()
    if (!canManage) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const { data } = await axios.put(
        `${BASE_URL}/api/admin/hire-commission/settings`,
        {
          enabled: !!enabled,
          intercityDistanceKm: Number(intercityDistanceKm),
          bands: bands.map((band, index) => ({
            bandKey: band.bandKey,
            label: band.label,
            description: band.description,
            ratePercent: Number(band.ratePercent),
            minCommissionUsd: Number(band.minCommissionUsd || 0),
            matchTripType: band.matchTripType || 'any',
            categorySlugs: String(band.categorySlugsText || '')
              .split(/[,\n]/)
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean),
            priority: Number(band.priority),
            isDefault: !!band.isDefault,
            sortOrder: Number.isFinite(Number(band.sortOrder)) ? Number(band.sortOrder) : index + 1,
          })),
        },
        { headers }
      )
      setEnabled(data?.settings?.enabled !== false)
      setIntercityDistanceKm(Number(data?.settings?.intercityDistanceKm || 80))
      setUpdatedAt(data?.settings?.updatedAt || null)
      setBands(bandsFromSettings(data?.settings))
      setExamples(Array.isArray(data?.examples) ? data.examples : [])
      setSuccess('Hire commission settings saved.')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save hire commission settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Business / Payouts</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Hire commission</h1>
        <p className="mt-1 text-xs text-slate-500">
          Charge a competitive service fee on the agreed hire charge only — not on tolls, parking, or other extras.
          Larger vehicles and high-value moves use a lower percent.
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
        <form onSubmit={saveSettings} className="space-y-4">
          <div className={`border px-4 py-4 ${enabled ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Hire service fee</p>
            <p className={`mt-1 text-lg font-semibold ${enabled ? 'text-emerald-700' : 'text-amber-800'}`}>
              {enabled ? 'ON — deducted when a hire is completed' : 'OFF — no hire commission'}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              Deduction still requires Driver Wallet payments to be on. The ride service fee stays separate.
            </p>
          </div>

          <label className="flex items-start gap-3 border border-slate-200 bg-white px-3 py-3">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canManage}
              onChange={(event) => setEnabled(event.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800">Enable hire commission</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                When a driver completes a hire, deduct the matching band from their wallet. Commission is on the agreed transport charge only.
              </span>
            </span>
          </label>

          <label className="block border border-slate-200 bg-white px-3 py-3">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Intercity distance threshold (km)
            </span>
            <input
              type="number"
              min={1}
              step="1"
              value={Number(intercityDistanceKm)}
              disabled={!canManage}
              onChange={(event) => setIntercityDistanceKm(event.target.value)}
              className="w-full max-w-xs border border-slate-200 px-3 py-2 text-sm text-slate-800"
            />
            <span className="mt-2 block text-xs leading-5 text-slate-500">
              If the passenger does not pick local or intercity, jobs at or above this distance use the intercity band.
            </span>
          </label>

          <div className="space-y-3">
            {bands.map((band, index) => (
              <div key={band.bandKey || index} className="border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-800">{band.label || band.bandKey}</h2>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">{band.bandKey}</p>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Label</span>
                    <input
                      value={band.label || ''}
                      disabled={!canManage}
                      onChange={(event) => setBandPatch(index, { label: event.target.value })}
                      className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Rate (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={Number(band.ratePercent)}
                      disabled={!canManage}
                      onChange={(event) => setBandPatch(index, { ratePercent: event.target.value })}
                      className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Minimum commission (USD)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={Number(band.minCommissionUsd || 0)}
                      disabled={!canManage}
                      onChange={(event) => setBandPatch(index, { minCommissionUsd: event.target.value })}
                      className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Match trip type</span>
                    <select
                      value={band.matchTripType || 'any'}
                      disabled={!canManage}
                      onChange={(event) => setBandPatch(index, { matchTripType: event.target.value })}
                      className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                    >
                      <option value="any">Any</option>
                      <option value="local">Local only</option>
                      <option value="intercity">Intercity only</option>
                    </select>
                  </label>
                </div>
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Vehicle categories (comma-separated)
                  </span>
                  <input
                    value={band.categorySlugsText || ''}
                    disabled={!canManage}
                    onChange={(event) => setBandPatch(index, { categorySlugsText: event.target.value })}
                    placeholder="e.g. sprinter, iveco, hiace"
                    className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                  />
                </label>
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Description</span>
                  <input
                    value={band.description || ''}
                    disabled={!canManage}
                    onChange={(event) => setBandPatch(index, { description: event.target.value })}
                    className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                  />
                </label>
                <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={!!band.isDefault}
                    disabled={!canManage}
                    onChange={(event) => setBandPatch(index, { isDefault: event.target.checked })}
                  />
                  Default band when nothing else matches
                </label>
              </div>
            ))}
          </div>

          <div className="border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Examples</h2>
            <p className="mt-1 text-xs text-slate-500">
              Live preview from the saved rates. Commission is on the hire charge; the operator keeps the rest.
            </p>
            <div className="mt-3 overflow-hidden border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Booking</th>
                    <th className="px-3 py-2 font-semibold">Hire charge</th>
                    <th className="px-3 py-2 font-semibold">Commission</th>
                    <th className="px-3 py-2 font-semibold">Operator receives</th>
                  </tr>
                </thead>
                <tbody>
                  {examples.map((example) => (
                    <tr key={example.label} className="border-t border-slate-200">
                      <td className="px-3 py-2 text-slate-700">{example.label}</td>
                      <td className="px-3 py-2 text-slate-700">{formatMoney(example.transportAmount)}</td>
                      <td className="px-3 py-2 text-slate-700">
                        {formatMoney(example.commissionAmount)} at {Number(example.commissionRatePercent || 0).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-slate-700">{formatMoney(example.operatorReceives)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              <p className="text-xs text-amber-700">You need payouts manage permission to edit these settings.</p>
            ) : null}
            <p className="text-xs text-slate-500">
              Last updated: {updatedAt ? new Date(updatedAt).toLocaleString('en-ZW') : 'Not yet saved'}
            </p>
          </div>
        </form>
      )}
    </div>
  )
}
