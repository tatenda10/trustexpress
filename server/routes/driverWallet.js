import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getClerkUserById, normalizeRole, toAppUser } from '../lib/clerk-user.js';
import {
  getDriverWalletDashboard,
  initializeDriverWalletTopup,
  verifyDriverWalletTopup,
  handleSmilePayWalletWebhook,
} from '../lib/driver-wallet.js';

const router = Router();

async function requireDriver(req, res) {
  const clerkUser = await getClerkUserById(req.userId).catch(() => null);
  const user = clerkUser ? toAppUser(clerkUser) : null;
  if (!user || normalizeRole(user.role) !== 'driver') {
    res.status(403).json({ error: 'Driver account required' });
    return null;
  }
  return user;
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;
    const data = await getDriverWalletDashboard(req.userId, { limit: Number(req.query?.limit || 50) });
    return res.json(data);
  } catch (err) {
    console.error('GET /api/drivers/wallet', err);
    return res.status(err?.status || 500).json({ error: err?.message || 'Server error' });
  }
});

router.post('/top-ups/initiate', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;
    const amount = Number(req.body?.amount);
    const callbackUrl = String(req.body?.callbackUrl || '').trim() || null;
    const result = await initializeDriverWalletTopup({
      driverUserId: req.userId,
      driverEmail: user.email,
      amount,
      callbackUrl,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      mobilePhoneNumber: user.phone || user.phoneNumber || '',
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/drivers/wallet/top-ups/initiate', err);
    return res.status(err?.status || 500).json({ error: err?.message || 'Server error' });
  }
});

router.post('/top-ups/verify', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;
    const reference = String(req.body?.reference || '').trim();
    const result = await verifyDriverWalletTopup(req.userId, reference);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/drivers/wallet/top-ups/verify', err);
    return res.status(err?.status || 500).json({ error: err?.message || 'Server error' });
  }
});

// Smile&Pay server-to-server webhook (resultUrl). No auth — verify by looking up the order reference.
router.post('/webhooks/smilepay', async (req, res) => {
  try {
    const result = await handleSmilePayWalletWebhook(req.body || {});
    return res.status(200).json({ ok: true, alreadyVerified: !!result?.alreadyVerified });
  } catch (err) {
    console.error('POST /api/drivers/wallet/webhooks/smilepay', err);
    // Still acknowledge so Smile&Pay does not retry forever on business 404s.
    const status = Number(err?.status) || 500;
    if (status === 404) {
      return res.status(200).json({ ok: false, error: err.message });
    }
    return res.status(status >= 500 ? 500 : 200).json({ ok: false, error: err?.message || 'Server error' });
  }
});

export default router;
