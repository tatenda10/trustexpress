import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getClerkUserById, normalizeRole, toAppUser } from '../lib/clerk-user.js';
import { upsertClerkUserToMysql } from '../lib/user-sync.js';
import {
  attachPassengerPeerReferral,
  getPassengerReferralDashboard,
} from '../lib/passenger-referrals.js';

const router = Router();

async function requirePassenger(req, res) {
  const user = await getClerkUserById(req.userId);
  await upsertClerkUserToMysql(user);
  const appUser = toAppUser(user);
  if (normalizeRole(appUser.role) !== 'passenger') {
    res.status(403).json({ error: 'Only passenger accounts can use referrals' });
    return null;
  }
  return user;
}

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const dashboard = await getPassengerReferralDashboard(req.userId);
    return res.json(dashboard);
  } catch (err) {
    console.error('GET /api/passengers/referrals/me', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/apply', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const referrerEmail = String(req.body?.referrerEmail || '').trim();
    if (!referrerEmail) {
      return res.status(400).json({ error: 'referrerEmail is required' });
    }

    const result = await attachPassengerPeerReferral({
      referredUserId: req.userId,
      referrerEmail,
      source: 'manual_apply',
    });

    return res.status(result.alreadyExists ? 200 : 201).json({
      ok: true,
      alreadyExists: result.alreadyExists,
      referral: result.referral,
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message || 'Invalid referral' });
    }
    console.error('POST /api/passengers/referrals/apply', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
