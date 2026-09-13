import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

function emptyType(index = 0) {
  return {
    typeKey: '',
    typeName: '',
    pricePerKm: '1.00',
    isActive: true,
    sortOrder: index + 1,
  }
}

function rowsFromApi(types = []) {
  return (Array.isArray(types) ? types : []).map((type, index) => ({
    typeKey: type.typeKey || '',
    typeName: type.typeName || '',
    pricePerKm: String(type.pricePerKm ?? '1'),
    isActive: type.isActive !== false,
    sortOrder: Number.isFinite(Number(type.sortOrder)) ? Number(type.sortOrder) : index + 1,
  }))
}

export default function HireVehicleTypesPage() {
  const { token, can, admin } = useAuth()
  const canManage = admin?.role === 'super_admin' || can('pricing.manage')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [types, setTypes] = useState([emptyType()])

  const loadTypes = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/hire-types`, { headers })
      setTypes(rowsFromApi(data?.types).length ? rowsFromApi(data.types) : [emptyType()])
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to load hire types')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return undefined
    loadTypes()
    return undefined
  }, [token])

  const updateType = (index, patch) => {
    setTypes((current) => current.map((type, typeIndex) => (
      typeIndex === index ? { ...type, ...patch } : type
    )))
  }

  const saveTypes = async (event) => {
    event.preventDefault()
    if (!canManage) return
    setSaving(true)
    try {
      const { data } = await axios.put(`${BASE_URL}/api/admin/hire-types`, {
        types: types.map((type, index) => ({
          typeKey: type.typeKey,
          typeName: type.typeName,
          pricePerKm: Number(type.pricePerKm),
          isActive: type.isActive !== false,
          sortOrder: Number(type.sortOrder || index + 1),
        })),
      }, { headers })
      setTypes(rowsFromApi(data?.types))
      toast.success('Hire vehicle types saved')
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to save hire types')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Business / Pricing</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Hire vehicle types</h1>
        <p className="mt-1 text-xs text-slate-500">
          Create the vehicle types passengers can hire. Set a starting rate per kilometre.
          A 20 km truck at $1/km shows an offer range of $20–$30.
        </p>
      </div>

      {loading ? (
        <div className="border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">Loading types...</div>
      ) : (
        <form onSubmit={saveTypes} className="space-y-4">
          {types.map((type, index) => (
            <div key={`${type.typeKey || 'new'}-${index}`} className="border border-slate-200 bg-white p-4">
              <div className="grid gap-3 md:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Type name</span>
                  <input
                    value={type.typeName}
                    disabled={!canManage}
                    onChange={(event) => updateType(index, { typeName: event.target.value })}
                    placeholder="Truck"
                    className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Key</span>
                  <input
                    value={type.typeKey}
                    disabled={!canManage}
                    onChange={(event) => updateType(index, { typeKey: event.target.value })}
                    placeholder="truck"
                    className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rate per km (USD)</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={type.pricePerKm}
                    disabled={!canManage}
                    onChange={(event) => updateType(index, { pricePerKm: event.target.value })}
                    className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                  />
                </label>
                <label className="flex items-end gap-3 pb-2">
                  <input
                    type="checkbox"
                    checked={type.isActive !== false}
                    disabled={!canManage}
                    onChange={(event) => updateType(index, { isActive: event.target.checked })}
                  />
                  <span className="text-sm text-slate-700">Active</span>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => setTypes((current) => current.filter((_, typeIndex) => typeIndex !== index))}
                      className="ml-auto text-xs font-semibold text-rose-600"
                    >
                      Remove
                    </button>
                  ) : null}
                </label>
              </div>
            </div>
          ))}

          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTypes((current) => [...current, emptyType(current.length)])}
                className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
              >
                Add type
              </button>
              <button
                type="submit"
                disabled={saving}
                className="bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save types'}
              </button>
            </div>
          ) : null}
        </form>
      )}
    </div>
  )
}
