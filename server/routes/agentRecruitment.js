import { Router } from 'express';
import { requireAgentAuth } from '../middleware/agentAuth.js';
import { getAgentRecruitmentDashboard, listAgentRecruitmentApplications } from '../lib/agent-recruitment.js';
import { query } from '../db/connection.js';

const router = Router();

function normalizeVehicleNumber(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '');
}

router.get('/dashboard', requireAgentAuth, async (req, res) => {
  try {
    const data = await getAgentRecruitmentDashboard(req.agent.id);
    return res.json(data);
  } catch (err) {
    console.error('GET /api/agent/dashboard', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/driver-eligibility', requireAgentAuth, async (req, res) => {
  try {
    const rawVehicleNumber = String(req.query.vehicleNumber || req.query.numberPlate || '').trim();
    const vehicleNumber = normalizeVehicleNumber(rawVehicleNumber);

    if (!vehicleNumber) {
      return res.status(400).json({ error: 'vehicleNumber is required' });
    }

    const rows = await query(
      `SELECT driver_user_id, number_plate, make, model, vehicle_status
       FROM driver_vehicle`,
    );

    const match = rows.find((row) => normalizeVehicleNumber(row.number_plate) === vehicleNumber) || null;

    if (match) {
      return res.json({
        vehicleNumber,
        available: false,
        alreadyRegistered: true,
        driverUserId: match.driver_user_id,
        vehicleStatus: match.vehicle_status || null,
        vehicleLabel: [match.make, match.model, match.number_plate].filter(Boolean).join(' ').trim() || match.number_plate || vehicleNumber,
      });
    }

    return res.json({
      vehicleNumber,
      available: true,
      alreadyRegistered: false,
    });
  } catch (err) {
    console.error('GET /api/agent/driver-eligibility', err);
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
