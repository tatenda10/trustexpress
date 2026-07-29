import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

const CURRENCY_OPTIONS = ['USD', 'ZWG', 'ZAR', 'NGN', 'GHS', 'KES'];
const PROVIDER_DEFAULT_CURRENCY = {
  paystack: 'ZAR',
  smilepay: 'USD',
};

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

  const paymentsLive = !!settings.paymentsEnabled
  const activeProvider = String(settings.paymentProvider || 'paystack').toLowerCase()
  const providerLabel = activeProvider === 'smilepay' ? 'Smile&Pay' : 'Paystack'

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

  const exampleFare = 10
  const exampleCommission = (exampleFare * Number(settings.commissionRatePercent || 0)) / 100

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Driver wallet settings</h1>
        <p className="mt-1 text-xs text-slate-500">
          Master payments switch and provider. Off = default ride flow. On = wallet top-ups via Paystack or Smile&Pay.
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
                ? `Drivers can top up with ${providerLabel}, low balance can block ride requests, and commission is deducted on completed trips.`
                : 'Drivers work as before: no wallet top-ups, no wallet balance requirement, and no commission wallet deductions.'}
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
                Master switch. Off = legacy ride flow. On = top-ups, wallet balance checks, and commission deductions.
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
                    Commission rate (%)
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
                <strong>{formatMoney(exampleCommission, settings.currency)}</strong> commission (
                {Number(settings.commissionRatePercent || 0).toFixed(2)}%).
                Active provider: <strong>{providerLabel}</strong>. Provider API keys stay in server environment variables.
              </div>
            </>
          ) : (
            <div className="border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
              Payments are off. Drivers can go online and complete trips without wallet top-ups or commission deductions.
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
    </div>
  )
}
