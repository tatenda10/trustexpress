import crypto from 'crypto';
import { normalizeUploadPath } from './driver-verification-mysql.js';

export function createHirePublicId(prefix) {
  return `${prefix}-${crypto.randomInt(100000, 999999)}`;
}

export function parsePhotoUrls(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeUploadPath(item)).filter(Boolean);
  }
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => normalizeUploadPath(item)).filter(Boolean);
  } catch {
    return [];
  }
}

export function shapeHireVehicle(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.public_id,
    driverUserId: row.driver_user_id,
    title: row.title,
    category: row.category,
    make: row.make,
    model: row.model,
    year: row.year == null ? null : Number(row.year),
    color: row.color,
    numberPlate: row.number_plate,
    seatCount: row.seat_count == null ? null : Number(row.seat_count),
    description: row.description,
    dailyRate: row.daily_rate == null ? null : Number(row.daily_rate),
    currency: row.currency || 'USD',
    photoUrls: parsePhotoUrls(row.photo_urls),
    status: row.vehicle_status,
    rejectionReason: row.rejection_reason || null,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

/** Public fleet card for passengers — no plate / internal driver id. */
export function shapeHireFleetVehicle(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.public_id,
    title: row.title,
    category: row.category,
    make: row.make,
    model: row.model,
    year: row.year == null ? null : Number(row.year),
    color: row.color,
    seatCount: row.seat_count == null ? null : Number(row.seat_count),
    description: row.description,
    dailyRate: row.daily_rate == null ? null : Number(row.daily_rate),
    currency: row.currency || 'USD',
    photoUrls: parsePhotoUrls(row.photo_urls),
    driverName: row.driver_name ? String(row.driver_name).trim() || null : null,
  };
}

export function shapeHireRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.public_id,
    passengerUserId: row.passenger_user_id,
    category: row.category || null,
    title: row.title ? String(row.title).trim() : null,
    pickupLabel: row.pickup_label,
    pickupLat: row.pickup_lat == null ? null : Number(row.pickup_lat),
    pickupLng: row.pickup_lng == null ? null : Number(row.pickup_lng),
    dropoffLabel: row.dropoff_label || null,
    dropoffLat: row.dropoff_lat == null ? null : Number(row.dropoff_lat),
    dropoffLng: row.dropoff_lng == null ? null : Number(row.dropoff_lng),
    startAt: row.start_at ? new Date(row.start_at).toISOString() : null,
    endAt: row.end_at ? new Date(row.end_at).toISOString() : null,
    passengerCount: Number(row.passenger_count || 1),
    recommendedFareMin: row.recommended_fare_min == null ? null : Number(row.recommended_fare_min),
    recommendedFareMax: row.recommended_fare_max == null ? null : Number(row.recommended_fare_max),
    passengerOfferAmount: row.passenger_offer_amount == null ? null : Number(row.passenger_offer_amount),
    fareCurrency: row.fare_currency || 'USD',
    notes: row.notes || null,
    preferredHireVehicleId: row.preferred_hire_vehicle_id == null
      ? null
      : Number(row.preferred_hire_vehicle_id),
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    quoteCount: row.quote_count == null ? undefined : Number(row.quote_count),
  };
}

const HIRE_FARE_PROFILES = {
  sedan: { min: 25, max: 45 },
  suv: { min: 35, max: 65 },
  van: { min: 45, max: 80 },
  moving_van: { min: 60, max: 110 },
  pickup: { min: 50, max: 95 },
  truck: { min: 90, max: 180 },
  lorry: { min: 120, max: 240 },
  iveco: { min: 90, max: 170 },
  sprinter: { min: 85, max: 160 },
  hiace: { min: 70, max: 130 },
  caravan: { min: 70, max: 130 },
  bus: { min: 120, max: 260 },
  eighteen_seater_plus: { min: 140, max: 300 },
  other: { min: 45, max: 100 },
};

function roundFare(value) {
  return Math.max(5, Math.round(Number(value || 0) / 5) * 5);
}

export function estimateHireFare({ category, passengerCount = 1, startAt = null, endAt = null } = {}) {
  const profile = HIRE_FARE_PROFILES[String(category || 'other').toLowerCase()] || HIRE_FARE_PROFILES.other;
  const passengers = Number(passengerCount);
  const passengerMultiplier = Number.isFinite(passengers) && passengers > 8
    ? 1 + Math.min((passengers - 8) * 0.025, 0.35)
    : 1;
  const startTime = startAt ? new Date(startAt).getTime() : NaN;
  const endTime = endAt ? new Date(endAt).getTime() : NaN;
  const hours = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime
    ? Math.min(Math.max((endTime - startTime) / 3600000, 1), 24)
    : 1;
  const durationMultiplier = hours > 4 ? 1 + Math.min((hours - 4) * 0.08, 0.8) : 1;
  const min = roundFare(profile.min * passengerMultiplier * durationMultiplier);
  const max = roundFare(profile.max * passengerMultiplier * durationMultiplier);
  return {
    min,
    max: Math.max(max, min + 10),
    currency: 'USD',
  };
}

export function shapeHireQuote(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.public_id,
    hireRequestId: row.hire_request_id,
    driverUserId: row.driver_user_id,
    hireVehicleId: row.hire_vehicle_id,
    amount: Number(row.amount),
    currency: row.currency || 'USD',
    message: row.message || null,
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    vehicle: row.vehicle_title
      ? {
          title: row.vehicle_title,
          category: row.vehicle_category,
          make: row.vehicle_make,
          model: row.vehicle_model,
          photoUrls: parsePhotoUrls(row.vehicle_photo_urls),
        }
      : undefined,
    driverName: row.driver_name || null,
  };
}

export function shapeHireBooking(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.public_id,
    hireRequestId: row.hire_request_id,
    hireQuoteId: row.hire_quote_id,
    hireVehicleId: row.hire_vehicle_id,
    passengerUserId: row.passenger_user_id,
    driverUserId: row.driver_user_id,
    amount: Number(row.amount),
    currency: row.currency || 'USD',
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    request: row.request_public_id
      ? {
          publicId: row.request_public_id,
          pickupLabel: row.pickup_label,
          dropoffLabel: row.dropoff_label,
          startAt: row.start_at ? new Date(row.start_at).toISOString() : null,
        }
      : undefined,
    vehicle: row.vehicle_title
      ? {
          title: row.vehicle_title,
          category: row.vehicle_category,
          photoUrls: parsePhotoUrls(row.vehicle_photo_urls),
        }
      : undefined,
  };
}
