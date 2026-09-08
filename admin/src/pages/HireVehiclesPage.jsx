import { useEffect, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'
import { resolveMediaUrl } from '../utils/media'

function statusClass(status) {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (status === 'rejected') return 'bg-rose-50 text-rose-700 ring-rose-200'
  return 'bg-amber-50 text-amber-700 ring-amber-200'
}

export default function HireVehiclesPage() {
  const { token, can, admin } = useAuth()
  const canReview = admin?.role === 'super_admin' || can('verification.review')
  const [status, setStatus] = useState('pending')
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = async () => {
    try {
      setLoading(true)
      setError('')
      const res = await axios.get(`${BASE_URL}/api/admin/hire/vehicles`, {
        headers: { Authorization: `Bearer ${token}` },
        params: status ? { status } : undefined,
      })
      setVehicles(res.data?.vehicles || [])
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load hire vehicles')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, status])

  const review = async (vehicleId, action) => {
    try {
      let rejectionReason = null
      if (action === 'reject') {
        rejectionReason = window.prompt('Rejection reason')
        if (!rejectionReason) return
      }
      setBusyId(vehicleId)
      await axios.patch(
        `${BASE_URL}/api/admin/hire/vehicles/${vehicleId}/review`,
        { action, rejectionReason },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      await load()
    } catch (err) {
      window.alert(err?.response?.data?.error || err.message || 'Review failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Hire vehicles</h1>
          <p className="mt-1 text-sm text-slate-500">Review vehicles drivers listed for transport hire.</p>
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}

      <div className="grid gap-3">
        {vehicles.map((vehicle) => {
          const photo = vehicle.photoUrls?.[0] ? resolveMediaUrl(vehicle.photoUrls[0]) : null
          return (
            <div key={vehicle.id} className="border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap gap-4">
                {photo ? (
                  <img src={photo} alt={vehicle.title} className="h-24 w-32 object-cover" />
                ) : (
                  <div className="flex h-24 w-32 items-center justify-center bg-slate-100 text-xs text-slate-400">No photo</div>
                )}
                <div className="min-w-[220px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-900">{vehicle.title}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusClass(vehicle.status)}`}>
                      {vehicle.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {vehicle.driverName || vehicle.driverUserId} · {vehicle.category}
                    {vehicle.make || vehicle.model ? ` · ${[vehicle.make, vehicle.model].filter(Boolean).join(' ')}` : ''}
                  </p>
                  {vehicle.rejectionReason ? (
                    <p className="mt-2 text-sm text-rose-600">{vehicle.rejectionReason}</p>
                  ) : null}
                </div>
                {canReview && vehicle.status === 'pending' ? (
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      disabled={busyId === vehicle.id}
                      onClick={() => review(vehicle.id, 'approve')}
                      className="rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === vehicle.id}
                      onClick={() => review(vehicle.id, 'reject')}
                      className="rounded bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
        {!loading && vehicles.length === 0 ? (
          <p className="text-sm text-slate-500">No hire vehicles for this filter.</p>
        ) : null}
      </div>
    </div>
  )
}
