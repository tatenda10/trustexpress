import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

const QUICK_MODES = [
  { key: 'peak', label: 'Peak Hours', description: 'Use immediately during unusually high demand.', field: 'peakMultiplier' },
  { key: 'night', label: 'Night', description: 'Use immediately for late-night operations.', field: 'nightMultiplier' },
  { key: 'rain', label: 'Rainy Weather', description: 'Use immediately when rain affects supply and travel.', field: 'rainMultiplier' },
]

const DEFAULT_DYNAMIC_PRICING = {
  isEnabled: true,
  manualMode: null,
  peakMultiplier: 1.25,
  nightMultiplier: 1.2,
  rainMultiplier: 1.3,
}

function makeSurgeRule(rule = {}) {
  return {
    clientKey: rule.id ? `rule-${rule.id}` : `new-${Date.now()}-${Math.random()}`,
    name: rule.name || '',
    tierKey: rule.tierKey || '',
    weekdays: Array.isArray(rule.weekdays) ? rule.weekdays : [1, 2, 3, 4, 5],
    startTime: rule.startTime || '06:30',
    endTime: rule.endTime || '09:00',
    multiplier: String(rule.multiplier ?? '1.25'),
    startsOn: rule.startsOn || '',
    endsOn: rule.endsOn || '',
    isActive: rule.isActive !== false,
    isCurrentlyActive: rule.isCurrentlyActive === true,
  }
}

function normalizeSurgeRules(rules = []) {
  return rules.map((rule) => ({
    name: String(rule.name || '').trim(),
    tierKey: String(rule.tierKey || '').trim().toLowerCase() || null,
    weekdays: rule.weekdays,
    startTime: rule.startTime,
    endTime: rule.endTime,
    multiplier: Number(rule.multiplier),
    startsOn: rule.startsOn || null,
    endsOn: rule.endsOn || null,
    isActive: rule.isActive !== false,
  }))
}

function defaultTierRows() {
  return [
    { tierKey: 'trust-express', tierName: 'Trust Express', pricePerKm: '', baseFare: '', perMinuteRate: '', minimumFare: '', isActive: true },
    { tierKey: 'trust-xl', tierName: 'Trust XL', pricePerKm: '', baseFare: '', perMinuteRate: '', minimumFare: '', isActive: true },
    { tierKey: 'trust-luxury', tierName: 'Trust Luxury', pricePerKm: '', baseFare: '', perMinuteRate: '', minimumFare: '', isActive: true },
  ]
}

function rowsFromApi(tiers = []) {
  if (!tiers.length) return defaultTierRows()
  return tiers.map((tier) => ({
    tierKey: tier.tierKey || '',
    tierName: tier.tierName || '',
    pricePerKm: String(tier.pricePerKm ?? ''),
    baseFare: String(tier.baseFare ?? ''),
    perMinuteRate: String(tier.perMinuteRate ?? ''),
    minimumFare: String(tier.minimumFare ?? ''),
    isActive: tier.isActive !== false,
  }))
}

function normalizeRows(rows = []) {
  return rows.map((row, index) => ({
    tierKey: String(row.tierKey || '').trim().toLowerCase(),
    tierName: String(row.tierName || '').trim(),
    pricePerKm: Number(row.pricePerKm || 0),
    baseFare: Number(row.baseFare || 0),
    perMinuteRate: Number(row.perMinuteRate || 0),
    minimumFare: Number(row.minimumFare || 0),
    isActive: row.isActive === false ? false : true,
    sortOrder: index,
  }))
}

export default function PricingZonesPage() {
  const { token, can, admin } = useAuth()
  const canManage = admin?.role === 'super_admin' || can('pricing.manage')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingSurge, setSavingSurge] = useState(false)
  const [savingControls, setSavingControls] = useState(false)
  const [currencyCode, setCurrencyCode] = useState('USD')
  const [tierRows, setTierRows] = useState(defaultTierRows())
  const [surgeRules, setSurgeRules] = useState([])
  const [dynamicPricing, setDynamicPricing] = useState(DEFAULT_DYNAMIC_PRICING)
  const [pricingTimeZone, setPricingTimeZone] = useState('Africa/Harare')

  const loadPricing = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/pricing`, { headers })
      setCurrencyCode(data?.currencyCode || 'USD')
      setTierRows(rowsFromApi(data?.tiers || []))
      setSurgeRules((data?.surgeRules || []).map(makeSurgeRule))
      setDynamicPricing({ ...DEFAULT_DYNAMIC_PRICING, ...(data?.dynamicPricing || {}) })
      setPricingTimeZone(data?.pricingTimeZone || 'Africa/Harare')
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to load pricing')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPricing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const updateTierRow = (index, patch) => {
    setTierRows((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }

  const updateSurgeRule = (clientKey, patch) => {
    setSurgeRules((previous) => previous.map((rule) => (
      rule.clientKey === clientKey ? { ...rule, ...patch } : rule
    )))
  }

  const toggleSurgeWeekday = (clientKey, weekday) => {
    setSurgeRules((previous) => previous.map((rule) => {
      if (rule.clientKey !== clientKey) return rule
      const selected = rule.weekdays.includes(weekday)
      return {
        ...rule,
        weekdays: selected
          ? rule.weekdays.filter((value) => value !== weekday)
          : [...rule.weekdays, weekday].sort(),
      }
    }))
  }

  const saveSurgeRules = async () => {
    setSavingSurge(true)
    try {
      const { data } = await axios.put(
        `${BASE_URL}/api/admin/pricing/surge-rules`,
        { rules: normalizeSurgeRules(surgeRules) },
        { headers }
      )
      setSurgeRules((data?.rules || []).map(makeSurgeRule))
      setPricingTimeZone(data?.pricingTimeZone || pricingTimeZone)
      toast.success('Scheduled fare increases saved')
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to save scheduled fare increases')
    } finally {
      setSavingSurge(false)
    }
  }

  const saveDynamicPricing = async (patch = {}, successMessage = 'Dynamic pricing controls saved') => {
    const previous = dynamicPricing
    const next = { ...dynamicPricing, ...patch }
    setSavingControls(true)
    try {
      const { data } = await axios.put(
        `${BASE_URL}/api/admin/pricing/surge-settings`,
        next,
        { headers }
      )
      setDynamicPricing({ ...DEFAULT_DYNAMIC_PRICING, ...(data?.dynamicPricing || next) })
      toast.success(successMessage)
    } catch (err) {
      setDynamicPricing(previous)
      toast.error(err?.response?.data?.error || err?.message || 'Failed to update dynamic pricing controls')
    } finally {
      setSavingControls(false)
    }
  }

  const savePricing = async () => {
    setSaving(true)
    try {
      const { data } = await axios.put(
        `${BASE_URL}/api/admin/pricing`,
        {
          currencyCode,
          tiers: normalizeRows(tierRows),
        },
        { headers }
      )
      setCurrencyCode(data?.currencyCode || currencyCode)
      setTierRows(rowsFromApi(data?.tiers || []))
      toast.success('Universal pricing saved')
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to save pricing')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-sm border border-slate-300 bg-white p-4 shadow-sm">
        <h1 className="text-sm font-semibold text-slate-800">Universal Pricing</h1>
        <p className="mt-1 text-xs text-slate-500">
          Manage the passenger ride pricing for all locations from one place. Regions are disabled for now.
        </p>
      </div>

      <div className="rounded-sm border border-slate-300 bg-white p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[160px_1fr]">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Currency
            </label>
            <input
              type="text"
              value={currencyCode}
              onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
              className="h-10 w-full rounded border border-slate-300 px-3 text-sm"
              maxLength={8}
            />
          </div>
          <div className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            Passenger pricing is now universal. The admin no longer needs to create or manage regions here.
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-600">
                <th className="px-3 py-2">Ride Option</th>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Price / KM</th>
                <th className="px-3 py-2">Base Fare</th>
                <th className="px-3 py-2">Per Min</th>
                <th className="px-3 py-2">Minimum Fare</th>
                <th className="px-3 py-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading pricing...</td>
                </tr>
              ) : tierRows.map((row, idx) => (
                <tr key={row.tierKey || idx} className="border-b border-slate-200">
                  <td className="px-3 py-2">
                    <input
                      value={row.tierName}
                      onChange={(event) => updateTierRow(idx, { tierName: event.target.value })}
                      className="h-9 w-40 rounded border border-slate-300 px-2"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.tierKey}
                      onChange={(event) => updateTierRow(idx, { tierKey: event.target.value })}
                      className="h-9 w-36 rounded border border-slate-300 px-2"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.pricePerKm}
                      onChange={(event) => updateTierRow(idx, { pricePerKm: event.target.value })}
                      className="h-9 w-28 rounded border border-slate-300 px-2"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.baseFare}
                      onChange={(event) => updateTierRow(idx, { baseFare: event.target.value })}
                      className="h-9 w-28 rounded border border-slate-300 px-2"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.perMinuteRate}
                      onChange={(event) => updateTierRow(idx, { perMinuteRate: event.target.value })}
                      className="h-9 w-28 rounded border border-slate-300 px-2"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.minimumFare}
                      onChange={(event) => updateTierRow(idx, { minimumFare: event.target.value })}
                      className="h-9 w-28 rounded border border-slate-300 px-2"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(event) => updateTierRow(idx, { isActive: event.target.checked })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={savePricing}
            disabled={!canManage || saving || loading}
            className={`h-10 rounded px-4 text-sm font-semibold text-white ${canManage && !saving && !loading ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-indigo-300'}`}
          >
            {saving ? 'Saving...' : 'Save Pricing'}
          </button>
        </div>
      </div>

      <div className="rounded-sm border border-slate-300 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Dynamic Pricing Control</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${dynamicPricing.isEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                {dynamicPricing.isEnabled ? 'ON' : 'OFF'}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs text-slate-500">
              The normal fare remains the minimum. Turning this off immediately disables every schedule and manual multiplier.
            </p>
          </div>
          <button
            type="button"
            onClick={() => saveDynamicPricing(
              { isEnabled: !dynamicPricing.isEnabled },
              dynamicPricing.isEnabled ? 'Dynamic pricing switched off' : 'Dynamic pricing switched on'
            )}
            disabled={!canManage || savingControls || loading}
            className={`h-11 min-w-48 rounded px-4 text-sm font-semibold text-white disabled:bg-slate-300 ${dynamicPricing.isEnabled ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
          >
            {savingControls ? 'Updating...' : dynamicPricing.isEnabled ? 'Switch Dynamic Pricing Off' : 'Switch Dynamic Pricing On'}
          </button>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {QUICK_MODES.map((mode) => {
            const selected = dynamicPricing.manualMode === mode.key
            return (
              <div key={mode.key} className={`rounded border p-3 ${selected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">{mode.label}</h3>
                    <p className="mt-1 text-xs text-slate-500">{mode.description}</p>
                  </div>
                  {selected ? (
                    <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                      {dynamicPricing.isEnabled ? 'Active' : 'Selected'}
                    </span>
                  ) : null}
                </div>
                <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Fare multiplier
                  <input
                    type="number"
                    min="1.01"
                    max="5"
                    step="0.05"
                    value={dynamicPricing[mode.field]}
                    onChange={(event) => setDynamicPricing((previous) => ({
                      ...previous,
                      [mode.field]: event.target.value,
                    }))}
                    className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm font-normal"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => saveDynamicPricing(
                    { isEnabled: true, manualMode: selected ? null : mode.key },
                    selected ? `${mode.label} pricing stopped` : `${mode.label} pricing activated`
                  )}
                  disabled={!canManage || savingControls || loading}
                  className={`mt-3 h-9 w-full rounded text-xs font-semibold ${selected ? 'border border-slate-300 bg-white text-slate-700' : 'bg-indigo-600 text-white hover:bg-indigo-500'} disabled:bg-slate-200 disabled:text-slate-400`}
                >
                  {selected ? 'Stop This Mode' : `Activate ${mode.label}`}
                </button>
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            Manual modes apply to all ride options. Scheduled rules still run, and the highest applicable multiplier wins.
          </p>
          <button
            type="button"
            onClick={() => saveDynamicPricing({}, 'Quick-mode multipliers saved')}
            disabled={!canManage || savingControls || loading}
            className="h-9 rounded border border-indigo-600 px-3 text-xs font-semibold text-indigo-700 disabled:border-slate-300 disabled:text-slate-400"
          >
            Save Quick Multipliers
          </button>
        </div>
      </div>

      <div className="rounded-sm border border-slate-300 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Scheduled Fare Increases</h2>
            <p className="mt-1 text-xs text-slate-500">
              Increase fares automatically during busy periods. Times use {pricingTimeZone}. If rules overlap, the highest multiplier applies.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSurgeRules((previous) => [...previous, makeSurgeRule({ name: 'Peak hours' })])}
            disabled={!canManage || loading}
            className="h-9 rounded border border-indigo-600 px-3 text-xs font-semibold text-indigo-700 disabled:border-slate-300 disabled:text-slate-400"
          >
            Add Schedule
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {!loading && surgeRules.length === 0 ? (
            <div className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-500">
              No scheduled fare increases. Standard pricing applies at all times.
            </div>
          ) : surgeRules.map((rule) => (
            <div key={rule.clientKey} className="rounded border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">Fare schedule</span>
                  {rule.isCurrentlyActive ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Active now</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setSurgeRules((previous) => previous.filter((item) => item.clientKey !== rule.clientKey))}
                  disabled={!canManage}
                  className="text-xs font-semibold text-red-600 disabled:text-slate-400"
                >
                  Remove
                </button>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 xl:col-span-2">
                  Name
                  <input
                    value={rule.name}
                    onChange={(event) => updateSurgeRule(rule.clientKey, { name: event.target.value })}
                    placeholder="Morning peak"
                    className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs font-normal normal-case tracking-normal"
                  />
                </label>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Ride option
                  <select
                    value={rule.tierKey}
                    onChange={(event) => updateSurgeRule(rule.clientKey, { tierKey: event.target.value })}
                    className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs font-normal normal-case tracking-normal"
                  >
                    <option value="">All ride options</option>
                    {tierRows.filter((tier) => tier.tierKey).map((tier) => (
                      <option key={tier.tierKey} value={tier.tierKey}>{tier.tierName || tier.tierKey}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Starts
                  <input
                    type="time"
                    value={rule.startTime}
                    onChange={(event) => updateSurgeRule(rule.clientKey, { startTime: event.target.value })}
                    className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs font-normal"
                  />
                </label>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Ends
                  <input
                    type="time"
                    value={rule.endTime}
                    onChange={(event) => updateSurgeRule(rule.clientKey, { endTime: event.target.value })}
                    className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs font-normal"
                  />
                </label>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_140px_170px_170px_90px] md:items-end">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Days</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((day) => {
                      const selected = rule.weekdays.includes(day.value)
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => toggleSurgeWeekday(rule.clientKey, day.value)}
                          className={`h-8 min-w-10 rounded px-2 text-[11px] font-semibold ${selected ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white text-slate-600'}`}
                        >
                          {day.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Multiplier
                  <input
                    type="number"
                    min="1.01"
                    max="5"
                    step="0.05"
                    value={rule.multiplier}
                    onChange={(event) => updateSurgeRule(rule.clientKey, { multiplier: event.target.value })}
                    className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs font-normal"
                  />
                </label>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  First date (optional)
                  <input
                    type="date"
                    value={rule.startsOn}
                    onChange={(event) => updateSurgeRule(rule.clientKey, { startsOn: event.target.value })}
                    className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs font-normal"
                  />
                </label>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Last date (optional)
                  <input
                    type="date"
                    value={rule.endsOn}
                    onChange={(event) => updateSurgeRule(rule.clientKey, { endsOn: event.target.value })}
                    className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs font-normal"
                  />
                </label>
                <label className="flex h-9 items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={rule.isActive}
                    onChange={(event) => updateSurgeRule(rule.clientKey, { isActive: event.target.checked })}
                  />
                  Enabled
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={saveSurgeRules}
            disabled={!canManage || savingSurge || loading}
            className={`h-10 rounded px-4 text-sm font-semibold text-white ${canManage && !savingSurge && !loading ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-indigo-300'}`}
          >
            {savingSurge ? 'Saving...' : 'Save Fare Schedules'}
          </button>
        </div>
      </div>
    </section>
  )
}
