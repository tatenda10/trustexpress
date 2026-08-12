/**
 * First dashboard path the signed-in admin is allowed to open.
 * Avoids sending recruitment/agent staff to Overview (company revenue).
 */
const HOME_CANDIDATES = [
  { permission: 'overview.read', path: '/dashboard/overview' },
  { permission: 'agents.read', path: '/dashboard/agents' },
  { permission: 'verification.read', path: '/dashboard/driver-verification' },
  { permission: 'support.read', path: '/dashboard/support' },
  { permission: 'ride_ops.read', path: '/dashboard/ride-operations' },
  { permission: 'drivers.read', path: '/dashboard/drivers' },
  { permission: 'passengers.read', path: '/dashboard/passengers' },
  { permission: 'live_map.read', path: '/dashboard/live-map' },
  { permission: 'reports.read', path: '/dashboard/reports' },
  { permission: 'pricing.read', path: '/dashboard/pricing-zones' },
  { permission: 'payouts.read', path: '/dashboard/driver-payouts' },
  { permission: 'admin.users.read', path: '/dashboard/admin-users' },
]

export function getDefaultDashboardPath({ admin, permissions = [], can } = {}) {
  if (admin?.role === 'super_admin') return '/dashboard/overview'
  const allowed = (key) => (typeof can === 'function' ? can(key) : permissions.includes(key))
  const match = HOME_CANDIDATES.find((item) => allowed(item.permission))
  return match?.path || '/dashboard/agents'
}
