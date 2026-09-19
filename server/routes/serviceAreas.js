import { Router } from 'express';
import { listPublicServiceAreas } from '../lib/service-area.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const areas = await listPublicServiceAreas();
    return res.json({ areas });
  } catch (err) {
    console.error('GET /api/service-areas', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
