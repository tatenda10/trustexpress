import 'dotenv/config';
import pool, { query } from '../db/connection.js';
import { DEFAULT_ROLE_MAPPINGS, PERMISSION_CATALOG } from '../lib/admin-permissions.js';

async function ensurePermissions() {
  for (const item of PERMISSION_CATALOG) {
    await query(
      `INSERT INTO permissions (
         \`key\`, module, name, description
       ) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         module = VALUES(module),
         name = VALUES(name),
         description = VALUES(description)`,
      [item.key, item.module, item.name, item.description || null]
    );
  }
}

async function ensureRoles() {
  const defs = [
    { slug: 'super_admin', name: 'Super Admin', isSystem: 1, description: 'Full platform access' },
    { slug: 'admin', name: 'Admin', isSystem: 1, description: 'General admin access' },
    { slug: 'verification_admin', name: 'Verification Admin', isSystem: 1, description: 'Driver verification workflows' },
    { slug: 'operations_admin', name: 'Operations Admin', isSystem: 1, description: 'Live operations and rides' },
    { slug: 'support_admin', name: 'Support Admin', isSystem: 1, description: 'Support and passenger operations' },
    { slug: 'finance_admin', name: 'Finance Admin', isSystem: 1, description: 'Pricing, payouts, finance reporting' },
    { slug: 'recruitment_admin', name: 'Recruitment Admin', isSystem: 1, description: 'Agent recruitment and onboarding' },
  ];

  for (const role of defs) {
    await query(
      `INSERT INTO roles (name, slug, is_system, description)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         is_system = VALUES(is_system),
         description = VALUES(description)`,
      [role.name, role.slug, role.isSystem, role.description]
    );
  }
}

async function syncRolePermissions() {
  const roleRows = await query('SELECT id, slug FROM roles');
  const permissionRows = await query('SELECT id, `key` FROM permissions');

  const roleIdBySlug = new Map(roleRows.map((r) => [r.slug, r.id]));
  const permIdByKey = new Map(permissionRows.map((p) => [p.key, p.id]));

  for (const [slug, keys] of Object.entries(DEFAULT_ROLE_MAPPINGS)) {
    const roleId = roleIdBySlug.get(slug);
    if (!roleId) continue;

    await query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

    for (const key of keys) {
      const permissionId = permIdByKey.get(key);
      if (!permissionId) continue;
      await query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
        [roleId, permissionId]
      );
    }
  }
}

async function assignAdminUsers() {
  const admins = await query('SELECT id, role FROM admin_users');
  const roleRows = await query('SELECT id, slug FROM roles');
  const roleIdBySlug = new Map(roleRows.map((r) => [r.slug, r.id]));

  for (const admin of admins) {
    const [countRow] = await query('SELECT COUNT(*) AS total FROM admin_user_roles WHERE admin_user_id = ?', [admin.id]);
    if ((countRow?.total || 0) > 0) continue;

    const targetSlug = admin.role === 'super_admin' ? 'super_admin' : 'admin';
    const roleId = roleIdBySlug.get(targetSlug);
    if (!roleId) continue;

    await query(
      'INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)',
      [admin.id, roleId]
    );
  }
}

async function run() {
  try {
    await ensurePermissions();
    await ensureRoles();
    await syncRolePermissions();
    await assignAdminUsers();
    console.log('RBAC seed complete.');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('RBAC seed failed:', err.message);
  process.exit(1);
});
