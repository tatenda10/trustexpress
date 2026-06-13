import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { toast } from 'react-toastify'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString()
}

function statusClass(status) {
  if (status === 'paid') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (status === 'approved') return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
  return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
}

export default function DriverDiscountReimbursementsPage() {
  const { token, can, admin } = useAuth()
  const canManage = admin?.role === 'super_admin' || can('payouts.manage')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [updatingId, setUpdatingId] = useState(null)
  const [summary, setSummary] = useState({ outstandingTotal: 0, paidTotal: 0, totalBatches: 0 })
  const [reimbursements, setReimbursements] = useState([])

  const loadBatches = async () => {
    if (!token) return
    setLoading(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/driver-discount-reimbursements`, { headers })
      setSummary(data?.summary || { outstandingTotal: 0, paidTotal: 0, totalBatches: 0 })
      setReimbursements(Array.isArray(data?.reimbursements) ? data.reimbursements : [])
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to load reimbursement ledger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBatches()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const handleGenerate = async () => {
    if (!canManage) return
    setGenerating(true)
    try {
      const { data } = await axios.post(`${BASE_URL}/api/admin/driver-discount-reimbursements/generate`, {}, { headers })
      toast.success(`Generated ${Number(data?.createdBatchCount || 0)} reimbursement batch(es)`)
      await loadBatches()
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to generate reimbursement batches')
    } finally {
      setGenerating(false)
    }
  }

  const handleStatusUpdate = async (batch, status) => {
    if (!canManage) return
    setUpdatingId(batch.id)
    try {
      await axios.patch(`${BASE_URL}/api/admin/driver-discount-reimbursements/${batch.id}`, {
        status,
        adminNote: batch.adminNote || '',
      }, { headers })
      toast.success(`Batch ${status}`)
      await loadBatches()
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to update reimbursement batch')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-sm border border-slate-300 bg-white p-4 shadow-sm">
        <h1 className="text-sm font-semibold text-slate-800">Driver Discount Reimbursements</h1>
        <p className="mt-1 text-xs text-slate-500">
          Track discount subsidy owed back to drivers. Batches only move forward when admin approves them.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <article className="border border-slate-300 bg-white p-4 shadow-sm">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Outstanding</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{formatCurrency(summary.outstandingTotal)}</p>
        </article>
        <article className="border border-slate-300 bg-white p-4 shadow-sm">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Paid</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{formatCurrency(summary.paidTotal)}</p>
        </article>
        <article className="border border-slate-300 bg-white p-4 shadow-sm">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Total Batches</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{Number(summary.totalBatches || 0)}</p>
        </article>
      </div>

      <div className="rounded-sm border border-slate-300 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-700">
            Generate weekly reimbursement batches from completed discounted rides that have not been settled yet.
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canManage || generating}
            className={`h-10 px-4 text-sm font-semibold text-white ${canManage && !generating ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-indigo-300'}`}
          >
            {generating ? 'Generating...' : 'Generate batches'}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-sm border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Reimbursement ledger
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-600">
                <th className="px-3 py-2">Driver</th>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Ride Count</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Timestamps</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading reimbursement ledger...</td>
                </tr>
              ) : reimbursements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No reimbursement batches yet.</td>
                </tr>
              ) : reimbursements.map((batch) => (
                <tr key={batch.id} className="border-b border-slate-200">
                  <td className="px-3 py-3">
                    <div className="font-medium text-slate-800">
                      {batch.driverName || 'Unknown driver'}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {batch.driverVehicleLabel || 'Vehicle not set'}
                      {batch.driverNumberPlate ? ` • ${batch.driverNumberPlate}` : ''}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {batch.driverPhoneNumber || 'No phone on file'}
                    </div>
                    <Link
                      to={`/dashboard/drivers/${batch.driverUserId}`}
                      className="mt-1 inline-block text-[11px] font-semibold text-indigo-600 hover:text-indigo-500"
                    >
                      View driver profile
                    </Link>
                    <div className="mt-1 font-mono text-[10px] text-slate-400">{batch.driverUserId}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {formatDate(batch.periodStart)} - {formatDate(batch.periodEnd)}
                  </td>
                  <td className="px-3 py-3 text-slate-700">{Number(batch.rideCount || 0)}</td>
                  <td className="px-3 py-3 font-semibold text-slate-900">{formatCurrency(batch.totalDiscountReimbursement)}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium uppercase ${statusClass(batch.status)}`}>
                      {batch.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-500">
                    <div>Created: {formatDate(batch.createdAt)}</div>
                    <div>Approved: {formatDate(batch.approvedAt)}</div>
                    <div>Paid: {formatDate(batch.paidAt)}</div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {batch.status !== 'approved' ? (
                        <button
                          type="button"
                          onClick={() => handleStatusUpdate(batch, 'approved')}
                          disabled={!canManage || updatingId === batch.id}
                          className="h-8 border border-blue-200 px-3 text-[11px] font-semibold text-blue-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                      ) : null}
                      {batch.status !== 'paid' ? (
                        <button
                          type="button"
                          onClick={() => handleStatusUpdate(batch, 'paid')}
                          disabled={!canManage || updatingId === batch.id}
                          className="h-8 border border-emerald-200 px-3 text-[11px] font-semibold text-emerald-700 disabled:opacity-50"
                        >
                          Mark paid
                        </button>
                      ) : null}
                      {batch.status !== 'pending' ? (
                        <button
                          type="button"
                          onClick={() => handleStatusUpdate(batch, 'pending')}
                          disabled={!canManage || updatingId === batch.id}
                          className="h-8 border border-slate-300 px-3 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                        >
                          Reopen
                        </button>
                      ) : null}
                    </div>
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
