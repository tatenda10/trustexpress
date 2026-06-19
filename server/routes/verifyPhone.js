import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getClerkUserById, mergePrivateMetadata, normalizeRole } from '../lib/clerk-user.js';
import { getClerkClient } from '../lib/clerk-client.js';
import { query } from '../db/connection.js';
import { upsertClerkUserToMysql } from '../lib/user-sync.js';

const router = Router();

async function blockDuplicateAccountsForPhone(phoneNumber, role) {
  const clerkClient = getClerkClient();
  const result = await clerkClient.users.getUserList({ phoneNumber: [phoneNumber], limit: 50 });
  const sameRoleUsers = (result.data || []).filter((item) => normalizeRole(item?.publicMetadata?.role) === role);
  if (sameRoleUsers.length < 2) {
    return { duplicate: false, affectedUserIds: [] };
  }

  const affectedUserIds = sameRoleUsers.map((item) => item.id);
  await Promise.all(affectedUserIds.map((userId) => (
    mergePrivateMetadata(userId, {
      ...(role === 'driver' ? { driverStatus: 'blocked' } : { passengerStatus: 'blocked' }),
      duplicateAccountDetectedAt: new Date().toISOString(),
      duplicateAccountReason: `Duplicate ${role} accounts detected for verified phone number ${phoneNumber}.`,
      duplicateAccountMatchedUserIds: affectedUserIds,
    })
  )));

  return { duplicate: true, affectedUserIds };
}

/**
 * Temporary phone verification stub.
 * For now we treat any provided phone number as verified and persist it on the user.
 * We can plug real provider verification here later without changing the client.
 * For drivers, also set phone_verified_at in driver_identity (MySQL).
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

    const user = await getClerkUserById(req.userId); // Ensure user exists / 404 otherwise
    const phoneNumber = rawPhone;

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
    const refreshedUser = await getClerkUserById(req.userId, { skipCache: true });
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
