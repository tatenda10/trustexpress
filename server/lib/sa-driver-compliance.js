import { toIsoDateOnly } from './smile-cash.js';

export const SA_OPERATOR_AGREEMENT_VERSION = 'ZA-1.0';

export function isSouthAfricanDriver(identity, registrationCountryCode = null) {
  return String(identity?.registration_country_code || registrationCountryCode || '').trim().toUpperCase() === 'ZA';
}

function isExpired(value, now = new Date()) {
  const iso = toIsoDateOnly(value);
  if (!iso) return false;
  const today = now.toISOString().slice(0, 10);
  return iso < today;
}

export function getSaProfileCompliance(identity, now = new Date()) {
  if (!isSouthAfricanDriver(identity)) return { applies: false, complete: true, active: true, missing: [], expired: [] };
  const requirements = [
    ['Identity document type', identity?.identity_document_type],
    ['Criminal-investigation declaration', identity?.criminal_declaration_accepted_at],
    ['RICA/ECA declaration', identity?.rica_eca_declaration_accepted_at],
    ['Operator agreement version', identity?.operator_agreement_version],
    ['Operator agreement acceptance', identity?.operator_agreement_accepted_at],
    ['Operating-licence condition', identity?.operating_licence_condition_accepted_at],
    ['PrDP number', identity?.prdp_number],
    ['PrDP document', identity?.prdp_url],
    ['PrDP expiration date', identity?.prdp_expires_at],
  ];
  const missing = requirements.filter(([, value]) => !value).map(([label]) => label);
  const expired = [
    ['Driving licence', identity?.driver_licence_expires_at],
    ['PrDP', identity?.prdp_expires_at],
  ].filter(([, value]) => value && isExpired(value, now)).map(([label]) => label);
  return { applies: true, complete: missing.length === 0, active: missing.length === 0 && expired.length === 0, missing, expired };
}

export function getSaVehicleCompliance(vehicle, now = new Date()) {
  if (!vehicle) return { applies: false, complete: true, active: true, missing: [], expired: [] };
  const requirements = [];
  const missing = requirements.filter(([, value]) => !value).map(([label]) => label);
  const expired = [];
  return { applies: true, complete: missing.length === 0, active: missing.length === 0 && expired.length === 0, missing, expired };
}

export function getSaDriverCompliance(identity, vehicle, now = new Date()) {
  const applies = isSouthAfricanDriver(identity);
  if (!applies) return { applies: false, complete: true, active: true, missing: [], expired: [], profile: getSaProfileCompliance(null), vehicle: getSaVehicleCompliance(null) };
  const profile = getSaProfileCompliance(identity, now);
  const vehicleResult = getSaVehicleCompliance(vehicle, now);
  return {
    applies: true,
    complete: profile.complete && vehicleResult.complete,
    active: profile.active && vehicleResult.active,
    missing: [...profile.missing, ...vehicleResult.missing],
    expired: [...profile.expired, ...vehicleResult.expired],
    profile,
    vehicle: vehicleResult,
  };
}
