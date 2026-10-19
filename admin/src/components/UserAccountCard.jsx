import { useEffect, useState } from 'react'
import axios from 'axios'
import BASE_URL from '../context/Api'

const MIN_PASSWORD_LENGTH = 8

function generatePassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint32Array(10)
  window.crypto.getRandomValues(bytes)
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('')
}

function Input({ label, value, onChange, type = 'text', placeholder, hint }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#6f54ff]"
      />
      {hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  )
}

/**
 * Lets admins correct a driver's or passenger's name, email and phone, and set a new password.
 * `canManage` should reflect drivers.manage / passengers.manage; the server enforces the same check.
 */
export default function UserAccountCard({ userId, token, canManage, onUpdated }) {
  const [account, setAccount] = useState(null)
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phoneNumber: '' })
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [signOutEverywhere, setSignOutEverywhere] = useState(true)
  const [settingPassword, setSettingPassword] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState({ type: '', text: '' })

  const headers = { Authorization: `Bearer ${token}` }

  const applyAccount = (next) => {
    setAccount(next)
    setForm({
      firstName: next?.firstName || '',
      lastName: next?.lastName || '',
      email: next?.email || '',
      phoneNumber: next?.phoneNumber || '',
    })
  }

  useEffect(() => {
    if (!userId || !token || !canManage) return undefined
    let cancelled = false
    setLoadError('')
    axios
      .get(`${BASE_URL}/api/admin/user-accounts/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => {
        if (!cancelled) applyAccount(data.account || null)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err?.response?.data?.error || err?.message || 'Unable to load account')
      })
    return () => {
      cancelled = true
    }
  }, [userId, token, canManage])

  if (!canManage) return null

  const dirty =
    account &&
    (form.firstName.trim() !== (account.firstName || '') ||
      form.lastName.trim() !== (account.lastName || '') ||
      form.email.trim().toLowerCase() !== (account.email || '').toLowerCase() ||
      form.phoneNumber.trim() !== (account.phoneNumber || ''))

  const handleSave = async (event) => {
    event.preventDefault()
    if (!account || !dirty) return
    if (!form.firstName.trim()) {
      setMessage({ type: 'error', text: 'First name is required.' })
      return
    }
    const payload = {}
    if (form.firstName.trim() !== (account.firstName || '') || form.lastName.trim() !== (account.lastName || '')) {
      payload.firstName = form.firstName
      payload.lastName = form.lastName
    }
    if (form.email.trim().toLowerCase() !== (account.email || '').toLowerCase()) payload.email = form.email
    if (form.phoneNumber.trim() !== (account.phoneNumber || '')) payload.phoneNumber = form.phoneNumber

    if ((payload.email !== undefined && !payload.email.trim()) || (payload.phoneNumber !== undefined && !payload.phoneNumber.trim())) {
      const ok = window.confirm('You are removing a sign-in method. The user will no longer be able to sign in with it. Continue?')
      if (!ok) return
    }

    setSaving(true)
    setMessage({ type: '', text: '' })
    try {
      const { data } = await axios.patch(`${BASE_URL}/api/admin/user-accounts/${encodeURIComponent(userId)}`, payload, { headers })
      applyAccount(data.account || null)
      setMessage({ type: 'success', text: 'Account details saved.' })
      onUpdated?.(data.account || null)
    } catch (err) {
      setMessage({ type: 'error', text: err?.response?.data?.error || err?.message || 'Unable to save account details' })
    } finally {
      setSaving(false)
    }
  }

  const handleSetPassword = async (event) => {
    event.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordMessage({ type: 'error', text: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` })
      return
    }
    const ok = window.confirm(
      signOutEverywhere
        ? 'Set this new password and sign the user out of all devices?'
        : 'Set this new password?'
    )
    if (!ok) return

    setSettingPassword(true)
    setPasswordMessage({ type: '', text: '' })
    try {
      const { data } = await axios.post(
        `${BASE_URL}/api/admin/user-accounts/${encodeURIComponent(userId)}/password`,
        { password, signOutEverywhere },
        { headers }
      )
      if (data.account) setAccount(data.account)
      setPasswordMessage({
        type: 'success',
        text: `Password set. Share it with the user securely: ${password}`,
      })
      setPassword('')
      setShowPassword(false)
    } catch (err) {
      setPasswordMessage({ type: 'error', text: err?.response?.data?.error || err?.message || 'Unable to set password' })
    } finally {
      setSettingPassword(false)
    }
  }

  const messageClass = (type) =>
    type === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700'

  return (
    <section className="rounded-sm border border-slate-300 bg-white">
      <div className="border-b border-slate-300 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Account &amp; sign-in</h2>
        <p className="text-xs text-slate-500">Correct the user's name, email or phone, or set a new password.</p>
      </div>

      {loadError ? (
        <p className="m-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{loadError}</p>
      ) : !account ? (
        <p className="p-4 text-xs text-slate-500">Loading account...</p>
      ) : (
        <div className="grid gap-6 p-4 lg:grid-cols-2">
          <form onSubmit={handleSave} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Profile details</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="First name" value={form.firstName} onChange={(v) => setForm((f) => ({ ...f, firstName: v }))} />
              <Input label="Last name" value={form.lastName} onChange={(v) => setForm((f) => ({ ...f, lastName: v }))} />
            </div>
            <Input
              label="Email"
              type="email"
              value={form.email}
              placeholder="name@example.com"
              onChange={(v) => setForm((f) => ({ ...f, email: v }))}
              hint={account.email ? (account.emailVerified ? 'Verified' : 'Not verified') : 'No email on file'}
            />
            <Input
              label="Phone"
              value={form.phoneNumber}
              placeholder="0771234567"
              onChange={(v) => setForm((f) => ({ ...f, phoneNumber: v }))}
              hint={account.phoneNumber ? (account.phoneVerified ? 'Verified' : 'Not verified') : 'No phone on file'}
            />
            {message.text ? (
              <p className={`rounded border px-3 py-2 text-xs ${messageClass(message.type)}`}>{message.text}</p>
            ) : null}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={!dirty || saving}
                className="rounded bg-[#6f54ff] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
              {dirty ? (
                <button
                  type="button"
                  onClick={() => applyAccount(account)}
                  className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                >
                  Discard
                </button>
              ) : null}
            </div>
            <p className="text-[11px] text-slate-500">
              Emails and phone numbers set here are marked as verified, so the user can sign in with them straight away.
            </p>
          </form>

          <form onSubmit={handleSetPassword} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Password</h3>
            <p className="text-xs text-slate-600">
              {account.hasPassword ? 'This user has a password.' : 'This user has no password yet (signs in with a code).'}
            </p>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  label="New password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  onChange={setPassword}
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPassword(generatePassword())
                    setShowPassword(true)
                  }}
                  className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                >
                  Generate
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={signOutEverywhere}
                onChange={(event) => setSignOutEverywhere(event.target.checked)}
              />
              Sign the user out of all devices
            </label>
            {passwordMessage.text ? (
              <p className={`break-all rounded border px-3 py-2 text-xs ${messageClass(passwordMessage.type)}`}>
                {passwordMessage.text}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={!password || settingPassword}
              className="rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {settingPassword ? 'Setting...' : 'Set password'}
            </button>
          </form>
        </div>
      )}
    </section>
  )
}
