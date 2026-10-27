import { Router } from 'express';
import { renderThreeDsChallengePage } from '../lib/payment-3ds-challenges.js';

const router = Router();

router.get('/:token', (req, res) => {
  const { status, html } = renderThreeDsChallengePage(req.params.token);
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  });
  res.status(status).type('html').send(html);
});

export default router;
