import { Router } from 'express';
import { getAuthorityShareSnapshotByToken } from '../lib/admin-ride-share.js';

const router = Router();

router.get('/admin-share/:token', async (req, res) => {
  try {
    const result = await getAuthorityShareSnapshotByToken(req.params.token);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.json(result.data);
  } catch (err) {
    console.error('GET /api/public/admin-share/:token', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
