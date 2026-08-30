import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

const DEFAULT_TIERS = [
  { tierKey: 'blue', tierName: 'Blue Captain', badgeColor: '#2563EB', minRides: 1, maxRides: 9, rewardAmountUsd: 0, sortOrder: 1, isActive: true },
  { tierKey: 'silver', tierName: 'Silver Captain', badgeColor: '#94A3B8', minRides: 10, maxRides: 19, rewardAmountUsd: 1.5, sortOrder: 2, isActive: true },
  { tierKey: 'gold', tierName: 'Gold Captain', badgeColor: '#EAB308', minRides: 20, maxRides: 34, rewardAmountUsd: 3, sortOrder: 3, isActive: true },
  { tierKey: 'diamond', tierName: 'Diamond Captain', badgeColor: '#06B6D4', minRides: 35, maxRides: null, rewardAmountUsd: 5, sortOrder: 4, isActive: true },
]

function formatUsd(value) {
  return `USD ${Number(value || 0).toFixed(2)}`
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function toDateInputValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export default function CaptainRewardsPage() {
  const { token, can, admin } = useAuth()
  const canManage = admin?.role === 'super_admin' || can('payouts.manage')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState(null)
  const [tiers, setTiers] = useState(DEFAULT_TIERS)
  const [cycles, setCycles] = useState([])
  const [weekdayOptions, setWeekdayOptions] = useState([])
  const [activeTab, setActiveTab] = useState('settings')
  const [selectedCycleId, setSelectedCycleId] = useState(null)
  const [cycleDrivers, setCycleDrivers] = useState([])
  const [loadingDrivers, setLoadingDrivers] = useState(false)
  const [processingCycleId, setProcessingCycleId] = useState(null)

  const [settingsForm, setSettingsForm] = useState({
    enabled: true,
    cycleLengthDays: 14,
    cycleWeekday: 1,
    cycleAnchorStartsAt: '',
    currency: 'USD',
  })

  const loadData = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/captain-rewards`, { headers })
      const nextSettings = data?.settings || {}
      setSettings(nextSettings)
      setSettingsForm({
        enabled: nextSettings.enabled !== false,
        cycleLengthDays: Number(nextSettings.cycleLengthDays || 14),
        cycleWeekday: Number(nextSettings.cycleWeekday ?? 1),
        cycleAnchorStartsAt: toDateInputValue(nextSettings.cycleAnchorStartsAt),
        currency: String(nextSettings.currency || 'USD').toUpperCase(),
      })
      setTiers(Array.isArray(data?.tiers) && data.tiers.length ? data.tiers : DEFAULT_TIERS)
      setCycles(Array.isArray(data?.cycles) ? data.cycles : [])
      setWeekdayOptions(Array.isArray(data?.weekdayOptions) ? data.weekdayOptions : [])
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to load captain rewards')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const loadCycleDrivers = async (cycleId) => {
    if (!cycleId) return
    setLoadingDrivers(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/captain-rewards/cycles/${cycleId}/drivers`, { headers })
      setCycleDrivers(Array.isArray(data?.drivers) ? data.drivers : [])
      setSelectedCycleId(cycleId)
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to load cycle drivers')
    } finally {
      setLoadingDrivers(false)
    }
  }

  const saveSettings = async () => {
    if (!canManage) return
    setSaving(true)
    try {
      const anchorDate = settingsForm.cycleAnchorStartsAt
        ? new Date(`${settingsForm.cycleAnchorStartsAt}T00:00:00`)
        : null
      const { data } = await axios.put(`${BASE_URL}/api/admin/captain-rewards/settings`, {
        enabled: settingsForm.enabled,
        cycleLengthDays: Number(settingsForm.cycleLengthDays),
        cycleWeekday: Number(settingsForm.cycleWeekday),
        cycleAnchorStartsAt: anchorDate ? anchorDate.toISOString() : undefined,
        currency: 'USD',
      }, { headers })
      setSettings(data?.settings || null)
      toast.success('Captain cycle settings saved')
      await loadData()
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const setTierPatch = (index, patch) => {
    setTiers((current) => current.map((tier, tierIndex) => (tierIndex === index ? { ...tier, ...patch } : tier)))
  }

  const saveTiers = async () => {
    if (!canManage) return
    setSaving(true)
    try {
      const payloadTiers = tiers
        .map((tier, index) => ({
          tierKey: String(tier.tierKey || '').trim().toLowerCase(),
          tierName: String(tier.tierName || '').trim(),
          badgeColor: String(tier.badgeColor || '#2563EB').trim(),
          minRides: Number(tier.minRides),
          maxRides: tier.maxRides === '' || tier.maxRides === undefined ? null : Number(tier.maxRides),
          rewardAmountUsd: Number(tier.rewardAmountUsd),
          isActive: tier.isActive !== false,
          sortOrder: Number.isFinite(Number(tier.sortOrder)) ? Number(tier.sortOrder) : index + 1,
        }))
        .filter((tier) => tier.tierKey && tier.tierName && Number.isInteger(tier.minRides) && tier.minRides >= 0)
      const { data } = await axios.put(`${BASE_URL}/api/admin/captain-rewards/tiers`, { tiers: payloadTiers }, { headers })
      setTiers(Array.isArray(data?.tiers) ? data.tiers : payloadTiers)
      toast.success('Captain tiers saved')
      await loadData()
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to save tiers')
    } finally {
      setSaving(false)
    }
  }

  const creditCycle = async (cycleId, force = false) => {
    if (!canManage) return
    setProcessingCycleId(cycleId)
    try {
      const { data } = await axios.post(`${BASE_URL}/api/admin/captain-rewards/cycles/${cycleId}/credit`, { force }, { headers })
      toast.success(`Credited ${data?.creditedCount || 0} driver(s)`)
      await loadData()
      if (selectedCycleId === cycleId) await loadCycleDrivers(cycleId)
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to credit cycle')
    } finally {
      setProcessingCycleId(null)
    }
  }

  const processDueCycles = async () => {
    if (!canManage) return
    setSaving(true)
    try {
      const { data } = await axios.post(`${BASE_URL}/api/admin/captain-rewards/process-due`, {}, { headers })
      toast.success(`Processed ${data?.processed || 0} due cycle(s)`)
      await loadData()
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to process due cycles')
    } finally {
      setSaving(false)
    }
  }

  const currentCycle = settings?.currentCycle

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Business / Payouts</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Captain Rewards</h1>
        <p className="mt-1 text-xs text-slate-500">
          Global 14-day cycles with admin-chosen start weekday. Rewards credit as non-withdrawable USD promotional float for service fees.
        </p>
        <div className="mt-4 inline-flex border border-slate-200 bg-slate-50 p-1">
          {['settings', 'tiers', 'cycles'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-semibold capitalize ${activeTab === tab ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {currentCycle ? (
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="border border-slate-200 bg-white px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current cycle</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{currentCycle.cycleKey}</p>
          </div>
          <div className="border border-slate-200 bg-white px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Ends</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{formatDate(currentCycle.endsAt)}</p>
          </div>
          <div className="border border-slate-200 bg-white px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Days left</p>
            <p className="mt-1 text-lg font-semibold text-emerald-700">{currentCycle.daysRemaining}</p>
          </div>
          <div className="border border-slate-200 bg-white px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Currency</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">USD</p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">Loading…</div>
      ) : null}

      {!loading && activeTab === 'settings' ? (
        <div className="border border-slate-200 bg-white px-4 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Global cycle settings</h2>
          <p className="mt-1 text-xs text-slate-500">All drivers share the same cycle window. The anchor date must fall on the selected weekday.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-600">
              Program enabled
              <select
                className="mt-1 w-full border border-slate-300 px-2 py-2 text-sm"
                value={settingsForm.enabled ? '1' : '0'}
                disabled={!canManage}
                onChange={(event) => setSettingsForm((current) => ({ ...current, enabled: event.target.value === '1' }))}
              >
                <option value="1">Enabled</option>
                <option value="0">Disabled</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Cycle length (days)
              <input
                type="number"
                min={7}
                max={28}
                className="mt-1 w-full border border-slate-300 px-2 py-2 text-sm"
                value={settingsForm.cycleLengthDays}
                disabled={!canManage}
                onChange={(event) => setSettingsForm((current) => ({ ...current, cycleLengthDays: event.target.value }))}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Cycle start weekday
              <select
                className="mt-1 w-full border border-slate-300 px-2 py-2 text-sm"
                value={settingsForm.cycleWeekday}
                disabled={!canManage}
                onChange={(event) => setSettingsForm((current) => ({ ...current, cycleWeekday: Number(event.target.value) }))}
              >
                {weekdayOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Anchor start date
              <input
                type="date"
                className="mt-1 w-full border border-slate-300 px-2 py-2 text-sm"
                value={settingsForm.cycleAnchorStartsAt}
                disabled={!canManage}
                onChange={(event) => setSettingsForm((current) => ({ ...current, cycleAnchorStartsAt: event.target.value }))}
              />
            </label>
          </div>
          {canManage ? (
            <button
              type="button"
              onClick={saveSettings}
              disabled={saving}
              className="mt-4 border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && activeTab === 'tiers' ? (
        <div className="border border-slate-200 bg-white px-4 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Reward tiers (highest tier only)</h2>
          <div className="mt-3 space-y-2">
            {tiers.map((tier, index) => (
              <div key={`${tier.tierKey}-${index}`} className="grid gap-2 border border-slate-100 bg-slate-50 p-3 sm:grid-cols-6">
                <input className="border border-slate-300 px-2 py-1 text-sm" value={tier.tierKey || ''} disabled={!canManage} onChange={(e) => setTierPatch(index, { tierKey: e.target.value })} placeholder="key" />
                <input className="border border-slate-300 px-2 py-1 text-sm sm:col-span-2" value={tier.tierName || ''} disabled={!canManage} onChange={(e) => setTierPatch(index, { tierName: e.target.value })} placeholder="Name" />
                <input type="number" className="border border-slate-300 px-2 py-1 text-sm" value={tier.minRides ?? ''} disabled={!canManage} onChange={(e) => setTierPatch(index, { minRides: e.target.value })} placeholder="Min rides" />
                <input type="number" className="border border-slate-300 px-2 py-1 text-sm" value={tier.maxRides ?? ''} disabled={!canManage} onChange={(e) => setTierPatch(index, { maxRides: e.target.value })} placeholder="Max rides" />
                <input type="number" step="0.01" className="border border-slate-300 px-2 py-1 text-sm" value={tier.rewardAmountUsd ?? ''} disabled={!canManage} onChange={(e) => setTierPatch(index, { rewardAmountUsd: e.target.value })} placeholder="USD reward" />
              </div>
            ))}
          </div>
          {canManage ? (
            <button
              type="button"
              onClick={saveTiers}
              disabled={saving}
              className="mt-4 border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save tiers'}
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && activeTab === 'cycles' ? (
        <div className="space-y-3">
          {canManage ? (
            <div className="border border-slate-200 bg-white px-4 py-3">
              <button
                type="button"
                onClick={processDueCycles}
                disabled={saving}
                className="border border-emerald-700 bg-emerald-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white disabled:opacity-60"
              >
                Process due cycles
              </button>
            </div>
          ) : null}
          <div className="border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Cycle</th>
                  <th className="px-3 py-2">Window</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Drivers</th>
                  <th className="px-3 py-2">Credited</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((cycle) => (
                  <tr key={cycle.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-900">{cycle.cycleKey}</td>
                    <td className="px-3 py-2 text-slate-600">{formatDate(cycle.startsAt)} → {formatDate(cycle.endsAt)}</td>
                    <td className="px-3 py-2 capitalize text-slate-700">{cycle.status}</td>
                    <td className="px-3 py-2">{cycle.driverCount}</td>
                    <td className="px-3 py-2">{formatUsd(cycle.creditedTotalUsd)} ({cycle.creditedDrivers})</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="text-[11px] font-semibold text-slate-700 underline" onClick={() => loadCycleDrivers(cycle.id)}>View</button>
                        {canManage ? (
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-emerald-700 underline disabled:opacity-50"
                            disabled={processingCycleId === cycle.id}
                            onClick={() => creditCycle(cycle.id, true)}
                          >
                            {processingCycleId === cycle.id ? 'Crediting…' : 'Credit now'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedCycleId ? (
            <div className="border border-slate-200 bg-white px-4 py-4">
              <h3 className="text-sm font-semibold text-slate-900">Cycle drivers</h3>
              {loadingDrivers ? <p className="mt-2 text-xs text-slate-500">Loading drivers…</p> : null}
              {!loadingDrivers && cycleDrivers.length === 0 ? <p className="mt-2 text-xs text-slate-500">No drivers in this cycle yet.</p> : null}
              {!loadingDrivers && cycleDrivers.length > 0 ? (
                <table className="mt-3 w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="py-2">Driver</th>
                      <th className="py-2">Rides</th>
                      <th className="py-2">Tier</th>
                      <th className="py-2">Reward</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycleDrivers.map((driver) => (
                      <tr key={driver.id} className="border-b border-slate-100">
                        <td className="py-2">{driver.driverName}{driver.driverPhone ? ` · ${driver.driverPhone}` : ''}</td>
                        <td className="py-2">{driver.qualifyingRidesCount}</td>
                        <td className="py-2">{driver.achievedTierKey || '—'}</td>
                        <td className="py-2">{formatUsd(driver.rewardAmountUsd)}</td>
                        <td className="py-2 capitalize">{driver.rewardStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
