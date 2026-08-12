import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

const CURRENCY_OPTIONS = ['USD', 'ZWG', 'ZAR', 'NGN', 'GHS', 'KES'];
const PROVIDER_DEFAULT_CURRENCY = {
  paystack: 'ZAR',
  smilepay: 'USD',
};
const DEFAULT_GRANT_ID = 'startup_grant_v1';

function formatMoney(value, currency = 'USD') {
  const amount = Number(value || 0)
  return `${currency} ${amount.toFixed(2)}`
}

export default function DriverWalletSettingsPage() {
  const { token, can, admin } = useAuth()
  const isSuperAdmin = admin?.role === 'super_admin'
  const canManage = isSuperAdmin || can('payouts.manage')
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [settings, setSettings] = useState({
    walletEnabled: false,
    paymentsEnabled: false,
    paymentProvider: 'paystack',
    paymentProviderOptions: [
      { id: 'paystack', label: 'Paystack', defaultCurrency: 'ZAR' },
      { id: 'smilepay', label: 'Smile&Pay (ZB Bank)', defaultCurrency: 'USD' },
    ],
    minimumBalanceUsd: 1,
    commissionRatePercent: 9.5,
    topupMinAmount: 1,
    topupMaxAmount: 500,
    currency: 'USD',
    updatedAt: null,
  })

  const [grantAmount, setGrantAmount] = useState(5)
  const [grantId, setGrantId] = useState(DEFAULT_GRANT_ID)
  const [grantLoading, setGrantLoading] = useState(false)
  const [grantApplying, setGrantApplying] = useState(false)
  const [grantSummary, setGrantSummary] = useState(null)
  const [grantError, setGrantError] = useState('')
  const [grantSuccess, setGrantSuccess] = useState('')

  const [manualEmail, setManualEmail] = useState('')
  const [manualAmount, setManualAmount] = useState(5)
  const [manualDescription, setManualDescription] = useState('Admin wallet top-up')
  const [manualLoading, setManualLoading] = useState(false)
  const [manualError, setManualError] = useState('')
  const [manualSuccess, setManualSuccess] = useState('')

  const [ledgerEmail, setLedgerEmail] = useState('')
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState('')
  const [ledger, setLedger] = useState(null)

  const paymentsLive = !!settings.paymentsEnabled
  const activeProvider = String(settings.paymentProvider || 'paystack').toLowerCase()
  const providerLabel = activeProvider === 'smilepay' ? 'Smile&Pay' : 'Paystack'
  const walletCurrency = String(settings.currency || 'USD').toUpperCase()

  const loadSettings = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/driver-wallet/settings`, { headers })
      setSettings((prev) => ({
        ...prev,
        ...(data?.settings || {}),
      }))
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load driver wallet settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const saveSettings = async (event) => {
    event.preventDefault()
    if (!canManage) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const { data } = await axios.put(
        `${BASE_URL}/api/admin/driver-wallet/settings`,
        {
          // When payments are off, force gating off so the app stays in legacy mode.
          walletEnabled: settings.paymentsEnabled ? !!settings.walletEnabled : false,
          paymentsEnabled: !!settings.paymentsEnabled,
          paymentProvider: String(settings.paymentProvider || 'paystack').toLowerCase(),
          minimumBalanceUsd: Number(settings.minimumBalanceUsd),
          commissionRatePercent: Number(settings.commissionRatePercent),
          topupMinAmount: Number(settings.topupMinAmount),
          topupMaxAmount: Number(settings.topupMaxAmount),
          currency: String(settings.currency || 'USD').toUpperCase(),
        },
        { headers }
      )
      setSettings((prev) => ({
        ...prev,
        ...(data?.settings || {}),
      }))
      setSuccess('Driver wallet settings saved.')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save driver wallet settings')
    } finally {
      setSaving(false)
    }
  }

  const previewStartupGrant = async () => {
    if (!canManage) return
    setGrantLoading(true)
    setGrantError('')
    setGrantSuccess('')
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/driver-wallet/startup-grant/preview`, {
        headers,
        params: {
          amount: Number(grantAmount),
          grantId: String(grantId || DEFAULT_GRANT_ID).trim() || DEFAULT_GRANT_ID,
          currency: walletCurrency,
        },
        timeout: 120000,
      })
      setGrantSummary(data?.summary || null)
      setGrantSuccess(
        data?.summary?.pending === 0
          ? 'Every driver already has this grant — nothing pending.'
          : `Preview ready: ${data.summary.pending} driver(s) would get ${formatMoney(data.summary.amount, data.summary.currency)}.`
      )
    } catch (err) {
      setGrantSummary(null)
      setGrantError(err?.response?.data?.error || err?.message || 'Failed to preview grant')
    } finally {
      setGrantLoading(false)
    }
  }

  const applyStartupGrant = async () => {
    if (!canManage) return
    const pendingCount = Number(grantSummary?.pending || 0)
    const amountLabel = formatMoney(grantAmount, walletCurrency)
    const confirmed = window.confirm(
      pendingCount > 0
        ? `Credit ${pendingCount} pending driver(s) ${amountLabel} each (grant ${grantId})?\n\nDrivers who already received this grant id will be skipped.`
        : `Run apply for grant ${grantId} at ${amountLabel} each?\n\nOnly drivers who have not received this grant will be credited.`
    )
    if (!confirmed) return

    setGrantApplying(true)
    setGrantError('')
    setGrantSuccess('')
    try {
      const { data } = await axios.post(
        `${BASE_URL}/api/admin/driver-wallet/startup-grant`,
        {
          apply: true,
          amount: Number(grantAmount),
          grantId: String(grantId || DEFAULT_GRANT_ID).trim() || DEFAULT_GRANT_ID,
          currency: walletCurrency,
        },
        { headers, timeout: 300000 }
      )
      setGrantSummary(data?.summary || null)
      const s = data?.summary || {}
      setGrantSuccess(
        `Applied. Credited ${s.credited || 0}, skipped ${s.skipped || 0}, failed ${s.failed || 0}.`
      )
    } catch (err) {
      setGrantError(err?.response?.data?.error || err?.message || 'Failed to apply grant')
    } finally {
      setGrantApplying(false)
    }
  }

  const creditOneDriver = async (event) => {
    event.preventDefault()
    if (!canManage) return
    const email = String(manualEmail || '').trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setManualError('Enter a valid driver email.')
      return
    }
    if (!(Number(manualAmount) > 0)) {
      setManualError('Amount must be greater than zero.')
      return
    }

    setManualLoading(true)
    setManualError('')
    setManualSuccess('')
    try {
      const { data } = await axios.post(
        `${BASE_URL}/api/admin/driver-wallet/manual-credit`,
        {
          email,
          amount: Number(manualAmount),
          currency: walletCurrency,
          description: String(manualDescription || 'Admin wallet top-up').trim() || 'Admin wallet top-up',
        },
        { headers }
      )
      const result = data?.result || {}
      const who = result.fullName || result.email || email
      if (result.alreadyCredited) {
        setManualSuccess(`Already credited (same source) for ${who}. Balance: ${formatMoney(result.wallet?.availableBalance, result.currency || walletCurrency)}.`)
      } else {
        setManualSuccess(
          `Credited ${formatMoney(result.amount, result.currency || walletCurrency)} to ${who}. New balance: ${formatMoney(result.wallet?.availableBalance, result.currency || walletCurrency)}.`
        )
      }
    } catch (err) {
      setManualError(err?.response?.data?.error || err?.message || 'Failed to credit driver')
    } finally {
      setManualLoading(false)
    }
  }

  const loadLedger = async (event) => {
    event.preventDefault()
    const email = String(ledgerEmail || '').trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setLedgerError('Enter a valid driver email.')
      return
    }

    setLedgerLoading(true)
    setLedgerError('')
    setLedger(null)
    try {
      const { data } = await axios.get(`${BASE_URL}/api/admin/driver-wallet/ledger`, {
        headers,
        params: { email, limit: 100 },
      })
      setLedger(data?.ledger || null)
    } catch (err) {
      setLedgerError(err?.response?.data?.error || err?.message || 'Failed to load ledger')
    } finally {
      setLedgerLoading(false)
    }
  }

  const exampleFare = 10
  const exampleCommission = (exampleFare * Number(settings.commissionRatePercent || 0)) / 100

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Driver wallet settings</h1>
        <p className="mt-1 text-xs text-slate-500">
          Master payments switch, provider, and admin wallet top-ups for new drivers.
        </p>
      </div>

      {error ? (
        <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}
      {success ? (
        <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div>
      ) : null}

      {loading ? (
        <div className="border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">Loading settings...</div>
      ) : (
        <form onSubmit={saveSettings} className="space-y-4 border border-slate-200 bg-white p-4">
          <div className={`border px-4 py-4 ${paymentsLive ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Payments system</p>
            <p className={`mt-1 text-lg font-semibold ${paymentsLive ? 'text-emerald-700' : 'text-amber-800'}`}>
              {paymentsLive ? 'ON — fully live' : 'OFF — default (no payments)'}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              {paymentsLive
                ? `Drivers can top up with ${providerLabel}, low balance can block ride requests, and a service fee is deducted on completed trips.`
                : 'Drivers work as before: no wallet top-ups, no wallet balance requirement, and no service fee wallet deductions.'}
            </p>
          </div>

          <label className="flex items-start gap-3 border border-slate-200 bg-slate-50 px-3 py-3">
            <input
              type="checkbox"
              checked={paymentsLive}
              disabled={!canManage}
              onChange={(event) => {
                const enabled = event.target.checked
                setSettings((prev) => ({
                  ...prev,
                  paymentsEnabled: enabled,
                  walletEnabled: enabled ? true : false,
                }))
              }}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800">Enable payments system</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Master switch. Off = legacy ride flow. On = top-ups, wallet balance checks, and service fee deductions.
              </span>
            </span>
          </label>

          {paymentsLive ? (
            <>
              <label className="block border border-slate-200 bg-slate-50 px-3 py-3">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Payment provider
                </span>
                <select
                  value={activeProvider}
                  disabled={!canManage}
                  onChange={(event) => {
                    const nextProvider = String(event.target.value || 'paystack').toLowerCase()
                    setSettings((prev) => ({
                      ...prev,
                      paymentProvider: nextProvider,
                      currency: PROVIDER_DEFAULT_CURRENCY[nextProvider] || prev.currency,
                    }))
                  }}
                  className="w-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                >
                  {(settings.paymentProviderOptions || []).map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <span className="mt-2 block text-xs leading-5 text-slate-500">
                  {activeProvider === 'smilepay'
                    ? 'Smile&Pay supports USD (840) and ZWG (924) with Ecocash, Innbucks, cards, and more. Requires SMILEPAY_API_KEY, SMILEPAY_API_SECRET, and PUBLIC_API_BASE_URL.'
                    : 'Paystack stays available. SA merchants typically use ZAR. Requires PAYSTACK_SECRET_KEY.'}
                </span>
              </label>

              <label className="flex items-start gap-3 border border-slate-200 bg-slate-50 px-3 py-3">
                <input
                  type="checkbox"
                  checked={!!settings.walletEnabled}
                  disabled={!canManage}
                  onChange={(event) => setSettings((prev) => ({ ...prev, walletEnabled: event.target.checked }))}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-800">Require wallet balance to receive ride requests</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Only applies while payments are on. Drivers below the minimum balance cannot go online or receive new requests.
                  </span>
                </span>
              </label>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Minimum wallet balance
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={Number(settings.minimumBalanceUsd)}
                    disabled={!canManage}
                    onChange={(event) => setSettings((prev) => ({ ...prev, minimumBalanceUsd: event.target.value }))}
                    className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Service fee rate (%)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={Number(settings.commissionRatePercent)}
                    disabled={!canManage}
                    onChange={(event) => setSettings((prev) => ({ ...prev, commissionRatePercent: event.target.value }))}
                    className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Currency
                  </span>
                  <select
                    value={String(settings.currency || 'USD').toUpperCase()}
                    disabled={!canManage}
                    onChange={(event) => setSettings((prev) => ({ ...prev, currency: event.target.value }))}
                    className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                  >
                    {CURRENCY_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Minimum top-up amount
                  </span>
                  <input
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={Number(settings.topupMinAmount)}
                    disabled={!canManage}
                    onChange={(event) => setSettings((prev) => ({ ...prev, topupMinAmount: event.target.value }))}
                    className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Maximum top-up amount
                  </span>
                  <input
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={Number(settings.topupMaxAmount)}
                    disabled={!canManage}
                    onChange={(event) => setSettings((prev) => ({ ...prev, topupMaxAmount: event.target.value }))}
                    className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
                  />
                </label>
              </div>

              <div className="border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                Example: a {formatMoney(exampleFare, settings.currency)} trip deducts{' '}
                <strong>{formatMoney(exampleCommission, settings.currency)}</strong> service fee (
                {Number(settings.commissionRatePercent || 0).toFixed(2)}%).
                Active provider: <strong>{providerLabel}</strong>. Provider API keys stay in server environment variables.
              </div>
            </>
          ) : (
            <div className="border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
              Payments are off. Drivers can go online and complete trips without wallet top-ups or service fee deductions.
              Turn the switch on above when you are ready to launch wallet payments.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canManage || saving}
              className="border border-indigo-600 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save settings'}
            </button>
            {!canManage ? (
              <p className="text-xs text-amber-700">You need payouts manage permission to edit these settings.</p>
            ) : null}
            <p className="text-xs text-slate-500">
              Last updated: {settings.updatedAt ? new Date(settings.updatedAt).toLocaleString('en-ZW') : 'Not yet saved'}
            </p>
          </div>
        </form>
      )}

      <section className="space-y-4 border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Startup grant (new drivers)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Same as the CLI job: credit every driver who has not yet received this grant id.
            Keep grant id as <code className="text-[11px]">{DEFAULT_GRANT_ID}</code> to only top up newcomers.
          </p>
        </div>

        {grantError ? (
          <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{grantError}</div>
        ) : null}
        {grantSuccess ? (
          <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{grantSuccess}</div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Amount ({walletCurrency})
            </span>
            <input
              type="number"
              min={0.01}
              step="0.01"
              value={Number(grantAmount)}
              disabled={!canManage || grantLoading || grantApplying}
              onChange={(event) => setGrantAmount(event.target.value)}
              className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Grant id (idempotency key)
            </span>
            <input
              type="text"
              value={grantId}
              disabled={!canManage || grantLoading || grantApplying}
              onChange={(event) => setGrantId(event.target.value)}
              className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
              placeholder={DEFAULT_GRANT_ID}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canManage || grantLoading || grantApplying}
            onClick={previewStartupGrant}
            className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
          >
            {grantLoading ? 'Checking…' : 'Preview pending'}
          </button>
          <button
            type="button"
            disabled={!canManage || grantLoading || grantApplying}
            onClick={applyStartupGrant}
            className="border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {grantApplying ? 'Crediting drivers…' : 'Apply grant'}
          </button>
          {!canManage ? (
            <p className="text-xs text-amber-700">Needs payouts manage permission.</p>
          ) : null}
        </div>

        {grantSummary ? (
          <div className="border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-700">
            <p>
              Drivers: <strong>{grantSummary.totalDrivers}</strong>
              {' · '}
              Already granted: <strong>{grantSummary.alreadyGranted}</strong>
              {' · '}
              Pending: <strong>{grantSummary.pending}</strong>
              {' · '}
              Total: <strong>{formatMoney(grantSummary.totalToCredit, grantSummary.currency)}</strong>
            </p>
            {Array.isArray(grantSummary.samplePending) && grantSummary.samplePending.length > 0 ? (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {grantSummary.samplePending.map((driver) => (
                  <li key={driver.id} className="font-mono text-[11px] text-slate-600">
                    {(driver.fullName || driver.email || 'Driver')} — {driver.id}
                  </li>
                ))}
                {grantSummary.pending > grantSummary.samplePending.length ? (
                  <li className="text-slate-500">…and {grantSummary.pending - grantSummary.samplePending.length} more</li>
                ) : null}
              </ul>
            ) : null}
            {Array.isArray(grantSummary.failures) && grantSummary.failures.length > 0 ? (
              <div className="mt-2 text-rose-700">
                Failures ({grantSummary.failures.length}):
                <ul className="mt-1 space-y-0.5">
                  {grantSummary.failures.slice(0, 10).map((failure) => (
                    <li key={`${failure.driverUserId}-${failure.error}`}>
                      {failure.label}: {failure.error}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-4 border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Single driver top-up</h2>
          <p className="mt-1 text-xs text-slate-500">
            Credit one driver by their account email. Must be a driver role in Clerk.
          </p>
        </div>

        {manualError ? (
          <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{manualError}</div>
        ) : null}
        {manualSuccess ? (
          <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{manualSuccess}</div>
        ) : null}

        <form onSubmit={creditOneDriver} className="grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Driver email
            </span>
            <input
              type="email"
              value={manualEmail}
              disabled={!canManage || manualLoading}
              onChange={(event) => setManualEmail(event.target.value)}
              placeholder="driver@example.com"
              autoComplete="email"
              className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Amount ({walletCurrency})
            </span>
            <input
              type="number"
              min={0.01}
              step="0.01"
              value={Number(manualAmount)}
              disabled={!canManage || manualLoading}
              onChange={(event) => setManualAmount(event.target.value)}
              className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Note
            </span>
            <input
              type="text"
              value={manualDescription}
              disabled={!canManage || manualLoading}
              onChange={(event) => setManualDescription(event.target.value)}
              className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={!canManage || manualLoading}
              className="border border-indigo-600 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {manualLoading ? 'Crediting…' : 'Credit driver'}
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-4 border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Wallet ledger lookup</h2>
          <p className="mt-1 text-xs text-slate-500">
            View transactions for live or deleted drivers by email. Wallet history is kept after account deletion.
          </p>
        </div>

        {ledgerError ? (
          <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{ledgerError}</div>
        ) : null}

        <form onSubmit={loadLedger} className="flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Driver email
            </span>
            <input
              type="email"
              value={ledgerEmail}
              disabled={ledgerLoading}
              onChange={(event) => setLedgerEmail(event.target.value)}
              placeholder="driver@example.com"
              className="w-full border border-slate-200 px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <button
            type="submit"
            disabled={ledgerLoading}
            className="border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {ledgerLoading ? 'Loading…' : 'Load ledger'}
          </button>
        </form>

        {ledger ? (
          <div className="space-y-3">
            <div className="border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-700">
              <p>
                {ledger.wallet?.ownerFullName || ledger.wallet?.ownerEmail || ledger.driverUserId}
                {ledger.wallet?.accountDeletedAt ? (
                  <span className="ml-2 font-semibold text-amber-700">Account deleted</span>
                ) : null}
              </p>
              <p className="mt-1">
                Balance: <strong>{formatMoney(ledger.wallet?.availableBalance, ledger.wallet?.currency || walletCurrency)}</strong>
                {' · '}
                Credits: <strong>{formatMoney(ledger.summary?.totalCredits, ledger.wallet?.currency || walletCurrency)}</strong>
                {' · '}
                Debits: <strong>{formatMoney(ledger.summary?.totalDebits, ledger.wallet?.currency || walletCurrency)}</strong>
                {' · '}
                Rows: <strong>{ledger.summary?.transactionCount || 0}</strong>
              </p>
            </div>

            <div className="overflow-x-auto border border-slate-200">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-200">
                    <th className="px-3 py-2 font-semibold">When</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Amount</th>
                    <th className="px-3 py-2 font-semibold">Balance after</th>
                    <th className="px-3 py-2 font-semibold">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(ledger.transactions || []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-500">No transactions found.</td>
                    </tr>
                  ) : (
                    ledger.transactions.map((tx) => (
                      <tr key={tx.id} className="border-t border-slate-200">
                        <td className="px-3 py-2 text-slate-600">
                          {tx.createdAt ? new Date(tx.createdAt).toLocaleString('en-ZW') : '-'}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">{tx.transactionType || '-'}</td>
                        <td className={`px-3 py-2 font-semibold ${Number(tx.amount || 0) < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {formatMoney(tx.amount, tx.currency || walletCurrency)}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {formatMoney(tx.balanceAfter, tx.currency || walletCurrency)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{tx.description || tx.sourceType || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
