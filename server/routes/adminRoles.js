import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { hashPassword } from '../lib/admin-password.js';

const router = Router();

router.get('/permissions', requireAdminAuth, requirePermission('admin.roles.read'), async (req, res) => {
  try {
    const rows = await query('SELECT id, `key`, module, name, description FROM permissions ORDER BY module, `key`');
    return res.json({ permissions: rows });
  } catch (err) {
    console.error('GET /api/admin/roles/permissions', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', requireAdminAuth, requirePermission('admin.roles.read'), async (req, res) => {
  try {
    const roles = await query('SELECT id, name, slug, description, is_system, created_by, created_at, updated_at FROM roles ORDER BY is_system DESC, name ASC');
    const rolePermissions = await query(
      `SELECT rp.role_id, p.id AS permission_id, p.\`key\`, p.module, p.name
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       ORDER BY rp.role_id, p.module, p.\`key\``
    );

    const permissionMap = new Map();
    for (const row of rolePermissions) {
      if (!permissionMap.has(row.role_id)) permissionMap.set(row.role_id, []);
      permissionMap.get(row.role_id).push({
        id: row.permission_id,
        key: row.key,
        module: row.module,
        name: row.name,
      });
    }

    return res.json({
      roles: roles.map((role) => ({
        ...role,
        permissions: permissionMap.get(role.id) || [],
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/roles', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', requireAdminAuth, requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const { name, slug, description, permissionKeys } = req.body || {};
    const normalizedName = String(name || '').trim();
    const normalizedSlug = String(slug || '').trim().toLowerCase().replace(/\s+/g, '_');
    const keys = Array.isArray(permissionKeys) ? [...new Set(permissionKeys.map((k) => String(k).trim()).filter(Boolean))] : [];

    if (!normalizedName || !normalizedSlug) {
      return res.status(400).json({ error: 'name and slug are required' });
    }

    const result = await query(
      `INSERT INTO roles (name, slug, description, is_system, created_by)
       VALUES (?, ?, ?, 0, ?)`,
      [normalizedName, normalizedSlug, description || null, req.admin.id]
    );

    const roleId = result.insertId;

    if (keys.length > 0) {
      const placeholders = keys.map(() => '?').join(',');
      const permissions = await query(
        `SELECT id, \`key\` FROM permissions WHERE \`key\` IN (${placeholders})`,
        keys
      );
      for (const p of permissions) {
        await query('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, p.id]);
      }
    }

    return res.status(201).json({ id: roleId, slug: normalizedSlug });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Role slug already exists' });
    }
    console.error('POST /api/admin/roles', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:roleId', requireAdminAuth, requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const roleId = Number(req.params.roleId);
    if (!roleId) return res.status(400).json({ error: 'Invalid role id' });

    const roleRows = await query('SELECT id, is_system FROM roles WHERE id = ? LIMIT 1', [roleId]);
    const role = roleRows[0];
    if (!role) return res.status(404).json({ error: 'Role not found' });

    const { name, description, permissionKeys } = req.body || {};
    if (name !== undefined || description !== undefined) {
      await query(
        'UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?',
        [name || null, description || null, roleId]
      );
    }

    if (Array.isArray(permissionKeys)) {
      const keys = [...new Set(permissionKeys.map((k) => String(k).trim()).filter(Boolean))];
      await query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

      if (keys.length > 0) {
        const placeholders = keys.map(() => '?').join(',');
        const permissions = await query(
          `SELECT id FROM permissions WHERE \`key\` IN (${placeholders})`,
          keys
        );
        for (const p of permissions) {
          await query('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, p.id]);
        }
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/admin/roles/:roleId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/admin-users', requireAdminAuth, requirePermission('admin.users.read'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const roleFilter = String(req.query.role || 'all').toLowerCase();
    const isActiveFilter = String(req.query.isActive || 'all').toLowerCase();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 100);
    const sortBy = String(req.query.sortBy || 'created_at');
    const sortOrder = String(req.query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const safeSortBy = ['created_at', 'email', 'full_name', 'role'].includes(sortBy) ? sortBy : 'created_at';
    let sql = 'SELECT id, full_name, email, role, is_active, created_at FROM admin_users WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (LOWER(full_name) LIKE ? OR LOWER(email) LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (['admin', 'super_admin'].includes(roleFilter)) {
      sql += ' AND role = ?';
      params.push(roleFilter);
    }
    if (['true', 'false', '1', '0'].includes(isActiveFilter)) {
      sql += ' AND is_active = ?';
      params.push(isActiveFilter === 'true' || isActiveFilter === '1' ? 1 : 0);
    }

    sql += ` ORDER BY ${safeSortBy} ${sortOrder}`;
    const admins = await query(sql, params);
    const assigned = await query(
      `SELECT aur.admin_user_id, r.id AS role_id, r.name, r.slug
       FROM admin_user_roles aur
       JOIN roles r ON r.id = aur.role_id`
    );

    const byAdmin = new Map();
    for (const row of assigned) {
      if (!byAdmin.has(row.admin_user_id)) byAdmin.set(row.admin_user_id, []);
      byAdmin.get(row.admin_user_id).push({ id: row.role_id, name: row.name, slug: row.slug });
    }

    const mapped = admins.map((admin) => ({
        ...admin,
        roles: byAdmin.get(admin.id) || [],
      }));
    const total = mapped.length;
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const paged = mapped.slice(start, start + pageSize);

    return res.json({
      adminUsers: paged,
      count: paged.length,
      total,
      page: safePage,
      pageSize,
      totalPages,
    });
  } catch (err) {
    console.error('GET /api/admin/roles/admin-users', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/admin-users', requireAdminAuth, requirePermission('admin.users.manage'), async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const requestedRole = String(req.body?.role || 'admin').trim();
    const roleIds = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map((id) => Number(id)).filter(Boolean) : [];

    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'fullName, email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const allowedRoles = new Set(['admin', 'super_admin']);
    if (!allowedRoles.has(requestedRole)) {
      return res.status(400).json({ error: 'Invalid admin role' });
    }

    if (requestedRole === 'super_admin' && req.admin.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admins can create super admins' });
    }

    const passwordHash = hashPassword(password);

    const created = await query(
      `INSERT INTO admin_users (full_name, email, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [fullName, email, passwordHash, requestedRole]
    );

    const adminUserId = created.insertId;

    for (const roleId of roleIds) {
      await query('INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)', [adminUserId, roleId]);
    }

    return res.status(201).json({
      id: adminUserId,
      fullName,
      email,
      role: requestedRole,
      assignedRoleIds: roleIds,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An admin with this email already exists' });
    }
    console.error('POST /api/admin/roles/admin-users', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/assign', requireAdminAuth, requirePermission('admin.users.manage'), async (req, res) => {
  try {
    const adminUserId = Number(req.body?.adminUserId);
    const roleIds = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map((id) => Number(id)).filter(Boolean) : [];

    if (!adminUserId) {
      return res.status(400).json({ error: 'adminUserId is required' });
    }

    const [admin] = await query('SELECT id FROM admin_users WHERE id = ? LIMIT 1', [adminUserId]);
    if (!admin) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    await query('DELETE FROM admin_user_roles WHERE admin_user_id = ?', [adminUserId]);
    for (const roleId of roleIds) {
      await query('INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)', [adminUserId, roleId]);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/admin/roles/assign', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
