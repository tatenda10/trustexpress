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
    nationalIdNumber: row.national_id_number || null,
    driverLicenceNumber: row.driver_licence_number || null,
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
    numberPlate: row.number_plate ? String(row.number_plate).trim().toUpperCase() : null,
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

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function shapeProfileFromLegacyMetadata(profileMeta = {}) {
  if (!profileMeta || typeof profileMeta !== 'object') return null;
  const status = String(profileMeta.status || '').trim().toLowerCase();
  const hasAnyDoc = !!(
    profileMeta.nationalIdFrontUrl ||
    profileMeta.nationalIdBackUrl ||
    profileMeta.driverLicenceUrl ||
    profileMeta.selfieUrl ||
    profileMeta.selfieWithIdCardUrl
  );
  if (!status && !hasAnyDoc) return null;

  return {
    id: profileMeta.id || null,
    status: status || 'pending',
    submittedAt: toIsoOrNull(profileMeta.submittedAt),
    rejectionReason: profileMeta.rejectionReason || null,
    canResubmit: profileMeta.canResubmit === undefined ? true : !!profileMeta.canResubmit,
    nationalIdFrontUrl: normalizeUploadPath(profileMeta.nationalIdFrontUrl),
    nationalIdBackUrl: normalizeUploadPath(profileMeta.nationalIdBackUrl),
    driverLicenceUrl: normalizeUploadPath(profileMeta.driverLicenceUrl),
    selfieUrl: normalizeUploadPath(profileMeta.selfieUrl),
    selfieWithIdCardUrl: normalizeUploadPath(profileMeta.selfieWithIdCardUrl),
    nationalIdNumber: profileMeta.nationalIdNumber || null,
    driverLicenceNumber: profileMeta.driverLicenceNumber || null,
    ecocashNumber: profileMeta.ecocashNumber || null,
    ecocashRegisteredName: profileMeta.ecocashRegisteredName || null,
  };
}

function shapeVehicleFromLegacyMetadata(vehicleMeta = {}) {
  if (!vehicleMeta || typeof vehicleMeta !== 'object') return null;
  const status = String(vehicleMeta.status || '').trim().toLowerCase();
  const hasAnyVehicleData = !!(
    vehicleMeta.carPhotoFrontUrl ||
    vehicleMeta.carPhotoRearUrl ||
    (Array.isArray(vehicleMeta.carPhotoUrls) && vehicleMeta.carPhotoUrls.length > 0) ||
    vehicleMeta.numberPlate ||
    vehicleMeta.make ||
    vehicleMeta.model
  );
  if (!status && !hasAnyVehicleData) return null;

  const normalizedCarPhotoUrls = (Array.isArray(vehicleMeta.carPhotoUrls) ? vehicleMeta.carPhotoUrls : [])
    .map((item) => normalizeUploadPath(item))
    .filter(Boolean);

  return {
    id: vehicleMeta.id || null,
    status: status || 'pending',
    submittedAt: toIsoOrNull(vehicleMeta.submittedAt),
    rejectionReason: vehicleMeta.rejectionReason || null,
    canResubmit: vehicleMeta.canResubmit === undefined ? true : !!vehicleMeta.canResubmit,
    carPhotoFrontUrl: normalizeUploadPath(vehicleMeta.carPhotoFrontUrl) || normalizedCarPhotoUrls[0] || null,
    carPhotoRearUrl: normalizeUploadPath(vehicleMeta.carPhotoRearUrl) || normalizedCarPhotoUrls[1] || null,
    carPhotoUrls: normalizedCarPhotoUrls,
    vehicleRegistrationUrl: normalizeUploadPath(vehicleMeta.vehicleRegistrationUrl),
    vehicleRegistrationBookUrl: normalizeUploadPath(vehicleMeta.vehicleRegistrationBookUrl),
    insuranceUrl: normalizeUploadPath(vehicleMeta.insuranceUrl),
    zinaraUrl: normalizeUploadPath(vehicleMeta.zinaraUrl),
    numberPlate: vehicleMeta.numberPlate || null,
    make: vehicleMeta.make || null,
    model: vehicleMeta.model || null,
    year: vehicleMeta.year ?? null,
    color: vehicleMeta.color || null,
    vehicleTierKey: vehicleMeta.vehicleTierKey || null,
    vehicleTierName: vehicleMeta.vehicleTierName || null,
    seatCount: vehicleMeta.seatCount ?? null,
    doorCount: vehicleMeta.doorCount ?? null,
    vehicleCategory: vehicleMeta.vehicleCategory || null,
    hasAirConditioning: !!vehicleMeta.hasAirConditioning,
    hasChargingPorts: !!vehicleMeta.hasChargingPorts,
    hasWifi: !!vehicleMeta.hasWifi,
    hasLeatherSeats: !!vehicleMeta.hasLeatherSeats,
    hasLargeLuggageSpace: !!vehicleMeta.hasLargeLuggageSpace,
    hasSlidingDoors: !!vehicleMeta.hasSlidingDoors,
    isHighEnd: !!vehicleMeta.isHighEnd,
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

  const legacyMeta = clerkUser?.privateMetadata || {};
  const phoneVerified = !!identity?.phone_verified_at || !!legacyMeta?.phoneVerifiedAt;
  const driverProfile = shapeProfileFromRow(identity) || shapeProfileFromLegacyMetadata(legacyMeta.driverProfile);
  const vehicleShaped = shapeVehicleFromRow(vehicle) || shapeVehicleFromLegacyMetadata(legacyMeta.vehicle);

  return {
    phoneVerified,
    driverProfile,
    vehicle: vehicleShaped,
    pushToken: clerkUser?.privateMetadata?.pushToken || null,
  };
}
