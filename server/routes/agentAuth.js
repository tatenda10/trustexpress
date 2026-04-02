import { Router } from 'express';
import { query } from '../db/connection.js';
import { hashPassword, verifyPassword } from '../lib/admin-password.js';
import { requireAgentAuth } from '../middleware/agentAuth.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const rows = await query(
      `SELECT id, full_name, email, password_hash, phone_number, employee_code, is_active
       FROM agent_users
       WHERE email = ?
       LIMIT 1`,
      [email]
    );

    const agent = rows[0];
    if (!agent || !agent.is_active || !verifyPassword(password, agent.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = await requireAgentAuth.createSession(agent.id);
    await query('UPDATE agent_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [agent.id]);

    return res.json({
      token,
      agent: {
        id: agent.id,
        fullName: agent.full_name,
        email: agent.email,
        phoneNumber: agent.phone_number || null,
        employeeCode: agent.employee_code || null,
        role: 'agent',
      },
    });
  } catch (err) {
    console.error('POST /api/agent/auth/login', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', requireAgentAuth, async (req, res) => {
  return res.json({
    agent: {
      id: req.agent.id,
      fullName: req.agent.full_name,
      email: req.agent.email,
      phoneNumber: req.agent.phone_number || null,
      employeeCode: req.agent.employee_code || null,
      role: 'agent',
    },
  });
});

router.post('/logout', requireAgentAuth, async (req, res) => {
  try {
    await requireAgentAuth.revokeSession(req.agentTokenHash);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/agent/auth/logout', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
