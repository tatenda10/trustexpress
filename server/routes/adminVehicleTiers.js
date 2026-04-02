import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';

const router = Router();

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeStringArray(values = []) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function mapTier(row) {
  return {
    id: row.id,
    tierKey: row.tier_key,
    tierName: row.tier_name,
    shortDescription: row.short_description || '',
    vehicleRequirements: parseJsonArray(row.vehicle_requirements_json),
    passengerComfort: parseJsonArray(row.passenger_comfort_json),
    driverRequirements: parseJsonArray(row.driver_requirements_json),
    useCases: parseJsonArray(row.use_cases_json),
    exampleVehicles: parseJsonArray(row.example_vehicles_json),
    isActive: !!row.is_active,
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function replaceVehicleTiers(tiers = []) {
  await query('DELETE FROM vehicle_tier_rules');

  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index] || {};
    const tierKey = String(tier.tierKey || '').trim().toLowerCase();
    const tierName = String(tier.tierName || '').trim();
    const shortDescription = String(tier.shortDescription || '').trim() || null;
    const vehicleRequirements = normalizeStringArray(tier.vehicleRequirements);
    const passengerComfort = normalizeStringArray(tier.passengerComfort);
    const driverRequirements = normalizeStringArray(tier.driverRequirements);
    const useCases = normalizeStringArray(tier.useCases);
    const exampleVehicles = normalizeStringArray(tier.exampleVehicles);
    const isActive = tier.isActive === false ? 0 : 1;
    const sortOrder = Number(tier.sortOrder ?? index);

    if (!tierKey || !tierName) continue;

    await query(
      `INSERT INTO vehicle_tier_rules (
        tier_key,
        tier_name,
        short_description,
        vehicle_requirements_json,
        passenger_comfort_json,
        driver_requirements_json,
        use_cases_json,
        example_vehicles_json,
        is_active,
        sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tierKey,
        tierName,
        shortDescription,
        JSON.stringify(vehicleRequirements),
        JSON.stringify(passengerComfort),
        JSON.stringify(driverRequirements),
        JSON.stringify(useCases),
        JSON.stringify(exampleVehicles),
        isActive,
        Number.isFinite(sortOrder) ? sortOrder : index,
      ]
    );
  }
}

router.get('/', requireAdminAuth, requirePermission('pricing.read'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, tier_key, tier_name, short_description, vehicle_requirements_json, passenger_comfort_json,
              driver_requirements_json, use_cases_json, example_vehicles_json, is_active, sort_order, created_at, updated_at
       FROM vehicle_tier_rules
       ORDER BY sort_order ASC, id ASC`
    );

    return res.json({ tiers: rows.map(mapTier) });
  } catch (err) {
    console.error('GET /api/admin/vehicle-tiers', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/', requireAdminAuth, requirePermission('pricing.manage'), async (req, res) => {
  try {
    const tiers = Array.isArray(req.body?.tiers) ? req.body.tiers : [];
    await replaceVehicleTiers(tiers);

    const rows = await query(
      `SELECT id, tier_key, tier_name, short_description, vehicle_requirements_json, passenger_comfort_json,
              driver_requirements_json, use_cases_json, example_vehicles_json, is_active, sort_order, created_at, updated_at
       FROM vehicle_tier_rules
       ORDER BY sort_order ASC, id ASC`
    );

    return res.json({ tiers: rows.map(mapTier) });
  } catch (err) {
    console.error('PUT /api/admin/vehicle-tiers', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
