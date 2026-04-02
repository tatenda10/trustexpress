import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

function emptyTierRow() {
  return {
    tierKey: '',
    tierName: '',
    shortDescription: '',
    vehicleRequirements: [''],
    passengerComfort: [''],
    driverRequirements: [''],
    useCases: [''],
    exampleVehicles: [''],
    isActive: true,
    sortOrder: 0,
  }
}

function normalizeList(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean)
}

function normalizeTierRows(rows = []) {
  return rows
    .map((row, index) => ({
      tierKey: String(row.tierKey || '').trim().toLowerCase(),
      tierName: String(row.tierName || '').trim(),
      shortDescription: String(row.shortDescription || '').trim(),
      vehicleRequirements: normalizeList(row.vehicleRequirements),
      passengerComfort: normalizeList(row.passengerComfort),
      driverRequirements: normalizeList(row.driverRequirements),
      useCases: normalizeList(row.useCases),
      exampleVehicles: normalizeList(row.exampleVehicles),
      isActive: row.isActive !== false,
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index,
    }))
    .filter((row) => row.tierKey && row.tierName)
}

function countActiveTiers(rows = []) {
  return rows.filter((row) => row.isActive !== false).length
}

function countExamples(rows = []) {
  return rows.reduce((total, row) => total + normalizeList(row.exampleVehicles).length, 0)
}

function rowsFromApi(tiers = []) {
  if (!tiers.length) return []
  return tiers.map((tier, index) => ({
    tierKey: tier.tierKey || '',
    tierName: tier.tierName || '',
    shortDescription: tier.shortDescription || '',
    vehicleRequirements: tier.vehicleRequirements?.length ? tier.vehicleRequirements : [''],
    passengerComfort: tier.passengerComfort?.length ? tier.passengerComfort : [''],
    driverRequirements: tier.driverRequirements?.length ? tier.driverRequirements : [''],
    useCases: tier.useCases?.length ? tier.useCases : [''],
    exampleVehicles: tier.exampleVehicles?.length ? tier.exampleVehicles : [''],
    isActive: tier.isActive !== false,
    sortOrder: tier.sortOrder ?? index,
  }))
}

function MultiLineListEditor({ label, rows, onChange, placeholder, disabled = false }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <textarea
        value={rows.join('\n')}
        onChange={(event) => onChange(event.target.value.split('\n'))}
        placeholder={placeholder}
        disabled={disabled}
        className="min-h-[96px] w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
      />
    </label>
  )
}

function TierStatusBadge({ active }) {
  return (
    <span
      className={`inline-flex px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
        active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'
      }`}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function TierModal({ mode, tier, onClose, onChange, onSave, canManage, saving }) {
  if (!tier) return null

  const isEdit = mode === 'edit' || mode === 'create'
  const title = mode === 'view' ? 'View Tier' : mode === 'create' ? 'Add Tier' : 'Edit Tier'

  const renderList = (label, rows) => (
    <div className="border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      {normalizeList(rows).length ? (
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          {normalizeList(rows).map((item, index) => (
            <li key={`${label}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-400">Nothing added.</p>
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden border border-slate-300 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">{tier.tierName || 'Untitled tier'}</h2>
          </div>
          <div className="flex items-center gap-2">
            <TierStatusBadge active={tier.isActive !== false} />
            <button
              type="button"
              onClick={onClose}
              className="h-9 border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isEdit ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_180px]">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tier Key</span>
                  <input
                    value={tier.tierKey}
                    onChange={(event) => onChange({ tierKey: event.target.value })}
                    placeholder="trust-xl"
                    disabled={!canManage}
                    className="h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tier Name</span>
                  <input
                    value={tier.tierName}
                    onChange={(event) => onChange({ tierName: event.target.value })}
                    placeholder="Trust XL"
                    disabled={!canManage}
                    className="h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
                  <select
                    value={tier.isActive ? 'active' : 'inactive'}
                    onChange={(event) => onChange({ isActive: event.target.value === 'active' })}
                    disabled={!canManage}
                    className="h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Short Description</span>
                <input
                  value={tier.shortDescription}
                  onChange={(event) => onChange({ shortDescription: event.target.value })}
                  placeholder="Premium ride option for executive and high-comfort trips."
                  disabled={!canManage}
                  className="h-10 w-full border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                />
              </label>

              <div className="grid gap-4 lg:grid-cols-2">
                <MultiLineListEditor
                  label="Vehicle Requirements"
                  rows={tier.vehicleRequirements}
                  onChange={(value) => onChange({ vehicleRequirements: value })}
                  placeholder={'One requirement per line\n2010 model or newer\nSeatbelts for all passengers'}
                  disabled={!canManage}
                />
                <MultiLineListEditor
                  label="Passenger Comfort"
                  rows={tier.passengerComfort}
                  onChange={(value) => onChange({ passengerComfort: value })}
                  placeholder={'One feature per line\nPhone charging ports\nOptional bottled water'}
                  disabled={!canManage}
                />
                <MultiLineListEditor
                  label="Driver Requirements"
                  rows={tier.driverRequirements}
                  onChange={(value) => onChange({ driverRequirements: value })}
                  placeholder={'One rule per line\nProfessional and respectful\nHigh driver rating'}
                  disabled={!canManage}
                />
                <MultiLineListEditor
                  label="Use Cases"
                  rows={tier.useCases}
                  onChange={(value) => onChange({ useCases: value })}
                  placeholder={'One use case per line\nAirport transfers\nBusiness group trips'}
                  disabled={!canManage}
                />
              </div>

              <MultiLineListEditor
                label="Example Vehicles"
                rows={tier.exampleVehicles}
                onChange={(value) => onChange({ exampleVehicles: value })}
                placeholder={'One example per line\nToyota Avanza\nHonda BR-V'}
                disabled={!canManage}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tier Key</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{tier.tierKey || '-'}</p>
                </div>
                <div className="border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tier Name</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{tier.tierName || '-'}</p>
                </div>
                <div className="border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Description</p>
                  <p className="mt-2 text-sm text-slate-700">{tier.shortDescription || 'No description added yet.'}</p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {renderList('Vehicle Requirements', tier.vehicleRequirements)}
                {renderList('Passenger Comfort', tier.passengerComfort)}
                {renderList('Driver Requirements', tier.driverRequirements)}
                {renderList('Use Cases', tier.useCases)}
              </div>

              {renderList('Example Vehicles', tier.exampleVehicles)}
            </div>
          )}
        </div>

        {isEdit ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
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
              className={`h-10 px-4 text-sm font-semibold text-white ${canManage && !saving ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-indigo-300'}`}
            >
              {saving ? 'Saving...' : 'Save Tier Changes'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function VehicleTiersPage() {
  const { token, can, admin } = useAuth()
  const canManage = admin?.role === 'super_admin' || can('pricing.manage')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tierRows, setTierRows] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [modalState, setModalState] = useState({ open: false, mode: 'view', index: null })

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const loadVehicleTiers = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/vehicle-tiers`, { headers })
      setTierRows(rowsFromApi(data.tiers || []))
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to load vehicle tiers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadVehicleTiers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const filteredIndexes = useMemo(() => {
    const search = String(appliedSearch || '').trim().toLowerCase()
    return tierRows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'active' && row.isActive !== false) ||
          (statusFilter === 'inactive' && row.isActive === false)
        if (!matchesStatus) return false
        if (!search) return true

        const haystack = [
          row.tierKey,
          row.tierName,
          row.shortDescription,
          ...normalizeList(row.vehicleRequirements),
          ...normalizeList(row.passengerComfort),
          ...normalizeList(row.driverRequirements),
          ...normalizeList(row.useCases),
          ...normalizeList(row.exampleVehicles),
        ]
          .join(' ')
          .toLowerCase()

        return haystack.includes(search)
      })
      .map(({ index }) => index)
  }, [tierRows, statusFilter, appliedSearch])

  const openModal = (mode, index = null) => {
    if (mode === 'create') {
      const nextIndex = tierRows.length
      setTierRows((current) => [...current, { ...emptyTierRow(), sortOrder: current.length }])
      setModalState({ open: true, mode, index: nextIndex })
      return
    }
    setModalState({ open: true, mode, index })
  }

  const closeModal = () => {
    if (modalState.mode === 'create') {
      const currentRow = tierRows[modalState.index]
      const isUntouched =
        currentRow &&
        !currentRow.tierKey &&
        !currentRow.tierName &&
        !currentRow.shortDescription &&
        normalizeList(currentRow.vehicleRequirements).length === 0 &&
        normalizeList(currentRow.passengerComfort).length === 0 &&
        normalizeList(currentRow.driverRequirements).length === 0 &&
        normalizeList(currentRow.useCases).length === 0 &&
        normalizeList(currentRow.exampleVehicles).length === 0

      if (isUntouched) {
        setTierRows((current) => current.filter((_, index) => index !== modalState.index))
      }
    }
    setModalState({ open: false, mode: 'view', index: null })
  }

  const updateTierRow = (index, patch) => {
    setTierRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }

  const removeTier = (index) => {
    const confirmed = window.confirm('Remove this vehicle tier?')
    if (!confirmed) return
    setTierRows((current) => current.filter((_, rowIndex) => rowIndex !== index))
    setModalState((current) => {
      if (!current.open) return current
      if (current.index === index) return { open: false, mode: 'view', index: null }
      if (current.index > index) return { ...current, index: current.index - 1 }
      return current
    })
  }

  const saveVehicleTiers = async (preserveIndex = null) => {
    if (!canManage) return
    const tiers = normalizeTierRows(tierRows)
    setSaving(true)
    try {
      const currentKey =
        preserveIndex !== null && preserveIndex >= 0
          ? tierRows[preserveIndex]?.tierKey
          : null
      const { data } = await axios.put(`${BASE_URL}/api/admin/vehicle-tiers`, { tiers }, { headers })
      const nextRows = rowsFromApi(data.tiers || [])
      setTierRows(nextRows)
      toast.success('Vehicle tiers saved')

      if (preserveIndex !== null) {
        const nextIndex = nextRows.findIndex((row) => row.tierKey === currentKey)
        setModalState({
          open: false,
          mode: 'view',
          index: nextIndex >= 0 ? nextIndex : null,
        })
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to save vehicle tiers')
    } finally {
      setSaving(false)
    }
  }

  const applySearch = () => {
    setAppliedSearch(String(searchInput || '').trim())
  }

  const selectedTier =
    modalState.open && modalState.index !== null
      ? tierRows[modalState.index] || null
      : null

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Business / Vehicle Tiers</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">Vehicle Tiers</h1>
            <p className="mt-1 text-xs text-slate-500">
              View all vehicle tiers first, then open one in a modal to inspect or edit it.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Total Tiers</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{tierRows.length}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Active</p>
              <p className="mt-1 text-lg font-semibold text-emerald-700">{countActiveTiers(tierRows)}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Examples</p>
              <p className="mt-1 text-lg font-semibold text-slate-800">{countExamples(tierRows)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="border border-slate-300 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Actions</p>
            <p className="mt-1 text-xs text-slate-500">Browse the saved tiers, filter them, then use modal actions to view or edit.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openModal('create')}
              className="bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Add Tier
            </button>
          </div>
        </div>

        <div className="grid gap-3 border-b border-slate-200 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_220px_120px]">
          <div className="flex gap-2">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applySearch()
              }}
              placeholder="Search by tier, description, requirement, or example vehicle"
              className="h-10 flex-1 border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={applySearch}
              className="h-10 bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Search
            </button>
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-500"
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <div className="flex items-center justify-start text-xs text-slate-500 lg:justify-end">
            {filteredIndexes.length} tier{filteredIndexes.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="border-b border-slate-200 bg-[#16213a] px-4 py-3">
          <div className="grid gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-100 md:grid-cols-[1.1fr_0.8fr_0.7fr_0.7fr]">
            <span>Tier</span>
            <span>Status</span>
            <span>Examples</span>
            <span>Actions</span>
          </div>
        </div>

        <div className="max-h-[72vh] overflow-y-auto">
          {loading ? (
            <div className="px-4 py-6 text-sm text-slate-500">Loading vehicle tiers...</div>
          ) : filteredIndexes.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-500">No vehicle tiers match the current filter.</div>
          ) : (
            filteredIndexes.map((index) => {
              const row = tierRows[index]
              return (
                <div key={`${row.tierKey || 'tier'}-${index}`} className="border-b border-slate-200 px-4 py-3">
                  <div className="grid gap-3 md:grid-cols-[1.1fr_0.8fr_0.7fr_0.7fr] md:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{row.tierName || 'Untitled tier'}</p>
                      <p className="mt-1 truncate text-xs uppercase tracking-[0.16em] text-slate-500">{row.tierKey || 'missing-key'}</p>
                      {row.shortDescription ? (
                        <p className="mt-2 line-clamp-2 text-xs text-slate-500">{row.shortDescription}</p>
                      ) : null}
                    </div>
                    <div>
                      <TierStatusBadge active={row.isActive !== false} />
                    </div>
                    <div className="text-sm text-slate-600">{normalizeList(row.exampleVehicles).length}</div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <button
                        type="button"
                        onClick={() => openModal('view', index)}
                        className="h-9 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => openModal('edit', index)}
                        className="h-9 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeTier(index)}
                        className="h-9 border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-100"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {modalState.open ? (
        <TierModal
          mode={modalState.mode}
          tier={selectedTier}
          onClose={closeModal}
          onChange={(patch) => {
            if (modalState.index !== null) {
              setTierRows((current) =>
                current.map((row, index) => (index === modalState.index ? { ...row, ...patch } : row))
              )
            }
          }}
          onSave={() => saveVehicleTiers(modalState.index)}
          canManage={canManage}
          saving={saving}
        />
      ) : null}
    </section>
  )
}
