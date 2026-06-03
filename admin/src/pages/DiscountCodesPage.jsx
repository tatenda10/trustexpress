import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

const emptyForm = {
  code: '',
  title: '',
  description: '',
  discountType: 'percent',
  discountValue: '',
  maxDiscountAmount: '',
  minRideAmount: '',
  usageLimitTotal: '',
  usageLimitPerPassenger: '',
  allowMultipleUse: true,
  isActive: true,
  startsAt: '',
  expiresAt: '',
}

function toDatetimeLocalValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function fromCodeToForm(code) {
  return {
    code: code.code || '',
    title: code.title || '',
    description: code.description || '',
    discountType: code.discountType || 'percent',
    discountValue: String(code.discountValue ?? ''),
    maxDiscountAmount: code.maxDiscountAmount === null ? '' : String(code.maxDiscountAmount),
    minRideAmount: code.minRideAmount === null ? '' : String(code.minRideAmount),
    usageLimitTotal: code.usageLimitTotal === null ? '' : String(code.usageLimitTotal),
    usageLimitPerPassenger: code.usageLimitPerPassenger === null ? '' : String(code.usageLimitPerPassenger),
    allowMultipleUse: code.allowMultipleUse !== false,
    isActive: code.isActive !== false,
    startsAt: toDatetimeLocalValue(code.startsAt),
    expiresAt: toDatetimeLocalValue(code.expiresAt),
  }
}

function normalizeForm(form) {
  const normalizeNullableNumber = (value) => {
    const nextValue = String(value || '').trim()
    return nextValue ? Number(nextValue) : null
  }

  return {
    code: String(form.code || '').trim(),
    title: String(form.title || '').trim(),
    description: String(form.description || '').trim(),
    discountType: String(form.discountType || 'percent').trim().toLowerCase(),
    discountValue: Number(form.discountValue || 0),
    maxDiscountAmount: normalizeNullableNumber(form.maxDiscountAmount),
    minRideAmount: normalizeNullableNumber(form.minRideAmount),
    usageLimitTotal: normalizeNullableNumber(form.usageLimitTotal),
    usageLimitPerPassenger: normalizeNullableNumber(form.usageLimitPerPassenger),
    allowMultipleUse: !!form.allowMultipleUse,
    isActive: !!form.isActive,
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
  }
}

export default function DiscountCodesPage() {
  const { token, can, admin } = useAuth()
  const canManage = admin?.role === 'super_admin' || can('pricing.manage')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [discountCodes, setDiscountCodes] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const loadDiscountCodes = async () => {
    if (!token) return
    setLoading(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/discount-codes`, { headers })
      setDiscountCodes(Array.isArray(data?.discountCodes) ? data.discountCodes : [])
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to load discount codes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDiscountCodes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const handleChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleEdit = (code) => {
    setEditingId(code.id)
    setForm(fromCodeToForm(code))
  }

  const handleReset = () => {
    setEditingId(null)
    setForm(emptyForm)
  }

  const handleSubmit = async () => {
    if (!canManage) return
    setSaving(true)
    try {
      const payload = normalizeForm(form)
      if (editingId) {
        await axios.patch(`${BASE_URL}/api/admin/discount-codes/${editingId}`, payload, { headers })
        toast.success('Discount code updated')
      } else {
        await axios.post(`${BASE_URL}/api/admin/discount-codes`, payload, { headers })
        toast.success('Discount code created')
      }
      handleReset()
      await loadDiscountCodes()
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to save discount code')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-sm border border-slate-300 bg-white p-4 shadow-sm">
        <h1 className="text-sm font-semibold text-slate-800">Promotions</h1>
        <p className="mt-1 text-xs text-slate-500">
          Create discount codes for passengers and track the total subsidy and reuse policy.
        </p>
      </div>

      <div className="rounded-sm border border-slate-300 bg-white p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-xs text-slate-600">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Code</span>
            <input value={form.code} onChange={(event) => handleChange('code', event.target.value.toUpperCase())} className="h-10 w-full border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-indigo-500" />
          </label>
          <label className="space-y-1 text-xs text-slate-600">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Title</span>
            <input value={form.title} onChange={(event) => handleChange('title', event.target.value)} className="h-10 w-full border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-indigo-500" />
          </label>
          <label className="space-y-1 text-xs text-slate-600">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Type</span>
            <select value={form.discountType} onChange={(event) => handleChange('discountType', event.target.value)} className="h-10 w-full border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-indigo-500">
              <option value="percent">Percent</option>
              <option value="fixed">Fixed amount</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-slate-600">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Value</span>
            <input type="number" step="0.01" value={form.discountValue} onChange={(event) => handleChange('discountValue', event.target.value)} className="h-10 w-full border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-indigo-500" />
          </label>
          <label className="space-y-1 text-xs text-slate-600 md:col-span-2 xl:col-span-4">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Description</span>
            <input value={form.description} onChange={(event) => handleChange('description', event.target.value)} className="h-10 w-full border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-indigo-500" />
          </label>
          <label className="space-y-1 text-xs text-slate-600">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Max discount</span>
            <input type="number" step="0.01" value={form.maxDiscountAmount} onChange={(event) => handleChange('maxDiscountAmount', event.target.value)} className="h-10 w-full border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-indigo-500" />
          </label>
          <label className="space-y-1 text-xs text-slate-600">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Minimum ride</span>
            <input type="number" step="0.01" value={form.minRideAmount} onChange={(event) => handleChange('minRideAmount', event.target.value)} className="h-10 w-full border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-indigo-500" />
          </label>
          <label className="space-y-1 text-xs text-slate-600">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Total uses limit</span>
            <input type="number" step="1" value={form.usageLimitTotal} onChange={(event) => handleChange('usageLimitTotal', event.target.value)} className="h-10 w-full border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-indigo-500" />
          </label>
          <label className="space-y-1 text-xs text-slate-600">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Uses per passenger</span>
            <input type="number" step="1" value={form.usageLimitPerPassenger} onChange={(event) => handleChange('usageLimitPerPassenger', event.target.value)} className="h-10 w-full border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-indigo-500" />
          </label>
          <label className="space-y-1 text-xs text-slate-600">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Starts at</span>
            <input type="datetime-local" value={form.startsAt} onChange={(event) => handleChange('startsAt', event.target.value)} className="h-10 w-full border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-indigo-500" />
          </label>
          <label className="space-y-1 text-xs text-slate-600">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Expires at</span>
            <input type="datetime-local" value={form.expiresAt} onChange={(event) => handleChange('expiresAt', event.target.value)} className="h-10 w-full border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-indigo-500" />
          </label>
          <label className="flex items-center gap-3 pt-6 text-sm text-slate-700">
            <input type="checkbox" checked={form.allowMultipleUse} onChange={(event) => handleChange('allowMultipleUse', event.target.checked)} />
            Allow multiple use
          </label>
          <label className="flex items-center gap-3 pt-6 text-sm text-slate-700">
            <input type="checkbox" checked={form.isActive} onChange={(event) => handleChange('isActive', event.target.checked)} />
            Active
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {editingId ? (
            <button type="button" onClick={handleReset} className="h-10 border border-slate-300 px-4 text-sm font-semibold text-slate-700">
              Cancel edit
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canManage || saving}
            className={`h-10 px-4 text-sm font-semibold text-white ${canManage && !saving ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-indigo-300'}`}
          >
            {saving ? 'Saving...' : editingId ? 'Update code' : 'Create code'}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-sm border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Discount codes
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-600">
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2">Usage</th>
                <th className="px-3 py-2">Issued</th>
                <th className="px-3 py-2">Window</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading discount codes...</td>
                </tr>
              ) : discountCodes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No discount codes created yet.</td>
                </tr>
              ) : discountCodes.map((code) => (
                <tr key={code.id} className="border-b border-slate-200">
                  <td className="px-3 py-3">
                    <div className="font-semibold text-slate-800">{code.code}</div>
                    <div className="text-slate-500">{code.title}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    <div>{code.discountType === 'percent' ? `${Number(code.discountValue || 0).toFixed(2)}% off` : `$${Number(code.discountValue || 0).toFixed(2)} off`}</div>
                    <div className="text-slate-500">
                      {code.allowMultipleUse ? 'Reusable' : 'Single-use policy'}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    <div>{code.usageCount} redemptions</div>
                    <div className="text-slate-500">
                      Total limit: {code.usageLimitTotal ?? 'Unlimited'} | Per passenger: {code.usageLimitPerPassenger ?? 'Unlimited'}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-medium text-emerald-700">
                    ${Number(code.totalDiscountIssued || 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    <div>{code.startsAt ? new Date(code.startsAt).toLocaleString() : 'Immediate'}</div>
                    <div className="text-slate-500">{code.expiresAt ? `Until ${new Date(code.expiresAt).toLocaleString()}` : 'No expiry'}</div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${code.isActive ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'}`}>
                      {code.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button type="button" onClick={() => handleEdit(code)} className="text-xs font-semibold text-indigo-600 hover:text-indigo-500">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
