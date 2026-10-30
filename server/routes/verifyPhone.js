import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getUserById, mergePrivateMetadata, normalizeRole } from '../lib/users.js';
import { getUserStore } from '../lib/user-store.js';
import { query } from '../db/connection.js';
import { upsertClerkUserToMysql } from '../lib/user-sync.js';
import { normalizeZimbabwePhoneNumber } from '../lib/phone-number.js';
import { sendCode, verifyCode } from '../lib/auth/codes.js';
import { createRestriction, listUserRestrictions } from '../lib/account-restrictions.js';

const router = Router();

async function blockDuplicateAccountsForPhone(phoneNumber, role) {
  const clerkClient = getUserStore();
  const result = await clerkClient.users.getUserList({ phoneNumber: [phoneNumber], limit: 50 });
  const sameRoleUsers = (result.data || []).filter((item) => normalizeRole(item?.publicMetadata?.role) === role);
  if (sameRoleUsers.length < 2) {
    return { duplicate: false, affectedUserIds: [] };
  }

  const affectedUserIds = sameRoleUsers.map((item) => item.id);
  const reasonPrefix = `Duplicate ${role} account`;
  for (const userId of affectedUserIds) {
    const otherUserIds = affectedUserIds.filter((id) => id !== userId);
    const reason = `${reasonPrefix}: phone ${phoneNumber} is also used by ${otherUserIds.join(', ')}`;
    await mergePrivateMetadata(userId, {
      duplicateAccountDetectedAt: new Date().toISOString(),
      duplicateAccountReason: reason,
      duplicateAccountMatchedUserIds: affectedUserIds,
    });
    const existing = await listUserRestrictions(userId);
    if (existing.some((restriction) => restriction.status === 'active' && restriction.reason.startsWith(reasonPrefix))) continue;
    await createRestriction({
      userId,
      userRole: role,
      scope: role === 'driver' ? 'go_online' : 'request_rides',
      reason,
    });
  }

  return { duplicate: true, affectedUserIds };
}

router.post('/send-code', requireAuth, async (req, res) => {
  try {
    const phoneResult = normalizeZimbabwePhoneNumber(req.body?.phoneNumber);
    if (!phoneResult.ok) {
      return res.status(400).json({ error: phoneResult.error });
    }
    const channel = String(req.body?.channel || 'whatsapp').trim().toLowerCase();
    if (!['sms', 'whatsapp'].includes(channel)) {
      return res.status(400).json({ error: 'Choose SMS or WhatsApp' });
    }
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const result = await sendCode({
      purpose: 'verify_phone',
      channel,
      destination: phoneResult.e164Phone,
      ipAddress: (forwarded || req.socket?.remoteAddress || '').slice(0, 64) || null,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error('POST /api/verify-phone/send-code', err);
    return res.status(status).json({ error: err?.message || 'Server error', code: err?.code || null, retryAfterSeconds: err?.retryAfterSeconds });
  }
});

/**
 * Persists a verified phone on the user; for drivers also sets driver_identity.phone_verified_at.
 * Current app versions send `code` from /send-code. Requests without a code come from older app
 * versions and are accepted unverified until those versions are retired.
 */
router.post('/confirm', requireAuth, async (req, res) => {
  try {
    const rawPhone =
      (req.body?.phoneNumber ||
        req.body?.firebaseIdToken || // backwards compatibility with older clients
        req.body?.token ||
        '').trim();

    if (!rawPhone) {
      return res.status(400).json({ error: 'phoneNumber required' });
    }

    const phoneResult = normalizeZimbabwePhoneNumber(rawPhone);
    if (!phoneResult.ok) {
      return res.status(400).json({ error: phoneResult.error });
    }

    const phoneNumber = phoneResult.e164Phone;
    if (req.body?.code !== undefined) {
      try {
        await verifyCode({ purpose: 'verify_phone', destination: phoneNumber, code: req.body.code });
      } catch (codeError) {
        return res.status(codeError?.status || 400).json({ error: codeError?.message || 'That code is not correct.', code: codeError?.code || null });
      }
    } else {
      console.warn('[verify-phone] legacy confirm without code', { userId: req.userId });
    }

    const user = await getUserById(req.userId); // Ensure user exists / 404 otherwise

    const meta = await mergePrivateMetadata(req.userId, {
      phoneNumber,
      phoneVerifiedAt: new Date().toISOString(),
    });

    const role = normalizeRole(user.publicMetadata?.role);
    if (role === 'driver') {
      const now = new Date();
      await query(
        `INSERT INTO driver_identity (driver_user_id, phone_verified_at) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE phone_verified_at = VALUES(phone_verified_at), updated_at = CURRENT_TIMESTAMP`,
        [req.userId, now]
      );
    }

    const duplicateResult = await blockDuplicateAccountsForPhone(phoneNumber, role);
    const refreshedUser = await getUserById(req.userId, { skipCache: true });
    await upsertClerkUserToMysql(refreshedUser);

    return res.json({
      verified: true,
      phoneNumber: meta.phoneNumber || phoneNumber,
      duplicateBlocked: duplicateResult.duplicate,
      duplicateAccountUserIds: duplicateResult.affectedUserIds,
    });
  } catch (err) {
    console.error('POST /api/verify-phone/confirm', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
