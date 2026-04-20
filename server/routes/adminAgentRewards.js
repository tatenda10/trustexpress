import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  listAdminAgentRewardSummary,
  replaceAgentRewardTiers,
  listAgentRewardTiers,
  listAdminRedemptionRequests,
  reviewRedemptionRequest,
} from '../lib/agent-rewards.js';

const router = Router();

router.get('/', requireAdminAuth, requirePermission('payouts.read'), async (req, res) => {
  try {
    const data = await listAdminAgentRewardSummary();
    return res.json(data);
  } catch (err) {
    console.error('GET /api/admin/agent-rewards', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/tiers', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const tiersInput = Array.isArray(req.body?.tiers) ? req.body.tiers : [];
    const tiers = await replaceAgentRewardTiers(tiersInput);
    return res.json({ tiers });
  } catch (err) {
    console.error('PUT /api/admin/agent-rewards/tiers', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/tiers', requireAdminAuth, requirePermission('payouts.read'), async (req, res) => {
  try {
    const tiers = await listAgentRewardTiers();
    return res.json({ tiers });
  } catch (err) {
    console.error('GET /api/admin/agent-rewards/tiers', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/redemptions', requireAdminAuth, requirePermission('payouts.read'), async (req, res) => {
  try {
    const redemptions = await listAdminRedemptionRequests();
    return res.json({ redemptions });
  } catch (err) {
    console.error('GET /api/admin/agent-rewards/redemptions', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/redemptions/:id', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const redemptionId = Number(req.params.id);
    const status = String(req.body?.status || '').trim().toLowerCase();
    const reviewNote = String(req.body?.reviewNote || '').trim();
    if (!Number.isInteger(redemptionId) || redemptionId <= 0) {
      return res.status(400).json({ error: 'Invalid redemption id' });
    }
    if (status !== 'processed' && status !== 'rejected') {
      return res.status(400).json({ error: 'Status must be processed or rejected' });
    }
    const result = await reviewRedemptionRequest({
      redemptionId,
      nextStatus: status,
      adminId: req.admin.id,
      reviewNote,
    });
    return res.json(result);
  } catch (err) {
    const message = String(err?.message || '');
    if (message === 'REDEMPTION_NOT_FOUND') {
      return res.status(404).json({ error: 'Redemption request not found' });
    }
    if (message === 'REDEMPTION_ALREADY_REVIEWED') {
      return res.status(409).json({ error: 'This redemption request was already reviewed.' });
    }
    console.error('PATCH /api/admin/agent-rewards/redemptions/:id', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
