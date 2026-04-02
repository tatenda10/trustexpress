import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

function formatDateTime(value) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('en-ZW', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function generateAgentCode(fullName) {
  const cleanedName = String(fullName || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  const prefix = cleanedName.length
    ? cleanedName.map((part) => part.slice(0, 2)).join('').slice(0, 6)
    : 'AGENT'

  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `${prefix}-${suffix}`
}

function AgentModal({
  open,
  saving,
  form,
  setForm,
  onGenerateCode,
  onClose,
  onSubmit,
}) {
  if (!open) return null

  const passwordMismatch =
    form.confirmPassword.length > 0 && form.password !== form.confirmPassword

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-8">
      <div className="w-full max-w-2xl border border-slate-300 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Recruitment / Agents</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">Create Agent Account</h2>
            <p className="mt-1 text-xs text-slate-500">
              Create the agent profile and password here. These credentials will be used on the agent portal.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-sm border border-slate-300 text-slate-500 transition hover:border-slate-400 hover:text-slate-800"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Full Name</label>
              <input
                type="text"
                value={form.fullName}
                onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                className="mt-1 h-10 w-full border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500"
                placeholder="Agent full name"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Company Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                className="mt-1 h-10 w-full border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500"
                placeholder="agentname@trustexpress.co.zw"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Phone</label>
              <input
                type="text"
                value={form.phoneNumber}
                onChange={(event) => setForm((current) => ({ ...current, phoneNumber: event.target.value }))}
                className="mt-1 h-10 w-full border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500"
                placeholder="+263..."
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agent Code</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={form.employeeCode}
                  onChange={(event) => setForm((current) => ({ ...current, employeeCode: event.target.value }))}
                  className="h-10 min-w-0 flex-1 border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500"
                  placeholder="Optional code"
                />
                <button
                  type="button"
                  onClick={onGenerateCode}
                  className="h-10 shrink-0 rounded-sm border border-slate-300 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                >
                  Auto
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">ID Number</label>
              <input
                type="text"
                value={form.idNumber}
                onChange={(event) => setForm((current) => ({ ...current, idNumber: event.target.value }))}
                className="mt-1 h-10 w-full border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500"
                placeholder="National ID number"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                className="mt-1 h-10 w-full border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500"
                placeholder="Minimum 8 characters"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Confirm Password</label>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                className="mt-1 h-10 w-full border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500"
                placeholder="Re-enter password"
              />
              {passwordMismatch ? (
                <p className="mt-1 text-[11px] font-medium text-rose-600">Passwords do not match yet.</p>
              ) : form.password && form.confirmPassword ? (
                <p className="mt-1 text-[11px] font-medium text-emerald-600">Passwords match.</p>
              ) : null}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Address</label>
            <textarea
              value={form.address}
              onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
              className="mt-1 min-h-[92px] w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              placeholder="Residential or company address"
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-sm border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || passwordMismatch}
              className={`h-10 rounded-sm px-4 text-sm font-semibold text-white ${saving || passwordMismatch ? 'cursor-not-allowed bg-slate-300' : 'bg-[#16213a]'}`}
            >
              {saving ? 'Creating...' : 'Create Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AgentsPage() {
  const { token, can, admin } = useAuth()
  const isSuperAdmin = admin?.role === 'super_admin'
  const canReadAgents = isSuperAdmin || can('agents.read')
  const canManageAgents = isSuperAdmin || can('agents.manage')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [agents, setAgents] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phoneNumber: '',
    employeeCode: '',
    idNumber: '',
    address: '',
    password: '',
    confirmPassword: '',
  })

  const headers = useMemo(() => ({
    Authorization: `Bearer ${token}`,
  }), [token])

  const resetForm = () => {
    setForm({
      fullName: '',
      email: '',
      phoneNumber: '',
      employeeCode: '',
      idNumber: '',
      address: '',
      password: '',
      confirmPassword: '',
    })
  }

  const loadAgents = async () => {
    if (!canReadAgents) return
    setLoading(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/agents`, {
        headers,
        params: {
          search: appliedSearch || undefined,
          status: statusFilter,
        },
      })
      setAgents(Array.isArray(data?.agents) ? data.agents : [])
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to load agents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAgents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedSearch, statusFilter, token])

  const createAgent = async (event) => {
    event.preventDefault()
    if (!canManageAgents) return
    if (form.password !== form.confirmPassword) {
      toast.error('Password and confirm password do not match.')
      return
    }

    setSaving(true)
    try {
      await axios.post(`${BASE_URL}/api/admin/agents`, {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phoneNumber: form.phoneNumber.trim(),
        employeeCode: form.employeeCode.trim(),
        idNumber: form.idNumber.trim(),
        address: form.address.trim(),
        password: form.password,
      }, { headers })

      toast.success('Agent account created successfully.')
      resetForm()
      setCreateOpen(false)
      await loadAgents()
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to create agent')
    } finally {
      setSaving(false)
    }
  }

  const toggleAgentStatus = async (agentId, isActive) => {
    if (!canManageAgents) return
    try {
      await axios.patch(`${BASE_URL}/api/admin/agents/${agentId}/status`, {
        isActive: !isActive,
      }, { headers })
      toast.success(!isActive ? 'Agent activated.' : 'Agent deactivated.')
      await loadAgents()
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to update agent status')
    }
  }

  const handleGenerateCode = () => {
    setForm((current) => ({
      ...current,
      employeeCode: generateAgentCode(current.fullName),
    }))
  }

  return (
    <section className="space-y-4">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Users / Recruitment</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">Agents</h1>
            <p className="mt-1 text-xs text-slate-500">Create recruitment agents, set their login credentials, and control whether they can access the agent portal.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="min-w-[120px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Total Agents</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{agents.length}</p>
            </div>
            <div className="min-w-[120px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Active</p>
              <p className="mt-1 text-lg font-semibold text-emerald-700">{agents.filter((agent) => agent.isActive).length}</p>
            </div>
            <div className="min-w-[120px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Inactive</p>
              <p className="mt-1 text-lg font-semibold text-rose-700">{agents.filter((agent) => !agent.isActive).length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden border border-slate-300 bg-white">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setAppliedSearch(searchInput.trim())
                }
              }}
              placeholder="Search name, email, phone, code, ID number, or address"
              className="h-9 w-full border border-slate-300 bg-white px-3 text-xs outline-none focus:border-indigo-500 md:w-80"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 border border-slate-300 bg-white px-2 text-xs"
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button
              type="button"
              onClick={() => setAppliedSearch(searchInput.trim())}
              className="h-9 rounded-sm bg-[#16213a] px-4 text-xs font-semibold text-white"
            >
              Search
            </button>
          </div>
          {canManageAgents ? (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="h-9 rounded-sm bg-[#16213a] px-4 text-xs font-semibold uppercase tracking-wide text-white lg:ml-auto"
            >
              Create Agent
            </button>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#16213a] text-left text-[11px] uppercase tracking-wide text-slate-100">
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-4 py-2 font-semibold">Contact</th>
                <th className="px-4 py-2 font-semibold">Agent Details</th>
                <th className="px-4 py-2 font-semibold">Address</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Last Login</th>
                <th className="px-4 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">Loading agents...</td>
                </tr>
              ) : agents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">No agents found.</td>
                </tr>
              ) : (
                agents.map((agent) => (
                  <tr key={agent.id} className="border-b border-slate-200 align-top hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{agent.fullName}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div>{agent.email}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{agent.phoneNumber || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div>Code: {agent.employeeCode || '-'}</div>
                      <div className="mt-1 text-[11px] text-slate-500">ID: {agent.idNumber || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="max-w-[240px] whitespace-pre-wrap text-[11px] leading-5 text-slate-600">
                        {agent.address || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${agent.isActive ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'}`}>
                        {agent.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(agent.lastLoginAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleAgentStatus(agent.id, agent.isActive)}
                        disabled={!canManageAgents}
                        className={`rounded-sm px-3 py-1.5 text-[11px] font-semibold ${!canManageAgents ? 'cursor-not-allowed bg-slate-100 text-slate-400' : agent.isActive ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'}`}
                      >
                        {agent.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AgentModal
        open={createOpen}
        saving={saving}
        form={form}
        setForm={setForm}
        onGenerateCode={handleGenerateCode}
        onClose={() => {
          if (saving) return
          setCreateOpen(false)
          resetForm()
        }}
        onSubmit={createAgent}
      />
    </section>
  )
}
