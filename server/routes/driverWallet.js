import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getUserById, normalizeRole, toAppUser } from '../lib/users.js';
import {
  getDriverWalletDashboard,
  initializeDriverWalletTopup,
  verifyDriverWalletTopup,
  handleSmilePayWalletWebhook,
  cashOutDriverWallet,
} from '../lib/driver-wallet.js';
import { assertNoActiveRestriction, restrictionErrorResponse } from '../lib/account-restrictions.js';

const router = Router();

async function requireDriver(req, res) {
  const clerkUser = await getUserById(req.userId).catch(() => null);
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
    console.log('[driver.wallet.topup] initiate route entered', {
      driverUserId: req.userId || null,
      bodyKeys: Object.keys(req.body || {}),
      amount: req.body?.amount ?? null,
      checkoutMode: req.body?.checkoutMode || req.body?.paymentMethod || null,
      hasMobilePhoneNumber: Boolean(req.body?.mobilePhoneNumber),
      hasCardDetails: Boolean(req.body?.card || req.body?.cardDetails),
    });
    const user = await requireDriver(req, res);
    if (!user) return;
    const amount = Number(req.body?.amount);
    const callbackUrl = String(req.body?.callbackUrl || '').trim() || null;
    const checkoutMode = String(req.body?.checkoutMode || req.body?.paymentMethod || '').trim() || null;
    console.log('[driver.wallet.topup] initiate request', {
      driverUserId: req.userId,
      amount,
      checkoutMode,
      hasMobilePhoneNumber: Boolean(req.body?.mobilePhoneNumber),
      hasCardDetails: Boolean(req.body?.card || req.body?.cardDetails),
    });
    const result = await initializeDriverWalletTopup({
      driverUserId: req.userId,
      driverEmail: user.email,
      amount,
      callbackUrl,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      mobilePhoneNumber: req.body?.mobilePhoneNumber || user.phone || user.phoneNumber || '',
      checkoutMode,
      cardDetails: req.body?.card || req.body?.cardDetails || null,
    });
    console.log('[driver.wallet.topup] initiate response', {
      driverUserId: req.userId,
      reference: result?.reference || null,
      provider: result?.provider || null,
      checkoutMode: result?.checkoutMode || null,
      nextAction: result?.nextAction || null,
      hasAuthorizationUrl: Boolean(result?.authorizationUrl),
      externalTransactionId: result?.externalTransactionId || null,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/drivers/wallet/top-ups/initiate', err);
    return res.status(err?.status || 500).json({
      error: err?.message || 'Server error',
      code: err?.code || null,
      providerPayload: err?.status && err.status < 500 ? err?.providerPayload || null : undefined,
    });
  }
});

router.post('/top-ups/verify', requireAuth, async (req, res) => {
  try {
    console.log('[driver.wallet.topup] verify route entered', {
      driverUserId: req.userId || null,
      bodyKeys: Object.keys(req.body || {}),
      reference: req.body?.reference || null,
    });
    const user = await requireDriver(req, res);
    if (!user) return;
    const reference = String(req.body?.reference || '').trim();
    console.log('[driver.wallet.topup] verify request', {
      driverUserId: req.userId,
      reference,
    });
    const result = await verifyDriverWalletTopup(req.userId, reference);
    console.log('[driver.wallet.topup] verify response', {
      driverUserId: req.userId,
      reference,
      topupStatus: result?.topup?.status || null,
      walletBalance: result?.wallet?.availableBalance ?? null,
      alreadyVerified: Boolean(result?.alreadyVerified),
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/drivers/wallet/top-ups/verify', err);
    return res.status(err?.status || 500).json({ error: err?.message || 'Server error' });
  }
});

router.post('/cash-outs', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;
    try {
      await assertNoActiveRestriction(req.userId, 'cash_out');
    } catch (restrictionError) {
      return res.status(restrictionError?.status || 403).json(restrictionErrorResponse(restrictionError));
    }
    const amount = req.body?.amount === undefined || req.body?.amount === null || req.body?.amount === ''
      ? null
      : Number(req.body.amount);
    const result = await cashOutDriverWallet({
      driverUserId: req.userId,
      amount,
      narration: req.body?.narration || 'Trust Express wallet cash out',
    });
    return res.status(201).json({ ok: true, cashout: result });
  } catch (err) {
    console.error('POST /api/drivers/wallet/cash-outs', err);
    return res.status(err?.status || 500).json({
      error: err?.message || 'Server error',
      code: err?.code || null,
    });
  }
});

// Smile&Pay server-to-server webhook (resultUrl). No auth — verify by looking up the order reference.
router.post('/webhooks/smilepay', async (req, res) => {
  try {
    console.log('[driver.wallet.topup] smilepay webhook route', {
      responseCode: req.body?.responseCode || req.body?.code || null,
      status: req.body?.status || req.body?.transactionStatus || req.body?.paymentStatus || null,
      orderReference: req.body?.orderReference || req.body?.order_reference || null,
      transactionReference: req.body?.transactionReference || req.body?.reference || null,
    });
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
