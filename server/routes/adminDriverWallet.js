import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  getDriverWalletSettings,
  updateDriverWalletSettings,
} from '../lib/driver-wallet-settings.js';
import {
  creditSingleDriverWallet,
  DEFAULT_STARTUP_GRANT_AMOUNT,
  DEFAULT_STARTUP_GRANT_ID,
  runStartupWalletGrant,
} from '../lib/startup-wallet-grant.js';

const router = Router();

router.get('/settings', requireAdminAuth, requirePermission('payouts.read'), async (req, res) => {
  try {
    const settings = await getDriverWalletSettings({ force: true });
    return res.json({ settings });
  } catch (err) {
    console.error('GET /api/admin/driver-wallet/settings', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/settings', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const settings = await updateDriverWalletSettings({
      walletEnabled: req.body?.walletEnabled,
      paymentsEnabled: req.body?.paymentsEnabled,
      paymentProvider: req.body?.paymentProvider,
      minimumBalanceUsd: req.body?.minimumBalanceUsd,
      commissionRatePercent: req.body?.commissionRatePercent,
      topupMinAmount: req.body?.topupMinAmount,
      topupMaxAmount: req.body?.topupMaxAmount,
      currency: req.body?.currency,
      adminUserId: req.admin?.id || null,
    });
    return res.json({ settings });
  } catch (err) {
    const status = Number(err?.status) || 500;
    console.error('PUT /api/admin/driver-wallet/settings', err);
    return res.status(status).json({ error: err?.message || 'Server error' });
  }
});

/**
 * Preview how many drivers would receive the startup grant (dry-run).
 * Does not write wallets.
 */
router.get('/startup-grant/preview', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const amount = req.query?.amount != null ? Number(req.query.amount) : DEFAULT_STARTUP_GRANT_AMOUNT;
    const grantId = String(req.query?.grantId || DEFAULT_STARTUP_GRANT_ID).trim() || DEFAULT_STARTUP_GRANT_ID;
    const currency = req.query?.currency ? String(req.query.currency).toUpperCase() : null;

    const summary = await runStartupWalletGrant({
      amount,
      grantId,
      currency,
      apply: false,
    });

    return res.json({ summary });
  } catch (err) {
    const status = Number(err?.status) || 500;
    console.error('GET /api/admin/driver-wallet/startup-grant/preview', err);
    return res.status(status).json({ error: err?.message || 'Server error' });
  }
});

/**
 * Apply (or dry-run) the startup grant: credits only drivers who never received this grantId.
 * Body: { amount?, grantId?, currency?, apply?: boolean }
 */
router.post('/startup-grant', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const apply = req.body?.apply === true || req.body?.apply === 'true';
    const amount = req.body?.amount != null ? Number(req.body.amount) : DEFAULT_STARTUP_GRANT_AMOUNT;
    const grantId = String(req.body?.grantId || DEFAULT_STARTUP_GRANT_ID).trim() || DEFAULT_STARTUP_GRANT_ID;
    const currency = req.body?.currency ? String(req.body.currency).toUpperCase() : null;

    const summary = await runStartupWalletGrant({
      amount,
      grantId,
      currency,
      apply,
    });

    return res.json({ summary });
  } catch (err) {
    const status = Number(err?.status) || 500;
    console.error('POST /api/admin/driver-wallet/startup-grant', err);
    return res.status(status).json({ error: err?.message || 'Server error' });
  }
});

/**
 * One-off manual credit for a single driver.
 * Body: { email, amount, currency?, description? }
 */
router.post('/manual-credit', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const result = await creditSingleDriverWallet({
      email: req.body?.email,
      driverUserId: req.body?.driverUserId || null,
      amount: req.body?.amount,
      currency: req.body?.currency || null,
      description: req.body?.description || 'Admin wallet top-up',
      sourceType: 'admin_manual_credit',
      sourceId: req.body?.sourceId || null,
    });

    return res.json({ result });
  } catch (err) {
    const status = Number(err?.status) || 500;
    console.error('POST /api/admin/driver-wallet/manual-credit', err);
    return res.status(status).json({ error: err?.message || 'Server error' });
  }
});

export default router;
