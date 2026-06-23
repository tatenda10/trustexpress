import { query } from '../db/connection.js';
import { DEFAULT_VEHICLE_CATALOG } from './default-vehicle-catalog.js';

function normalizeStringArray(values = []) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return normalizeStringArray(parsed);
  } catch {
    return [];
  }
}

function mapCatalogRow(row) {
  return {
    id: row.id,
    make: row.make_name,
    models: parseJsonArray(row.models_json),
    isActive: !!row.is_active,
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeVehicleCatalogRows(rows = []) {
  return rows
    .map((row, index) => ({
      make: String(row?.make || '').trim(),
      models: normalizeStringArray(row?.models),
      isActive: row?.isActive !== false,
      sortOrder: Number.isFinite(Number(row?.sortOrder)) ? Number(row.sortOrder) : index,
    }))
    .filter((row) => row.make && row.models.length > 0);
}

export async function loadVehicleCatalog({ includeInactive = false } = {}) {
  const rows = await query(
    `SELECT id, make_name, models_json, is_active, sort_order, created_at, updated_at
     FROM vehicle_make_model_catalog
     ${includeInactive ? '' : 'WHERE is_active = 1'}
     ORDER BY sort_order ASC, id ASC`
  ).catch(() => []);

  const mapped = rows.map(mapCatalogRow);
  if (mapped.length > 0) {
    return includeInactive ? mapped : mapped.filter((item) => item.isActive !== false);
  }

  try {
    return await replaceVehicleCatalog(
      DEFAULT_VEHICLE_CATALOG.map((row, index) => ({
        make: row.make,
        models: normalizeStringArray(row.models),
        isActive: true,
        sortOrder: index,
      }))
    );
  } catch {
    return DEFAULT_VEHICLE_CATALOG.map((row, index) => ({
      id: null,
      make: row.make,
      models: normalizeStringArray(row.models),
      isActive: true,
      sortOrder: index,
      createdAt: null,
      updatedAt: null,
    }));
  }
}

export async function replaceVehicleCatalog(rows = []) {
  const normalized = normalizeVehicleCatalogRows(rows);
  await query('DELETE FROM vehicle_make_model_catalog');

  for (let index = 0; index < normalized.length; index += 1) {
    const row = normalized[index];
    await query(
      `INSERT INTO vehicle_make_model_catalog (
        make_name,
        models_json,
        is_active,
        sort_order
      ) VALUES (?, ?, ?, ?)`,
      [
        row.make,
        JSON.stringify(row.models),
        row.isActive ? 1 : 0,
        Number.isFinite(row.sortOrder) ? row.sortOrder : index,
      ]
    );
  }

  return loadVehicleCatalog({ includeInactive: true });
}
