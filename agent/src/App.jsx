import axios from 'axios'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAgentAuth } from './auth/AgentAuthContext.jsx'
import BASE_URL from './context/Api'

const ANDROID_PLAY_STORE_FALLBACK_URL = 'https://play.google.com/store/apps/details?id=com.tatenda10.trustexpress'
const IOS_APP_STORE_FALLBACK_URL = 'https://apps.apple.com/gr/app/trust-express-app/id6760766112'

const agentSections = [
  {
    label: null,
    items: [
      { id: 'dashboard', label: 'Dashboard', description: 'Overview of your recruitment activity', icon: GridIcon },
      { id: 'rewards', label: 'Rewards', description: 'Redeem payouts and view reward history', icon: ClipboardIcon },
    ],
  },
  {
    label: 'Recruitment',
    items: [
      { id: 'register-driver', label: 'Register Driver', description: 'Start a new driver application', icon: FolderIcon },
      { id: 'applications', label: 'My Applications', description: 'Track pending, approved, and rejected applications', icon: BriefcaseIcon },
      { id: 'register-passenger', label: 'Register Passenger', description: 'Optional passenger registration flow', icon: UsersIcon },
    ],
  },
]

function SectionEyebrow({ children }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{children}</p>
}

async function fetchAgentInvite(token) {
  try {
    const response = await axios.get(`${BASE_URL}/api/agent/invites/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    return response?.data?.invite || null
  } catch (error) {
    throw new Error(error?.response?.data?.error || 'Failed to load invite link')
  }
}

async function fetchAgentDashboard(token) {
  try {
    const response = await axios.get(`${BASE_URL}/api/agent/dashboard`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    return response.data
  } catch (error) {
    throw new Error(error?.response?.data?.error || 'Failed to load dashboard')
  }
}

async function postRedeemAgentRewards(token) {
  try {
    const response = await axios.post(
      `${BASE_URL}/api/agent/rewards/redeem`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    )
    return response.data
  } catch (error) {
    throw new Error(error?.response?.data?.error || 'Failed to redeem rewards')
  }
}

async function fetchAgentApplications(token, { search = '', status = 'all' } = {}) {
  const params = new URLSearchParams()
  if (search.trim()) params.set('search', search.trim())
  if (status && status !== 'all') params.set('status', status)

  try {
    const response = await axios.get(`${BASE_URL}/api/agent/applications${params.toString() ? `?${params.toString()}` : ''}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    return response?.data?.applications || []
  } catch (error) {
    throw new Error(error?.response?.data?.error || 'Failed to load applications')
  }
}

async function checkDriverEligibility(token, vehicleNumber) {
  const params = new URLSearchParams({ vehicleNumber: String(vehicleNumber || '').trim() })
  try {
    const response = await axios.get(`${BASE_URL}/api/agent/driver-eligibility?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    return response.data
  } catch (error) {
    throw new Error(error?.response?.data?.error || 'Failed to check vehicle number')
  }
}

function LogoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#6f54ff" />
      <path d="m7 7 10 10M17 7 7 17" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1" fill="currentColor" />
      <rect x="13" y="4" width="7" height="7" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="4" y="13" width="7" height="7" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="13" y="13" width="7" height="7" rx="1" fill="currentColor" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M3.5 7.5h6l1.5 1.7H20a1 1 0 0 1 1 1v7.8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 .5-1Z" fill="currentColor" />
    </svg>
  )
}

function BriefcaseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="18" height="12" rx="2" fill="currentColor" />
      <rect x="9" y="4" width="6" height="3" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="8.5" cy="9" r="2.7" fill="currentColor" />
      <circle cx="15.5" cy="10" r="2.3" fill="currentColor" opacity="0.7" />
      <path d="M4 19c0-2.5 2-4.5 4.5-4.5h.2c2.5 0 4.5 2 4.5 4.5" fill="currentColor" />
    </svg>
  )
}

function ClipboardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M9 4.5h6a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <rect x="8" y="2.5" width="8" height="4" rx="1.2" fill="currentColor" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function formatUsd(value) {
  const amount = Number(value || 0);
  return `USD ${amount.toFixed(2)}`;
}

function StatusBadge({ tone = 'slate', children }) {
  const toneClass = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }[tone] || 'border-slate-200 bg-slate-50 text-slate-700'

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${toneClass}`}>{children}</span>
}

function LoginScreen() {
  const { login } = useAgentAuth()
  const [form, setForm] = useState({ email: '', password: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await login({
        email: form.email.trim(),
        password: form.password,
      })
    } catch (err) {
      setError(err?.message || 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(46,93,255,0.18),transparent_30%),linear-gradient(180deg,#f5f8ff_0%,#eef3fb_100%)] px-5 py-8 text-slate-900">
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center">
        <div className="w-full max-w-[420px] border border-slate-200 bg-white/95 p-8 shadow-[0_20px_45px_rgba(22,33,58,0.08)]">
          <div className="mb-4 grid h-[54px] w-[54px] place-items-center bg-[#16213a] text-[18px] font-bold tracking-[0.08em] text-white">TX</div>
          <SectionEyebrow>Trust Express</SectionEyebrow>
          <h1 className="mt-2 text-[30px] font-semibold leading-tight text-slate-950">Agent Portal</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">Sign in with the credentials created for you by Trust Express admin.</p>

          {error ? (
            <div className="mt-5 border border-rose-200 bg-rose-50 px-3.5 py-3 text-[13px] text-rose-700">
              {error}
            </div>
          ) : null}

          <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-600">Company Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="agentname@trustexpress.co.zw"
                autoComplete="username"
                className="h-12 border border-slate-300 bg-white px-3.5 text-[15px] text-slate-900 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-600">Password</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="Enter your password"
                autoComplete="current-password"
                className="h-12 border border-slate-300 bg-white px-3.5 text-[15px] text-slate-900 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 h-12 bg-[#16213a] text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Signing In...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function AgentMenuItem({ item, active, onSelect = null }) {
  const base = 'flex h-9 w-full items-center justify-between px-4 text-left text-[13px] transition'

  return (
    <button
      type="button"
      onClick={() => onSelect?.(item.id)}
      className={`${base} ${active ? 'bg-[#6f54ff] text-white' : 'text-[#a4adc1] hover:bg-[#1a2238] hover:text-white'}`}
    >
      <span className="flex items-center gap-2.5">
        <span className="shrink-0"><item.icon /></span>
        <span>{item.label}</span>
      </span>
    </button>
  )
}

function AgentSidebar({ agent, currentSection, onSelect, onLogout, mobile = false, onClose = null }) {
  const menuRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onMouseDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const initials = String(agent?.fullName || 'A')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('')

  return (
    <aside className={`flex w-full min-h-0 flex-col border-r border-[#252d45] bg-[#0b1020] text-[#a4adc1] ${mobile ? 'h-full shadow-2xl' : 'h-screen md:sticky md:top-0'}`}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-14 items-center justify-between gap-2 border-b border-[#252d45] px-4 text-[12px] font-semibold tracking-wide text-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-[#8f99b2]"><MenuIcon /></span>
            <span><LogoIcon /></span>
            <span>TRUST EXPRESS</span>
          </div>
          {mobile ? (
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-[#8f99b2] hover:bg-[#1a2238] hover:text-white">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>

        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-0 py-2">
          {agentSections.map((section) => (
            <div key={section.label || 'core'} className="mt-2 first:mt-0">
              {section.label ? (
                <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#5f6880]">{section.label}</p>
              ) : null}

              <nav className="mt-1">
                {section.items.map((item) => (
                  <AgentMenuItem
                    key={item.id}
                    item={item}
                    active={currentSection === item.id}
                    onSelect={(sectionId) => {
                      onSelect(sectionId)
                      if (mobile && onClose) onClose()
                    }}
                  />
                ))}
              </nav>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-[#252d45] px-4 py-4">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            className="flex w-full items-center gap-3 rounded-md px-1.5 py-1.5 text-left hover:bg-[#1a2238]"
          >
            <div className="grid h-10 w-10 place-items-center rounded-full bg-[#36405a] text-xs font-semibold text-[#dbe1f0]">
              {initials || 'A'}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-slate-100">{agent?.fullName || 'Agent User'}</p>
              <p className="text-[12px] text-[#98a3bb]">Recruitment Agent</p>
            </div>
          </button>

          {menuOpen ? (
            <div className="absolute bottom-14 left-0 z-20 w-full overflow-hidden rounded-md border border-[#2b344d] bg-[#111a31] shadow-xl">
              <button
                type="button"
                onClick={onLogout}
                className="w-full px-3 py-2 text-left text-[12px] font-semibold text-rose-200 hover:bg-[#1f2943] hover:text-rose-100"
              >
                Logout
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}

function DashboardContent({ agent, summary, applications }) {
  const recent = applications.slice(0, 5)

  return (
    <div className="grid gap-5">
      <section className="grid gap-5 border border-slate-200 bg-white p-5 xl:grid-cols-[minmax(0,1.5fr),280px]">
        <div>
          <SectionEyebrow>Welcome Back</SectionEyebrow>
          <h2 className="mt-2 text-[28px] font-semibold leading-tight text-slate-950">{agent?.fullName || 'Agent'}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
            This portal is now ready for recruitment operations. The next screens will let you register drivers, upload documents, and track approvals.
          </p>
        </div>
        <div className="grid gap-3">
          <div className="border border-slate-200 bg-slate-50 px-4 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Agent Code</span>
            <strong className="mt-2 block text-sm text-slate-900">{agent?.employeeCode || '-'}</strong>
          </div>
          <div className="border border-slate-200 bg-slate-50 px-4 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Phone</span>
            <strong className="mt-2 block text-sm text-slate-900">{agent?.phoneNumber || '-'}</strong>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <section className="border border-slate-200 bg-white p-5">
          <SectionEyebrow>Invite Opens</SectionEyebrow>
          <h3 className="mt-2 text-[28px] font-semibold text-slate-950">{summary?.inviteOpens ?? 0}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">How many times drivers opened your invite link or QR.</p>
        </section>
        <section className="border border-slate-200 bg-white p-5">
          <SectionEyebrow>Drivers Recruited</SectionEyebrow>
          <h3 className="mt-2 text-[28px] font-semibold text-slate-950">{summary?.driverAccountsCreated ?? 0}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">Drivers who finished signup through your invite.</p>
        </section>
        <section className="border border-slate-200 bg-white p-5">
          <SectionEyebrow>Passengers Recruited</SectionEyebrow>
          <h3 className="mt-2 text-[28px] font-semibold text-slate-950">{summary?.passengerAccountsCreated ?? 0}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">Passengers who finished signup through your invite.</p>
        </section>
        <section className="border border-slate-200 bg-white p-5">
          <SectionEyebrow>Pending Approval</SectionEyebrow>
          <h3 className="mt-2 text-[28px] font-semibold text-slate-950">{summary?.pendingReview ?? 0}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">Drivers waiting for admin review and approval.</p>
        </section>
        <section className="border border-slate-200 bg-white p-5">
          <SectionEyebrow>Approved</SectionEyebrow>
          <h3 className="mt-2 text-[28px] font-semibold text-slate-950">{summary?.approved ?? 0}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">Drivers fully approved and ready to go live.</p>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr),320px]">
        <section className="border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <SectionEyebrow>Recent Recruits</SectionEyebrow>
              <h3 className="mt-2 text-2xl font-semibold text-slate-950">Recruitment progress overview</h3>
            </div>
            <StatusBadge tone="rose">{summary?.rejected ?? 0} rejected</StatusBadge>
          </div>

          {recent.length === 0 ? (
            <div className="mt-4 border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              No drivers have completed signup through your invite yet.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0">
                <thead>
                  <tr className="bg-[#16213a] text-white">
                    <th className="rounded-tl-sm px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Driver</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Type</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Stage</th>
                    <th className="rounded-tr-sm px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Vehicle</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((item) => (
                    <tr key={item.id} className="bg-white">
                      <td className="border-b border-slate-200 px-4 py-3 text-sm text-slate-800">
                        <p className="font-semibold text-slate-900">{item.driver.fullName || `${item.type === 'passenger' ? 'Passenger' : 'Driver'} account created`}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.driver.email || item.driver.phoneNumber || item.driverUserId || item.passengerUserId}</p>
                      </td>
                      <td className="border-b border-slate-200 px-4 py-3">
                        <StatusBadge tone={item.type === 'passenger' ? 'blue' : 'slate'}>{item.type}</StatusBadge>
                      </td>
                      <td className="border-b border-slate-200 px-4 py-3">
                        <StatusBadge tone={item.status.tone}>{item.status.label}</StatusBadge>
                      </td>
                      <td className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700">
                        {item.type === 'passenger' ? 'Passenger account' : item.vehicle.make || item.vehicle.model ? `${item.vehicle.make || ''} ${item.vehicle.model || ''}`.trim() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="border border-slate-200 bg-white p-5">
          <SectionEyebrow>Pipeline</SectionEyebrow>
          <h3 className="mt-2 text-2xl font-semibold text-slate-950">Where your drivers are</h3>
          <div className="mt-4 grid gap-3">
            {[
              { label: 'Documents Started', value: summary?.documentsStarted ?? 0, tone: 'blue' },
              { label: 'Pending Review', value: summary?.pendingReview ?? 0, tone: 'amber' },
              { label: 'Approved', value: summary?.approved ?? 0, tone: 'emerald' },
              { label: 'Rejected', value: summary?.rejected ?? 0, tone: 'rose' },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{item.label}</span>
                <StatusBadge tone={item.tone}>{item.value}</StatusBadge>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function RewardsSection({ rewards, redeeming, onRedeemRewards }) {
  const rewardTiers = Array.isArray(rewards?.tiersProgress) ? rewards.tiersProgress : []
  const redemptionHistory = Array.isArray(rewards?.redemptionHistory) ? rewards.redemptionHistory : []
  const pendingUsd = Number(rewards?.summary?.pendingPayoutUsd ?? rewards?.summary?.totalPayoutUsd ?? 0)
  const pendingRequestCount = Number(rewards?.summary?.pendingRedemptionCount || 0)

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="border border-slate-200 bg-white p-5">
          <SectionEyebrow>Reward Pending (This Cycle)</SectionEyebrow>
          <h3 className="mt-2 text-[28px] font-semibold text-slate-950">{formatUsd(pendingUsd)}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            This is what you can redeem now. Redeeming resets your cycle counter to 0, while lifetime ride history remains.
          </p>
        </section>
        <section className="border border-slate-200 bg-white p-5">
          <SectionEyebrow>Lifetime Redeemed</SectionEyebrow>
          <h3 className="mt-2 text-[28px] font-semibold text-slate-950">{formatUsd(rewards?.summary?.lifetimeRedeemedUsd || 0)}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">Total payouts already redeemed and stored in your history.</p>
        </section>
      </div>

      <section className="border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <SectionEyebrow>Milestones</SectionEyebrow>
            <h3 className="mt-2 text-2xl font-semibold text-slate-950">Reward tiers this cycle</h3>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <StatusBadge tone="emerald">
              {Number(rewards?.summary?.unlockedTierCount || 0)} milestones unlocked
            </StatusBadge>
            <button
              type="button"
              onClick={onRedeemRewards}
              disabled={redeeming || pendingUsd <= 0 || pendingRequestCount > 0}
              className={`h-10 rounded-sm px-4 text-sm font-semibold text-white ${redeeming || pendingUsd <= 0 || pendingRequestCount > 0 ? 'cursor-not-allowed bg-slate-300' : 'bg-[#16213a] hover:bg-slate-900'}`}
            >
              {redeeming ? 'Submitting...' : pendingRequestCount > 0 ? 'Request pending review' : 'Request payout'}
            </button>
          </div>
        </div>
        {rewardTiers.length === 0 ? (
          <div className="mt-4 border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
            Reward tiers are not configured yet. Admin can add them under Agent Rewards.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="bg-[#16213a] text-white">
                  <th className="rounded-tl-sm px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Threshold</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Reward</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Status</th>
                  <th className="rounded-tr-sm px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Payout</th>
                </tr>
              </thead>
              <tbody>
                {rewardTiers.map((tier) => (
                  <tr key={`reward-tier-${tier.ridesThreshold}`}>
                    <td className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">{tier.ridesThreshold} rides</td>
                    <td className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700">{formatUsd(tier.rewardAmountUsd || 0)}</td>
                    <td className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700">{tier.isUnlocked ? 'Unlocked' : 'Locked'}</td>
                    <td className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">{formatUsd(tier.payoutUsd || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Lifetime completed rides: <span className="font-semibold text-slate-700">{Number(rewards?.summary?.totalCompletedRides || 0)}</span>
          {' '}
          • Rides since last redeem: <span className="font-semibold text-slate-700">{Number(rewards?.summary?.cycleRides || 0)}</span>
          {' '}
          • Pending requests: <span className="font-semibold text-slate-700">{pendingRequestCount}</span>
          {rewards?.summary?.nextTier ? (
            <> • Next milestone: {rewards.summary.nextTier.ridesThreshold} rides ({formatUsd(rewards.summary.nextTier.rewardAmountUsd)})</>
          ) : (
            <> • All configured milestones unlocked</>
          )}
        </p>
      </section>

      {redemptionHistory.length ? (
        <section className="border border-slate-200 bg-white p-5">
          <SectionEyebrow>Payout History</SectionEyebrow>
          <h3 className="mt-2 text-2xl font-semibold text-slate-950">Recent redemptions</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="bg-[#16213a] text-white">
                  <th className="rounded-tl-sm px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">When</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Amount</th>
                  <th className="rounded-tr-sm px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Details</th>
                </tr>
              </thead>
              <tbody>
                {redemptionHistory.map((item) => (
                  <tr key={`redemption-${item.id}`}>
                    <td className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}
                    </td>
                    <td className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">{formatUsd(item.amountUsd || 0)}</td>
                    <td className="border-b border-slate-200 px-4 py-3 text-xs text-slate-600">
                      Cycle rides: {item.cycleRidesAtRedeem} • Lifetime rides at redeem: {item.ridesTotalAtRedeem} • Highest tier: {item.highestThreshold}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function RegisterDriverSection({
  invite,
  inviteLoading,
  inviteError,
  onCopyInvite,
  vehicleNumberInput,
  onVehicleNumberInputChange,
  onCheckVehicleNumber,
  checkingVehicleNumber,
  vehicleEligibility,
  vehicleEligibilityError,
}) {
  const apiBase = String(BASE_URL || '').replace(/\/$/, '')
  const driverSmartInviteUrl =
    invite?.driverSmartInviteUrl ||
    (invite?.token && apiBase ? `${apiBase}/invite/driver?invite=${encodeURIComponent(invite.token)}` : '')
  const qrCodeUrl = driverSmartInviteUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(driverSmartInviteUrl)}`
    : ''
  const canShowInvite = !!invite && vehicleEligibility?.available === true

  return (
    <div className="grid gap-5">
      <section className="border border-slate-200 bg-white p-5">
        <SectionEyebrow>Driver Recruitment</SectionEyebrow>
        <h2 className="mt-2 text-[28px] font-semibold text-slate-950">Register a driver through the real mobile app</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
          Let the driver scan your QR code or open your invite link on their phone. It keeps the agent token attached,
          opens the Trust Express app if already installed, and only falls back to the correct store when needed.
        </p>
      </section>

      <section className="border border-slate-200 bg-white p-5">
        <SectionEyebrow>How It Works</SectionEyebrow>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            'Open this page and show the QR code to the driver.',
            'If the app is already installed, the QR opens Trust Express directly with the agent token attached.',
            'If the app is not installed yet, the same QR sends the driver to the correct store for their phone.',
            'After install, reopening the same invite link continues signup under the same agent.',
          ].map((item, index) => (
            <div key={item} className="border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Step {index + 1}</p>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-800">{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border border-slate-200 bg-white p-5">
        <SectionEyebrow>Vehicle Check</SectionEyebrow>
        <h3 className="mt-2 text-2xl font-semibold text-slate-950">Check the vehicle number first</h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
          Enter the driver&apos;s licence plate or vehicle number before showing the QR code. If the vehicle is already registered,
          the system will stop the process here.
        </p>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr),180px]">
          <label className="grid gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Vehicle Number / Plate</span>
            <input
              value={vehicleNumberInput}
              onChange={(event) => onVehicleNumberInputChange(event.target.value)}
              placeholder="e.g. AET9976 or ABC1234"
              className="h-11 border border-slate-300 bg-white px-3.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
            />
          </label>

          <div className="grid gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-transparent">Check</span>
            <button
              type="button"
              onClick={onCheckVehicleNumber}
              disabled={checkingVehicleNumber || !vehicleNumberInput.trim()}
              className="h-11 rounded-sm bg-[#16213a] px-4 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {checkingVehicleNumber ? 'Checking...' : 'Check Vehicle'}
            </button>
          </div>
        </div>

        {vehicleEligibilityError ? (
          <div className="mt-4 border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{vehicleEligibilityError}</div>
        ) : null}

        {vehicleEligibility?.available === true ? (
          <div className="mt-4 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Vehicle number <span className="font-semibold">{vehicleEligibility.vehicleNumber}</span> is available. You can now show the QR code to the driver.
          </div>
        ) : null}

        {vehicleEligibility?.alreadyRegistered ? (
          <div className="mt-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This driver is already registered under vehicle number <span className="font-semibold">{vehicleEligibility.vehicleNumber}</span>.
            {vehicleEligibility.vehicleLabel ? ` (${vehicleEligibility.vehicleLabel})` : ''}
          </div>
        ) : null}
      </section>

      <section className="border border-slate-200 bg-white p-5">
        <SectionEyebrow>Driver Invite</SectionEyebrow>
        <h3 className="mt-2 text-2xl font-semibold text-slate-950">Share this with the driver</h3>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          Use the QR code for in-person recruitment, or copy the invite link if you want to send it by WhatsApp or SMS.
          The invite uses your live API host, not `trustexpress.co.zw`, so it will not go to that old domain.
        </p>

        {!vehicleEligibility?.available ? (
          <div className="mt-4 border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Check the vehicle number first. The QR code will only appear when the vehicle is not already registered.
          </div>
        ) : inviteLoading ? (
          <div className="mt-4 border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">Loading invite link...</div>
        ) : inviteError ? (
          <div className="mt-4 border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{inviteError}</div>
        ) : canShowInvite ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[280px,1fr] lg:items-start">
            <div className="border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Scan QR</p>
              <div className="mt-3 flex justify-center">
                <img
                  src={qrCodeUrl}
                  alt="Driver invite QR code"
                  className="h-[230px] w-[230px] border border-slate-200 bg-white p-2"
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                This opens the app directly if installed. If not, it falls back to the right store and keeps the invite flow on your live server.
              </p>
            </div>

            <div className="grid gap-3">
              <div className="border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Invite Link</p>
                <p className="mt-2 break-all text-sm font-medium text-slate-900">{driverSmartInviteUrl || '—'}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Play Store Fallback</p>
                <p className="mt-2 break-all text-sm font-medium text-slate-900">{ANDROID_PLAY_STORE_FALLBACK_URL}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">App Store Fallback</p>
                <p className="mt-2 break-all text-sm font-medium text-slate-900">{IOS_APP_STORE_FALLBACK_URL}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onCopyInvite(driverSmartInviteUrl || invite?.driverAppUrl || '')}
                  className="h-10 rounded-sm bg-[#16213a] px-4 text-sm font-semibold text-white transition hover:bg-slate-900"
                >
                  Copy Invite Link
                </button>
                <button
                  type="button"
                  onClick={() => onCopyInvite(ANDROID_PLAY_STORE_FALLBACK_URL)}
                  className="h-10 rounded-sm border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                >
                  Copy Play Store Link
                </button>
                <button
                  type="button"
                  onClick={() => onCopyInvite(IOS_APP_STORE_FALLBACK_URL)}
                  className="h-10 rounded-sm border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                >
                  Copy App Store Link
                </button>
                <a
                  href={ANDROID_PLAY_STORE_FALLBACK_URL}
                  className="inline-flex h-10 items-center rounded-sm border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                >
                  Open Play Store
                </a>
                <a
                  href={IOS_APP_STORE_FALLBACK_URL}
                  className="inline-flex h-10 items-center rounded-sm border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                >
                  Open App Store
                </a>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function RegisterPassengerSection({ invite, inviteLoading, inviteError, onCopyInvite }) {
  const passengerSmartInviteUrl = invite?.passengerSmartInviteUrl || invite?.passengerUniversalUrl || ''
  const qrCodeUrl = passengerSmartInviteUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(passengerSmartInviteUrl)}`
    : ''

  return (
    <div className="grid gap-5">
      <section className="border border-slate-200 bg-white p-5">
        <SectionEyebrow>Passenger Recruitment</SectionEyebrow>
        <h2 className="mt-2 text-[28px] font-semibold text-slate-950">Register a passenger through the real mobile app</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
          Let the passenger scan your QR code or open your invite link on their phone. It keeps the agent token attached
          and falls back to the correct store only when needed.
        </p>
      </section>

      <section className="border border-slate-200 bg-white p-5">
        <SectionEyebrow>Passenger Invite</SectionEyebrow>
        <h3 className="mt-2 text-2xl font-semibold text-slate-950">Share this with the passenger</h3>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          Use the QR code for in-person recruitment, or copy the passenger invite link if you want to send it by WhatsApp or SMS.
          The invite uses your live API host, not `trustexpress.co.zw`.
        </p>

        {inviteLoading ? (
          <div className="mt-4 border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">Loading invite link...</div>
        ) : inviteError ? (
          <div className="mt-4 border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{inviteError}</div>
        ) : invite ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[280px,1fr] lg:items-start">
            <div className="border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Scan QR</p>
              <div className="mt-3 flex justify-center">
                <img
                  src={qrCodeUrl}
                  alt="Passenger invite QR code"
                  className="h-[230px] w-[230px] border border-slate-200 bg-white p-2"
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                This opens the app directly if installed. If not, it falls back to the right store and keeps the invite flow on your live server.
              </p>
            </div>

            <div className="grid gap-3">
              <div className="border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Invite Link</p>
                <p className="mt-2 break-all text-sm font-medium text-slate-900">{passengerSmartInviteUrl || '—'}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Play Store Fallback</p>
                <p className="mt-2 break-all text-sm font-medium text-slate-900">{ANDROID_PLAY_STORE_FALLBACK_URL}</p>
              </div>
              <div className="border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">App Store Fallback</p>
                <p className="mt-2 break-all text-sm font-medium text-slate-900">{IOS_APP_STORE_FALLBACK_URL}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onCopyInvite(passengerSmartInviteUrl || invite?.passengerAppUrl || '')}
                  className="h-10 rounded-sm bg-[#16213a] px-4 text-sm font-semibold text-white transition hover:bg-slate-900"
                >
                  Copy Passenger Link
                </button>
                <button
                  type="button"
                  onClick={() => onCopyInvite(ANDROID_PLAY_STORE_FALLBACK_URL)}
                  className="h-10 rounded-sm border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                >
                  Copy Play Store Link
                </button>
                <button
                  type="button"
                  onClick={() => onCopyInvite(IOS_APP_STORE_FALLBACK_URL)}
                  className="h-10 rounded-sm border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                >
                  Copy App Store Link
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function ApplicationsSection({ applications, loading, error, filters, onFilterChange, onSearch }) {
  const statuses = [
    { value: 'all', label: 'All' },
    { value: 'account_created', label: 'Account Created' },
    { value: 'documents_started', label: 'Docs Started' },
    { value: 'partially_submitted', label: 'Partially Submitted' },
    { value: 'pending_review', label: 'Pending Review' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
  ]

  return (
    <div className="grid gap-5">
      <section className="border border-slate-200 bg-white p-5">
        <SectionEyebrow>My Applications</SectionEyebrow>
        <h2 className="mt-2 text-[28px] font-semibold text-slate-950">Track accounts linked to your invite</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
          This list shows drivers and passengers who created their account through your invite and how far they have moved through signup,
          documentation, and admin approval.
        </p>
      </section>

      <section className="border border-slate-200 bg-white p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr),220px,140px]">
          <label className="grid gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Search</span>
            <div className="flex items-center border border-slate-300 bg-white px-3">
              <span className="text-slate-400"><SearchIcon /></span>
              <input
                value={filters.search}
                onChange={(event) => onFilterChange('search', event.target.value)}
                placeholder="Search driver or passenger, phone, email, car, or plate"
                className="h-11 w-full bg-transparent px-3 text-sm text-slate-900 outline-none"
              />
            </div>
          </label>

          <label className="grid gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Status</span>
            <select
              value={filters.status}
              onChange={(event) => onFilterChange('status', event.target.value)}
              className="h-11 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none"
            >
              {statuses.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="grid gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-transparent">Search</span>
            <button
              type="button"
              onClick={onSearch}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-[#16213a] px-4 text-sm font-semibold text-white transition hover:bg-slate-900"
            >
              <SearchIcon />
              Search
            </button>
          </div>
        </div>
      </section>

      <section className="border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="bg-[#16213a] text-white">
                <th className="rounded-tl-sm px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Driver</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Type</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Identity</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Vehicle</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Submitted</th>
                <th className="rounded-tr-sm px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em]">Review</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-sm text-slate-500">Loading applications...</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-sm text-rose-600">{error}</td>
                </tr>
              ) : applications.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-sm text-slate-500">No applications found for this filter yet.</td>
                </tr>
              ) : (
                applications.map((item) => (
                  <tr key={item.id} className="bg-white">
                    <td className="border-b border-slate-200 px-4 py-3 text-sm text-slate-800">
                      <p className="font-semibold text-slate-900">{item.driver.fullName || `${item.type === 'passenger' ? 'Passenger' : 'Driver'} account created`}</p>
                      <p className="mt-1 text-xs text-slate-500">{item.driver.email || item.driver.phoneNumber || item.driverUserId || item.passengerUserId}</p>
                      {item.vehicle.make || item.vehicle.model || item.vehicle.numberPlate ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {[item.vehicle.make, item.vehicle.model, item.vehicle.numberPlate].filter(Boolean).join(' • ')}
                        </p>
                      ) : null}
                    </td>
                    <td className="border-b border-slate-200 px-4 py-3">
                      <StatusBadge tone={item.type === 'passenger' ? 'blue' : 'slate'}>{item.type}</StatusBadge>
                    </td>
                    <td className="border-b border-slate-200 px-4 py-3">
                      <StatusBadge tone={item.status.tone}>{item.status.label}</StatusBadge>
                    </td>
                    <td className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700">{item.type === 'passenger' ? `${item.status.identityUploadedCount}/2 docs` : `${item.status.identityUploadedCount}/5 docs`}</td>
                    <td className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700">{item.type === 'passenger' ? '-' : `${item.status.vehicleUploadedCount}/5 docs`}</td>
                    <td className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700">
                      {item.submittedAt ? new Date(item.submittedAt).toLocaleString() : '-'}
                    </td>
                    <td className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700">
                      {item.rejectionReason || (item.reviewedAt ? `Reviewed ${new Date(item.reviewedAt).toLocaleDateString()}` : '-')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function PlaceholderSection({ title, description }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="border border-slate-200 bg-white p-5">
        <SectionEyebrow>Coming Next</SectionEyebrow>
        <h2 className="mt-2 text-[28px] font-semibold text-slate-950">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
      </section>

      <section className="border border-slate-200 bg-white p-5">
        <SectionEyebrow>Planned Flow</SectionEyebrow>
        <ul className="mt-4 grid gap-3">
          {[
            'Collect core registration details',
            'Run duplicate checks',
            'Upload required documents',
            'Submit to admin for approval',
          ].map((item) => (
            <li key={item} className="border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function DashboardShell() {
  const { agent, token, logout } = useAgentAuth()
  const [currentSection, setCurrentSection] = useState('dashboard')
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [invite, setInvite] = useState(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [vehicleNumberInput, setVehicleNumberInput] = useState('')
  const [checkingVehicleNumber, setCheckingVehicleNumber] = useState(false)
  const [vehicleEligibility, setVehicleEligibility] = useState(null)
  const [vehicleEligibilityError, setVehicleEligibilityError] = useState('')
  const [dashboardData, setDashboardData] = useState({ summary: null, applications: [], rewards: null })
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardError, setDashboardError] = useState('')
  const [redeemingRewards, setRedeemingRewards] = useState(false)
  const [applications, setApplications] = useState([])
  const [applicationsLoading, setApplicationsLoading] = useState(false)
  const [applicationsError, setApplicationsError] = useState('')
  const [applicationFilters, setApplicationFilters] = useState({ search: '', status: 'all' })
  const [appliedApplicationFilters, setAppliedApplicationFilters] = useState({ search: '', status: 'all' })

  const activeSection = useMemo(
    () => agentSections.flatMap((section) => section.items).find((section) => section.id === currentSection) || agentSections[0].items[0],
    [currentSection]
  )

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) {
        setMobileSidebarOpen(false)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!token) return undefined

    const loadInvite = async () => {
      setInviteLoading(true)
      setInviteError('')
      try {
        const inviteData = await fetchAgentInvite(token)
        if (!cancelled) {
          setInvite(inviteData)
        }
      } catch (error) {
        if (!cancelled) {
          setInviteError(error?.message || 'Failed to load invite link')
        }
      } finally {
        if (!cancelled) {
          setInviteLoading(false)
        }
      }
    }

    loadInvite()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    let cancelled = false
    if (!token) return undefined

    const loadDashboard = async () => {
      setDashboardLoading(true)
      setDashboardError('')
      try {
        const data = await fetchAgentDashboard(token)
        if (!cancelled) {
          setDashboardData({
            summary: data?.summary || null,
            applications: Array.isArray(data?.applications) ? data.applications : [],
            rewards: data?.rewards || null,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setDashboardError(error?.message || 'Failed to load dashboard')
        }
      } finally {
        if (!cancelled) setDashboardLoading(false)
      }
    }

    loadDashboard()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    let cancelled = false
    if (!token) return undefined

    const loadApplications = async () => {
      setApplicationsLoading(true)
      setApplicationsError('')
      try {
        const data = await fetchAgentApplications(token, appliedApplicationFilters)
        if (!cancelled) {
          setApplications(data)
        }
      } catch (error) {
        if (!cancelled) {
          setApplicationsError(error?.message || 'Failed to load applications')
        }
      } finally {
        if (!cancelled) setApplicationsLoading(false)
      }
    }

    loadApplications()
    return () => {
      cancelled = true
    }
  }, [token, appliedApplicationFilters])

  const handleCopyInvite = async (value) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      }
    } catch {
      // Ignore clipboard errors in unsupported environments.
    }
  }

  const handleCheckVehicleNumber = async () => {
    if (!token) return
    if (!vehicleNumberInput.trim()) {
      setVehicleEligibility(null)
      setVehicleEligibilityError('Enter a vehicle number first.')
      return
    }

    setCheckingVehicleNumber(true)
    setVehicleEligibilityError('')
    try {
      const result = await checkDriverEligibility(token, vehicleNumberInput)
      setVehicleEligibility(result)
    } catch (error) {
      setVehicleEligibility(null)
      setVehicleEligibilityError(error?.message || 'Failed to check vehicle number')
    } finally {
      setCheckingVehicleNumber(false)
    }
  }

  const handleApplicationFilterChange = (key, value) => {
    setApplicationFilters((current) => ({ ...current, [key]: value }))
  }

  const handleRedeemRewards = async () => {
    if (!token) return
    const pendingUsd = Number(
      dashboardData?.rewards?.summary?.pendingPayoutUsd ?? dashboardData?.rewards?.summary?.totalPayoutUsd ?? 0,
    )
    if (!Number.isFinite(pendingUsd) || pendingUsd <= 0) {
      window.alert('No reward is available to redeem yet.')
      return
    }

    const confirmed = window.confirm(
      `Redeem ${formatUsd(pendingUsd)} now?\n\nThis will record a payout and reset your reward cycle counter to 0 (your lifetime ride history stays).`,
    )
    if (!confirmed) return

    setRedeemingRewards(true)
    try {
      const result = await postRedeemAgentRewards(token)
      const requestedAmount = result?.request?.amountUsd
      const data = await fetchAgentDashboard(token)
      setDashboardData({
        summary: data?.summary || null,
        applications: Array.isArray(data?.applications) ? data.applications : [],
        rewards: data?.rewards || null,
      })
      window.alert(`Redemption request for ${formatUsd(requestedAmount || pendingUsd)} submitted. Admin will process or reject it.`)
    } catch (error) {
      window.alert(error?.message || 'Could not redeem rewards.')
    } finally {
      setRedeemingRewards(false)
    }
  }

  const initials = String(agent?.fullName || 'A')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('')

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 md:grid md:h-screen md:grid-cols-[260px_1fr] md:overflow-hidden">
      <div className="hidden md:block">
        <AgentSidebar
          agent={agent}
          currentSection={currentSection}
          onSelect={setCurrentSection}
          onLogout={logout}
        />
      </div>

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-40 bg-slate-950/55 md:hidden" onClick={() => setMobileSidebarOpen(false)}>
          <div className="h-full w-[285px]" onClick={(event) => event.stopPropagation()}>
            <AgentSidebar
              agent={agent}
              currentSection={currentSection}
              onSelect={setCurrentSection}
              onLogout={logout}
              mobile
              onClose={() => setMobileSidebarOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <main className="min-h-screen md:h-screen md:overflow-y-auto">
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">Trust Express Agent</p>
              <p className="truncate text-xs text-slate-500">{agent?.fullName || 'Agent User'}</p>
            </div>

            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
              {initials || 'A'}
            </div>
          </div>
        </div>

        <header className="border-b border-slate-200 bg-white px-5 py-4 lg:px-8">
          <div>
            <SectionEyebrow>Trust Express Recruitment</SectionEyebrow>
            <h1 className="mt-2 text-[30px] font-semibold leading-tight text-slate-950">{activeSection.label}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">{activeSection.description}</p>
          </div>
        </header>

        <div className="p-2 sm:p-2.5 md:p-4">
          {currentSection === 'dashboard' ? (
            dashboardLoading && !dashboardData?.summary ? (
              <div className="border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">Loading dashboard...</div>
            ) : dashboardError && !dashboardData?.summary ? (
              <div className="border border-rose-200 bg-rose-50 px-4 py-8 text-sm text-rose-700">{dashboardError}</div>
            ) : (
              <DashboardContent
                agent={agent}
                summary={dashboardData?.summary || {}}
                applications={dashboardData?.applications || []}
              />
            )
          ) : currentSection === 'rewards' ? (
            <RewardsSection
              rewards={dashboardData?.rewards || {}}
              redeeming={redeemingRewards}
              onRedeemRewards={handleRedeemRewards}
            />
          ) : currentSection === 'register-driver' ? (
            <RegisterDriverSection
              invite={invite}
              inviteLoading={inviteLoading}
              inviteError={inviteError}
              onCopyInvite={handleCopyInvite}
              vehicleNumberInput={vehicleNumberInput}
              onVehicleNumberInputChange={(value) => {
                setVehicleNumberInput(value)
                setVehicleEligibility(null)
                setVehicleEligibilityError('')
              }}
              onCheckVehicleNumber={handleCheckVehicleNumber}
              checkingVehicleNumber={checkingVehicleNumber}
              vehicleEligibility={vehicleEligibility}
              vehicleEligibilityError={vehicleEligibilityError}
            />
          ) : currentSection === 'register-passenger' ? (
            <RegisterPassengerSection
              invite={invite}
              inviteLoading={inviteLoading}
              inviteError={inviteError}
              onCopyInvite={handleCopyInvite}
            />
          ) : currentSection === 'applications' ? (
            <ApplicationsSection
              applications={applications}
              loading={applicationsLoading}
              error={applicationsError}
              filters={applicationFilters}
              onFilterChange={handleApplicationFilterChange}
              onSearch={() => setAppliedApplicationFilters(applicationFilters)}
            />
          ) : (
            <PlaceholderSection
              title={activeSection.label}
              description={activeSection.description}
            />
          )}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  const { isAuthenticated, restoring } = useAgentAuth()

  if (restoring) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(46,93,255,0.18),transparent_30%),linear-gradient(180deg,#f5f8ff_0%,#eef3fb_100%)] px-5 py-8 text-slate-900">
        <div className="grid min-h-[calc(100vh-4rem)] place-items-center">
          <div className="w-full max-w-[420px] border border-slate-200 bg-white/95 p-8 shadow-[0_20px_45px_rgba(22,33,58,0.08)]">
            <SectionEyebrow>Trust Express</SectionEyebrow>
            <h1 className="mt-2 text-[30px] font-semibold leading-tight text-slate-950">Restoring session...</h1>
          </div>
        </div>
      </div>
    )
  }

  return isAuthenticated ? <DashboardShell /> : <LoginScreen />
}
