import { query } from '../db/connection.js';
import { DEFAULT_ROLE_MAPPINGS, PERMISSION_CATALOG } from './admin-permissions.js';

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function fallbackAccess(role) {
  const keys = role === 'super_admin' ? PERMISSION_CATALOG.map((item) => item.key) : (DEFAULT_ROLE_MAPPINGS[role] || []);
  return {
    roles: [{ id: null, slug: role, name: role }],
    permissions: unique(keys),
  };
}

export async function getAdminAccessContext(adminUserId, fallbackRole = 'admin') {
  try {
    const rows = await query(
      `SELECT
         r.id AS role_id,
         r.slug AS role_slug,
         r.name AS role_name,
         p.key AS permission_key
       FROM admin_user_roles aur
       JOIN roles r ON r.id = aur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE aur.admin_user_id = ?`,
      [adminUserId]
    );

    if (!rows.length) {
      return fallbackAccess(fallbackRole);
    }

    const roleMap = new Map();
    const permissionKeys = [];

    for (const row of rows) {
      if (!roleMap.has(row.role_id)) {
        roleMap.set(row.role_id, {
          id: row.role_id,
          slug: row.role_slug,
          name: row.role_name,
        });
      }
      if (row.permission_key) permissionKeys.push(row.permission_key);
    }

    const roles = Array.from(roleMap.values());
    const isSuper = roles.some((r) => r.slug === 'super_admin') || fallbackRole === 'super_admin';
    const permissions = isSuper ? PERMISSION_CATALOG.map((item) => item.key) : unique(permissionKeys);

    return { roles, permissions };
  } catch {
    return fallbackAccess(fallbackRole);
  }
}

export function hasPermission(admin, permissionKey) {
  if (!admin) return false;
  if (admin.role === 'super_admin') return true;
  return Array.isArray(admin.permissions) && admin.permissions.includes(permissionKey);
}