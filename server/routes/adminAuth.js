import { Router } from 'express';
import { query } from '../db/connection.js';
import { hashPassword, verifyPassword } from '../lib/admin-password.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { getAdminAccessContext } from '../lib/admin-rbac.js';

const router = Router();

router.post('/bootstrap', async (req, res) => {
  try {
    const setupKey = process.env.ADMIN_SETUP_KEY;
    if (!setupKey) {
      return res.status(403).json({ error: 'Admin bootstrap is disabled' });
    }

    const incomingKey = req.headers['x-admin-setup-key'];
    if (incomingKey !== setupKey) {
      return res.status(401).json({ error: 'Invalid setup key' });
    }

    const existing = await query('SELECT COUNT(*) AS total FROM admin_users');
    if (existing[0]?.total > 0) {
      return res.status(409).json({ error: 'Admin user already exists' });
    }

    const { fullName, email, password } = req.body || {};
    if (!fullName || !email || !password || String(password).length < 8) {
      return res.status(400).json({ error: 'fullName, email and password (min 8 chars) are required' });
    }

    const passwordHash = hashPassword(password);

    const result = await query(
      `INSERT INTO admin_users (full_name, email, password_hash, role)
       VALUES (?, ?, ?, 'super_admin')`,
      [fullName, String(email).toLowerCase(), passwordHash]
    );

    return res.status(201).json({
      id: result.insertId,
      email: String(email).toLowerCase(),
      role: 'super_admin',
    });
  } catch (err) {
    console.error('POST /admin/auth/bootstrap', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const admins = await query(
      `SELECT id, full_name, email, role, password_hash, is_active
       FROM admin_users
       WHERE email = ?
       LIMIT 1`,
      [normalizedEmail]
    );

    const admin = admins[0];
    if (!admin || !admin.is_active || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = await requireAdminAuth.createSession(admin.id);

    await query('UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);

    const access = await getAdminAccessContext(admin.id, admin.role);

    return res.json({
      token,
      admin: {
        id: admin.id,
        fullName: admin.full_name,
        email: admin.email,
        role: admin.role,
      },
      roles: access.roles,
      permissions: access.permissions,
    });
  } catch (err) {
    console.error('[AdminAuth] Login server error', {
      message: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', requireAdminAuth, async (req, res) => {
  return res.json({
    admin: {
      id: req.admin.id,
      fullName: req.admin.full_name,
      email: req.admin.email,
      role: req.admin.role,
    },
    roles: req.admin.roles || [],
    permissions: req.admin.permissions || [],
  });
});

router.post('/logout', requireAdminAuth, async (req, res) => {
  try {
    await requireAdminAuth.revokeSession(req.adminTokenHash);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /admin/auth/logout', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;