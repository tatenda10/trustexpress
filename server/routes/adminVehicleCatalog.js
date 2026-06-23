import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { loadVehicleCatalog, replaceVehicleCatalog } from '../lib/vehicle-catalog.js';

const router = Router();

router.get('/', requireAdminAuth, requirePermission('pricing.read'), async (req, res) => {
  try {
    const catalog = await loadVehicleCatalog({ includeInactive: true });
    return res.json({ catalog });
  } catch (err) {
    console.error('GET /api/admin/vehicle-catalog', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/', requireAdminAuth, requirePermission('pricing.manage'), async (req, res) => {
  try {
    const catalog = Array.isArray(req.body?.catalog) ? req.body.catalog : [];
    const saved = await replaceVehicleCatalog(catalog);
    return res.json({ catalog: saved });
  } catch (err) {
    console.error('PUT /api/admin/vehicle-catalog', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
