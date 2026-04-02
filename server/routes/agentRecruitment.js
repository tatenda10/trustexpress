import { Router } from 'express';
import { requireAgentAuth } from '../middleware/agentAuth.js';
import { getAgentRecruitmentDashboard, listAgentRecruitmentApplications } from '../lib/agent-recruitment.js';

const router = Router();

router.get('/dashboard', requireAgentAuth, async (req, res) => {
  try {
    const data = await getAgentRecruitmentDashboard(req.agent.id);
    return res.json(data);
  } catch (err) {
    console.error('GET /api/agent/dashboard', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/applications', requireAgentAuth, async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || 'all').trim().toLowerCase();
    const applications = await listAgentRecruitmentApplications(req.agent.id);

    const filtered = applications.filter((item) => {
      const matchesStatus = status === 'all' ? true : item.status.key === status;
      if (!matchesStatus) return false;
      if (!search) return true;

      const haystack = [
        item.driverUserId,
        item.driver?.fullName,
        item.driver?.email,
        item.driver?.phoneNumber,
        item.vehicle?.make,
        item.vehicle?.model,
        item.vehicle?.numberPlate,
        item.status?.label,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(search);
    });

    return res.json({ applications: filtered });
  } catch (err) {
    console.error('GET /api/agent/applications', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
