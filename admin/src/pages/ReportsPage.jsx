import axios from 'axios'
import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

function RideIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M6 15.5h12l-1-4.5a2 2 0 0 0-2-1.5H9a2 2 0 0 0-2 1.5l-1 4.5Z" fill={color} />
      <circle cx="9" cy="16.5" r="1.3" fill={color} opacity="0.75" />
      <circle cx="15" cy="16.5" r="1.3" fill={color} opacity="0.75" />
    </svg>
  )
}

function DriverIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.2" fill={color} />
      <path d="M6 18c0-2.9 2.6-5.2 6-5.2s6 2.3 6 5.2" fill={color} opacity="0.75" />
    </svg>
  )
}

function PassengerIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="3" fill={color} />
      <circle cx="16" cy="10" r="2.4" fill={color} opacity="0.7" />
      <path d="M5 18c0-2.6 2.1-4.7 4.8-4.7h.3c2.7 0 4.9 2.1 4.9 4.7" fill={color} opacity="0.75" />
    </svg>
  )
}

function SupportIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M6 7.5A2.5 2.5 0 0 1 8.5 5h7A2.5 2.5 0 0 1 18 7.5v5A2.5 2.5 0 0 1 15.5 15H11l-3.5 3v-3H8.5A2.5 2.5 0 0 1 6 12.5v-5Z" fill={color} />
    </svg>
  )
}

function VerificationIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M12 4 18 6.5v4.8c0 3.5-2.3 6.6-6 8.7-3.7-2.1-6-5.2-6-8.7V6.5L12 4Z" fill={color} />
      <path d="m9.4 12 1.7 1.7 3.6-3.8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GeographyIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M12 20s5-4.4 5-8.6A5 5 0 1 0 7 11.4C7 15.6 12 20 12 20Z" fill={color} />
      <circle cx="12" cy="11" r="1.8" fill="#fff" />
    </svg>
  )
}

function SafetyIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M12 4 19 7v4.5c0 4.2-2.8 7-7 8.5-4.2-1.5-7-4.3-7-8.5V7l7-3Z" fill={color} />
      <path d="M12 8.3v4.1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="15.6" r="1" fill="#fff" />
    </svg>
  )
}

const REPORT_TABS = [
  { key: 'rides', label: 'Rides', icon: RideIcon },
  { key: 'drivers', label: 'Drivers', icon: DriverIcon },
  { key: 'passengers', label: 'Passengers', icon: PassengerIcon },
  { key: 'support', label: 'Support', icon: SupportIcon },
  { key: 'verification', label: 'Verification', icon: VerificationIcon },
  { key: 'geography', label: 'Geography', icon: GeographyIcon },
  { key: 'safety', label: 'Safety', icon: SafetyIcon },
]

function ReportsTabs({ tabs = [], activeTab, onChange }) {
  return (
    <div className="border border-slate-300 bg-white px-4 py-3">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Report Sections</p>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {tabs.map((tab) => {
          const active = activeTab === tab.key
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange?.(tab.key)}
              className={`flex items-center justify-center gap-2 border-b-2 px-2 py-2 text-xs font-semibold transition ${
                active ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              <Icon active={active} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CustomTooltip({ active, payload, label, valuePrefix = '', valueSuffix = '' }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload || {}
  return (
    <div className="border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-xs font-semibold text-slate-900">{label || point.label}</p>
      <p className="mt-1 text-xs text-slate-600">
        {valuePrefix}{payload[0]?.value}{valueSuffix}
      </p>
    </div>
  )
}

function ReportBarChart({ items = [], color = '#4f46e5', valuePrefix = '', valueSuffix = '' }) {
  if (!items.length) {
    return <div className="px-4 py-10 text-sm text-slate-500">No chart data available yet.</div>
  }

  return (
    <div className="h-[300px] px-4 py-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={items} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
          <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
          <Tooltip content={<CustomTooltip valuePrefix={valuePrefix} valueSuffix={valueSuffix} />} />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ReportLineChart({ items = [], color = '#4f46e5', valuePrefix = '', valueSuffix = '' }) {
  if (!items.length) {
    return <div className="px-4 py-10 text-sm text-slate-500">No chart data available yet.</div>
  }

  return (
    <div className="h-[320px] px-4 py-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={items} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
          <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
          <Tooltip content={<CustomTooltip valuePrefix={valuePrefix} valueSuffix={valueSuffix} />} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function ReportPieChart({ items = [], colors = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'] }) {
  if (!items.length) {
    return <div className="px-4 py-10 text-sm text-slate-500">No chart data available yet.</div>
  }

  return (
    <div className="h-[320px] px-4 py-4">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={items} dataKey="value" nameKey="label" outerRadius={95} innerRadius={46} paddingAngle={2}>
            {items.map((entry, index) => (
              <Cell key={`${entry.label}-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

function MetricCards({ metrics = [] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{metric.label}</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{metric.value}</p>
        </div>
      ))}
    </div>
  )
}

function getSectionCopy(activeTab) {
  const copy = {
    rides: 'Track ride volume, completion patterns, and operational throughput.',
    drivers: 'Monitor online supply, approvals, and driver-side health.',
    passengers: 'Watch passenger identity progress and rider-side health.',
    support: 'Measure support workload and issue resolution patterns.',
    verification: 'See driver and passenger verification progress in one place.',
    geography: 'Understand where demand is clustering across the platform.',
    safety: 'Spot cancellations, expiries, and operational risk signals.',
  }
  return copy[activeTab] || 'Platform reporting.'
}

export default function ReportsPage() {
  const { token } = useAuth()
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('rides')
  const [sections, setSections] = useState({})
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [appliedDateFrom, setAppliedDateFrom] = useState('')
  const [appliedDateTo, setAppliedDateTo] = useState('')

  const headers = useMemo(() => ({
    Authorization: `Bearer ${token}`,
  }), [token])

  const loadReports = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/reports/summary`, {
        headers,
        params: {
          dateFrom: appliedDateFrom || undefined,
          dateTo: appliedDateTo || undefined,
        },
      })
      setSections(data?.sections || {})
    } catch (err) {
      const apiError = err?.response?.data?.error
      setError(apiError || err?.message || 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, appliedDateFrom, appliedDateTo])

  const exportReportsCsv = async () => {
    setExporting(true)
    setError('')
    try {
      const response = await axios.get(`${BASE_URL}/api/admin/reports/export.csv`, {
        headers,
        responseType: 'blob',
      })

      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }))
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = `reports_export_${Date.now()}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(blobUrl)
    } catch (err) {
      const apiError = err?.response?.data?.error
      setError(apiError || err?.message || 'Failed to export report CSV')
    } finally {
      setExporting(false)
    }
  }

  const activeSection = sections[activeTab] || { metrics: [], chart: [] }

  const applyDateFilters = () => {
    setAppliedDateFrom(dateFrom)
    setAppliedDateTo(dateTo)
  }

  return (
    <section className="space-y-3">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Business / Reports</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">Reports</h1>
            <p className="mt-1 text-xs text-slate-500">
              Explore operations, revenue, support, verification, geography, and safety with graphical views.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-10 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="h-10 border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={applyDateFilters}
              className="h-10 border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Apply Dates
            </button>
            <button
              type="button"
              onClick={loadReports}
              disabled={loading}
              className="h-10 border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={exportReportsCsv}
              disabled={exporting}
              className="h-10 bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
        </div>
      </div>

      <ReportsTabs
        tabs={REPORT_TABS}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {error ? <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <div className="border border-slate-300 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{activeTab}</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            {REPORT_TABS.find((tab) => tab.key === activeTab)?.label || 'Report'}
          </h2>
          <p className="mt-1 text-xs text-slate-500">{getSectionCopy(activeTab)}</p>
        </div>

        {loading ? (
          <div className="px-4 py-10 text-sm text-slate-500">Loading report data...</div>
        ) : (
          <div className="space-y-4 px-4 py-4">
            <MetricCards metrics={activeSection.metrics || []} />

            <div className="border border-slate-200 bg-slate-50">
              <div className="border-b border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Trend Analysis</p>
                <p className="mt-1 text-xs text-slate-500">Operational trend for the currently selected report section.</p>
              </div>
              <ReportLineChart
                items={activeSection.chart || []}
                color={activeTab === 'support' ? '#f59e0b' : activeTab === 'safety' ? '#ef4444' : '#4f46e5'}
              />
            </div>

            {activeTab === 'rides' ? (
              <>
                <div className="border border-slate-200 bg-slate-50">
                  <div className="border-b border-slate-200 bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Weekly Distribution</p>
                    <p className="mt-1 text-xs text-slate-500">Ride volume split across the days of the week.</p>
                  </div>
                  <ReportBarChart items={activeSection.weeklyDistribution || []} color="#0ea5e9" />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="border border-slate-200 bg-slate-50">
                    <div className="border-b border-slate-200 bg-white px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Locations</p>
                      <p className="mt-1 text-xs text-slate-500">Top pickup locations in the selected date range.</p>
                    </div>
                    <ReportBarChart items={activeSection.locations || []} color="#10b981" />
                  </div>

                  <div className="border border-slate-200 bg-slate-50">
                    <div className="border-b border-slate-200 bg-white px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Ride Status Mix</p>
                      <p className="mt-1 text-xs text-slate-500">See how completed, active, cancelled, and expired rides are distributed.</p>
                    </div>
                    <ReportPieChart items={activeSection.statusBreakdown || []} />
                  </div>
                </div>

                <div className="border border-slate-200 bg-slate-50">
                  <div className="border-b border-slate-200 bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Tier Mix</p>
                    <p className="mt-1 text-xs text-slate-500">Distribution of rides across the requested ride tiers.</p>
                  </div>
                  <ReportBarChart items={activeSection.tierMix || []} color="#8b5cf6" />
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}
