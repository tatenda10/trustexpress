import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  getSafetyPinSettings,
  updateSafetyPinSettings,
} from '../lib/ride-safety-pin.js';

const router = Router();

router.get('/', requireAdminAuth, requirePermission('ride_ops.manage'), async (req, res) => {
  try {
    const settings = await getSafetyPinSettings({ force: true });
    return res.json({ settings });
  } catch (err) {
    console.error('GET /api/admin/ride-safety-pin', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/', requireAdminAuth, requirePermission('ride_ops.manage'), async (req, res) => {
  try {
    const settings = await updateSafetyPinSettings({
      enabled: req.body?.enabled,
      nightStartHour: req.body?.nightStartHour,
      nightEndHour: req.body?.nightEndHour,
      maxAttempts: req.body?.maxAttempts,
      adminUserId: req.admin?.id || null,
    });
    return res.json({ settings });
  } catch (err) {
    const status = Number(err?.status) || 500;
    console.error('PUT /api/admin/ride-safety-pin', err);
    return res.status(status).json({ error: err?.message || 'Server error' });
  }
});

export default router;
