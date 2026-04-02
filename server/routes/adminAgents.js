import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { hashPassword } from '../lib/admin-password.js';

const router = Router();

router.get('/', requireAdminAuth, requirePermission('agents.read'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || 'all').trim().toLowerCase();

    let sql = `
      SELECT
        a.id,
        a.full_name,
        a.email,
        a.phone_number,
        a.employee_code,
        a.id_number,
        a.address,
        a.is_active,
        a.last_login_at,
        a.created_at,
        creator.full_name AS created_by_admin_name
      FROM agent_users a
      LEFT JOIN admin_users creator ON creator.id = a.created_by_admin_id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += `
        AND (
          LOWER(a.full_name) LIKE ?
          OR LOWER(a.email) LIKE ?
          OR LOWER(COALESCE(a.phone_number, '')) LIKE ?
          OR LOWER(COALESCE(a.employee_code, '')) LIKE ?
          OR LOWER(COALESCE(a.id_number, '')) LIKE ?
          OR LOWER(COALESCE(a.address, '')) LIKE ?
        )
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status === 'active' || status === 'inactive') {
      sql += ' AND a.is_active = ?';
      params.push(status === 'active' ? 1 : 0);
    }

    sql += ' ORDER BY a.created_at DESC, a.id DESC';

    const rows = await query(sql, params);
    return res.json({
      agents: rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phoneNumber: row.phone_number || '',
        employeeCode: row.employee_code || '',
        idNumber: row.id_number || '',
        address: row.address || '',
        isActive: !!row.is_active,
        lastLoginAt: row.last_login_at || null,
        createdAt: row.created_at,
        createdByAdminName: row.created_by_admin_name || null,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/agents', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', requireAdminAuth, requirePermission('agents.manage'), async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const phoneNumber = String(req.body?.phoneNumber || '').trim();
    const employeeCode = String(req.body?.employeeCode || '').trim();
    const idNumber = String(req.body?.idNumber || '').trim();
    const address = String(req.body?.address || '').trim();

    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'fullName, email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const passwordHash = hashPassword(password);

    const created = await query(
      `INSERT INTO agent_users (full_name, email, password_hash, phone_number, employee_code, id_number, address, is_active, created_by_admin_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [fullName, email, passwordHash, phoneNumber || null, employeeCode || null, idNumber || null, address || null, req.admin.id]
    );

    return res.status(201).json({
      id: created.insertId,
      fullName,
      email,
      phoneNumber,
      employeeCode,
      idNumber,
      address,
      isActive: true,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An agent with this email already exists' });
    }
    console.error('POST /api/admin/agents', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:agentId/status', requireAdminAuth, requirePermission('agents.manage'), async (req, res) => {
  try {
    const agentId = Number(req.params.agentId);
    const isActive = req.body?.isActive === true;

    if (!agentId) {
      return res.status(400).json({ error: 'Invalid agent id' });
    }

    const result = await query('UPDATE agent_users SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, agentId]);
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    return res.json({ ok: true, isActive });
  } catch (err) {
    console.error('PATCH /api/admin/agents/:agentId/status', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
