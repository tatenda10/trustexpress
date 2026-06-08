import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

export default function SupportAgentPage() {
  const { token } = useAuth()
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [trainingSections, setTrainingSections] = useState([])
  const [settings, setSettings] = useState({
    enabled: false,
    provider: 'claude',
    model: 'claude-sonnet-4-20250514',
    systemPrompt: '',
    trainingContent: '',
    hasApiKey: false,
    updatedAt: null,
    lastTestedAt: null,
  })
  const [testMessage, setTestMessage] = useState('')
  const [testUserRole, setTestUserRole] = useState('passenger')
  const [testReply, setTestReply] = useState(null)

  const loadSettings = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/support/agent/settings`, { headers })
      setSettings((prev) => ({
        ...prev,
        ...(data?.settings || {}),
      }))
      setTrainingSections(Array.isArray(data?.trainingSections) ? data.trainingSections : [])
      setError('')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load support agent settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const handleSave = async () => {
    setSaving(true)
    setSuccess('')
    try {
      const { data } = await axios.put(
        `${BASE_URL}/api/admin/support/agent/settings`,
        {
          enabled: settings.enabled,
          provider: settings.provider,
          model: settings.model,
          systemPrompt: settings.systemPrompt,
          trainingContent: settings.trainingContent,
        },
        { headers },
      )
      setSettings((prev) => ({
        ...prev,
        ...(data?.settings || {}),
      }))
      setSuccess('Support agent settings saved.')
      setError('')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save support agent settings')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    const message = String(testMessage || '').trim()
    if (!message) return
    setTesting(true)
    setSuccess('')
    try {
      const { data } = await axios.post(
        `${BASE_URL}/api/admin/support/agent/test`,
        {
          message,
          userRole: testUserRole,
        },
        { headers },
      )
      setTestReply(data?.reply || null)
      setSettings((prev) => ({ ...prev, lastTestedAt: new Date().toISOString() }))
      setError('')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to test support agent')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="rounded border border-slate-300 bg-white p-4 text-sm text-slate-600">Loading support agent...</div>
  }

  return (
    <section className="space-y-4">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Support / Claude Agent</p>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Support Agent</h1>
            <p className="text-sm text-slate-500">
              Train the auto-reply agent, toggle it on and off, and test answers before passengers and drivers receive them.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={`border px-3 py-2 ${settings.enabled ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Agent status</p>
              <p className={`mt-1 text-sm font-semibold ${settings.enabled ? 'text-emerald-700' : 'text-slate-700'}`}>
                {settings.enabled ? 'Enabled' : 'Disabled'}
              </p>
            </div>
            <div className={`border px-3 py-2 ${settings.hasApiKey ? 'border-blue-200 bg-blue-50' : 'border-amber-200 bg-amber-50'}`}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Claude API</p>
              <p className={`mt-1 text-sm font-semibold ${settings.hasApiKey ? 'text-blue-700' : 'text-amber-700'}`}>
                {settings.hasApiKey ? 'Configured' : 'Missing ANTHROPIC_API_KEY'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {error ? <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_420px]">
        <div className="space-y-4">
          <div className="border border-slate-300 bg-white px-4 py-4">
            <div className="flex flex-col gap-4">
              <label className="flex items-center justify-between gap-4 border border-slate-200 bg-slate-50 px-3 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Auto replies</p>
                  <p className="text-xs text-slate-500">When enabled, the Claude agent replies automatically to new support messages.</p>
                </div>
                <input
                  type="checkbox"
                  checked={!!settings.enabled}
                  onChange={(event) => setSettings((prev) => ({ ...prev, enabled: event.target.checked }))}
                  className="h-5 w-5"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Provider</span>
                  <input
                    value={settings.provider || 'claude'}
                    onChange={(event) => setSettings((prev) => ({ ...prev, provider: event.target.value }))}
                    className="h-10 w-full border border-slate-300 px-3 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Model</span>
                  <input
                    value={settings.model || ''}
                    onChange={(event) => setSettings((prev) => ({ ...prev, model: event.target.value }))}
                    className="h-10 w-full border border-slate-300 px-3 text-sm"
                  />
                </label>
              </div>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">System prompt</span>
                <textarea
                  value={settings.systemPrompt || ''}
                  onChange={(event) => setSettings((prev) => ({ ...prev, systemPrompt: event.target.value }))}
                  rows={6}
                  className="w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Training content</span>
                <textarea
                  value={settings.trainingContent || ''}
                  onChange={(event) => setSettings((prev) => ({ ...prev, trainingContent: event.target.value }))}
                  rows={20}
                  className="w-full border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
                />
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="h-10 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save settings'}
                </button>
                <p className="text-xs text-slate-500">
                  Last updated: {settings.updatedAt ? new Date(settings.updatedAt).toLocaleString('en-ZW') : 'Not yet saved'}
                </p>
              </div>
            </div>
          </div>

          <div className="border border-slate-300 bg-white px-4 py-4">
            <p className="text-sm font-semibold text-slate-900">Test section</p>
            <p className="mt-1 text-xs text-slate-500">Ask the same kind of support questions your users ask before enabling live auto replies.</p>
            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">User role</span>
                  <select
                    value={testUserRole}
                    onChange={(event) => setTestUserRole(event.target.value)}
                    className="h-10 w-full border border-slate-300 px-2 text-sm"
                  >
                    <option value="passenger">Passenger</option>
                    <option value="driver">Driver</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Question</span>
                  <input
                    value={testMessage}
                    onChange={(event) => setTestMessage(event.target.value)}
                    placeholder="Example: A driver asked me to add money after the trip."
                    className="h-10 w-full border border-slate-300 px-3 text-sm"
                  />
                </label>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing || !String(testMessage || '').trim()}
                  className="h-10 bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {testing ? 'Testing...' : 'Run Claude test'}
                </button>
                <p className="text-xs text-slate-500">
                  Last tested: {settings.lastTestedAt ? new Date(settings.lastTestedAt).toLocaleString('en-ZW') : 'Not tested yet'}
                </p>
              </div>
              <div className="border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Claude reply</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {testReply?.message || 'Your Claude test answer will appear here.'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="border border-slate-300 bg-white px-4 py-4">
          <p className="text-sm font-semibold text-slate-900">Training sections</p>
          <p className="mt-1 text-xs text-slate-500">These are the support question groups currently used to train the agent.</p>
          <div className="mt-4 space-y-3">
            {trainingSections.map((section) => (
              <div key={section.title} className="border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-sm font-semibold text-slate-900">{section.title}</p>
                <div className="mt-2 space-y-1">
                  {section.questions.map((question) => (
                    <p key={question} className="text-xs leading-5 text-slate-600">
                      {question}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
