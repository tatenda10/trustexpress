import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  createRestriction,
  durationToExpiry,
  extendRestriction,
  liftRestriction,
  listUserRestrictionAudit,
  listUserRestrictions,
} from '../lib/account-restrictions.js';

const router = Router();

function normalizeSearch(value) {
  return String(value || '').trim();
}

function normalizeExpiry(body = {}) {
  const duration = String(body.duration || '').trim().toLowerCase();
  if (duration === 'custom') {
    const customExpiresAt = String(body.expiresAt || '').trim();
    if (!customExpiresAt) {
      const error = new Error('Custom expiry date is required');
      error.status = 400;
      throw error;
    }
    const date = new Date(customExpiresAt);
    if (Number.isNaN(date.getTime()) || date <= new Date()) {
      const error = new Error('Custom expiry date must be in the future');
      error.status = 400;
      throw error;
    }
    return date;
  }
  if (duration === 'permanent') return null;
  const expiry = durationToExpiry(duration || body.hours);
  if (!expiry && duration !== 'permanent') {
    const error = new Error('Choose 12h, 24h, 48h, custom, or permanent');
    error.status = 400;
    throw error;
  }
  return expiry;
}

router.get('/', requireAdminAuth, requirePermission('account_restrictions.read'), async (req, res) => {
  try {
    const search = normalizeSearch(req.query?.q);
    const status = String(req.query?.status || 'active').trim().toLowerCase();
    const params = [];
    const where = [];

    if (status && status !== 'all') {
      where.push('r.status = ?');
      params.push(status);
    }
    if (search) {
      where.push(`(
        r.clerk_user_id LIKE ?
        OR r.reason LIKE ?
        OR u.email LIKE ?
        OR u.phone_number LIKE ?
        OR CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) LIKE ?
      )`);
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }

    const rows = await query(
      `SELECT
         r.*,
         u.email,
         u.first_name,
         u.last_name,
         u.phone_number,
         u.role AS db_role
       FROM user_account_restrictions r
       LEFT JOIN users u
         ON u.clerk_user_id COLLATE utf8mb4_unicode_ci = r.clerk_user_id COLLATE utf8mb4_unicode_ci
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY r.status = 'active' DESC, r.created_at DESC, r.id DESC
       LIMIT 300`,
      params
    );

    return res.json({
      restrictions: rows.map((row) => ({
        id: Number(row.id),
        userId: row.clerk_user_id,
        userRole: row.user_role,
        scope: row.scope,
        status: row.status,
        reason: row.reason,
        startsAt: row.starts_at || null,
        expiresAt: row.expires_at || null,
        isPermanent: !row.expires_at,
        createdByAdminId: row.created_by_admin_id === null ? null : Number(row.created_by_admin_id),
        liftedByAdminId: row.lifted_by_admin_id === null ? null : Number(row.lifted_by_admin_id),
        liftedAt: row.lifted_at || null,
        liftReason: row.lift_reason || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        user: {
          email: row.email || null,
          firstName: row.first_name || null,
          lastName: row.last_name || null,
          fullName: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || null,
          phoneNumber: row.phone_number || null,
          role: row.db_role || row.user_role || null,
        },
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/account-restrictions', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users/:userId', requireAdminAuth, requirePermission('account_restrictions.read'), async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    if (!userId) return res.status(400).json({ error: 'User id is required' });
    const [user] = await query(
      `SELECT clerk_user_id, email, first_name, last_name, phone_number, role, registration_source
       FROM users
       WHERE clerk_user_id = ?
       LIMIT 1`,
      [userId]
    );
    const [restrictions, audit] = await Promise.all([
      listUserRestrictions(userId),
      listUserRestrictionAudit(userId),
    ]);
    return res.json({
      user: user ? {
        id: user.clerk_user_id,
        email: user.email || null,
        firstName: user.first_name || null,
        lastName: user.last_name || null,
        fullName: [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || null,
        phoneNumber: user.phone_number || null,
        role: user.role || null,
        registrationSource: user.registration_source || null,
      } : { id: userId },
      restrictions,
      audit,
    });
  } catch (err) {
    console.error('GET /api/admin/account-restrictions/users/:userId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', requireAdminAuth, requirePermission('account_restrictions.manage'), async (req, res) => {
  try {
    const userId = String(req.body?.userId || '').trim();
    const expiresAt = normalizeExpiry(req.body || {});
    const restriction = await createRestriction({
      userId,
      userRole: req.body?.userRole || 'any',
      scope: req.body?.scope || 'all',
      reason: req.body?.reason,
      expiresAt,
      adminUserId: req.admin?.id || null,
    });
    return res.status(201).json({ restriction });
  } catch (err) {
    console.error('POST /api/admin/account-restrictions', err);
    return res.status(err?.status || 500).json({ error: err?.message || 'Server error' });
  }
});

router.patch('/:restrictionId/extend', requireAdminAuth, requirePermission('account_restrictions.manage'), async (req, res) => {
  try {
    const restrictionId = Number(req.params.restrictionId);
    if (!Number.isFinite(restrictionId) || restrictionId <= 0) {
      return res.status(400).json({ error: 'Valid restriction id is required' });
    }
    const expiresAt = normalizeExpiry(req.body || {});
    const restriction = await extendRestriction({
      restrictionId,
      expiresAt,
      reason: req.body?.reason,
      adminUserId: req.admin?.id || null,
    });
    return res.json({ restriction });
  } catch (err) {
    console.error('PATCH /api/admin/account-restrictions/:restrictionId/extend', err);
    return res.status(err?.status || 500).json({ error: err?.message || 'Server error' });
  }
});

router.patch('/:restrictionId/lift', requireAdminAuth, requirePermission('account_restrictions.manage'), async (req, res) => {
  try {
    const restrictionId = Number(req.params.restrictionId);
    if (!Number.isFinite(restrictionId) || restrictionId <= 0) {
      return res.status(400).json({ error: 'Valid restriction id is required' });
    }
    const restriction = await liftRestriction({
      restrictionId,
      reason: req.body?.reason,
      adminUserId: req.admin?.id || null,
    });
    return res.json({ restriction });
  } catch (err) {
    console.error('PATCH /api/admin/account-restrictions/:restrictionId/lift', err);
    return res.status(err?.status || 500).json({ error: err?.message || 'Server error' });
  }
});

export default router;
