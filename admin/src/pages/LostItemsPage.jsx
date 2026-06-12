import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import BASE_URL from '../context/Api'
import { useAuth } from '../authcontext/AuthContext'

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function statusBadge(status) {
  if (status === 'returned') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (status === 'contacted') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
  if (status === 'closed') return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
  return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
}

function priorityBadge(priority) {
  if (priority === 'high') return 'bg-orange-100 text-orange-800 ring-1 ring-orange-200'
  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
}

export default function LostItemsPage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const [lostItems, setLostItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

  const loadLostItems = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/rides/lost-items`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          status: statusFilter,
          search: appliedSearch,
        },
      })
      setLostItems(Array.isArray(data?.lostItems) ? data.lostItems : [])
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load lost item cases')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLostItems()
  }, [token, statusFilter, appliedSearch])

  const updateLostItem = async (item, patch) => {
    if (!token || !item?.id) return
    setSavingId(String(item.id))
    setError('')
    try {
      await axios.patch(`${BASE_URL}/api/admin/rides/lost-items/${item.id}`, patch, {
        headers: { Authorization: `Bearer ${token}` },
      })
      await loadLostItems()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to update lost item case')
    } finally {
      setSavingId('')
    }
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-slate-800">Lost Items</h1>
        <p className="text-xs text-slate-500">Full case management for passenger lost-property reports.</p>
      </div>

      {error ? <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div> : null}

      <div className="border border-slate-300 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search case, ride, rider, driver, route, or item..."
              className="h-9 w-full max-w-md border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-500"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-500"
            >
              <option value="open">Open only</option>
              <option value="contacted">Contacted only</option>
              <option value="returned">Returned only</option>
              <option value="closed">Closed only</option>
              <option value="all">All cases</option>
            </select>
            <button
              type="button"
              onClick={() => setAppliedSearch(searchInput.trim())}
              className="h-9 border border-indigo-600 bg-indigo-600 px-4 text-xs font-medium text-white transition hover:bg-indigo-700"
            >
              Search
            </button>
          </div>
          <div className="text-xs text-slate-500">{lostItems.length} case{lostItems.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="border border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">Loading lost item cases...</div>
        ) : lostItems.length === 0 ? (
          <div className="border border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">No lost item cases found.</div>
        ) : (
          lostItems.map((item) => (
            <article key={item.id} className="border border-slate-300 bg-white px-4 py-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium uppercase ${statusBadge(item.status)}`}>
                      {item.status}
                    </span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium uppercase ${priorityBadge(item.casePriority)}`}>
                      {item.casePriority || 'normal'}
                    </span>
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase text-slate-600">
                      {item.followUpStatus || 'pending'}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-slate-500">
                      Case {item.caseReference || `#${item.id}`}
                    </span>
                  </div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {item.ridePublicId || `ride #${item.rideRequestId}`} - {item.rider}
                  </h2>
                  <p className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</p>
                  <p className="text-sm text-slate-700">{item.itemDescription}</p>
                  <div className="grid gap-2 text-xs text-slate-500 md:grid-cols-2">
                    <p>Rider: {item.rider}</p>
                    <p>Driver: {item.driver}</p>
                    <p>Route: {item.route}</p>
                    <p>Contact: {item.contactPhone || '-'}</p>
                    <p>Last follow-up: {formatDateTime(item.lastFollowedUpAt)}</p>
                    <p>Resolved: {formatDateTime(item.resolvedAt)}</p>
                  </div>
                  {item.followUpNote ? (
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      Follow-up note: {item.followUpNote}
                    </div>
                  ) : null}
                  {item.adminNote ? (
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      Admin note: {item.adminNote}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2 xl:min-w-[220px]">
                  <button
                    type="button"
                    onClick={() => navigate(`/dashboard/ride-operations/${item.ridePublicId || item.rideRequestId}`)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Open ride case
                  </button>
                  <button
                    type="button"
                    disabled={savingId === String(item.id)}
                    onClick={() => updateLostItem(item, { status: 'contacted', followUpStatus: 'contacted' })}
                    className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    Mark contacted
                  </button>
                  <button
                    type="button"
                    disabled={savingId === String(item.id)}
                    onClick={() => {
                      const followUpNote = window.prompt('Add return note', item.followUpNote || '')
                      if (followUpNote === null) return
                      updateLostItem(item, {
                        status: 'returned',
                        followUpStatus: 'resolved',
                        followUpNote,
                        casePriority: 'high',
                      })
                    }}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    Mark returned
                  </button>
                  <button
                    type="button"
                    disabled={savingId === String(item.id)}
                    onClick={() => {
                      const followUpNote = window.prompt('Add closing note', item.followUpNote || item.adminNote || '')
                      if (followUpNote === null) return
                      updateLostItem(item, {
                        status: 'closed',
                        followUpStatus: 'closed',
                        followUpNote,
                      })
                    }}
                    className="rounded-md bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    Close case
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
