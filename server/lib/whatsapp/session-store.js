import { query } from '../../db/connection.js';

export async function loadSession(phone) {
  const [row] = await query(
    `SELECT whatsapp_phone, state, payload_json, ride_request_id, status
     FROM whatsapp_sessions
     WHERE whatsapp_phone = ?
     LIMIT 1`,
    [phone]
  );
  if (!row) {
    return {
      phone,
      state: 'idle',
      payload: {},
      rideRequestId: null,
      status: 'active',
    };
  }
  let payload = {};
  try {
    if (!row.payload_json) {
      payload = {};
    } else if (typeof row.payload_json === 'string') {
      payload = JSON.parse(row.payload_json);
    } else if (typeof row.payload_json === 'object') {
      payload = row.payload_json;
    }
  } catch (error) {
    console.warn('[whatsapp.session-store] failed to parse session payload', {
      phone,
      state: row.state || 'idle',
      payloadType: typeof row.payload_json,
      message: error?.message || String(error),
    });
    payload = {};
  }
  return {
    phone: row.whatsapp_phone,
    state: row.state || 'idle',
    payload,
    rideRequestId: row.ride_request_id || null,
    status: row.status || 'active',
  };
}

export async function saveSession(session) {
  await query(
    `INSERT INTO whatsapp_sessions (
       whatsapp_phone, state, payload_json, ride_request_id, status
     ) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       state = VALUES(state),
       payload_json = VALUES(payload_json),
       ride_request_id = VALUES(ride_request_id),
       status = VALUES(status),
       updated_at = CURRENT_TIMESTAMP`,
    [
      session.phone,
      session.state || 'idle',
      JSON.stringify(session.payload || {}),
      session.rideRequestId || null,
      session.status || 'active',
    ]
  );
}

export async function recordWhatsAppRide({ phone, rideRequest, payload }) {
  await query(
    `INSERT INTO whatsapp_ride_requests (
       whatsapp_phone, ride_request_id, public_id, payload_json, status
     ) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       public_id = VALUES(public_id),
       payload_json = VALUES(payload_json),
       status = VALUES(status),
       updated_at = CURRENT_TIMESTAMP`,
    [
      phone,
      rideRequest.id,
      rideRequest.publicId,
      JSON.stringify(payload || {}),
      rideRequest.status || 'requested',
    ]
  );
}

export async function getWhatsAppRideByRideRequestId(rideRequestId) {
  const [row] = await query(
    `SELECT whatsapp_phone, ride_request_id, public_id, payload_json, status
     FROM whatsapp_ride_requests
     WHERE ride_request_id = ?
     LIMIT 1`,
    [rideRequestId]
  );
  if (!row) return null;
  let payload = {};
  try {
    if (!row.payload_json) payload = {};
    else if (typeof row.payload_json === 'string') payload = JSON.parse(row.payload_json);
    else if (typeof row.payload_json === 'object') payload = row.payload_json;
  } catch {
    payload = {};
  }
  return {
    phone: row.whatsapp_phone,
    rideRequestId: row.ride_request_id,
    publicId: row.public_id || null,
    payload,
    status: row.status || null,
  };
}

export async function updateWhatsAppRideStatus(rideRequestId, status, payloadPatch = {}) {
  const existing = await getWhatsAppRideByRideRequestId(rideRequestId);
  if (!existing) return null;
  const nextPayload = { ...(existing.payload || {}), ...(payloadPatch || {}) };
  await query(
    `UPDATE whatsapp_ride_requests
     SET status = ?,
         payload_json = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE ride_request_id = ?`,
    [status, JSON.stringify(nextPayload), rideRequestId]
  );
  return { ...existing, status, payload: nextPayload };
}
