import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import BASE_URL from '../context/Api'

const STORAGE_KEY = 'trust_agent_session'
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
  try {
    const response = await axios({
      url: `${BASE_URL}${path}`,
      method: options.method || 'GET',
      data: options.body ? JSON.parse(options.body) : undefined,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    })
    return response.data || {}
  } catch (error) {
    if (!error?.response) {
      const networkError = new Error('Network error. Please check your connection and try again.')
      networkError.status = 0
      throw networkError
    }

    const requestError = new Error(error?.response?.data?.error || 'Request failed')
    requestError.status = error.response.status
    throw requestError
  }
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

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error?.response?.status
        const requestUrl = String(error?.config?.url || '')
        const isAgentRequest = requestUrl.includes('/api/agent/')
        const isAgentLoginRequest = requestUrl.includes('/api/agent/auth/login')

        if ((status === 401 || status === 403) && isAgentRequest && !isAgentLoginRequest) {
          clearSession()
        }

        return Promise.reject(error)
      }
    )

    return () => {
      axios.interceptors.response.eject(interceptor)
    }
  }, [])

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
