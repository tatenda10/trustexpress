import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../authcontext/AuthContext'
import { toast } from 'react-toastify'
import BASE_URL from '../context/Api'
import AdminTabs from '../components/AdminTabs'

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'create-user', label: 'Create User' },
  { key: 'roles', label: 'Roles' },
  { key: 'role-matrix', label: 'Role Matrix' },
]

function UserTabIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.1" fill={color} />
      <path d="M6 18c0-2.8 2.5-5 6-5s6 2.2 6 5" fill={color} opacity="0.75" />
    </svg>
  )
}

function CreateTabIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M12 6v12M6 12h12" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function RoleTabIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M7 8.5A3.5 3.5 0 1 1 13.4 10l3.6 6.2-2.1.8-1-1.7-1.5 1.1-1.1-1.9-1.6 1.1-1.4-2.3A3.5 3.5 0 0 1 7 8.5Z" fill={color} />
    </svg>
  )
}

function MatrixTabIcon({ active = false }) {
  const color = active ? '#4f46e5' : '#64748b'
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="6" height="6" rx="1" fill={color} />
      <rect x="14" y="5" width="6" height="6" rx="1" fill={color} opacity="0.75" />
      <rect x="4" y="13" width="6" height="6" rx="1" fill={color} opacity="0.75" />
      <rect x="14" y="13" width="6" height="6" rx="1" fill={color} />
    </svg>
  )
}

const ACCESS_TABS = [
  { key: 'users', label: 'Users', icon: UserTabIcon },
  { key: 'create-user', label: 'Create User', icon: CreateTabIcon },
  { key: 'roles', label: 'Roles', icon: RoleTabIcon },
  { key: 'role-matrix', label: 'Role Matrix', icon: MatrixTabIcon },
]

function groupPermissionsByModule(permissions) {
  return permissions.reduce((acc, permission) => {
    const moduleKey = permission.module || 'general'
    if (!acc[moduleKey]) acc[moduleKey] = []
    acc[moduleKey].push(permission)
    return acc
  }, {})
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export default function AdminUsersPage() {
  const { token, can, admin } = useAuth()
  const isSuperAdmin = admin?.role === 'super_admin'
  const canReadUsers = isSuperAdmin || can('admin.users.read')
  const canManageUsers = isSuperAdmin || can('admin.users.manage')
  const canReadRoles = isSuperAdmin || can('admin.roles.read')
  const canManageRoles = isSuperAdmin || can('admin.roles.manage')

  const [activeTab, setActiveTab] = useState('users')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedModal, setSavedModal] = useState({ open: false, adminName: '' })

  const [adminUsers, setAdminUsers] = useState([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [usersPage, setUsersPage] = useState(1)
  const [usersPageSize, setUsersPageSize] = useState(20)
  const [usersTotalPages, setUsersTotalPages] = useState(1)
  const [usersSearch, setUsersSearch] = useState('')
  const [usersRoleFilter, setUsersRoleFilter] = useState('all')
  const [usersActiveFilter, setUsersActiveFilter] = useState('all')
  const [usersSortBy, setUsersSortBy] = useState('created_at')
  const [usersSortOrder, setUsersSortOrder] = useState('desc')
  const [roles, setRoles] = useState([])
  const [permissions, setPermissions] = useState([])
  const [selectedRolesByAdmin, setSelectedRolesByAdmin] = useState({})

  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleSlug, setNewRoleSlug] = useState('')
  const [newRoleDescription, setNewRoleDescription] = useState('')
  const [newRolePermissionKeys, setNewRolePermissionKeys] = useState([])

  const [newAdminFullName, setNewAdminFullName] = useState('')
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [newAdminRole, setNewAdminRole] = useState('admin')
  const [newAdminRoleIds, setNewAdminRoleIds] = useState([])

  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
    }),
    [token]
  )

  const loadData = async () => {
    setLoading(true)

    const [adminUsersResult, rolesResult, permissionsResult] = await Promise.allSettled([
      axios.get(`${BASE_URL}/api/admin/roles/admin-users`, {
        headers,
        params: {
          search: usersSearch || undefined,
          role: usersRoleFilter,
          isActive: usersActiveFilter,
          sortBy: usersSortBy,
          sortOrder: usersSortOrder,
          page: usersPage,
          pageSize: usersPageSize,
        },
      }),
      axios.get(`${BASE_URL}/api/admin/roles`, { headers }),
      axios.get(`${BASE_URL}/api/admin/roles/permissions`, { headers }),
    ])

    if (adminUsersResult.status === 'fulfilled') {
      const users = adminUsersResult.value?.data?.adminUsers || []
      setAdminUsers(users)
      setUsersTotal(adminUsersResult.value?.data?.total || users.length)
      setUsersTotalPages(adminUsersResult.value?.data?.totalPages || 1)
      const selections = {}
      for (const user of users) {
        selections[user.id] = (user.roles || []).map((role) => role.id)
      }
      setSelectedRolesByAdmin(selections)
    } else if (canReadUsers) {
      const message = adminUsersResult.reason?.response?.data?.error || adminUsersResult.reason?.message || 'Failed loading admin users'
      toast.error(message)
    }

    if (rolesResult.status === 'fulfilled') {
      setRoles(rolesResult.value?.data?.roles || [])
    } else if (canReadRoles || canManageRoles || canManageUsers) {
      toast.warn('Role definitions are unavailable for this account.')
    }

    if (permissionsResult.status === 'fulfilled') {
      setPermissions(permissionsResult.value?.data?.permissions || [])
    }

    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, usersSearch, usersRoleFilter, usersActiveFilter, usersSortBy, usersSortOrder, usersPage, usersPageSize])

  useEffect(() => {
    setNewRoleSlug((prev) => {
      if (prev) return prev
      return slugify(newRoleName)
    })
  }, [newRoleName])

  const onChangeAssignedRoles = (adminUserId, roleId) => {
    setSelectedRolesByAdmin((prev) => {
      const current = new Set(prev[adminUserId] || [])
      if (current.has(roleId)) current.delete(roleId)
      else current.add(roleId)
      return { ...prev, [adminUserId]: [...current] }
    })
  }

  const saveAssignments = async (adminUserId) => {
    if (!canManageUsers) return

    setSaving(true)
    try {
      await axios.post(
        `${BASE_URL}/api/admin/roles/assign`,
        {
          adminUserId,
          roleIds: selectedRolesByAdmin[adminUserId] || [],
        },
        { headers }
      )
      const selectedAdmin = adminUsers.find((item) => item.id === adminUserId)
      const adminName = selectedAdmin?.full_name || selectedAdmin?.email || 'Admin user'
      setSavedModal({ open: true, adminName })
      toast.success('Roles saved successfully.')
      await loadData()
    } catch (err) {
      const apiError = err?.response?.data?.error
      toast.error(apiError || err?.message || 'Failed to save role assignments')
    } finally {
      setSaving(false)
    }
  }

  const toggleNewAdminRole = (roleId) => {
    setNewAdminRoleIds((prev) => (prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]))
  }

  const createAdminUser = async (event) => {
    event.preventDefault()
    if (!canManageUsers) return

    setSaving(true)
    try {
      await axios.post(
        `${BASE_URL}/api/admin/roles/admin-users`,
        {
          fullName: newAdminFullName.trim(),
          email: newAdminEmail.trim(),
          password: newAdminPassword,
          role: newAdminRole,
          roleIds: newAdminRoleIds,
        },
        { headers }
      )

      setNewAdminFullName('')
      setNewAdminEmail('')
      setNewAdminPassword('')
      setNewAdminRole('admin')
      setNewAdminRoleIds([])
      toast.success('Admin user created successfully.')
      setActiveTab('users')
      await loadData()
    } catch (err) {
      const apiError = err?.response?.data?.error
      toast.error(apiError || err?.message || 'Failed to create admin user')
    } finally {
      setSaving(false)
    }
  }

  const togglePermissionKey = (permissionKey) => {
    setNewRolePermissionKeys((prev) => {
      if (prev.includes(permissionKey)) return prev.filter((key) => key !== permissionKey)
      return [...prev, permissionKey]
    })
  }

  const createRole = async (event) => {
    event.preventDefault()
    if (!canManageRoles) return

    setSaving(true)
    try {
      await axios.post(
        `${BASE_URL}/api/admin/roles`,
        {
          name: newRoleName.trim(),
          slug: newRoleSlug.trim(),
          description: newRoleDescription.trim(),
          permissionKeys: newRolePermissionKeys,
        },
        { headers }
      )
      setNewRoleName('')
      setNewRoleSlug('')
      setNewRoleDescription('')
      setNewRolePermissionKeys([])
      toast.success('Role created successfully.')
      await loadData()
    } catch (err) {
      const apiError = err?.response?.data?.error
      toast.error(apiError || err?.message || 'Failed to create role')
    } finally {
      setSaving(false)
    }
  }

  const permissionsByModule = useMemo(() => groupPermissionsByModule(permissions), [permissions])

  return (
    <section className="space-y-4">
      <div className="border border-slate-300 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Safety & System / Access Control</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">Admin Access Control</h1>
            <p className="mt-1 text-xs text-slate-500">Manage admin users, custom roles, and permission mappings.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Admin Users</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{usersTotal}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Custom Roles</p>
              <p className="mt-1 text-lg font-semibold text-indigo-700">{roles.length}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Permissions</p>
              <p className="mt-1 text-lg font-semibold text-slate-800">{permissions.length}</p>
            </div>
            <div className="min-w-[110px] border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Active Tab</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {TABS.find((tab) => tab.key === activeTab)?.label || 'Users'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <AdminTabs
        label="Access Sections"
        tabs={ACCESS_TABS}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      <div className="overflow-hidden border border-slate-300 bg-white">
        {activeTab === 'users' ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
              <input
                type="text"
                value={usersSearch}
                onChange={(event) => {
                  setUsersSearch(event.target.value)
                  setUsersPage(1)
                }}
                placeholder="Search name/email..."
                className="h-9 w-full border border-slate-300 bg-white px-3 text-xs outline-none focus:border-indigo-500 md:w-64"
              />
              <select
                value={usersRoleFilter}
                onChange={(event) => {
                  setUsersRoleFilter(event.target.value)
                  setUsersPage(1)
                }}
                className="h-9 border border-slate-300 bg-white px-2 text-xs"
              >
                <option value="all">All roles</option>
                <option value="admin">admin</option>
                <option value="super_admin">super_admin</option>
              </select>
              <select
                value={usersActiveFilter}
                onChange={(event) => {
                  setUsersActiveFilter(event.target.value)
                  setUsersPage(1)
                }}
                className="h-9 border border-slate-300 bg-white px-2 text-xs"
              >
                <option value="all">All status</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
              <select
                value={usersSortBy}
                onChange={(event) => setUsersSortBy(event.target.value)}
                className="h-9 border border-slate-300 bg-white px-2 text-xs"
              >
                <option value="created_at">Sort: Created</option>
                <option value="full_name">Sort: Name</option>
                <option value="email">Sort: Email</option>
                <option value="role">Sort: Role</option>
              </select>
              <select
                value={usersSortOrder}
                onChange={(event) => setUsersSortOrder(event.target.value)}
                className="h-9 border border-slate-300 bg-white px-2 text-xs"
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-[#16213a] text-left text-[11px] uppercase tracking-wide text-slate-100">
                    <th className="px-4 py-2 font-semibold">Admin</th>
                    <th className="px-4 py-2 font-semibold">Email</th>
                    <th className="px-4 py-2 font-semibold">Built-in Role</th>
                    <th className="px-4 py-2 font-semibold">Assigned Roles</th>
                    <th className="px-4 py-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">Loading admin users...</td>
                    </tr>
                  ) : adminUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">No admin users found.</td>
                    </tr>
                  ) : (
                    adminUsers.map((adminUser) => (
                      <tr key={adminUser.id} className="border-b border-slate-200 align-top hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{adminUser.full_name || 'Admin User'}</td>
                        <td className="px-4 py-3 text-slate-700">{adminUser.email}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            {adminUser.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            {roles.map((role) => (
                              <label key={`${adminUser.id}-${role.id}`} className="flex items-center gap-2 text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={(selectedRolesByAdmin[adminUser.id] || []).includes(role.id)}
                                  onChange={() => onChangeAssignedRoles(adminUser.id, role.id)}
                                  disabled={!canManageUsers || saving}
                                />
                                <span className="text-[11px]">
                                  {role.name}
                                  <span className="ml-1 text-slate-500">({role.slug})</span>
                                </span>
                              </label>
                            ))}
                            {roles.length === 0 ? <span className="text-[11px] text-slate-400">No visible roles.</span> : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => saveAssignments(adminUser.id)}
                            disabled={!canManageUsers || saving}
                            className={`px-2.5 py-1 text-[11px] font-semibold text-white ${
                              canManageUsers && !saving ? 'bg-indigo-600 hover:bg-indigo-500' : 'cursor-not-allowed bg-indigo-300'
                            }`}
                          >
                            Save Roles
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
              <p>Showing {adminUsers.length} of {usersTotal} admin users</p>
              <div className="flex items-center gap-2">
                <label className="text-xs">Page size</label>
                <select
                  value={usersPageSize}
                  onChange={(event) => {
                    setUsersPageSize(Number(event.target.value))
                    setUsersPage(1)
                  }}
                  className="h-8 border border-slate-300 bg-white px-2 text-xs"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
                <button
                  type="button"
                  onClick={() => setUsersPage((prev) => Math.max(prev - 1, 1))}
                  disabled={usersPage <= 1}
                  className="h-8 border border-slate-300 px-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Prev
                </button>
                <span>Page {usersPage} / {usersTotalPages}</span>
                <button
                  type="button"
                  onClick={() => setUsersPage((prev) => Math.min(prev + 1, usersTotalPages))}
                  disabled={usersPage >= usersTotalPages}
                  className="h-8 border border-slate-300 px-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : null}

        {activeTab === 'create-user' ? (
          <form onSubmit={createAdminUser} className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="text"
                placeholder="Full name"
                value={newAdminFullName}
                onChange={(event) => setNewAdminFullName(event.target.value)}
                className="h-10 border border-slate-300 px-3 text-xs outline-none focus:border-indigo-500"
                disabled={!canManageUsers || saving}
                required
              />
              <input
                type="email"
                placeholder="Email"
                value={newAdminEmail}
                onChange={(event) => setNewAdminEmail(event.target.value)}
                className="h-10 border border-slate-300 px-3 text-xs outline-none focus:border-indigo-500"
                disabled={!canManageUsers || saving}
                required
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="password"
                placeholder="Password (min 8 chars)"
                value={newAdminPassword}
                onChange={(event) => setNewAdminPassword(event.target.value)}
                className="h-10 border border-slate-300 px-3 text-xs outline-none focus:border-indigo-500"
                disabled={!canManageUsers || saving}
                required
              />

              <select
                value={newAdminRole}
                onChange={(event) => setNewAdminRole(event.target.value)}
                className="h-10 border border-slate-300 px-3 text-xs outline-none focus:border-indigo-500"
                disabled={!canManageUsers || saving}
              >
                <option value="admin">admin</option>
                {isSuperAdmin ? <option value="super_admin">super_admin</option> : null}
              </select>
            </div>

            <div className="border border-slate-200 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-700">Attach Custom Roles (optional)</p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {roles.map((role) => (
                  <label key={`new-admin-role-${role.id}`} className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={newAdminRoleIds.includes(role.id)}
                      onChange={() => toggleNewAdminRole(role.id)}
                      disabled={!canManageUsers || saving}
                    />
                    <span>{role.name} <span className="text-slate-500">({role.slug})</span></span>
                  </label>
                ))}
                {roles.length === 0 ? <span className="text-xs text-slate-400">No roles available.</span> : null}
              </div>
            </div>

            <button
              type="submit"
              disabled={!canManageUsers || saving}
              className={`h-10 px-4 text-xs font-semibold text-white ${
                canManageUsers && !saving ? 'bg-emerald-600 hover:bg-emerald-500' : 'cursor-not-allowed bg-emerald-300'
              }`}
            >
              Create Admin User
            </button>
          </form>
        ) : null}

        {activeTab === 'roles' ? (
          <form onSubmit={createRole} className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                placeholder="Role name (e.g. Pricing Read)"
                value={newRoleName}
                onChange={(event) => setNewRoleName(event.target.value)}
                className="h-9 border border-slate-300 px-3 text-xs outline-none focus:border-indigo-500"
                disabled={!canManageRoles || saving}
                required
              />
              <input
                type="text"
                placeholder="Slug (e.g. pricing_read)"
                value={newRoleSlug}
                onChange={(event) => setNewRoleSlug(slugify(event.target.value))}
                className="h-9 border border-slate-300 px-3 text-xs outline-none focus:border-indigo-500"
                disabled={!canManageRoles || saving}
                required
              />
            </div>

            <input
              type="text"
              placeholder="Description (optional)"
              value={newRoleDescription}
              onChange={(event) => setNewRoleDescription(event.target.value)}
              className="h-9 w-full border border-slate-300 px-3 text-xs outline-none focus:border-indigo-500"
              disabled={!canManageRoles || saving}
            />

            <div className="max-h-56 overflow-auto border border-slate-200 p-2">
              {Object.entries(permissionsByModule).map(([moduleName, modulePermissions]) => (
                <div key={moduleName} className="mb-2 last:mb-0">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{moduleName}</p>
                  <div className="grid gap-1">
                    {modulePermissions.map((permission) => (
                      <label key={permission.key} className="flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={newRolePermissionKeys.includes(permission.key)}
                          onChange={() => togglePermissionKey(permission.key)}
                          disabled={!canManageRoles || saving}
                        />
                        <span>{permission.key}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {permissions.length === 0 ? <p className="text-xs text-slate-500">No permissions available.</p> : null}
            </div>

            <button
              type="submit"
              disabled={!canManageRoles || saving}
              className={`h-9 px-3 text-xs font-semibold text-white ${
                canManageRoles && !saving ? 'bg-emerald-600 hover:bg-emerald-500' : 'cursor-not-allowed bg-emerald-300'
              }`}
            >
              Create Role
            </button>
          </form>
        ) : null}

        {activeTab === 'role-matrix' ? (
          <div className="max-h-[40rem] overflow-auto p-4">
            <div className="space-y-3">
              {roles.map((role) => (
                <div key={role.id} className="border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-slate-800">{role.name}</h3>
                    <span className="bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{role.slug}</span>
                  </div>
                  <p className="mb-2 text-[11px] text-slate-500">{role.description || 'No description'}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(role.permissions || []).map((permission) => (
                      <span key={`${role.id}-${permission.key}`} className="bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
                        {permission.key}
                      </span>
                    ))}
                    {(role.permissions || []).length === 0 ? <span className="text-[11px] text-slate-400">No permissions</span> : null}
                  </div>
                </div>
              ))}
              {roles.length === 0 ? <p className="text-xs text-slate-500">No role data available.</p> : null}
            </div>
          </div>
        ) : null}
      </div>

      {savedModal.open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4">
          <div className="w-full max-w-sm border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Saved</h3>
            <p className="mt-2 text-sm text-slate-600">
              Roles updated for <span className="font-semibold text-slate-900">{savedModal.adminName}</span>.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setSavedModal({ open: false, adminName: '' })}
                className="bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
