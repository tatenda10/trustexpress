import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

function normalizeModels(values = []) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

function rowsFromApi(catalog = []) {
  return catalog.map((item, index) => ({
    make: item.make || '',
    models: Array.isArray(item.models) && item.models.length ? item.models : [''],
    isActive: item.isActive !== false,
    sortOrder: item.sortOrder ?? index,
  }))
}

function normalizeRows(rows = []) {
  return rows
    .map((row, index) => ({
      make: String(row.make || '').trim(),
      models: normalizeModels(row.models),
      isActive: row.isActive !== false,
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index,
    }))
    .filter((row) => row.make && row.models.length > 0)
}

function emptyRow() {
  return {
    make: '',
    models: [''],
    isActive: true,
    sortOrder: 0,
  }
}

function CatalogModal({ row, mode, onClose, onChange, onSave, saving, canManage }) {
  if (!row) return null

  const isEdit = mode === 'edit' || mode === 'create'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden border border-slate-300 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {mode === 'create' ? 'Add Make' : mode === 'edit' ? 'Edit Make' : 'View Make'}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">{row.make || 'Untitled make'}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isEdit ? (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Make</span>
                <input
                  value={row.make}
                  onChange={(event) => onChange({ make: event.target.value })}
                  disabled={!canManage}
                  placeholder="Toyota"
                  className="h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Models</span>
                <textarea
                  value={row.models.join('\n')}
                  onChange={(event) => onChange({ models: event.target.value.split('\n') })}
                  disabled={!canManage}
                  placeholder={'One model per line\nCorolla\nVitz\nPasso'}
                  className="min-h-[220px] w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
                  <select
                    value={row.isActive ? 'active' : 'inactive'}
                    onChange={(event) => onChange({ isActive: event.target.value === 'active' })}
                    disabled={!canManage}
                    className="h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sort Order</span>
                  <input
                    value={row.sortOrder}
                    onChange={(event) => onChange({ sortOrder: event.target.value })}
                    disabled={!canManage}
                    className="h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Models</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {normalizeModels(row.models).map((model) => (
                    <span key={model} className="border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                      {model}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {isEdit ? (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="h-10 border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!canManage || saving}
              className="h-10 bg-[#16213a] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function VehicleCatalogPage() {
  const { token, admin, can } = useAuth()
  const canManage = admin?.role === 'super_admin' || can('pricing.manage')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [modalMode, setModalMode] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [draftRow, setDraftRow] = useState(null)

  const headers = useMemo(() => ({
    Authorization: `Bearer ${token}`,
  }), [token])

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      try {
        const { data } = await axios.get(`${BASE_URL}/api/admin/vehicle-catalog`, { headers })
        if (!active) return
        setRows(rowsFromApi(data?.catalog || []))
      } catch (err) {
        if (!active) return
        toast.error(err?.response?.data?.error || err?.message || 'Failed to load vehicle catalog')
      } finally {
        if (active) setLoading(false)
      }
    }

    if (token) {
      load()
    }

    return () => {
      active = false
    }
  }, [token, headers])

  const filteredRows = rows.filter((row) => {
    const term = search.trim().toLowerCase()
    if (!term) return true
    return [row.make, ...normalizeModels(row.models)].join(' ').toLowerCase().includes(term)
  })

  const openModal = (mode, index = -1) => {
    setModalMode(mode)
    setSelectedIndex(index)
    setDraftRow(index >= 0 ? { ...rows[index], models: [...rows[index].models] } : emptyRow())
  }

  const closeModal = () => {
    setModalMode(null)
    setSelectedIndex(-1)
    setDraftRow(null)
  }

  const saveDraft = async () => {
    const normalizedDraft = normalizeRows([{ ...draftRow, sortOrder: draftRow?.sortOrder }])[0]
    if (!normalizedDraft) {
      toast.error('Make and at least one model are required')
      return
    }

    const nextRows = [...rows]
    if (modalMode === 'create') {
      nextRows.push({ ...normalizedDraft, sortOrder: rows.length })
    } else if (selectedIndex >= 0) {
      nextRows[selectedIndex] = normalizedDraft
    }

    setSaving(true)
    try {
      const payload = { catalog: normalizeRows(nextRows) }
      const { data } = await axios.put(`${BASE_URL}/api/admin/vehicle-catalog`, payload, { headers })
      setRows(rowsFromApi(data?.catalog || []))
      toast.success('Vehicle catalog saved')
      closeModal()
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to save vehicle catalog')
    } finally {
      setSaving(false)
    }
  }

  const removeRow = async (index) => {
    if (!canManage) return
    const nextRows = rows.filter((_, rowIndex) => rowIndex !== index)
    setSaving(true)
    try {
      const { data } = await axios.put(
        `${BASE_URL}/api/admin/vehicle-catalog`,
        { catalog: normalizeRows(nextRows) },
        { headers }
      )
      setRows(rowsFromApi(data?.catalog || []))
      toast.success('Vehicle make removed')
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to remove make')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Business / Vehicle Catalog</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Vehicle Makes & Models</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Control which vehicle makes and models appear in driver car registration. Drivers will receive this catalog from the API.
        </p>
      </section>

      <section className="border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search make or model"
            className="h-11 w-full max-w-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={() => openModal('create')}
            disabled={!canManage}
            className="h-11 bg-[#16213a] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add Make
          </button>
        </div>
      </section>

      <section className="border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="bg-[#16213a] text-white">
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Make</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Models</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Order</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="px-4 py-6 text-sm text-slate-500">Loading vehicle catalog...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan="5" className="px-4 py-6 text-sm text-slate-500">No vehicle makes match the current filter.</td></tr>
              ) : (
                filteredRows.map((row, index) => (
                  <tr key={`${row.make}-${index}`} className="border-t border-slate-100">
                    <td className="px-4 py-4 text-sm font-semibold text-slate-900">{row.make}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{normalizeModels(row.models).join(', ')}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{row.isActive ? 'Active' : 'Inactive'}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{row.sortOrder}</td>
                    <td className="px-4 py-4 text-sm">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => openModal('view', index)} className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">View</button>
                        <button type="button" onClick={() => openModal('edit', index)} disabled={!canManage} className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Edit</button>
                        <button type="button" onClick={() => removeRow(index)} disabled={!canManage || saving} className="border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <CatalogModal
        row={draftRow}
        mode={modalMode}
        onClose={closeModal}
        onChange={(patch) => setDraftRow((current) => ({ ...current, ...patch }))}
        onSave={saveDraft}
        saving={saving}
        canManage={canManage}
      />
    </div>
  )
}
