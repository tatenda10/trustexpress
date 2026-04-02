export const PERMISSION_CATALOG = [
  { key: 'overview.read', module: 'overview', name: 'Read Overview' },

  { key: 'drivers.read', module: 'drivers', name: 'Read Drivers' },
  { key: 'drivers.manage', module: 'drivers', name: 'Manage Drivers' },
  { key: 'drivers.delete', module: 'drivers', name: 'Delete Drivers' },

  { key: 'passengers.read', module: 'passengers', name: 'Read Passengers' },
  { key: 'passengers.manage', module: 'passengers', name: 'Manage Passengers' },
  { key: 'passengers.delete', module: 'passengers', name: 'Delete Passengers' },

  { key: 'verification.read', module: 'verification', name: 'Read Verification' },
  { key: 'verification.review', module: 'verification', name: 'Review Verification' },

  { key: 'ride_ops.read', module: 'ride_ops', name: 'Read Ride Operations' },
  { key: 'ride_ops.manage', module: 'ride_ops', name: 'Manage Ride Operations' },

  { key: 'live_map.read', module: 'live_map', name: 'Read Live Map' },

  { key: 'pricing.read', module: 'pricing', name: 'Read Pricing' },
  { key: 'pricing.manage', module: 'pricing', name: 'Manage Pricing' },

  { key: 'payouts.read', module: 'payouts', name: 'Read Payouts' },
  { key: 'payouts.manage', module: 'payouts', name: 'Manage Payouts' },

  { key: 'reports.read', module: 'reports', name: 'Read Reports' },

  { key: 'support.read', module: 'support', name: 'Read Support' },
  { key: 'support.manage', module: 'support', name: 'Manage Support' },

  { key: 'agents.read', module: 'agents', name: 'Read Agents' },
  { key: 'agents.manage', module: 'agents', name: 'Manage Agents' },

  { key: 'admin.users.read', module: 'admin', name: 'Read Admin Users' },
  { key: 'admin.users.manage', module: 'admin', name: 'Manage Admin Users' },
  { key: 'admin.roles.read', module: 'admin', name: 'Read Roles' },
  { key: 'admin.roles.manage', module: 'admin', name: 'Manage Roles' },
]

export const DEFAULT_ROLE_MAPPINGS = {
  super_admin: PERMISSION_CATALOG.map((item) => item.key),
  admin: [
    'overview.read',
    'drivers.read',
    'passengers.read',
    'verification.read',
    'ride_ops.read',
    'live_map.read',
    'reports.read',
  ],
  verification_admin: ['overview.read', 'verification.read', 'verification.review', 'drivers.read'],
  operations_admin: ['overview.read', 'ride_ops.read', 'ride_ops.manage', 'live_map.read', 'drivers.read', 'passengers.read'],
  support_admin: ['overview.read', 'support.read', 'support.manage', 'passengers.read', 'passengers.manage'],
  finance_admin: ['overview.read', 'pricing.read', 'pricing.manage', 'payouts.read', 'payouts.manage', 'reports.read'],
  recruitment_admin: ['overview.read', 'agents.read', 'agents.manage', 'verification.read', 'drivers.read'],
}
