/**
 * Driver identity and vehicle verification stored in MySQL.
 * Single source of truth for profile/vehicle docs and status (replaces Clerk for this data).
 */
import { query } from '../db/connection.js';

export function normalizeUploadPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/\\/g, '/');
  if (normalized.startsWith('/uploads/')) return normalized;

  try {
    const parsed = new URL(normalized);
    if (parsed.pathname.startsWith('/uploads/')) return parsed.pathname;
    return normalized;
  } catch {
    if (normalized.startsWith('uploads/')) return `/${normalized}`;

    const uploadsIndex = normalized.toLowerCase().lastIndexOf('/uploads/');
    if (uploadsIndex >= 0) {
      return normalized.slice(uploadsIndex);
    }

    return normalized;
  }
}

export async function getDriverIdentity(driverUserId) {
  const [row] = await query(
    `SELECT *
     FROM driver_identity
     WHERE driver_user_id = ?
     LIMIT 1`,
    [driverUserId]
  );
  return row || null;
}

export async function getDriverVehicle(driverUserId) {
  const [row] = await query(
    `SELECT *
     FROM driver_vehicle
     WHERE driver_user_id = ?
     LIMIT 1`,
    [driverUserId]
  );
  return row || null;
}

/**
 * Returns driverProfile and vehicle in the same shape as Clerk getDriverMetadata for API responses.
 */
function shapeProfileFromRow(row) {
  if (!row) return null;
  return {
    id: `profile_${row.driver_user_id}`,
    status: row.profile_status || 'pending',
    submittedAt: row.profile_submitted_at ? new Date(row.profile_submitted_at).toISOString() : null,
    rejectionReason: row.profile_rejection_reason || null,
    canResubmit: row.profile_can_resubmit === undefined ? true : !!row.profile_can_resubmit,
    nationalIdFrontUrl: normalizeUploadPath(row.national_id_front_url),
    nationalIdBackUrl: normalizeUploadPath(row.national_id_back_url),
    driverLicenceUrl: normalizeUploadPath(row.driver_licence_url),
    selfieUrl: normalizeUploadPath(row.selfie_url),
    selfieWithIdCardUrl: normalizeUploadPath(row.selfie_with_id_card_url),
    ecocashNumber: row.ecocash_number || null,
    ecocashRegisteredName: row.ecocash_registered_name || null,
  };
}

function shapeVehicleFromRow(row) {
  if (!row) return null;
  let carPhotoUrls = [];
  try {
    if (row.car_photo_urls) carPhotoUrls = JSON.parse(row.car_photo_urls);
  } catch (_) {}
  if (!Array.isArray(carPhotoUrls)) carPhotoUrls = [];
  const normalizedCarPhotoUrls = carPhotoUrls.map((item) => normalizeUploadPath(item)).filter(Boolean);
  return {
    id: `vehicle_${row.driver_user_id}`,
    status: row.vehicle_status || 'pending',
    submittedAt: row.vehicle_submitted_at ? new Date(row.vehicle_submitted_at).toISOString() : null,
    rejectionReason: row.vehicle_rejection_reason || null,
    canResubmit: row.vehicle_can_resubmit === undefined ? true : !!row.vehicle_can_resubmit,
    carPhotoFrontUrl: normalizeUploadPath(row.car_photo_front_url) || normalizedCarPhotoUrls[0] || null,
    carPhotoRearUrl: normalizeUploadPath(row.car_photo_rear_url) || normalizedCarPhotoUrls[1] || null,
    carPhotoUrls: normalizedCarPhotoUrls,
    vehicleRegistrationUrl: normalizeUploadPath(row.vehicle_registration_url),
    vehicleRegistrationBookUrl: normalizeUploadPath(row.vehicle_registration_book_url),
    insuranceUrl: normalizeUploadPath(row.insurance_url),
    zinaraUrl: normalizeUploadPath(row.zinara_url),
    numberPlate: row.number_plate || null,
    make: row.make || null,
    model: row.model || null,
    year: row.year ?? null,
    color: row.color || null,
    vehicleTierKey: row.vehicle_tier_key || null,
    vehicleTierName: row.vehicle_tier_name || null,
    seatCount: row.seat_count ?? null,
    doorCount: row.door_count ?? null,
    vehicleCategory: row.vehicle_category || null,
    hasAirConditioning: !!row.has_air_conditioning,
    hasChargingPorts: !!row.has_charging_ports,
    hasWifi: !!row.has_wifi,
    hasLeatherSeats: !!row.has_leather_seats,
    hasLargeLuggageSpace: !!row.has_large_luggage_space,
    hasSlidingDoors: !!row.has_sliding_doors,
    isHighEnd: !!row.is_high_end,
  };
}

/**
 * Build metadata for GET /api/drivers/me and app consumption.
 * Uses MySQL as source of truth; pass clerkUser only for pushToken (and optional fallback).
 */
export async function getDriverVerificationFromMysql(driverUserId, clerkUser = null) {
  const [identity, vehicle] = await Promise.all([
    getDriverIdentity(driverUserId),
    getDriverVehicle(driverUserId),
  ]);

  const phoneVerified = !!identity?.phone_verified_at;
  const driverProfile = shapeProfileFromRow(identity);
  const vehicleShaped = shapeVehicleFromRow(vehicle);

  return {
    phoneVerified,
    driverProfile,
    vehicle: vehicleShaped,
    pushToken: clerkUser?.privateMetadata?.pushToken || null,
  };
}
