import { useEffect, useState } from 'react'
import axios from 'axios'
import BASE_URL from '../context/Api'
import { useAuth } from '../authcontext/AuthContext'

const SCOPES = [
  { value: 'all', label: 'All activity' },
  { value: 'login', label: 'Login' },
  { value: 'request_rides', label: 'Request rides' },
  { value: 'go_online', label: 'Go online' },
  { value: 'accept_rides', label: 'Accept rides' },
  { value: 'cash_out', label: 'Cash out' },
]

const DURATIONS = [
  { value: '12h', label: '12 hours' },
  { value: '24h', label: '24 hours' },
  { value: '48h', label: '48 hours' },
  { value: 'custom', label: 'Custom' },
  { value: 'permanent', label: 'Permanent' },
]

function formatDateTime(value) {
  if (!value) return 'Permanent'
  return new Date(value).toLocaleString()
}

function statusBadge(status) {
  if (status === 'active') return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
  if (status === 'lifted') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
}

function displayUser(item) {
  return item?.user?.fullName || item?.user?.email || item?.user?.phoneNumber || item?.userId || 'User'
}

export default function AccountRestrictionsPage() {
  const { token, can, admin } = useAuth()
  const canManage = admin?.role === 'super_admin' || can('account_restrictions.manage')
  const [restrictions, setRestrictions] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [audit, setAudit] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [form, setForm] = useState({
    userId: '',
    userRole: 'any',
    scope: 'all',
    duration: '24h',
    expiresAt: '',
    reason: '',
  })

  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  const loadRestrictions = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/account-restrictions`, {
        headers,
        params: {
          status: statusFilter,
          q: appliedSearch,
        },
      })
      setRestrictions(Array.isArray(data?.restrictions) ? data.restrictions : [])
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load account restrictions')
    } finally {
      setLoading(false)
    }
  }

  const loadUserHistory = async (userId) => {
    if (!token || !userId) return
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/account-restrictions/users/${encodeURIComponent(userId)}`, {
        headers,
      })
      setSelectedUser(data?.user || { id: userId })
      setHistory(Array.isArray(data?.restrictions) ? data.restrictions : [])
      setAudit(Array.isArray(data?.audit) ? data.audit : [])
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load user restriction history')
    }
  }

  useEffect(() => {
    loadRestrictions()
  }, [token, statusFilter, appliedSearch])

  const createRestriction = async (event) => {
    event.preventDefault()
    if (!token || !canManage) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await axios.post(`${BASE_URL}/api/admin/account-restrictions`, form, { headers })
      setSuccess('Restriction created.')
      setForm((prev) => ({ ...prev, reason: '' }))
      await loadRestrictions()
      if (form.userId) await loadUserHistory(form.userId)
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create restriction')
    } finally {
      setSaving(false)
    }
  }

  const liftRestriction = async (restriction) => {
    if (!token || !canManage) return
    const reason = window.prompt('Reason for unblocking/lifting this restriction?', 'Manual admin unblock')
    if (reason === null) return
    setSaving(true)
    setError('')
    try {
      await axios.patch(`${BASE_URL}/api/admin/account-restrictions/${restriction.id}/lift`, { reason }, { headers })
      setSuccess('Restriction lifted.')
      await loadRestrictions()
      await loadUserHistory(restriction.userId)
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to lift restriction')
    } finally {
      setSaving(false)
    }
  }

  const extendRestriction = async (restriction, duration) => {
    if (!token || !canManage) return
    const reason = window.prompt('Reason for extending this restriction?', 'Manual admin extension')
    if (reason === null) return
    setSaving(true)
    setError('')
    try {
      await axios.patch(
        `${BASE_URL}/api/admin/account-restrictions/${restriction.id}/extend`,
        { duration, reason },
        { headers },
      )
      setSuccess('Restriction extended.')
      await loadRestrictions()
      await loadUserHistory(restriction.userId)
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to extend restriction')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-slate-800">Account Restrictions</h1>
        <p className="text-xs text-slate-500">Temporarily or permanently block specific user actions without deleting accounts.</p>
      </div>

      {error ? <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div> : null}
      {success ? <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{success}</div> : null}

      <div className="grid gap-3 xl:grid-cols-[420px_1fr]">
        <form onSubmit={createRestriction} className="space-y-3 border border-slate-300 bg-white px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Manual block/restriction</h2>
            <p className="text-xs text-slate-500">Use the Clerk user ID from driver/passenger details.</p>
          </div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            User ID
            <input
              value={form.userId}
              onChange={(event) => setForm((prev) => ({ ...prev, userId: event.target.value }))}
              placeholder="user_... or whatsapp:263..."
              className="mt-1 h-9 w-full border border-slate-300 px-3 text-xs normal-case tracking-normal text-slate-800 outline-none focus:border-indigo-500"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Role
              <select
                value={form.userRole}
                onChange={(event) => setForm((prev) => ({ ...prev, userRole: event.target.value }))}
                className="mt-1 h-9 w-full border border-slate-300 px-3 text-xs normal-case tracking-normal text-slate-800 outline-none focus:border-indigo-500"
              >
                <option value="any">Any</option>
                <option value="passenger">Passenger</option>
                <option value="driver">Driver</option>
              </select>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Scope
              <select
                value={form.scope}
                onChange={(event) => setForm((prev) => ({ ...prev, scope: event.target.value }))}
                className="mt-1 h-9 w-full border border-slate-300 px-3 text-xs normal-case tracking-normal text-slate-800 outline-none focus:border-indigo-500"
              >
                {SCOPES.map((scope) => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Duration
              <select
                value={form.duration}
                onChange={(event) => setForm((prev) => ({ ...prev, duration: event.target.value }))}
                className="mt-1 h-9 w-full border border-slate-300 px-3 text-xs normal-case tracking-normal text-slate-800 outline-none focus:border-indigo-500"
              >
                {DURATIONS.map((duration) => <option key={duration.value} value={duration.value}>{duration.label}</option>)}
              </select>
            </label>
            {form.duration === 'custom' ? (
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Expires at
                <input
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={(event) => setForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
                  className="mt-1 h-9 w-full border border-slate-300 px-3 text-xs normal-case tracking-normal text-slate-800 outline-none focus:border-indigo-500"
                />
              </label>
            ) : null}
          </div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Reason shown to user
            <textarea
              value={form.reason}
              onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
              rows={4}
              placeholder="Explain the rule violation and what the user should do next."
              className="mt-1 w-full border border-slate-300 px-3 py-2 text-xs normal-case tracking-normal text-slate-800 outline-none focus:border-indigo-500"
            />
          </label>
          <button
            type="submit"
            disabled={!canManage || saving}
            className="h-9 w-full bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-50"
          >
            Create restriction
          </button>
        </form>

        <div className="space-y-3">
          <div className="border border-slate-300 bg-white px-4 py-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search user, phone, reason..."
                  className="h-9 w-full max-w-md border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none focus:border-indigo-500"
                />
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="h-9 border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none focus:border-indigo-500"
                >
                  <option value="active">Active only</option>
                  <option value="lifted">Lifted only</option>
                  <option value="expired">Expired only</option>
                  <option value="all">All</option>
                </select>
                <button
                  type="button"
                  onClick={() => setAppliedSearch(searchInput.trim())}
                  className="h-9 border border-indigo-600 bg-indigo-600 px-4 text-xs font-medium text-white hover:bg-indigo-700"
                >
                  Search
                </button>
              </div>
              <div className="text-xs text-slate-500">{restrictions.length} restriction{restrictions.length === 1 ? '' : 's'}</div>
            </div>
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="border border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">Loading restrictions...</div>
            ) : restrictions.length === 0 ? (
              <div className="border border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">No restrictions found.</div>
            ) : restrictions.map((restriction) => (
              <article key={restriction.id} className="border border-slate-300 bg-white px-4 py-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium uppercase ${statusBadge(restriction.status)}`}>
                        {restriction.status}
                      </span>
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase text-slate-700">
                        {restriction.scope}
                      </span>
                      <span className="text-[11px] uppercase tracking-wide text-slate-500">{restriction.userRole}</span>
                    </div>
                    <h2 className="text-sm font-semibold text-slate-900">{displayUser(restriction)}</h2>
                    <p className="break-all text-xs text-slate-500">{restriction.userId}</p>
                    <p className="text-sm text-slate-700">{restriction.reason}</p>
                    <div className="grid gap-2 text-xs text-slate-500 md:grid-cols-2">
                      <p>Created: {formatDateTime(restriction.createdAt)}</p>
                      <p>Expires: {formatDateTime(restriction.expiresAt)}</p>
                      <p>Phone: {restriction.user?.phoneNumber || '-'}</p>
                      <p>Email: {restriction.user?.email || '-'}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 xl:min-w-[180px]">
                    <button
                      type="button"
                      onClick={() => loadUserHistory(restriction.userId)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      View audit
                    </button>
                    {restriction.status === 'active' && canManage ? (
                      <>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => extendRestriction(restriction, '24h')}
                          className="rounded-md bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          Extend 24h
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => liftRestriction(restriction)}
                          className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          Unblock
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>

      {selectedUser ? (
        <div className="border border-slate-300 bg-white px-4 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Audit history: {selectedUser.fullName || selectedUser.email || selectedUser.id}</h2>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Restrictions</p>
              <div className="space-y-2">
                {history.length ? history.map((item) => (
                  <div key={item.id} className="border border-slate-200 px-3 py-2 text-xs text-slate-600">
                    <p className="font-semibold text-slate-800">{item.scope} - {item.status}</p>
                    <p>{item.reason}</p>
                    <p>Expires: {formatDateTime(item.expiresAt)}</p>
                  </div>
                )) : <p className="text-xs text-slate-500">No restriction history.</p>}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Audit events</p>
              <div className="space-y-2">
                {audit.length ? audit.map((item) => (
                  <div key={item.id} className="border border-slate-200 px-3 py-2 text-xs text-slate-600">
                    <p className="font-semibold uppercase text-slate-800">{item.action}</p>
                    <p>{item.reason || '-'}</p>
                    <p>{formatDateTime(item.createdAt)}</p>
                  </div>
                )) : <p className="text-xs text-slate-500">No audit events.</p>}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
