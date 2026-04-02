import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

function MetricCard({ label, value, change, accent = 'slate' }) {
  const accentMap = {
    slate: 'border-slate-200 text-slate-900',
    blue: 'border-blue-200 text-slate-900',
    indigo: 'border-indigo-200 text-slate-900',
    amber: 'border-amber-200 text-slate-900',
  }

  return (
    <article className={`border bg-white px-3.5 py-3.5 ${accentMap[accent] || accentMap.slate}`}>
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-1.5 text-[28px] font-semibold leading-none text-slate-950">{value}</p>
      <p className="mt-1 text-[10px] font-medium text-indigo-700">{change}</p>
    </article>
  )
}

function ActionIcon({ kind }) {
  if (kind === 'verification') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
        <path d="M12 3 5 6v5c0 4.4 3 8.5 7 10 4-1.5 7-5.6 7-10V6l-7-3Z" fill="currentColor" />
        <path d="m9.5 12.5 1.7 1.7 3.5-4" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (kind === 'passengers') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
        <circle cx="8.5" cy="9" r="2.8" fill="currentColor" />
        <circle cx="16" cy="10" r="2.3" fill="currentColor" opacity="0.7" />
        <path d="M4.5 19c0-2.4 1.9-4.3 4.3-4.3h.3c2.4 0 4.4 1.9 4.4 4.3" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'support') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
        <path d="M12 4a7 7 0 0 0-7 7v3a2 2 0 0 0 2 2h1v-5H6a6 6 0 1 1 12 0h-2v5h1a2 2 0 0 0 2-2v-3a7 7 0 0 0-7-7Z" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function ActionShortcut({ to, label, subtitle, kind }) {
  return (
    <Link to={to} className="group border border-slate-200 bg-white p-3 transition hover:border-indigo-300 hover:bg-indigo-50">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center bg-slate-900 text-white transition group-hover:bg-indigo-600">
          <ActionIcon kind={kind} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>
        </div>
      </div>
    </Link>
  )
}

function MiniBar({ label, value, max, tone = 'bg-indigo-600' }) {
  const safeMax = Math.max(Number(max || 0), 1)
  const width = Math.max(10, Math.min(100, (Number(value || 0) / safeMax) * 100))
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="font-semibold text-slate-800">{value}</span>
      </div>
      <div className="h-2 bg-slate-100">
        <div className={`h-2 ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0))
}

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`
}

export default function OverviewPage() {
  const { token } = useAuth()
  const [loading, setLoading] = useState(false)
  const [overview, setOverview] = useState(null)

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      try {
        const { data } = await axios.get(`${BASE_URL}/api/admin/overview`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        setOverview(data || null)
      } catch {
        setOverview(null)
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [token])

  const cards = useMemo(() => {
    const payload = overview?.cards || {}
    return [
      {
        label: 'Rides Today',
        value: formatNumber(payload.ridesToday?.value || 0),
        change: payload.ridesToday?.change || '0.0% vs yesterday',
        accent: 'slate',
      },
      {
        label: 'Online Drivers',
        value: formatNumber(payload.onlineDrivers?.value || 0),
        change: payload.onlineDrivers?.change || '0.0% vs yesterday',
        accent: 'blue',
      },
      {
        label: 'Pending Verifications',
        value: formatNumber(payload.pendingVerifications?.value || 0),
        change: payload.pendingVerifications?.change || 'No pending verification items',
        accent: 'amber',
      },
      {
        label: 'Open Support Tickets',
        value: formatNumber(payload.openSupportTickets?.value || 0),
        change: payload.openSupportTickets?.change || '0.0% vs yesterday',
        accent: 'indigo',
      },
    ]
  }, [overview])

  const spotlight = overview?.spotlight || {}
  const pendingVerificationCount = Number(overview?.cards?.pendingVerifications?.value || 0)
  const supportOpenCount = Number(spotlight.supportOpen || 0)
  const requestedTodayCount = Number(spotlight.totalRequestedToday || 0)
  const analyticsMax = Math.max(pendingVerificationCount, supportOpenCount, requestedTodayCount, 1)

  return (
    <section className="space-y-5">
      <header className="border border-slate-200 bg-white px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Operations Dashboard</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">Admin overview</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              Track the numbers that matter most today and jump straight into the queues that need attention.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:min-w-[420px]">
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Ride Value Today</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(spotlight.grossRideValueToday || 0)}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Requested Today</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(spotlight.totalRequestedToday || 0)}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Support Open</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(spotlight.supportOpen || 0)}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-4 sm:px-6">
            <h2 className="text-base font-semibold text-slate-900">Analytics</h2>
            <p className="mt-1 text-xs text-slate-500">A simple view of where admin attention is being pulled right now.</p>
          </div>

          <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="border border-slate-200 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Today Snapshot</p>
              <div className="mt-5 space-y-4">
                <MiniBar label="Verification queue" value={pendingVerificationCount} max={analyticsMax} tone="bg-amber-500" />
                <MiniBar label="Open support" value={supportOpenCount} max={analyticsMax} tone="bg-indigo-600" />
                <MiniBar label="Ride requests" value={requestedTodayCount} max={analyticsMax} tone="bg-slate-900" />
              </div>
            </div>

            <div className="border border-slate-200 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Performance Readout</p>
              <div className="mt-4 space-y-4">
                <div className="border border-slate-100 bg-slate-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Ride Value</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{formatCurrency(spotlight.grossRideValueToday || 0)}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-slate-100 bg-slate-50 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Drivers Live</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{cards[1]?.value || '0'}</p>
                  </div>
                  <div className="border border-slate-100 bg-slate-50 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Support Load</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{cards[3]?.value || '0'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-4 sm:px-6">
            <h2 className="text-base font-semibold text-slate-900">Quick actions</h2>
            <p className="mt-1 text-xs text-slate-500">Fast access to the admin areas you use most.</p>
          </div>

          <div className="grid gap-3 p-4 sm:p-6">
            <ActionShortcut
              to="/dashboard/driver-verification"
              label="Driver verification"
              subtitle="Approve incoming identity and vehicle submissions."
              kind="verification"
            />
            <ActionShortcut
              to="/dashboard/passengers"
              label="Passenger accounts"
              subtitle="Review passenger profiles and uploaded ID documents."
              kind="passengers"
            />
            <ActionShortcut
              to="/dashboard/support"
              label="Support inbox"
              subtitle="Respond to driver and passenger support messages."
              kind="support"
            />
          </div>
        </section>
      </div>

      {loading ? <p className="text-sm text-slate-500">Refreshing dashboard...</p> : null}
    </section>
  )
}
