import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  getDriverResponsePolicySettings,
  listDriverResponsePerformance,
  listDriverResponsePolicyActions,
  saveDriverResponsePolicySettings,
} from '../lib/driver-response-policy.js';

const router = Router();

router.get('/', requireAdminAuth, requirePermission('account_restrictions.read'), async (req, res) => {
  try {
    const settings = await getDriverResponsePolicySettings();
    const [drivers, actions] = await Promise.all([
      listDriverResponsePerformance({ windowHours: settings.windowHours }),
      listDriverResponsePolicyActions(100),
    ]);
    return res.json({ settings, drivers, actions });
  } catch (error) {
    console.error('GET /api/admin/driver-response-policy', error);
    return res.status(error?.status || 500).json({ error: error?.message || 'Server error' });
  }
});

router.put('/settings', requireAdminAuth, requirePermission('account_restrictions.manage'), async (req, res) => {
  try {
    const settings = await saveDriverResponsePolicySettings(req.body || {}, req.admin?.id || null);
    return res.json({ settings });
  } catch (error) {
    console.error('PUT /api/admin/driver-response-policy/settings', error);
    return res.status(error?.status || 500).json({ error: error?.message || 'Server error' });
  }
});

export default router;
