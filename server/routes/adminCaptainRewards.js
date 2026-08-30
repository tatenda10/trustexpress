import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  getCaptainRewardSettings,
  updateCaptainRewardSettings,
  listCaptainRewardTiers,
  replaceCaptainRewardTiers,
  listAdminCaptainCycles,
  listAdminCaptainCycleDrivers,
  creditCaptainRewardsForCycle,
  processDueCaptainRewardCycles,
  computeCycleWindowFromAnchor,
  getWeekdayLabel,
} from '../lib/captain-rewards.js';

const router = Router();

router.get('/', requireAdminAuth, requirePermission('payouts.read'), async (req, res) => {
  try {
    const [settings, tiers, cycles] = await Promise.all([
      getCaptainRewardSettings({ force: true }),
      listCaptainRewardTiers(),
      listAdminCaptainCycles(10),
    ]);
    const window = computeCycleWindowFromAnchor(
      settings.cycleAnchorStartsAt,
      settings.cycleLengthDays
    );
    return res.json({
      settings: {
        ...settings,
        currentCycle: {
          cycleKey: window.cycleKey,
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
          daysRemaining: window.daysRemaining,
        },
      },
      tiers,
      cycles,
      weekdayOptions: [0, 1, 2, 3, 4, 5, 6].map((value) => ({
        value,
        label: getWeekdayLabel(value),
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/captain-rewards', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/settings', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const settings = await updateCaptainRewardSettings({
      enabled: req.body?.enabled !== false,
      cycleLengthDays: req.body?.cycleLengthDays,
      cycleWeekday: req.body?.cycleWeekday,
      cycleAnchorStartsAt: req.body?.cycleAnchorStartsAt,
      currency: req.body?.currency || 'USD',
      adminId: req.admin.id,
    });
    return res.json({ settings });
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: err.message || 'Invalid settings' });
    }
    console.error('PUT /api/admin/captain-rewards/settings', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/tiers', requireAdminAuth, requirePermission('payouts.read'), async (req, res) => {
  try {
    const tiers = await listCaptainRewardTiers();
    return res.json({ tiers });
  } catch (err) {
    console.error('GET /api/admin/captain-rewards/tiers', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/tiers', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const tiersInput = Array.isArray(req.body?.tiers) ? req.body.tiers : [];
    const tiers = await replaceCaptainRewardTiers(tiersInput);
    return res.json({ tiers });
  } catch (err) {
    console.error('PUT /api/admin/captain-rewards/tiers', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/cycles', requireAdminAuth, requirePermission('payouts.read'), async (req, res) => {
  try {
    const limit = Number(req.query?.limit) || 20;
    const cycles = await listAdminCaptainCycles(limit);
    return res.json({ cycles });
  } catch (err) {
    console.error('GET /api/admin/captain-rewards/cycles', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/cycles/:cycleId/drivers', requireAdminAuth, requirePermission('payouts.read'), async (req, res) => {
  try {
    const cycleId = Number(req.params.cycleId);
    if (!Number.isInteger(cycleId) || cycleId <= 0) {
      return res.status(400).json({ error: 'Invalid cycle id' });
    }
    const drivers = await listAdminCaptainCycleDrivers(cycleId);
    return res.json({ drivers });
  } catch (err) {
    console.error('GET /api/admin/captain-rewards/cycles/:cycleId/drivers', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/cycles/:cycleId/credit', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const cycleId = Number(req.params.cycleId);
    if (!Number.isInteger(cycleId) || cycleId <= 0) {
      return res.status(400).json({ error: 'Invalid cycle id' });
    }
    const force = req.body?.force === true;
    const result = await creditCaptainRewardsForCycle(cycleId, { force });
    return res.json(result);
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: err.message || 'Could not credit cycle' });
    }
    console.error('POST /api/admin/captain-rewards/cycles/:cycleId/credit', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/process-due', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const results = await processDueCaptainRewardCycles();
    return res.json({ processed: results.length, results });
  } catch (err) {
    console.error('POST /api/admin/captain-rewards/process-due', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
