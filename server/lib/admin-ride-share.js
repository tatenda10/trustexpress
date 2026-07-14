import crypto from 'crypto';
import { query } from '../db/connection.js';
import { buildRideStopsPayload } from './ride-stops.js';

const ACTIVE_RIDE_STATUSES = ['driver_assigned', 'driver_arrived', 'in_progress'];
const DEFAULT_SHARE_TTL_HOURS = 6;

function getPublicBaseUrl(req) {
  const configured = String(
    process.env.PUBLIC_WEB_BASE_URL ||
      process.env.PUBLIC_BASE_URL ||
      process.env.API_PUBLIC_BASE_URL ||
      '',
  ).trim().replace(/\/+$/, '');
  if (configured) return configured;

  const host = String(req?.get?.('host') || '').trim();
  if (!host) return 'https://ridehailcarsserver.online';
  const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'https').split(',')[0].trim();
  return `${proto}://${host}`.replace(/\/+$/, '');
}

export function buildAdminSharePageUrl(token, req) {
  return `${getPublicBaseUrl(req)}/admin/share/${encodeURIComponent(token)}`;
}

export function createAdminShareToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function mapStage(status) {
  if (status === 'in_progress') return 'In progress';
  if (status === 'driver_arrived') return 'Driver waiting at pickup';
  if (status === 'driver_assigned') return 'Driver on the way';
  if (status === 'completed') return 'Trip completed';
  if (status === 'cancelled') return 'Trip cancelled';
  return String(status || 'Unknown');
}

function toCoord(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { lat: latitude, lng: longitude };
}

async function loadRideShareSnapshot(rideRequestId) {
  const [row] = await query(
    `SELECT
       rr.id,
       rr.public_id,
       rr.passenger_name,
       rr.passenger_phone,
       rr.driver_user_id,
       rr.driver_name,
       rr.driver_phone,
       rr.requested_tier_name,
       rr.pickup_label,
       rr.dropoff_label,
       rr.intermediate_stops_json,
       rr.current_stop_index,
       rr.pickup_lat,
       rr.pickup_lng,
       rr.dropoff_lat,
       rr.dropoff_lng,
       rr.route_polyline,
       rr.status,
       rr.assigned_at,
       rr.arrived_at,
       rr.started_at,
       rr.completed_at,
       rr.cancelled_at,
       da.current_lat AS driver_current_lat,
       da.current_lng AS driver_current_lng,
       da.last_seen_at AS driver_last_seen_at,
       da.phone_number AS availability_phone,
       da.vehicle_make,
       da.vehicle_model,
       da.number_plate AS availability_plate,
       dv.make AS vehicle_make_db,
       dv.model AS vehicle_model_db,
       dv.color AS vehicle_color,
       dv.number_plate AS vehicle_plate_db
     FROM ride_requests rr
     LEFT JOIN driver_availability da ON da.driver_user_id = rr.driver_user_id
     LEFT JOIN driver_vehicle dv ON dv.driver_user_id = rr.driver_user_id
     WHERE rr.id = ?
     LIMIT 1`,
    [rideRequestId],
  );

  if (!row) return null;

  const stops = buildRideStopsPayload(row);
  const driverCoordinate = toCoord(row.driver_current_lat, row.driver_current_lng);
  const pickupCoordinate = toCoord(row.pickup_lat, row.pickup_lng);
  const dropoffCoordinate = toCoord(row.dropoff_lat, row.dropoff_lng);
  const vehicleMake = row.vehicle_make || row.vehicle_make_db || null;
  const vehicleModel = row.vehicle_model || row.vehicle_model_db || null;
  const numberPlate = row.availability_plate || row.vehicle_plate_db || null;

  return {
    rideRequestId: Number(row.id),
    publicId: row.public_id || null,
    status: row.status,
    stage: mapStage(row.status),
    isLive: ACTIVE_RIDE_STATUSES.includes(String(row.status || '')),
    passengerName: row.passenger_name || 'Passenger',
    passengerPhone: row.passenger_phone || null,
    driverName: row.driver_name || 'Driver',
    driverPhone: row.driver_phone || row.availability_phone || null,
    tierName: row.requested_tier_name || null,
    vehicle: {
      make: vehicleMake,
      model: vehicleModel,
      color: row.vehicle_color || null,
      numberPlate,
      label: [vehicleMake, vehicleModel, numberPlate].filter(Boolean).join(' ') || null,
    },
    pickupLabel: row.pickup_label || null,
    dropoffLabel: row.dropoff_label || null,
    currentTargetLabel: stops.currentTargetLabel || row.dropoff_label || null,
    intermediateStops: stops.intermediateStops || [],
    currentStopIndex: Number(stops.currentStopIndex || 0),
    driverCoordinate,
    pickupCoordinate,
    dropoffCoordinate,
    currentTargetCoordinate: (() => {
      const target = stops.currentTargetCoordinate;
      if (!target) return null;
      return toCoord(target.latitude, target.longitude);
    })(),
    driverLastSeenAt: row.driver_last_seen_at || null,
    assignedAt: row.assigned_at || null,
    arrivedAt: row.arrived_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    cancelledAt: row.cancelled_at || null,
    refreshedAt: new Date().toISOString(),
  };
}

export async function resolveRideForAdminShare(rideId) {
  const raw = String(rideId || '').trim();
  if (!raw) return null;
  const [row] = await query(
    `SELECT id, public_id, status, driver_user_id
     FROM ride_requests
     WHERE public_id = ? OR id = ?
     LIMIT 1`,
    [raw, Number(raw) || -1],
  );
  return row || null;
}

export async function getActiveAdminShareLink(rideRequestId) {
  const [row] = await query(
    `SELECT *
     FROM admin_ride_share_links
     WHERE ride_request_id = ?
       AND revoked_at IS NULL
       AND        expires_at > NOW()
     ORDER BY id DESC
     LIMIT 1`,
    [rideRequestId],
  );
  return row || null;
}

export async function createOrRefreshAdminShareLink({
  ride,
  adminId = null,
  adminEmail = null,
  recipientNote = null,
  ttlHours = DEFAULT_SHARE_TTL_HOURS,
  req = null,
}) {
  const existing = await getActiveAdminShareLink(ride.id);
  if (existing) {
    return {
      link: existing,
      token: existing.token,
      url: buildAdminSharePageUrl(existing.token, req),
      created: false,
    };
  }

  const token = createAdminShareToken();
  const hours = Math.max(1, Math.min(Number(ttlHours) || DEFAULT_SHARE_TTL_HOURS, 24));
  const insert = await query(
    `INSERT INTO admin_ride_share_links (
       ride_request_id,
       ride_public_id,
       token,
       scope,
       created_by_admin_id,
       created_by_admin_email,
       recipient_note,
       expires_at
     ) VALUES (?, ?, ?, 'authority', ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [
      ride.id,
      ride.public_id || null,
      token,
      adminId || null,
      adminEmail || null,
      recipientNote ? String(recipientNote).trim().slice(0, 255) : null,
      hours,
    ],
  );

  const [link] = await query(
    `SELECT * FROM admin_ride_share_links WHERE id = ? LIMIT 1`,
    [Number(insert?.insertId || 0)],
  );

  return {
    link,
    token,
    url: buildAdminSharePageUrl(token, req),
    created: true,
  };
}

export async function revokeAdminShareLinks(rideRequestId) {
  await query(
    `UPDATE admin_ride_share_links
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE ride_request_id = ?
       AND revoked_at IS NULL`,
    [rideRequestId],
  );
}

export async function getAuthorityShareSnapshotByToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized) {
    return { ok: false, status: 400, error: 'Share token required' };
  }

  const [link] = await query(
    `SELECT *
     FROM admin_ride_share_links
     WHERE token = ?
     LIMIT 1`,
    [normalized],
  );

  if (!link) {
    return { ok: false, status: 404, error: 'Share link not found' };
  }
  if (link.revoked_at) {
    return { ok: false, status: 410, error: 'This share link has been revoked' };
  }
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 410, error: 'This share link has expired' };
  }

  const trip = await loadRideShareSnapshot(link.ride_request_id);
  if (!trip) {
    return { ok: false, status: 404, error: 'Ride not found for this share link' };
  }

  await query(
    `UPDATE admin_ride_share_links
     SET last_viewed_at = CURRENT_TIMESTAMP, view_count = view_count + 1
     WHERE id = ?`,
    [link.id],
  );

  return {
    ok: true,
    status: 200,
    data: {
      scope: 'authority',
      recipientNote: link.recipient_note || null,
      expiresAt: link.expires_at,
      sharedAt: link.created_at,
      trip,
    },
  };
}

export function serializeAdminShareLink(link, req) {
  if (!link) return null;
  return {
    id: Number(link.id),
    rideRequestId: Number(link.ride_request_id),
    ridePublicId: link.ride_public_id || null,
    token: link.token,
    url: buildAdminSharePageUrl(link.token, req),
    scope: link.scope || 'authority',
    recipientNote: link.recipient_note || null,
    expiresAt: link.expires_at,
    revokedAt: link.revoked_at || null,
    lastViewedAt: link.last_viewed_at || null,
    viewCount: Number(link.view_count || 0),
    createdAt: link.created_at,
    createdByAdminEmail: link.created_by_admin_email || null,
  };
}
