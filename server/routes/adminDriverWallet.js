import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  getDriverWalletSettings,
  updateDriverWalletSettings,
} from '../lib/driver-wallet-settings.js';

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

export default router;
