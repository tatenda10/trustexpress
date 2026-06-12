import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import BASE_URL from '../context/Api'

const navSections = [
  {
    label: null,
    items: [
      { id: 'overview', label: 'Overview', icon: GridIcon, to: '/dashboard/overview', permission: 'overview.read' },
      { id: 'verification', label: 'Driver Verification', icon: FolderIcon, to: '/dashboard/driver-verification', permission: 'verification.read' },
      { id: 'rides', label: 'Ride Operations', icon: BriefcaseIcon, to: '/dashboard/ride-operations', permission: 'ride_ops.read' },
      { id: 'live-map', label: 'Live Map', icon: CatalogIcon, to: '/dashboard/live-map', permission: 'live_map.read' },
    ],
  },
  {
    label: 'Users',
    items: [
      { id: 'drivers', label: 'Drivers', icon: UsersIcon, to: '/dashboard/drivers', permission: 'drivers.read' },
      { id: 'passengers', label: 'Passengers', icon: UsersIcon, to: '/dashboard/passengers', permission: 'passengers.read' },
      { id: 'agents', label: 'Agents', icon: UsersIcon, to: '/dashboard/agents', permission: 'agents.read' },
      { id: 'support', label: 'Support Tickets', icon: LockIcon, to: '/dashboard/support', permission: 'support.read' },
      { id: 'support-agent', label: 'Support Agent', icon: LockIcon, to: '/dashboard/support-agent', permission: 'support.read' },
    ],
  },
  {
    label: 'Business',
    items: [
      { id: 'pricing', label: 'Pricing', icon: ServerIcon, to: '/dashboard/pricing-zones', permission: 'pricing.read' },
      { id: 'vehicle-tiers', label: 'Vehicle Tiers', icon: ComponentsIcon, to: '/dashboard/vehicle-tiers', permission: 'pricing.read' },
      { id: 'agent-rewards', label: 'Agent Rewards', icon: ComponentsIcon, to: '/dashboard/agent-rewards', permission: 'payouts.read' },
      { id: 'payouts', label: 'Driver Payouts', icon: ComponentsIcon, to: '/dashboard/driver-payouts', permission: 'payouts.read' },
      { id: 'promotions', label: 'Promotions', icon: NetworkIcon, to: '/dashboard/promotions', permission: 'pricing.read' },
      { id: 'reports', label: 'Reports', icon: ClusterIcon, to: '/dashboard/reports', permission: 'reports.read' },
    ],
  },
  {
    label: 'Safety & System',
    items: [
      { id: 'panic-alerts', label: 'Panic Alerts', icon: LockIcon, to: '/dashboard/panic-alerts', permission: 'ride_ops.read' },
      { id: 'lost-items', label: 'Lost Items', icon: LockIcon, to: '/dashboard/lost-items', permission: 'ride_ops.read' },
      { id: 'admin-users', label: 'Admin Users', icon: UsersIcon, to: '/dashboard/admin-users', permission: 'admin.users.read' },
    ],
  },
]

function LogoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#6f54ff" />
      <path d="m7 7 10 10M17 7 7 17" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1" fill="currentColor" />
      <rect x="13" y="4" width="7" height="7" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="4" y="13" width="7" height="7" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="13" y="13" width="7" height="7" rx="1" fill="currentColor" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M3.5 7.5h6l1.5 1.7H20a1 1 0 0 1 1 1v7.8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 .5-1Z" fill="currentColor" />
    </svg>
  )
}

function BriefcaseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="18" height="12" rx="2" fill="currentColor" />
      <rect x="9" y="4" width="6" height="3" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

function CatalogIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1" fill="currentColor" />
      <rect x="13" y="4" width="7" height="7" rx="1" fill="currentColor" />
      <rect x="4" y="13" width="7" height="7" rx="1" fill="currentColor" />
      <rect x="13" y="13" width="7" height="7" rx="1" fill="currentColor" />
    </svg>
  )
}

function ServerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="5" rx="1" fill="currentColor" />
      <rect x="4" y="14" width="16" height="5" rx="1" fill="currentColor" opacity="0.8" />
    </svg>
  )
}

function NetworkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="6" cy="12" r="2.5" fill="currentColor" />
      <circle cx="18" cy="7" r="2.5" fill="currentColor" opacity="0.75" />
      <circle cx="18" cy="17" r="2.5" fill="currentColor" opacity="0.75" />
      <path d="M8 11l7-3M8 13l7 3" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" fill="currentColor" />
      <path d="M8.5 10V7.8A3.5 3.5 0 0 1 12 4.3a3.5 3.5 0 0 1 3.5 3.5V10" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function ClusterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <circle cx="16" cy="8" r="3" fill="currentColor" opacity="0.7" />
      <circle cx="12" cy="16" r="3" fill="currentColor" opacity="0.85" />
    </svg>
  )
}

function ComponentsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="7" height="16" rx="1" fill="currentColor" />
      <rect x="13" y="4" width="7" height="7" rx="1" fill="currentColor" opacity="0.75" />
      <rect x="13" y="13" width="7" height="7" rx="1" fill="currentColor" opacity="0.75" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="8.5" cy="9" r="2.7" fill="currentColor" />
      <circle cx="15.5" cy="10" r="2.3" fill="currentColor" opacity="0.7" />
      <path d="M4 19c0-2.5 2-4.5 4.5-4.5h.2c2.5 0 4.5 2 4.5 4.5" fill="currentColor" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MenuItem({ item, onSelect = null }) {
  const base = 'flex h-9 w-full items-center justify-between px-4 text-left text-[13px] transition'

  if (!item.to) {
    return (
      <button type="button" onClick={onSelect} className={`${base} text-[#a4adc1] hover:bg-[#1a2238] hover:text-white`}>
        <span className="flex items-center gap-2.5">
          <span className="shrink-0"><item.icon /></span>
          <span>{item.label}</span>
        </span>
        {item.hasArrow ? <ChevronRight /> : null}
      </button>
    )
  }

  return (
    <NavLink
      to={item.to}
      onClick={onSelect}
      className={({ isActive }) =>
        `${base} ${isActive ? 'bg-[#6f54ff] text-white' : 'text-[#a4adc1] hover:bg-[#1a2238] hover:text-white'}`
      }
    >
      <span className="flex items-center gap-2.5">
        <span className="shrink-0"><item.icon /></span>
        <span>{item.label}</span>
      </span>
      {item.hasArrow ? <ChevronRight /> : null}
    </NavLink>
  )
}

export default function AdminSidebar({ admin, mobile = false, onClose = null }) {
  const navigate = useNavigate()
  const menuRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const { can, admin: authAdmin, token, clearSession } = useAuth()
  const isSuperAdmin = authAdmin?.role === 'super_admin'

  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.permission || isSuperAdmin || can(item.permission)),
    }))
    .filter((section) => section.items.length > 0)

  useEffect(() => {
    const onMouseDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const handleLogout = async () => {
    try {
      if (token) {
        await axios.post(
          `${BASE_URL}/api/admin/auth/logout`,
          {},
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        )
      }
    } catch {
      // Ignore logout API failures and still clear local session.
    } finally {
      clearSession()
      navigate('/login', { replace: true })
    }
  }

  return (
    <aside className={`flex w-full min-h-0 flex-col border-r border-[#252d45] bg-[#0b1020] text-[#a4adc1] ${mobile ? 'h-full shadow-2xl' : 'h-screen md:sticky md:top-0'}`}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-14 items-center justify-between gap-2 border-b border-[#252d45] px-4 text-[12px] font-semibold tracking-wide text-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-[#8f99b2]"><MenuIcon /></span>
            <span><LogoIcon /></span>
            <span>TRUST EXPRESS</span>
          </div>
          {mobile ? (
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-[#8f99b2] hover:bg-[#1a2238] hover:text-white">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>

        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-0 py-2">
          {visibleSections.map((section) => (
            <div key={section.label || 'core'} className="mt-2 first:mt-0">
              {section.label ? (
                <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#5f6880]">{section.label}</p>
              ) : null}

              <nav className="mt-1">
                {section.items.map((item) => (
                  <MenuItem key={item.id} item={item} onSelect={mobile ? onClose : null} />
                ))}
              </nav>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-[#252d45] px-4 py-4">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            className="flex w-full items-center gap-3 rounded-md px-1.5 py-1.5 text-left hover:bg-[#1a2238]"
          >
            <div className="grid h-10 w-10 place-items-center rounded-full bg-[#36405a] text-xs font-semibold text-[#dbe1f0]">
              {(admin?.fullName || 'A')
                .split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase() || '')
                .join('')}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-slate-100">{admin?.fullName || 'Admin User'}</p>
              <p className="text-[12px] text-[#98a3bb]">{admin?.role === 'super_admin' ? 'Super Admin' : 'Admin'}</p>
            </div>
          </button>

          {menuOpen ? (
            <div className="absolute bottom-14 left-0 z-20 w-full overflow-hidden rounded-md border border-[#2b344d] bg-[#111a31] shadow-xl">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full px-3 py-2 text-left text-[12px] font-semibold text-rose-200 hover:bg-[#1f2943] hover:text-rose-100"
              >
                Logout
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
