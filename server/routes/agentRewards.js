import { Router } from 'express';
import { requireAgentAuth } from '../middleware/agentAuth.js';
import { getAgentRewardProgress, redeemAgentRewards } from '../lib/agent-rewards.js';

const router = Router();

router.get('/rewards', requireAgentAuth, async (req, res) => {
  try {
    const rewards = await getAgentRewardProgress(req.agent.id);
    return res.json(rewards);
  } catch (err) {
    console.error('GET /api/agent/rewards', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/rewards/redeem', requireAgentAuth, async (req, res) => {
  try {
    const result = await redeemAgentRewards(req.agent.id);
    return res.json(result);
  } catch (err) {
    const message = String(err?.message || '');
    if (message === 'NOTHING_TO_REDEEM') {
      return res.status(400).json({ error: 'No reward is available to redeem yet.' });
    }
    if (message === 'PENDING_REDEMPTION_EXISTS') {
      return res.status(409).json({ error: 'You already have a pending redemption request.' });
    }
    console.error('POST /api/agent/rewards/redeem', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
