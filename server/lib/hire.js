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

export function shapeHireRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.public_id,
    passengerUserId: row.passenger_user_id,
    category: row.category || null,
    pickupLabel: row.pickup_label,
    pickupLat: row.pickup_lat == null ? null : Number(row.pickup_lat),
    pickupLng: row.pickup_lng == null ? null : Number(row.pickup_lng),
    dropoffLabel: row.dropoff_label || null,
    dropoffLat: row.dropoff_lat == null ? null : Number(row.dropoff_lat),
    dropoffLng: row.dropoff_lng == null ? null : Number(row.dropoff_lng),
    startAt: row.start_at ? new Date(row.start_at).toISOString() : null,
    endAt: row.end_at ? new Date(row.end_at).toISOString() : null,
    passengerCount: Number(row.passenger_count || 1),
    notes: row.notes || null,
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    quoteCount: row.quote_count == null ? undefined : Number(row.quote_count),
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
