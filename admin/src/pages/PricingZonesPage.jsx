import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

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
  const [currencyCode, setCurrencyCode] = useState('USD')
  const [tierRows, setTierRows] = useState(defaultTierRows())

  const loadPricing = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/pricing`, { headers })
      setCurrencyCode(data?.currencyCode || 'USD')
      setTierRows(rowsFromApi(data?.tiers || []))
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

  const savePricing = async () => {
    setSaving(true)
    try {
      await axios.put(
        `${BASE_URL}/api/admin/pricing`,
        {
          currencyCode,
          tiers: normalizeRows(tierRows),
        },
        { headers }
      )
      toast.success('Universal pricing saved')
      await loadPricing()
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
    </section>
  )
}
