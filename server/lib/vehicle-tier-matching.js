import { query } from '../db/connection.js';

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadVehicleTierRules() {
  let rows = [];
  try {
    rows = await query(
      `SELECT id, tier_key, tier_name, short_description, vehicle_requirements_json, passenger_comfort_json,
              driver_requirements_json, use_cases_json, example_vehicles_json, is_active, sort_order
       FROM vehicle_tier_rules
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      return [];
    }
    throw error;
  }

  return rows.map((row) => ({
    id: row.id,
    tierKey: row.tier_key,
    tierName: row.tier_name,
    shortDescription: row.short_description || '',
    vehicleRequirements: parseJsonArray(row.vehicle_requirements_json),
    passengerComfort: parseJsonArray(row.passenger_comfort_json),
    driverRequirements: parseJsonArray(row.driver_requirements_json),
    useCases: parseJsonArray(row.use_cases_json),
    exampleVehicles: parseJsonArray(row.example_vehicles_json),
    sortOrder: Number(row.sort_order || 0),
  }));
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function evaluateRule(label, passed, expected, actual, category = 'required') {
  return { label, passed: !!passed, expected, actual, category };
}

function computeTierChecks(tier, vehicle = {}) {
  const year = toNumber(vehicle.year);
  const seatCount = toNumber(vehicle.seatCount);
  const doorCount = toNumber(vehicle.doorCount);
  const category = normalizeText(vehicle.vehicleCategory);
  const makeModel = `${normalizeText(vehicle.make)} ${normalizeText(vehicle.model)}`.trim();

  const bools = {
    hasAirConditioning: vehicle.hasAirConditioning === true,
    hasChargingPorts: vehicle.hasChargingPorts === true,
    hasWifi: vehicle.hasWifi === true,
    hasLeatherSeats: vehicle.hasLeatherSeats === true,
    hasLargeLuggageSpace: vehicle.hasLargeLuggageSpace === true,
    hasSlidingDoors: vehicle.hasSlidingDoors === true,
    isHighEnd: vehicle.isHighEnd === true,
  };

  const key = normalizeText(tier.tierKey);
  const checks = [];

  if (key === 'trust-express') {
    checks.push(evaluateRule('Model year', year !== null && year >= 2005, '2005 or newer', year ?? 'Not provided'));
    checks.push(evaluateRule('Doors', doorCount !== null && doorCount >= 4, '4 or more doors', doorCount ?? 'Not provided'));
    checks.push(evaluateRule('Passenger seats', seatCount !== null && seatCount >= 4, 'At least 4 passenger seats', seatCount ?? 'Not provided'));
  }

  if (key === 'trust-xl') {
    checks.push(evaluateRule('Model year', year !== null && year >= 2010, '2010 or newer', year ?? 'Not provided'));
    checks.push(evaluateRule('Passenger seats', seatCount !== null && seatCount >= 6 && seatCount <= 7, '6 to 7 seats', seatCount ?? 'Not provided'));
    checks.push(evaluateRule('Doors', doorCount !== null && doorCount >= 4, '4 or more doors', doorCount ?? 'Not provided'));
    checks.push(evaluateRule('Air conditioning', bools.hasAirConditioning, 'Air conditioning available', bools.hasAirConditioning ? 'Yes' : 'No'));
    checks.push(evaluateRule('Luggage space', bools.hasLargeLuggageSpace, 'Large luggage space', bools.hasLargeLuggageSpace ? 'Yes' : 'No'));
    checks.push(evaluateRule('Charging ports', bools.hasChargingPorts, 'Charging ports preferred', bools.hasChargingPorts ? 'Yes' : 'No', 'preferred'));
    checks.push(evaluateRule('Wi-Fi', bools.hasWifi, 'Wi-Fi preferred', bools.hasWifi ? 'Yes' : 'No', 'preferred'));
    checks.push(evaluateRule('Sliding doors', bools.hasSlidingDoors, 'Sliding doors preferred', bools.hasSlidingDoors ? 'Yes' : 'No', 'preferred'));
  }

  if (key === 'trust-luxury') {
    checks.push(evaluateRule('Model year', year !== null && year >= 2015, '2015 or newer', year ?? 'Not provided'));
    checks.push(
      evaluateRule(
        'Vehicle category',
        category === 'sedan' || category === 'suv',
        'Sedan or SUV',
        vehicle.vehicleCategory || 'Not provided'
      )
    );
    checks.push(evaluateRule('Air conditioning', bools.hasAirConditioning, 'Air conditioning available', bools.hasAirConditioning ? 'Yes' : 'No'));
    checks.push(evaluateRule('High-end vehicle', bools.isHighEnd, 'Marked as high-end', bools.isHighEnd ? 'Yes' : 'No'));
    checks.push(evaluateRule('Leather seats', bools.hasLeatherSeats, 'Leather seats preferred', bools.hasLeatherSeats ? 'Yes' : 'No', 'preferred'));
  }

  const exampleMatch = tier.exampleVehicles.some((example) => makeModel.includes(normalizeText(example)));
  if (tier.exampleVehicles.length) {
    checks.push(
      evaluateRule(
        'Known example vehicle',
        exampleMatch,
        tier.exampleVehicles.join(', '),
        `${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Not provided',
        'informational'
      )
    );
  }

  return checks;
}

export function evaluateVehicleAgainstTiers(vehicle = {}, tiers = []) {
  const evaluations = tiers.map((tier) => {
    const checks = computeTierChecks(tier, vehicle);
    const requiredChecks = checks.filter((check) => check.category === 'required');
    const preferredChecks = checks.filter((check) => check.category === 'preferred');
    const informationalChecks = checks.filter((check) => check.category === 'informational');
    const metRequired = requiredChecks.filter((check) => check.passed).length;
    const metPreferred = preferredChecks.filter((check) => check.passed).length;
    const eligible = requiredChecks.length > 0 ? metRequired === requiredChecks.length : false;

    return {
      tierKey: tier.tierKey,
      tierName: tier.tierName,
      eligible,
      score: requiredChecks.length ? Number((metRequired / requiredChecks.length).toFixed(2)) : 0,
      metRequired,
      totalRequired: requiredChecks.length,
      metPreferred,
      totalPreferred: preferredChecks.length,
      checks: [...requiredChecks, ...preferredChecks, ...informationalChecks],
    };
  });

  const recommended = evaluations
    .slice()
    .sort((left, right) => {
      if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
      if (left.score !== right.score) return right.score - left.score;
      return (right.metPreferred || 0) - (left.metPreferred || 0);
    })[0] || null;

  const selectedTierKey = normalizeText(vehicle.vehicleTierKey);
  const selected = evaluations.find((item) => normalizeText(item.tierKey) === selectedTierKey) || null;

  return {
    recommendedTierKey: recommended?.tierKey || null,
    recommendedTierName: recommended?.tierName || null,
    selectedTierKey: selected?.tierKey || vehicle.vehicleTierKey || null,
    selectedTierName: selected?.tierName || vehicle.vehicleTierName || null,
    selectedTierEligible: selected?.eligible ?? null,
    evaluations,
  };
}
