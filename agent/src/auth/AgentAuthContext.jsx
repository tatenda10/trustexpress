import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'trust_agent_session'
const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
const AgentAuthContext = createContext(null)

function parseStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { token: '', agent: null }
    const parsed = JSON.parse(raw)
    if (!parsed?.token || !parsed?.agent) return { token: '', agent: null }
    return { token: parsed.token, agent: parsed.agent }
  } catch {
    return { token: '', agent: null }
  }
}

async function apiFetch(path, options = {}, token = '') {
  const headers = { ...(options.headers || {}) }
  if (options.body === undefined || typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let response
  let data = {}
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
    })
    data = await response.json().catch(() => ({}))
  } catch {
    const error = new Error('Network error. Please check your connection and try again.')
    error.status = 0
    throw error
  }

  if (!response.ok) {
    const error = new Error(data?.error || 'Request failed')
    error.status = response.status
    throw error
  }

  return data
}

export function AgentAuthProvider({ children }) {
  const [{ token, agent }, setSessionState] = useState(parseStoredSession)
  const [restoring, setRestoring] = useState(false)

  const setSession = ({ token: nextToken, agent: nextAgent }) => {
    const payload = { token: nextToken, agent: nextAgent }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    setSessionState(payload)
  }

  const clearSession = () => {
    localStorage.removeItem(STORAGE_KEY)
    setSessionState({ token: '', agent: null })
  }

  useEffect(() => {
    if (!token || !agent) return

    let active = true
    const restore = async () => {
      setRestoring(true)
      try {
        const data = await apiFetch('/api/agent/auth/me', {}, token)
        if (!active) return
        setSession({ token, agent: data.agent || agent })
      } catch {
        if (!active) return
        clearSession()
      } finally {
        if (active) setRestoring(false)
      }
    }

    restore()
    return () => {
      active = false
    }
  }, [token, agent?.id])

  const login = async ({ email, password }) => {
    const data = await apiFetch('/api/agent/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    setSession({ token: data.token, agent: data.agent })
    return data
  }

  const logout = async () => {
    try {
      if (token) {
        await apiFetch('/api/agent/auth/logout', {
          method: 'POST',
          body: JSON.stringify({}),
        }, token)
      }
    } catch {
      // Ignore remote logout issues and still clear local session.
    } finally {
      clearSession()
    }
  }

  const value = useMemo(() => ({
    token,
    agent,
    restoring,
    isAuthenticated: !!token && !!agent,
    login,
    logout,
    clearSession,
  }), [token, agent, restoring])

  return <AgentAuthContext.Provider value={value}>{children}</AgentAuthContext.Provider>
}

export function useAgentAuth() {
  const context = useContext(AgentAuthContext)
  if (!context) {
    throw new Error('useAgentAuth must be used inside AgentAuthProvider')
  }
  return context
}
