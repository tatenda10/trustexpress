import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

export default function AdminLoginPage() {
  const { setSession } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    const loginUrl = `${BASE_URL}/api/admin/auth/login`

    try {
      const { data } = await axios.post(
        loginUrl,
        { email, password },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      )

      setSession({
        token: data.token,
        admin: data.admin,
        roles: data.roles || [],
        permissions: data.permissions || [],
      })

      navigate('/dashboard', { replace: true })
    } catch (err) {
      const apiError = err?.response?.data?.error
      const networkMessage = err?.message || 'Unable to login'
      setError(apiError || networkMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#eceff3] lg:grid lg:grid-cols-[48%_52%]">
      <section className="flex min-h-screen items-center justify-center px-6 py-10 lg:px-14">
        <div className="w-full max-w-[430px]">
          <div className="mb-7">
            <p className="text-base font-semibold tracking-wide text-[#2563eb]">TrustCars</p>
            <h1 className="mt-2 text-5xl font-bold leading-tight text-[#0f172a]">Log in</h1>
            <p className="mt-3 text-sm text-slate-500">Admin Console access for driver operations, verification and support.</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="admin-email" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Email address
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@trustcars.com"
                required
                className="h-12 w-full rounded-sm border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#2563eb] focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="admin-password" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                required
                className="h-12 w-full rounded-sm border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#2563eb] focus:ring-4 focus:ring-blue-100"
              />
            </div>

            {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 h-12 w-full rounded-sm bg-[#1d4ed8] text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? 'Signing in...' : 'Log in'}
            </button>

            <div className="relative py-1">
              <div className="h-px w-full bg-slate-300" />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#eceff3] px-3 text-xs text-slate-500">Admin only</span>
            </div>

            <button
              type="button"
              className="h-11 w-full rounded-sm border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Need account support
            </button>
          </form>
        </div>
      </section>

      <section className="relative hidden min-h-screen lg:block">
        <img
          src="https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1400&q=80"
          alt="TrustCars operations team"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-black/10" />
        <div className="absolute bottom-8 left-8 right-8 rounded-md bg-black/35 p-5 backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-blue-200">TrustCars Admin Console</p>
          <p className="mt-2 max-w-md text-2xl font-semibold text-white">Manage ride sharing operations in one place.</p>
        </div>
      </section>
    </div>
  )
}
