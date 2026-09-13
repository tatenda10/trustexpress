import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { listHireVehicleTypes, replaceHireVehicleTypes } from '../lib/hire-vehicle-types.js';

const router = Router();

router.get('/', requireAdminAuth, requirePermission('pricing.read'), async (_req, res) => {
  try {
    const types = await listHireVehicleTypes();
    return res.json({ types });
  } catch (err) {
    console.error('GET /api/admin/hire-types', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/', requireAdminAuth, requirePermission('pricing.manage'), async (req, res) => {
  try {
    const types = await replaceHireVehicleTypes(req.body?.types);
    return res.json({ types });
  } catch (err) {
    console.error('PUT /api/admin/hire-types', err);
    return res.status(err?.status || 500).json({ error: err?.message || 'Server error' });
  }
});

export default router;
