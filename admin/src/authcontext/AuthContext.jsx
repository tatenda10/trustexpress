import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import BASE_URL from '../context/Api'

const STORAGE_KEY = 'trust_admin_session'
const AuthContext = createContext(null)

function parseStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { token: '', admin: null, roles: [], permissions: [] }

    const parsed = JSON.parse(raw)
    if (!parsed?.token || !parsed?.admin) {
      return { token: '', admin: null, roles: [], permissions: [] }
    }

    return {
      token: parsed.token,
      admin: parsed.admin,
      roles: Array.isArray(parsed.roles) ? parsed.roles : [],
      permissions: Array.isArray(parsed.permissions) ? parsed.permissions : [],
    }
  } catch {
    return { token: '', admin: null, roles: [], permissions: [] }
  }
}

export function AuthProvider({ children }) {
  const [{ token, admin, roles, permissions }, setAuth] = useState(parseStoredSession)
  const [loadingPermissions, setLoadingPermissions] = useState(false)

  const setSession = ({ token: nextToken, admin: nextAdmin, roles: nextRoles = [], permissions: nextPermissions = [] }) => {
    const payload = {
      token: nextToken,
      admin: nextAdmin,
      roles: Array.isArray(nextRoles) ? nextRoles : [],
      permissions: Array.isArray(nextPermissions) ? nextPermissions : [],
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    setAuth(payload)
  }

  const clearSession = () => {
    localStorage.removeItem(STORAGE_KEY)
    setAuth({ token: '', admin: null, roles: [], permissions: [] })
  }

  useEffect(() => {
    if (!token || !admin) return
    if (permissions.length > 0) return

    const refresh = async () => {
      setLoadingPermissions(true)
      try {
        const response = await fetch(`${BASE_URL}/api/admin/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (!response.ok) throw new Error('Session refresh failed')
        const data = await response.json()

        setSession({
          token,
          admin: data.admin || admin,
          roles: data.roles || [],
          permissions: data.permissions || [],
        })
      } catch {
        clearSession()
      } finally {
        setLoadingPermissions(false)
      }
    }

    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, admin?.id])

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error?.response?.status
        const requestUrl = String(error?.config?.url || '')
        const isAdminRequest = requestUrl.includes('/api/admin/')
        const isAuthLoginRequest = requestUrl.includes('/api/admin/auth/login')

        if ((status === 401 || status === 403) && isAdminRequest && !isAuthLoginRequest) {
          clearSession()
        }

        return Promise.reject(error)
      }
    )

    return () => {
      axios.interceptors.response.eject(interceptor)
    }
  }, [])

  const can = (permissionKey) => {
    if (!admin) return false
    if (admin.role === 'super_admin') return true
    return permissions.includes(permissionKey)
  }

  const value = useMemo(
    () => ({
      token,
      admin,
      roles,
      permissions,
      loadingPermissions,
      isAuthenticated: !!token && !!admin,
      setSession,
      clearSession,
      can,
    }),
    [token, admin, roles, permissions, loadingPermissions]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }

  return context
}
