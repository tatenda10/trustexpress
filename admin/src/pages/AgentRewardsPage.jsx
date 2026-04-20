import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

const DEFAULT_TIERS = [
  { ridesThreshold: 8, rewardAmountUsd: 3, isActive: true, sortOrder: 0 },
  { ridesThreshold: 15, rewardAmountUsd: 4, isActive: true, sortOrder: 1 },
  { ridesThreshold: 25, rewardAmountUsd: 5, isActive: true, sortOrder: 2 },
  { ridesThreshold: 35, rewardAmountUsd: 6, isActive: true, sortOrder: 3 },
  { ridesThreshold: 50, rewardAmountUsd: 7, isActive: true, sortOrder: 4 },
]

function formatUsd(value) {
  return `USD ${Number(value || 0).toFixed(2)}`
}

export default function AgentRewardsPage() {
  const { token, can, admin } = useAuth()
  const canManage = admin?.role === 'super_admin' || can('payouts.manage')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tiers, setTiers] = useState([])
  const [agents, setAgents] = useState([])
  const [redemptions, setRedemptions] = useState([])
  const [activeTab, setActiveTab] = useState('config')
  const [reviewingId, setReviewingId] = useState(null)
  const [totals, setTotals] = useState({
    totalAgents: 0,
    totalUnlockedTiers: 0,
    totalCompletedRides: 0,
    totalPayoutUsd: 0,
    totalLifetimeRedeemedUsd: 0,
  })

  const loadData = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/agent-rewards`, { headers })
      setTiers(Array.isArray(data?.tiers) && data.tiers.length ? data.tiers : DEFAULT_TIERS)
      setAgents(Array.isArray(data?.agents) ? data.agents : [])
      const redemptionResp = await axios.get(`${BASE_URL}/api/admin/agent-rewards/redemptions`, { headers })
      setRedemptions(Array.isArray(redemptionResp?.data?.redemptions) ? redemptionResp.data.redemptions : [])
      setTotals(data?.totals || {
        totalAgents: 0,
        totalUnlockedTiers: 0,
        totalCompletedRides: 0,
        totalPayoutUsd: 0,
        totalLifetimeRedeemedUsd: 0,
      })
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to load agent rewards')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const setTierPatch = (index, patch) => {
    setTiers((current) =>
      current.map((tier, tierIndex) => (tierIndex === index ? { ...tier, ...patch } : tier))
    )
  }

  const addTier = () => {
    setTiers((current) => [...current, {
      ridesThreshold: '',
      rewardAmountUsd: '',
      isActive: true,
      sortOrder: current.length,
    }])
  }

  const removeTier = (index) => {
    setTiers((current) => current.filter((_, tierIndex) => tierIndex !== index).map((tier, sortOrder) => ({ ...tier, sortOrder })))
  }

  const saveTiers = async () => {
    if (!canManage) return
    setSaving(true)
    try {
      const payloadTiers = tiers
        .map((tier, index) => ({
          ridesThreshold: Number(tier.ridesThreshold),
          rewardAmountUsd: Number(tier.rewardAmountUsd),
          isActive: tier.isActive !== false,
          sortOrder: Number.isFinite(Number(tier.sortOrder)) ? Number(tier.sortOrder) : index,
        }))
        .filter((tier) => Number.isInteger(tier.ridesThreshold) && tier.ridesThreshold > 0 && Number.isFinite(tier.rewardAmountUsd) && tier.rewardAmountUsd >= 0)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const { data } = await axios.put(`${BASE_URL}/api/admin/agent-rewards/tiers`, { tiers: payloadTiers }, { headers })
      setTiers(Array.isArray(data?.tiers) ? data.tiers : payloadTiers)
      toast.success('Agent reward tiers saved')
      await loadData()
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to save tiers')
    } finally {
      setSaving(false)
    }
  }

  const reviewRedemption = async (id, status) => {
    if (!canManage) return
    setReviewingId(id)
    try {
      await axios.patch(`${BASE_URL}/api/admin/agent-rewards/redemptions/${id}`, { status }, { headers })
      toast.success(status === 'processed' ? 'Redemption marked as processed.' : 'Redemption rejected.')
      await loadData()
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to review redemption')
    } finally {
      setReviewingId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Business / Payouts</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Agent Rewards</h1>
        <p className="mt-1 text-xs text-slate-500">Set ride milestones and payout amounts. Payouts are calculated from completed rides by referred drivers.</p>
        <div className="mt-4 inline-flex border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`px-3 py-1.5 text-xs font-semibold ${activeTab === 'config' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            Configurations
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('payouts')}
            className={`px-3 py-1.5 text-xs font-semibold ${activeTab === 'payouts' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            Agent Payouts & Visibility
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-6">
        <div className="border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Agents</p><p className="mt-1 text-lg font-semibold text-slate-900">{totals.totalAgents || 0}</p></div>
        <div className="border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Unlocked Milestones</p><p className="mt-1 text-lg font-semibold text-emerald-700">{totals.totalUnlockedTiers || 0}</p></div>
        <div className="border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Completed Rides</p><p className="mt-1 text-lg font-semibold text-slate-900">{totals.totalCompletedRides || 0}</p></div>
        <div className="border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Pending (Not Redeemed)</p><p className="mt-1 text-lg font-semibold text-slate-900">{formatUsd(totals.totalPayoutUsd || 0)}</p></div>
        <div className="border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Redeemed (Lifetime)</p><p className="mt-1 text-lg font-semibold text-slate-900">{formatUsd(totals.totalLifetimeRedeemedUsd || 0)}</p></div>
        <div className="border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Pending Requests</p><p className="mt-1 text-lg font-semibold text-amber-700">{totals.totalPendingRequests || 0}</p></div>
      </div>

      {activeTab === 'config' ? (
      <div className="border border-slate-300 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">Reward Tiers</p>
          <div className="flex gap-2">
            <button type="button" onClick={addTier} className="h-9 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100">Add tier</button>
            <button type="button" onClick={saveTiers} disabled={!canManage || saving} className={`h-9 px-3 text-xs font-semibold text-white ${canManage && !saving ? 'bg-slate-900 hover:bg-slate-800' : 'bg-slate-300'}`}>{saving ? 'Saving...' : 'Save tiers'}</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="bg-[#16213a] text-white">
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Order</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Rides Threshold</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Reward USD</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Active</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Action</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier, index) => (
                <tr key={`tier-${tier.id || index}`}>
                  <td className="border-b border-slate-200 px-3 py-2 text-sm text-slate-700">{index + 1}</td>
                  <td className="border-b border-slate-200 px-3 py-2"><input value={String(tier.ridesThreshold ?? '')} onChange={(event) => setTierPatch(index, { ridesThreshold: event.target.value.replace(/[^\d]/g, '') })} className="h-9 w-32 border border-slate-300 px-2 text-sm" disabled={!canManage} /></td>
                  <td className="border-b border-slate-200 px-3 py-2"><input value={String(tier.rewardAmountUsd ?? '')} onChange={(event) => setTierPatch(index, { rewardAmountUsd: event.target.value.replace(/[^\d.]/g, '') })} className="h-9 w-32 border border-slate-300 px-2 text-sm" disabled={!canManage} /></td>
                  <td className="border-b border-slate-200 px-3 py-2"><input type="checkbox" checked={tier.isActive !== false} onChange={(event) => setTierPatch(index, { isActive: event.target.checked })} disabled={!canManage} /></td>
                  <td className="border-b border-slate-200 px-3 py-2"><button type="button" onClick={() => removeTier(index)} className="h-8 border border-rose-200 bg-rose-50 px-2 text-xs font-semibold text-rose-700 hover:bg-rose-100" disabled={!canManage}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      ) : null}

      {activeTab === 'payouts' ? (
      <>
      <div className="border border-slate-300 bg-white">
        <div className="border-b border-slate-200 px-4 py-3"><p className="text-sm font-semibold text-slate-900">Agent payout visibility</p></div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="bg-[#16213a] text-white">
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Agent</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Unlocked Milestones</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Completed Rides</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Pending</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Redeemed</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="px-4 py-8 text-sm text-slate-500">Loading rewards...</td></tr>
              ) : agents.length === 0 ? (
                <tr><td colSpan="5" className="px-4 py-8 text-sm text-slate-500">No agents found.</td></tr>
              ) : agents.map((agent) => (
                <tr key={`agent-reward-${agent.id}`}>
                  <td className="border-b border-slate-200 px-3 py-2 text-sm text-slate-800"><p className="font-semibold text-slate-900">{agent.fullName}</p><p className="text-xs text-slate-500">{agent.email}</p></td>
                  <td className="border-b border-slate-200 px-3 py-2 text-sm text-slate-700">{agent.rewardSummary?.unlockedTierCount || 0}</td>
                  <td className="border-b border-slate-200 px-3 py-2 text-sm text-slate-700">{agent.rewardSummary?.totalCompletedRides || 0}</td>
                  <td className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">{formatUsd(agent.rewardSummary?.pendingPayoutUsd || agent.rewardSummary?.totalPayoutUsd || 0)}</td>
                  <td className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">{formatUsd(agent.rewardSummary?.lifetimeRedeemedUsd || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="border border-slate-300 bg-white">
        <div className="border-b border-slate-200 px-4 py-3"><p className="text-sm font-semibold text-slate-900">Redemption Requests</p></div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="bg-[#16213a] text-white">
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Agent</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Amount</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Cycle Rides</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Status</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Requested</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Reviewed</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" className="px-4 py-8 text-sm text-slate-500">Loading redemptions...</td></tr>
              ) : redemptions.length === 0 ? (
                <tr><td colSpan="7" className="px-4 py-8 text-sm text-slate-500">No redemption requests found.</td></tr>
              ) : redemptions.map((item) => (
                <tr key={`redemption-${item.id}`}>
                  <td className="border-b border-slate-200 px-3 py-2 text-sm text-slate-800"><p className="font-semibold text-slate-900">{item.agentName || '-'}</p><p className="text-xs text-slate-500">{item.agentEmail || '-'}</p></td>
                  <td className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">{formatUsd(item.amountUsd || 0)}</td>
                  <td className="border-b border-slate-200 px-3 py-2 text-sm text-slate-700">{item.cycleRidesAtRedeem || 0}</td>
                  <td className="border-b border-slate-200 px-3 py-2 text-sm text-slate-700 uppercase">{item.status || 'pending'}</td>
                  <td className="border-b border-slate-200 px-3 py-2 text-xs text-slate-600">{item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}</td>
                  <td className="border-b border-slate-200 px-3 py-2 text-xs text-slate-600">{item.reviewedAt ? `${new Date(item.reviewedAt).toLocaleString()}${item.reviewedByAdminName ? ` • ${item.reviewedByAdminName}` : ''}` : '-'}</td>
                  <td className="border-b border-slate-200 px-3 py-2 text-sm">
                    {item.status === 'pending' ? (
                      <div className="flex gap-2">
                        <button type="button" onClick={() => reviewRedemption(item.id, 'processed')} disabled={!canManage || reviewingId === item.id} className={`h-8 px-2 text-xs font-semibold text-white ${canManage && reviewingId !== item.id ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-slate-300'}`}>Process</button>
                        <button type="button" onClick={() => reviewRedemption(item.id, 'rejected')} disabled={!canManage || reviewingId === item.id} className={`h-8 px-2 text-xs font-semibold text-white ${canManage && reviewingId !== item.id ? 'bg-rose-600 hover:bg-rose-500' : 'bg-slate-300'}`}>Reject</button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">Reviewed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      ) : null}
    </section>
  )
}
