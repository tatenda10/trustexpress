import { useAuth } from '../authcontext/AuthContext'

export default function Can({ permission, anyOf = [], allOf = [], fallback = null, children }) {
  const { admin, can } = useAuth()

  if (!admin) return fallback
  if (admin.role === 'super_admin') return children

  let allowed = true

  if (permission) {
    allowed = allowed && can(permission)
  }

  if (anyOf.length > 0) {
    allowed = allowed && anyOf.some((key) => can(key))
  }

  if (allOf.length > 0) {
    allowed = allowed && allOf.every((key) => can(key))
  }

  return allowed ? children : fallback
}
