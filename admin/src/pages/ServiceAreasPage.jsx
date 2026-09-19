import axios from 'axios'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

const EMPTY_FORM = {
  id: null,
  areaKey: '',
  label: '',
  countryCode: 'ZW',
  centerLat: '',
  centerLng: '',
  westLng: '',
  southLat: '',
  eastLng: '',
  northLat: '',
  sortOrder: 0,
  isActive: true,
}

function makeAreaKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function Input({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-500"
      />
    </label>
  )
}

export default function ServiceAreasPage() {
  const { token, can, admin } = useAuth()
  const [areas, setAreas] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const canManage = admin?.role === 'super_admin' || can('pricing.manage')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const loadAreas = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/service-areas`, { headers })
      setAreas(Array.isArray(data?.areas) ? data.areas : [])
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Could not load service areas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAreas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const updateForm = (key, value) => {
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === 'label' && !current.id && (!current.areaKey || current.areaKey === makeAreaKey(current.label))) {
        next.areaKey = makeAreaKey(value)
      }
      return next
    })
  }

  const editArea = (area) => {
    setForm({
      id: area.id,
      areaKey: area.areaKey || '',
      label: area.label || '',
      countryCode: area.countryCode || 'ZW',
      centerLat: area.centerLat ?? '',
      centerLng: area.centerLng ?? '',
      westLng: area.westLng ?? '',
      southLat: area.southLat ?? '',
      eastLng: area.eastLng ?? '',
      northLat: area.northLat ?? '',
      sortOrder: area.sortOrder || 0,
      isActive: area.isActive !== false,
    })
    setSuccess('')
    setError('')
  }

  const saveArea = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const payload = {
        ...form,
        centerLat: Number(form.centerLat),
        centerLng: Number(form.centerLng),
        westLng: Number(form.westLng),
        southLat: Number(form.southLat),
        eastLng: Number(form.eastLng),
        northLat: Number(form.northLat),
        sortOrder: Number(form.sortOrder || 0),
      }
      if (form.id) {
        await axios.patch(`${BASE_URL}/api/admin/service-areas/${form.id}`, payload, { headers })
      } else {
        await axios.post(`${BASE_URL}/api/admin/service-areas`, payload, { headers })
      }
      setSuccess('Service area saved.')
      setForm(EMPTY_FORM)
      await loadAreas()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Could not save service area')
    } finally {
      setSaving(false)
    }
  }

  const deleteArea = async (area) => {
    if (!window.confirm(`Delete ${area.label}?`)) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await axios.delete(`${BASE_URL}/api/admin/service-areas/${area.id}`, { headers })
      setSuccess('Service area deleted.')
      await loadAreas()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Could not delete service area')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Business / Service Areas</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Service Areas</h1>
        <p className="mt-1 text-xs text-slate-500">
          Add cities or zones where passengers can book rides and where registration city is detected.
        </p>
      </div>

      {error ? <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="border border-slate-300 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Active and inactive areas</p>
            <p className="mt-1 text-xs text-slate-500">Bounds are rectangular: west/south/east/north coordinates.</p>
          </div>
          {loading ? (
            <div className="px-4 py-8 text-sm text-slate-500">Loading service areas...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Area</th>
                    <th className="px-4 py-3">Center</th>
                    <th className="px-4 py-3">Bounds</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {areas.map((area) => (
                    <tr key={area.id}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{area.label}</p>
                        <p className="text-xs text-slate-500">{area.areaKey}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{area.centerLat}, {area.centerLng}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        W {area.westLng} / S {area.southLat} / E {area.eastLng} / N {area.northLat}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${area.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {area.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button type="button" onClick={() => editArea(area)} className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">Edit</button>
                          {canManage ? (
                            <button type="button" onClick={() => deleteArea(area)} className="text-xs font-semibold text-rose-700 hover:text-rose-900">Delete</button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!areas.length ? <div className="px-4 py-8 text-sm text-slate-500">No service areas configured.</div> : null}
            </div>
          )}
        </div>

        <form onSubmit={saveArea} className="space-y-3 border border-slate-300 bg-white px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">{form.id ? 'Edit service area' : 'Add service area'}</p>
            <p className="mt-1 text-xs text-slate-500">Use coordinates around the city or operating zone.</p>
          </div>
          <Input label="Area name" value={form.label} onChange={(value) => updateForm('label', value)} placeholder="e.g. Harare" />
          <Input label="Area key" value={form.areaKey} onChange={(value) => updateForm('areaKey', value)} placeholder="harare" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Country" value={form.countryCode} onChange={(value) => updateForm('countryCode', value)} />
            <Input label="Sort order" type="number" value={form.sortOrder} onChange={(value) => updateForm('sortOrder', value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Center lat" type="number" value={form.centerLat} onChange={(value) => updateForm('centerLat', value)} />
            <Input label="Center lng" type="number" value={form.centerLng} onChange={(value) => updateForm('centerLng', value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="West lng" type="number" value={form.westLng} onChange={(value) => updateForm('westLng', value)} />
            <Input label="South lat" type="number" value={form.southLat} onChange={(value) => updateForm('southLat', value)} />
            <Input label="East lng" type="number" value={form.eastLng} onChange={(value) => updateForm('eastLng', value)} />
            <Input label="North lat" type="number" value={form.northLat} onChange={(value) => updateForm('northLat', value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.isActive} onChange={(event) => updateForm('isActive', event.target.checked)} />
            Active
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={!canManage || saving} className="h-10 bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              {saving ? 'Saving...' : form.id ? 'Update Area' : 'Add Area'}
            </button>
            <button type="button" onClick={() => setForm(EMPTY_FORM)} className="h-10 border border-slate-300 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Clear
            </button>
          </div>
          {!canManage ? <p className="text-xs text-slate-500">You need pricing manage permission to save changes.</p> : null}
        </form>
      </div>
    </section>
  )
}
