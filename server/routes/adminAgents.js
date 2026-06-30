import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { hashPassword } from '../lib/admin-password.js';
import { attachDriverToAgentManual } from '../lib/agent-invites.js';
import { getExistingDriverReferral, resolveDriverByIdentifier } from '../lib/agent-driver-referrals.js';
import { getAgentRecruitmentDashboard } from '../lib/agent-recruitment.js';
import { mergePrivateMetadata } from '../lib/clerk-user.js';

const router = Router();

function mapAgentRow(row) {
  return {
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
    driverReferralCount: Number(row.driver_referral_count || 0),
    passengerReferralCount: Number(row.passenger_referral_count || 0),
    totalCompletedRides: Number(row.total_completed_rides || 0),
  };
}

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
        creator.full_name AS created_by_admin_name,
        (
          SELECT COUNT(*)
          FROM agent_driver_referrals r
          WHERE r.agent_user_id = a.id
        ) AS driver_referral_count,
        (
          SELECT COUNT(*)
          FROM agent_passenger_referrals p
          WHERE p.agent_user_id = a.id
        ) AS passenger_referral_count,
        (
          SELECT COUNT(CASE WHEN rr.status = 'completed' THEN 1 END)
          FROM agent_driver_referrals r
          LEFT JOIN ride_requests rr ON rr.driver_user_id = r.driver_user_id
          WHERE r.agent_user_id = a.id
        ) AS total_completed_rides
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
      agents: rows.map(mapAgentRow),
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

router.get('/:agentId/referrals', requireAdminAuth, requirePermission('agents.read'), async (req, res) => {
  try {
    const agentId = Number(req.params.agentId);
    if (!agentId) {
      return res.status(400).json({ error: 'Invalid agent id' });
    }

    const agentRows = await query(
      `SELECT id, full_name, email, phone_number, employee_code, is_active, created_at, last_login_at
       FROM agent_users
       WHERE id = ?
       LIMIT 1`,
      [agentId]
    );
    if (!agentRows[0]) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const dashboard = await getAgentRecruitmentDashboard(agentId);
    const driverProgressByUserId = new Map(
      (dashboard.rewards?.driverProgress || []).map((item) => [item.driverUserId, item])
    );

    const referrals = dashboard.applications.map((application) => {
      const rideInfo = application.type === 'driver'
        ? driverProgressByUserId.get(application.driverUserId)
        : null;
      return {
        ...application,
        completedRides: rideInfo ? rideInfo.completedRides : 0,
      };
    });

    const row = agentRows[0];
    return res.json({
      agent: {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phoneNumber: row.phone_number || '',
        employeeCode: row.employee_code || '',
        isActive: !!row.is_active,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at || null,
      },
      summary: dashboard.summary,
      rewards: dashboard.rewards,
      referrals,
    });
  } catch (err) {
    console.error('GET /api/admin/agents/:agentId/referrals', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:agentId/referrals/drivers', requireAdminAuth, requirePermission('agents.manage'), async (req, res) => {
  try {
    const agentId = Number(req.params.agentId);
    const driverIdentifier = String(req.body?.driverIdentifier || req.body?.driverUserId || '').trim();

    if (!agentId) {
      return res.status(400).json({ error: 'Invalid agent id' });
    }
    if (!driverIdentifier) {
      return res.status(400).json({ error: 'driverIdentifier is required (Clerk user id, email, or plate number)' });
    }

    const agentRows = await query(
      'SELECT id, full_name, email, is_active FROM agent_users WHERE id = ? LIMIT 1',
      [agentId]
    );
    const agent = agentRows[0];
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    if (!agent.is_active) {
      return res.status(400).json({ error: 'Agent is inactive' });
    }

    const driver = await resolveDriverByIdentifier(driverIdentifier);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }
    if (String(driver.role || '').toLowerCase() !== 'driver') {
      return res.status(400).json({ error: 'User is not registered as a driver' });
    }

    const existingReferral = await getExistingDriverReferral(driver.clerk_user_id);
    if (existingReferral && Number(existingReferral.agent_user_id) !== agentId) {
      return res.status(409).json({
        error: 'Driver is already assigned to another agent',
        existingAgent: {
          id: existingReferral.agent_user_id,
          fullName: existingReferral.agent_name,
          email: existingReferral.agent_email,
          employeeCode: existingReferral.agent_employee_code || null,
        },
      });
    }

    const referral = await attachDriverToAgentManual({
      driverUserId: driver.clerk_user_id,
      agentUserId: agentId,
    });

    if (referral && !referral.alreadyExists) {
      await mergePrivateMetadata(driver.clerk_user_id, {
        referredByAgentId: referral.agentUserId,
        recruitmentSource: referral.source,
      });
    }

    return res.status(referral?.alreadyExists ? 200 : 201).json({
      ok: true,
      alreadyExists: !!referral?.alreadyExists,
      driver: {
        userId: driver.clerk_user_id,
        email: driver.email || null,
        phoneNumber: driver.phone_number || null,
      },
      referral,
    });
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({ error: err.message || 'Driver is already assigned to another agent' });
    }
    console.error('POST /api/admin/agents/:agentId/referrals/drivers', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:agentId', requireAdminAuth, requirePermission('agents.read'), async (req, res) => {
  try {
    const agentId = Number(req.params.agentId);
    if (!agentId) {
      return res.status(400).json({ error: 'Invalid agent id' });
    }

    const rows = await query(
      `SELECT
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
        creator.full_name AS created_by_admin_name,
        (
          SELECT COUNT(*)
          FROM agent_driver_referrals r
          WHERE r.agent_user_id = a.id
        ) AS driver_referral_count,
        (
          SELECT COUNT(*)
          FROM agent_passenger_referrals p
          WHERE p.agent_user_id = a.id
        ) AS passenger_referral_count,
        (
          SELECT COUNT(CASE WHEN rr.status = 'completed' THEN 1 END)
          FROM agent_driver_referrals r
          LEFT JOIN ride_requests rr ON rr.driver_user_id = r.driver_user_id
          WHERE r.agent_user_id = a.id
        ) AS total_completed_rides
       FROM agent_users a
       LEFT JOIN admin_users creator ON creator.id = a.created_by_admin_id
       WHERE a.id = ?
       LIMIT 1`,
      [agentId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    return res.json({ agent: mapAgentRow(rows[0]) });
  } catch (err) {
    console.error('GET /api/admin/agents/:agentId', err);
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

router.patch('/:agentId/password', requireAdminAuth, requirePermission('agents.manage'), async (req, res) => {
  try {
    const agentId = Number(req.params.agentId);
    const password = String(req.body?.password || '');

    if (!agentId) {
      return res.status(400).json({ error: 'Invalid agent id' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const passwordHash = hashPassword(password);
    const result = await query(
      'UPDATE agent_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [passwordHash, agentId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/admin/agents/:agentId/password', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
