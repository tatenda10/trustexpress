import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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

function formatUsd(value) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

function StatusBadge({ status }) {
  if (!status) return <span className="text-slate-500">-</span>
  const toneMap = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    blue: 'bg-blue-50 text-blue-700 ring-blue-200',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  }
  const tone = toneMap[status.tone] || toneMap.slate
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tone}`}>
      {status.label}
    </span>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="min-w-[120px] border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  )
}

export default function AgentDetailPage() {
  const { agentId } = useParams()
  const navigate = useNavigate()
  const { token, can, admin } = useAuth()
  const isSuperAdmin = admin?.role === 'super_admin'
  const canManageAgents = isSuperAdmin || can('agents.manage')

  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(false)
  const [driverIdentifier, setDriverIdentifier] = useState('')
  const [data, setData] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')

  const headers = useMemo(() => ({
    Authorization: `Bearer ${token}`,
  }), [token])

  const loadReferrals = async () => {
    setLoading(true)
    try {
      const { data: response } = await axios.get(`${BASE_URL}/api/admin/agents/${agentId}/referrals`, { headers })
      setData(response)
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to load agent referrals')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReferrals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, token])

  const assignDriver = async (event) => {
    event.preventDefault()
    if (!canManageAgents) return
    const identifier = driverIdentifier.trim()
    if (!identifier) {
      toast.error('Enter a driver Clerk ID, email, or plate number.')
      return
    }

    setAssigning(true)
    try {
      const { data: response } = await axios.post(
        `${BASE_URL}/api/admin/agents/${agentId}/referrals/drivers`,
        { driverIdentifier: identifier },
        { headers }
      )
      if (response?.alreadyExists) {
        toast.info('Driver was already assigned to this agent.')
      } else {
        toast.success('Driver assigned to agent successfully.')
      }
      setDriverIdentifier('')
      await loadReferrals()
    } catch (err) {
      const apiError = err?.response?.data?.error
      const existingAgent = err?.response?.data?.existingAgent
      if (existingAgent) {
        toast.error(`${apiError}: ${existingAgent.fullName} (${existingAgent.email})`)
      } else {
        toast.error(apiError || err?.message || 'Failed to assign driver')
      }
    } finally {
      setAssigning(false)
    }
  }

  if (loading && !data) {
    return <section className="rounded-sm border border-slate-300 bg-white p-6 text-sm text-slate-600">Loading agent details...</section>
  }

  if (!data?.agent) {
    return (
      <section className="space-y-4">
        <button
          type="button"
          onClick={() => navigate('/dashboard/agents')}
          className="text-sm font-medium text-indigo-700 hover:text-indigo-900"
        >
          ← Back to Agents
        </button>
        <div className="rounded-sm border border-slate-300 bg-white p-6 text-sm text-slate-600">Agent not found.</div>
      </section>
    )
  }

  const { agent, summary, rewards, referrals } = data
  const filteredReferrals = (referrals || []).filter((item) => {
    if (typeFilter === 'drivers') return item.type === 'driver'
    if (typeFilter === 'passengers') return item.type === 'passenger'
    return true
  })

  return (
    <section className="space-y-4">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => navigate('/dashboard/agents')}
          className="text-xs font-medium text-indigo-700 hover:text-indigo-900"
        >
          ← Back to Agents
        </button>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Users / Recruitment / Agent</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">{agent.fullName}</h1>
            <p className="mt-1 text-xs text-slate-500">
              {agent.email}
              {agent.employeeCode ? ` · Code: ${agent.employeeCode}` : ''}
              {agent.phoneNumber ? ` · ${agent.phoneNumber}` : ''}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Last login: {formatDateTime(agent.lastLoginAt)} · Joined: {formatDateTime(agent.createdAt)}
            </p>
          </div>
          <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ${agent.isActive ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'}`}>
            {agent.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Drivers Referred" value={summary?.driverAccountsCreated || 0} />
        <StatCard label="Passengers Referred" value={summary?.passengerAccountsCreated || 0} />
        <StatCard label="Completed Rides" value={rewards?.summary?.totalCompletedRides || 0} />
        <StatCard label="Invite Opens" value={summary?.inviteOpens || 0} />
        <StatCard label="Approved" value={summary?.approved || 0} />
        <StatCard label="Pending Review" value={summary?.pendingReview || 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="border border-slate-300 bg-white px-4 py-3 lg:col-span-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Reward Progress</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Cycle Rides" value={rewards?.summary?.cycleRides || 0} />
            <StatCard label="Unlocked Tiers" value={rewards?.summary?.unlockedTierCount || 0} />
            <StatCard label="Pending Payout" value={formatUsd(rewards?.summary?.pendingPayoutUsd || 0)} />
            <StatCard label="Lifetime Redeemed" value={formatUsd(rewards?.summary?.lifetimeRedeemedUsd || 0)} />
          </div>
        </div>

        {canManageAgents ? (
          <form onSubmit={assignDriver} className="border border-slate-300 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Assign Driver Manually</p>
            <p className="mt-1 text-xs text-slate-500">
              Link a driver to this agent using their Clerk user ID, email, or vehicle plate.
            </p>
            <input
              type="text"
              value={driverIdentifier}
              onChange={(event) => setDriverIdentifier(event.target.value)}
              placeholder="user_xxx, email@example.com, or ABC1234"
              className="mt-3 h-9 w-full border border-slate-300 px-3 text-xs outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={assigning}
              className={`mt-3 h-9 w-full rounded-sm text-xs font-semibold text-white ${assigning ? 'cursor-not-allowed bg-slate-300' : 'bg-[#16213a]'}`}
            >
              {assigning ? 'Assigning...' : 'Assign Driver'}
            </button>
          </form>
        ) : null}
      </div>

      <div className="overflow-hidden border border-slate-300 bg-white">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Referred Users</h2>
            <p className="text-xs text-slate-500">Drivers and passengers linked to this agent, with ride counts for drivers.</p>
          </div>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="h-9 border border-slate-300 bg-white px-2 text-xs"
          >
            <option value="all">All types</option>
            <option value="drivers">Drivers only</option>
            <option value="passengers">Passengers only</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#16213a] text-left text-[11px] uppercase tracking-wide text-slate-100">
                <th className="px-4 py-2 font-semibold">Type</th>
                <th className="px-4 py-2 font-semibold">Name / Contact</th>
                <th className="px-4 py-2 font-semibold">Vehicle</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Rides</th>
                <th className="px-4 py-2 font-semibold">Source</th>
                <th className="px-4 py-2 font-semibold">Referred</th>
                <th className="px-4 py-2 font-semibold text-right">Profile</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">Loading referrals...</td>
                </tr>
              ) : filteredReferrals.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">No referred users yet.</td>
                </tr>
              ) : (
                filteredReferrals.map((item) => {
                  const userId = item.type === 'driver' ? item.driverUserId : item.passengerUserId
                  const profilePath = item.type === 'driver'
                    ? `/dashboard/drivers/${userId}`
                    : `/dashboard/passengers/${userId}`
                  return (
                    <tr key={`${item.type}-${item.id}`} className="border-b border-slate-200 align-top hover:bg-slate-50">
                      <td className="px-4 py-3 capitalize text-slate-700">{item.type}</td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="font-medium text-slate-800">{item.driver?.fullName || userId}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{item.driver?.email || '-'}</div>
                        <div className="text-[11px] text-slate-500">{item.driver?.phoneNumber || '-'}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {item.type === 'driver' ? (
                          <>
                            <div>{item.vehicle?.numberPlate || '-'}</div>
                            <div className="mt-1 text-[11px] text-slate-500">
                              {[item.vehicle?.make, item.vehicle?.model].filter(Boolean).join(' ') || '-'}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {item.type === 'driver' ? (item.completedRides ?? 0) : '-'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{item.source || '-'}</td>
                      <td className="px-4 py-3 text-slate-700">{formatDateTime(item.referredAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={profilePath}
                          className="inline-flex rounded-sm bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
