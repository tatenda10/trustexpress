import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  getHireCommissionSettings,
  previewHireCommission,
  updateHireCommissionSettings,
} from '../lib/hire-commission.js';

const router = Router();

const EXAMPLE_BOOKINGS = [
  { label: 'Local delivery', transportAmount: 20, category: 'delivery', tripType: 'local' },
  { label: 'Intercity hire', transportAmount: 100, category: 'sedan', tripType: 'intercity' },
  { label: 'Sprinter hire', transportAmount: 200, category: 'sprinter', tripType: 'local' },
  { label: 'Lorry/property move', transportAmount: 400, category: 'lorry', tripType: 'local' },
];

function withExamples(settings) {
  return {
    settings,
    examples: EXAMPLE_BOOKINGS.map((example) => ({
      ...example,
      ...previewHireCommission({
        settings,
        category: example.category,
        tripType: example.tripType,
        transportAmount: example.transportAmount,
      }),
    })),
  };
}

router.get('/settings', requireAdminAuth, requirePermission('payouts.read'), async (_req, res) => {
  try {
    const settings = await getHireCommissionSettings({ force: true });
    return res.json(withExamples(settings));
  } catch (err) {
    console.error('GET /api/admin/hire-commission/settings', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/settings', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const settings = await updateHireCommissionSettings({
      enabled: req.body?.enabled,
      intercityDistanceKm: req.body?.intercityDistanceKm,
      bands: req.body?.bands,
      adminUserId: req.admin?.id || null,
    });
    return res.json(withExamples(settings));
  } catch (err) {
    const status = Number(err?.status) || 500;
    console.error('PUT /api/admin/hire-commission/settings', err);
    return res.status(status).json({ error: err?.message || 'Server error' });
  }
});

export default router;
