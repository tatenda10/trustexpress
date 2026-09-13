import { query } from '../db/connection.js';

const FALLBACK_TYPES = [
  { typeKey: 'delivery', typeName: 'Delivery', pricePerKm: 0.8, isActive: true, sortOrder: 1 },
  { typeKey: 'sedan', typeName: 'Sedan', pricePerKm: 0.8, isActive: true, sortOrder: 2 },
  { typeKey: 'suv', typeName: 'SUV', pricePerKm: 1, isActive: true, sortOrder: 3 },
  { typeKey: 'van', typeName: 'Van', pricePerKm: 1.1, isActive: true, sortOrder: 4 },
  { typeKey: 'pickup', typeName: 'Pickup', pricePerKm: 1.1, isActive: true, sortOrder: 5 },
  { typeKey: 'sprinter', typeName: 'Sprinter', pricePerKm: 1.2, isActive: true, sortOrder: 6 },
  { typeKey: 'iveco', typeName: 'Iveco', pricePerKm: 1.2, isActive: true, sortOrder: 7 },
  { typeKey: 'hiace', typeName: 'Hiace', pricePerKm: 1.1, isActive: true, sortOrder: 8 },
  { typeKey: 'eighteen_seater_plus', typeName: '18-seater+', pricePerKm: 1.4, isActive: true, sortOrder: 9 },
  { typeKey: 'bus', typeName: 'Bus', pricePerKm: 1.5, isActive: true, sortOrder: 10 },
  { typeKey: 'moving_van', typeName: 'Moving van', pricePerKm: 1.2, isActive: true, sortOrder: 11 },
  { typeKey: 'truck', typeName: 'Truck', pricePerKm: 1, isActive: true, sortOrder: 12 },
  { typeKey: 'lorry', typeName: 'Lorry', pricePerKm: 1.5, isActive: true, sortOrder: 13 },
  { typeKey: 'other', typeName: 'Other', pricePerKm: 1, isActive: true, sortOrder: 14 },
];

function slugifyTypeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeMoney(value, fallback = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.round(amount * 10000) / 10000;
}

function roundFare(value) {
  return Math.max(1, Math.round(Number(value || 0) * 100) / 100);
}

function isMissingSchemaError(err) {
  const message = String(err?.message || '');
  return err?.code === 'ER_NO_SUCH_TABLE' || /hire_vehicle_types/i.test(message);
}

function mapType(row) {
  return {
    id: row.id == null ? null : Number(row.id),
    typeKey: String(row.type_key || row.typeKey || '').trim().toLowerCase(),
    typeName: String(row.type_name || row.typeName || '').trim(),
    pricePerKm: normalizeMoney(row.price_per_km ?? row.pricePerKm, 0),
    isActive: row.is_active === undefined && row.isActive === undefined
      ? true
      : Number(row.is_active ?? row.isActive ?? 1) === 1,
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
  };
}

export function estimateHireFareFromType(type, distanceKm) {
  const pricePerKm = normalizeMoney(type?.pricePerKm, 0);
  const km = Number(distanceKm);
  const hasDistance = Number.isFinite(km) && km > 0;
  const hasRate = pricePerKm > 0;
  if (!hasRate || !hasDistance) {
    return {
      min: null,
      max: null,
      pricePerKm: hasRate ? pricePerKm : null,
      distanceKm: hasDistance ? Math.round(km * 100) / 100 : null,
      currency: 'USD',
      typeKey: type?.typeKey || null,
      typeName: type?.typeName || null,
    };
  }

  const min = roundFare(pricePerKm * km);
  const max = roundFare(Math.max(min * 1.5, min + 1));
  return {
    min,
    max,
    pricePerKm,
    distanceKm: Math.round(km * 100) / 100,
    currency: 'USD',
    typeKey: type?.typeKey || null,
    typeName: type?.typeName || null,
  };
}

export async function listHireVehicleTypes({ activeOnly = false } = {}) {
  try {
    const rows = await query(
      `SELECT id, type_key, type_name, price_per_km, is_active, sort_order
       FROM hire_vehicle_types
       ${activeOnly ? 'WHERE is_active = 1' : ''}
       ORDER BY sort_order ASC, type_name ASC, id ASC`
    );
    const types = (rows || []).map(mapType).filter((item) => item.typeKey && item.typeName);
    if (types.length) return types;
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }
  return FALLBACK_TYPES
    .filter((item) => !activeOnly || item.isActive !== false)
    .map((item, index) => ({ ...item, id: index + 1 }));
}

export async function getHireVehicleTypeByKey(typeKey) {
  const key = slugifyTypeKey(typeKey);
  if (!key) return null;
  const types = await listHireVehicleTypes();
  return types.find((item) => item.typeKey === key)
    || types.find((item) => item.typeKey === 'other')
    || types[0]
    || null;
}

export async function replaceHireVehicleTypes(inputTypes = []) {
  const types = (Array.isArray(inputTypes) ? inputTypes : [])
    .map((item, index) => ({
      typeKey: slugifyTypeKey(item?.typeKey || item?.typeName),
      typeName: String(item?.typeName || '').trim(),
      pricePerKm: Math.max(0.01, normalizeMoney(item?.pricePerKm, 1)),
      isActive: item?.isActive === false ? 0 : 1,
      sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : index + 1,
    }))
    .filter((item) => item.typeKey && item.typeName);

  if (!types.length) {
    const error = new Error('Add at least one hire vehicle type.');
    error.status = 400;
    throw error;
  }

  await query('DELETE FROM hire_vehicle_types');
  for (const type of types) {
    await query(
      `INSERT INTO hire_vehicle_types (type_key, type_name, price_per_km, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [type.typeKey, type.typeName, type.pricePerKm, type.isActive, type.sortOrder]
    );
  }
  return listHireVehicleTypes();
}

export async function estimateHireFare({ category, typeKey, distanceKm } = {}) {
  const type = await getHireVehicleTypeByKey(typeKey || category);
  return estimateHireFareFromType(type, distanceKm);
}
