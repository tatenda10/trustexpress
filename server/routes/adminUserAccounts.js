import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { hasPermission } from '../lib/admin-rbac.js';
import { query } from '../db/connection.js';
import {
  assertPasswordStrength,
  findUserByEmail,
  findUserById,
  findUserByPhone,
  hashPassword,
  normalizeEmail,
  normalizePhone,
  normalizeRole,
  setUserPassword,
} from '../lib/auth/accounts.js';
import { revokeAllUserSessions } from '../lib/auth/tokens.js';

const router = Router();
const MAX_NAME_LENGTH = 100;

function shapeAccount(row) {
  return {
    id: row.id,
    role: normalizeRole(row.role),
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    email: row.email || '',
    emailVerified: Boolean(row.email_verified_at),
    phoneNumber: row.phone_number || '',
    phoneVerified: Boolean(row.phone_verified_at),
    hasPassword: Boolean(row.password_hash),
  };
}

async function loadManageableUser(req, res) {
  const userId = String(req.params.userId || '').trim();
  const row = userId ? await findUserById(userId) : null;
  if (!row) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  const permission = normalizeRole(row.role) === 'driver' ? 'drivers.manage' : 'passengers.manage';
  if (!hasPermission(req.admin, permission)) {
    res.status(403).json({ error: 'Insufficient permissions', required: permission });
    return null;
  }
  return row;
}

function cleanName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
}

router.get('/:userId', requireAdminAuth, async (req, res) => {
  try {
    const row = await loadManageableUser(req, res);
    if (!row) return undefined;
    return res.json({ account: shapeAccount(row) });
  } catch (err) {
    console.error('GET /api/admin/user-accounts/:userId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:userId', requireAdminAuth, async (req, res) => {
  try {
    const row = await loadManageableUser(req, res);
    if (!row) return undefined;

    const role = normalizeRole(row.role);
    const body = req.body || {};
    const sets = [];
    const params = [];

    if (body.firstName !== undefined || body.lastName !== undefined) {
      const firstName = body.firstName !== undefined ? cleanName(body.firstName) : row.first_name || '';
      const lastName = body.lastName !== undefined ? cleanName(body.lastName) : row.last_name || '';
      if (!firstName) {
        return res.status(400).json({ error: 'First name is required.' });
      }
      sets.push('first_name = ?', 'last_name = ?');
      params.push(firstName, lastName || null);
    }

    if (body.email !== undefined) {
      const rawEmail = String(body.email || '').trim();
      if (!rawEmail) {
        sets.push('email = NULL', 'email_verified_at = NULL');
      } else {
        const email = normalizeEmail(rawEmail);
        if (!email) {
          return res.status(400).json({ error: 'Enter a valid email address.' });
        }
        if (email !== String(row.email || '').toLowerCase()) {
          const existing = await findUserByEmail(email, role);
          if (existing && existing.id !== row.id) {
            return res.status(409).json({ error: `Another ${role} account already uses this email.` });
          }
          sets.push('email = ?', 'email_verified_at = CURRENT_TIMESTAMP');
          params.push(email);
        }
      }
    }

    if (body.phoneNumber !== undefined) {
      const rawPhone = String(body.phoneNumber || '').trim();
      if (!rawPhone) {
        sets.push('phone_number = NULL', 'phone_verified_at = NULL');
      } else {
        const phone = normalizePhone(rawPhone);
        if (!phone) {
          return res.status(400).json({ error: 'Enter a valid Zimbabwe phone number.' });
        }
        if (phone !== row.phone_number) {
          const existing = await findUserByPhone(phone, role);
          if (existing && existing.id !== row.id) {
            return res.status(409).json({ error: `Another ${role} account already uses this phone number.` });
          }
          sets.push('phone_number = ?', 'phone_verified_at = CURRENT_TIMESTAMP');
          params.push(phone);
        }
      }
    }

    if (sets.length > 0) {
      await query(`UPDATE users SET ${sets.join(', ')} WHERE clerk_user_id = ?`, [...params, row.id]);
      console.info('[admin.user-accounts] updated', {
        userId: row.id,
        adminId: req.admin?.id || null,
        fields: Object.keys(body).filter((key) => ['firstName', 'lastName', 'email', 'phoneNumber'].includes(key)),
      });
    }

    const updated = await findUserById(row.id);
    return res.json({ account: shapeAccount(updated) });
  } catch (err) {
    console.error('PATCH /api/admin/user-accounts/:userId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:userId/password', requireAdminAuth, async (req, res) => {
  try {
    const row = await loadManageableUser(req, res);
    if (!row) return undefined;

    const password = String(req.body?.password || '');
    try {
      assertPasswordStrength(password);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }

    await setUserPassword(row.id, await hashPassword(password));
    if (req.body?.signOutEverywhere !== false) {
      await revokeAllUserSessions(row.id, { reason: 'admin_password_reset' });
    }
    console.info('[admin.user-accounts] password set', { userId: row.id, adminId: req.admin?.id || null });

    const updated = await findUserById(row.id);
    return res.json({ ok: true, account: shapeAccount(updated) });
  } catch (err) {
    console.error('POST /api/admin/user-accounts/:userId/password', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
