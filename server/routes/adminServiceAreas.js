import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { clearServiceAreaCache } from '../lib/service-area.js';

const router = Router();

function slugifyKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function toNumber(value, field) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    const error = new Error(`${field} must be a valid number`);
    error.status = 400;
    throw error;
  }
  return next;
}

function normalizeAreaPayload(body = {}) {
  const label = String(body.label || '').trim();
  const areaKey = slugifyKey(body.areaKey || body.key || label);
  if (!label) {
    const error = new Error('Area name is required');
    error.status = 400;
    throw error;
  }
  if (!areaKey) {
    const error = new Error('Area key is required');
    error.status = 400;
    throw error;
  }

  const centerLat = toNumber(body.centerLat ?? body.centerLatitude, 'Center latitude');
  const centerLng = toNumber(body.centerLng ?? body.centerLongitude, 'Center longitude');
  const westLng = toNumber(body.westLng ?? body.west, 'West longitude');
  const southLat = toNumber(body.southLat ?? body.south, 'South latitude');
  const eastLng = toNumber(body.eastLng ?? body.east, 'East longitude');
  const northLat = toNumber(body.northLat ?? body.north, 'North latitude');

  if (centerLat < -90 || centerLat > 90 || southLat < -90 || southLat > 90 || northLat < -90 || northLat > 90) {
    const error = new Error('Latitude must be between -90 and 90');
    error.status = 400;
    throw error;
  }
  if (centerLng < -180 || centerLng > 180 || westLng < -180 || westLng > 180 || eastLng < -180 || eastLng > 180) {
    const error = new Error('Longitude must be between -180 and 180');
    error.status = 400;
    throw error;
  }
  if (southLat >= northLat) {
    const error = new Error('South latitude must be less than north latitude');
    error.status = 400;
    throw error;
  }
  if (westLng >= eastLng) {
    const error = new Error('West longitude must be less than east longitude');
    error.status = 400;
    throw error;
  }

  return {
    areaKey,
    label,
    countryCode: String(body.countryCode || 'ZW').trim().toUpperCase().slice(0, 2) || 'ZW',
    centerLat,
    centerLng,
    westLng,
    southLat,
    eastLng,
    northLat,
    isActive: body.isActive === false ? 0 : 1,
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
  };
}

function shapeArea(row) {
  return {
    id: row.id,
    areaKey: row.area_key,
    label: row.label,
    countryCode: row.country_code || 'ZW',
    centerLat: Number(row.center_lat),
    centerLng: Number(row.center_lng),
    westLng: Number(row.west_lng),
    southLat: Number(row.south_lat),
    eastLng: Number(row.east_lng),
    northLat: Number(row.north_lat),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

router.get('/', requireAdminAuth, requirePermission('pricing.read'), async (_req, res) => {
  try {
    const rows = await query(
      `SELECT *
       FROM service_areas
       ORDER BY sort_order ASC, label ASC, id ASC`
    );
    return res.json({ areas: rows.map(shapeArea) });
  } catch (err) {
    console.error('GET /api/admin/service-areas', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', requireAdminAuth, requirePermission('pricing.manage'), async (req, res) => {
  try {
    const area = normalizeAreaPayload(req.body || {});
    await query(
      `INSERT INTO service_areas (
        area_key, label, country_code, center_lat, center_lng,
        west_lng, south_lat, east_lng, north_lat, is_active, sort_order,
        created_by_admin_id, updated_by_admin_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        area.areaKey,
        area.label,
        area.countryCode,
        area.centerLat,
        area.centerLng,
        area.westLng,
        area.southLat,
        area.eastLng,
        area.northLat,
        area.isActive,
        area.sortOrder,
        req.admin?.id || null,
        req.admin?.id || null,
      ]
    );
    clearServiceAreaCache();
    return res.status(201).json({ ok: true });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That area key already exists' });
    console.error('POST /api/admin/service-areas', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id', requireAdminAuth, requirePermission('pricing.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid area id' });
    const area = normalizeAreaPayload(req.body || {});
    await query(
      `UPDATE service_areas
       SET area_key = ?,
           label = ?,
           country_code = ?,
           center_lat = ?,
           center_lng = ?,
           west_lng = ?,
           south_lat = ?,
           east_lng = ?,
           north_lat = ?,
           is_active = ?,
           sort_order = ?,
           updated_by_admin_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        area.areaKey,
        area.label,
        area.countryCode,
        area.centerLat,
        area.centerLng,
        area.westLng,
        area.southLat,
        area.eastLng,
        area.northLat,
        area.isActive,
        area.sortOrder,
        req.admin?.id || null,
        id,
      ]
    );
    clearServiceAreaCache();
    return res.json({ ok: true });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That area key already exists' });
    console.error('PATCH /api/admin/service-areas/:id', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', requireAdminAuth, requirePermission('pricing.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid area id' });
    await query('DELETE FROM service_areas WHERE id = ?', [id]);
    clearServiceAreaCache();
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/service-areas/:id', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
