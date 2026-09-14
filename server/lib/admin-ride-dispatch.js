import crypto from 'crypto';
import { query } from '../db/connection.js';
import { getClerkClient } from './clerk-client.js';
import { toAppUser } from './clerk-user.js';
import { fetchCachedDirections } from './maps-directions.js';
import { fetchCachedPlaceAutocomplete, fetchCachedPlaceDetails } from './maps-places.js';
import { normalizePaymentMethod } from './payment-method.js';
import { normalizeZimbabwePhoneNumber } from './phone-number.js';
import { getTierMaxPassengerCount, parseRequiredPassengerCount } from './ride-passenger-count.js';
import { sanitizeIntermediateStops, stringifyIntermediateStops } from './ride-stops.js';
import { isCoordinateInBulawayoServiceArea, BULAWAYO_CENTER_COORDINATE } from './service-area.js';
import { emitRideRequestToDriver } from './realtime.js';
import {
  calculateTierFare,
  createPendingDriverOffers,
  createPublicRideId,
  getUserProfileImageUrl,
  loadEligibleDriversForRide,
  loadPassengerTier,
  notifyDriversAboutRideRequest,
} from '../routes/rides.js';

function toCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function calculateTierFarePreview(tier, distanceKm) {
  return calculateTierFare(tier, distanceKm);
}

export async function listDispatchRideOptions() {
  const tiers = await query(
    `SELECT
       t.tier_key,
       t.tier_name,
       t.price_per_km,
       t.base_fare,
       t.per_minute_rate,
       t.minimum_fare
     FROM operating_region_pricing_tiers t
     INNER JOIN operating_regions r ON r.id = t.region_id
     WHERE t.is_active = 1 AND r.is_active = 1
     ORDER BY t.sort_order ASC, t.id ASC`
  );

  return {
    defaultPaymentMethod: 'cash',
    centerCoordinate: BULAWAYO_CENTER_COORDINATE,
    tiers: tiers.map((row) => ({
      tierKey: row.tier_key,
      tierName: row.tier_name,
      pricePerKm: Number(row.price_per_km || 0),
      baseFare: Number(row.base_fare || 0),
      perMinuteRate: Number(row.per_minute_rate || 0),
      minimumFare: Number(row.minimum_fare || 0),
      maxPassengerCount: getTierMaxPassengerCount(row.tier_key, row.tier_name),
    })),
  };
}

export async function searchDispatchPlaces(queryText, originCoordinate) {
  const result = await fetchCachedPlaceAutocomplete({
    query: String(queryText || '').trim(),
    originCoordinate: toCoordinate(originCoordinate) || BULAWAYO_CENTER_COORDINATE,
  });
  return Array.isArray(result?.suggestions) ? result.suggestions : [];
}

export async function loadDispatchPlaceDetails(placeId) {
  const result = await fetchCachedPlaceDetails({ placeId: String(placeId || '').trim() });
  return result?.place || null;
}

export async function lookupDispatchPassenger(phoneValue) {
  const phone = normalizeZimbabwePhoneNumber(phoneValue);
  if (!phone.ok) {
    const error = new Error(phone.error);
    error.status = 400;
    throw error;
  }

  let mysqlUser = null
  try {
    const rows = await query(
      `SELECT clerk_user_id, first_name, last_name, phone_number, email
       FROM users
       WHERE phone_number IN (?, ?, ?)
       ORDER BY updated_at DESC
       LIMIT 1`,
      [phone.localPhone, phone.e164Phone, phone.e164Phone.replace('+', '')]
    )
    mysqlUser = rows[0] || null
  } catch {
    try {
      const rows = await query(
        `SELECT clerk_user_id, phone_number, email
         FROM users
         WHERE phone_number IN (?, ?)
         LIMIT 1`,
        [phone.localPhone, phone.e164Phone]
      )
      mysqlUser = rows[0] || null
    } catch {
      mysqlUser = null
    }
  };

  let clerkUser = null;
  try {
    const clerkClient = getClerkClient();
    const list = await clerkClient.users.getUserList({ phoneNumber: [phone.e164Phone], limit: 5 });
    clerkUser = list?.data?.[0] || null;
  } catch {
    clerkUser = null;
  }

  const appUser = clerkUser ? toAppUser(clerkUser) : null;
  const fullName = [
    appUser?.first_name || mysqlUser?.first_name,
    appUser?.last_name || mysqlUser?.last_name,
  ].filter(Boolean).join(' ').trim();

  if (!fullName && !mysqlUser && !appUser) {
    return {
      found: false,
      localPhone: phone.localPhone,
      e164Phone: phone.e164Phone,
      name: '',
      passengerUserId: null,
    };
  }

  return {
    found: true,
    localPhone: phone.localPhone,
    e164Phone: phone.e164Phone,
    name: fullName || 'Passenger',
    passengerUserId: appUser?.clerk_user_id || mysqlUser?.clerk_user_id || null,
    email: appUser?.email || mysqlUser?.email || null,
  };
}

async function buildDispatchQuote({
  pickupCoordinate,
  dropoffCoordinate,
  pickupLabel,
  dropoffLabel,
  intermediateStops = [],
  selectedTierKey,
  passengerCount,
  paymentMethod: paymentMethodRaw,
}) {
  const pickupPoint = toCoordinate(pickupCoordinate);
  const dropoffPoint = toCoordinate(dropoffCoordinate);
  const normalizedIntermediateStops = sanitizeIntermediateStops(intermediateStops);
  const tier = await loadPassengerTier(selectedTierKey);
  const paymentMethod = normalizePaymentMethod(paymentMethodRaw) || 'cash';

  if (!String(pickupLabel || '').trim() || !String(dropoffLabel || '').trim() || !tier) {
    const error = new Error('Pickup, drop-off, and a ride type are required');
    error.status = 400;
    throw error;
  }
  if (!pickupPoint || !dropoffPoint) {
    const error = new Error('Valid pickup and drop-off coordinates are required');
    error.status = 400;
    throw error;
  }
  if (!isCoordinateInBulawayoServiceArea(pickupPoint) || !isCoordinateInBulawayoServiceArea(dropoffPoint)) {
    const error = new Error('Trust Express currently supports rides within Bulawayo only.');
    error.status = 422;
    throw error;
  }
  if (normalizedIntermediateStops.some((stop) => !isCoordinateInBulawayoServiceArea(stop.coordinate))) {
    const error = new Error('All stops must be inside Bulawayo.');
    error.status = 422;
    throw error;
  }

  const maxPassengerCount = getTierMaxPassengerCount(tier.tier_key, tier.tier_name);
  const partySize = parseRequiredPassengerCount(passengerCount, maxPassengerCount);
  if (!partySize) {
    const error = new Error(`Confirm how many people are riding. This ${tier.tier_name} fits up to ${maxPassengerCount}.`);
    error.status = 400;
    throw error;
  }
  if (!paymentMethod) {
    const error = new Error('Choose cash or pay online');
    error.status = 400;
    throw error;
  }

  let authoritativeRoute = null;
  try {
    authoritativeRoute = await fetchCachedDirections({
      origin: pickupPoint,
      destination: dropoffPoint,
      waypoints: normalizedIntermediateStops.map((stop) => stop.coordinate),
      cacheTtlSeconds: 1800,
    });
  } catch (routeError) {
    const error = new Error('Could not calculate the road distance for this trip. Please try again.');
    error.status = 422;
    error.cause = routeError;
    throw error;
  }

  const distanceKm = Number(authoritativeRoute?.distanceKm || 0);
  const durationMinutes = Number(authoritativeRoute?.durationMinutes || 0);
  if (distanceKm <= 0 || !Number.isFinite(distanceKm)) {
    const error = new Error('Could not calculate the road distance for this trip. Please try again.');
    error.status = 422;
    throw error;
  }

  const estimatedAmount = calculateTierFarePreview(tier, distanceKm);
  return {
    pickupPoint,
    dropoffPoint,
    pickupLabel: String(pickupLabel).trim(),
    dropoffLabel: String(dropoffLabel).trim(),
    normalizedIntermediateStops,
    tier,
    partySize,
    paymentMethod,
    authoritativeRoute,
    distanceKm,
    durationMinutes,
    estimatedAmount,
  };
}

export async function quoteDispatchRide(payload) {
  const quote = await buildDispatchQuote(payload);
  return {
    pickupLabel: quote.pickupLabel,
    dropoffLabel: quote.dropoffLabel,
    distanceKm: quote.distanceKm,
    durationMinutes: quote.durationMinutes,
    estimatedAmount: quote.estimatedAmount,
    tierKey: quote.tier.tier_key,
    tierName: quote.tier.tier_name,
    passengerCount: quote.partySize,
    paymentMethod: quote.paymentMethod,
  };
}

async function insertDispatchedRide({
  publicId,
  passengerUserId,
  passengerName,
  passengerPhone,
  quote,
  adminUserId,
}) {
  const values = [
    publicId,
    passengerUserId,
    passengerName,
    passengerPhone,
    quote.partySize,
    quote.tier.tier_key,
    quote.tier.tier_name,
    quote.pickupLabel,
    quote.pickupPoint.latitude,
    quote.pickupPoint.longitude,
    quote.dropoffLabel,
    quote.dropoffPoint.latitude,
    quote.dropoffPoint.longitude,
    stringifyIntermediateStops(quote.normalizedIntermediateStops),
    0,
    String(quote.authoritativeRoute?.polyline || '').trim() || null,
    quote.distanceKm,
    quote.durationMinutes,
    quote.distanceKm,
    quote.durationMinutes,
    quote.estimatedAmount,
    quote.estimatedAmount,
    0,
    quote.estimatedAmount,
    0,
    quote.paymentMethod,
    'admin_dispatch',
    adminUserId || null,
  ];

  try {
    return await query(
      `INSERT INTO ride_requests (
        public_id,
        passenger_user_id,
        passenger_name,
        passenger_phone,
        passenger_count,
        requested_tier_key,
        requested_tier_name,
        pickup_label,
        pickup_lat,
        pickup_lng,
        dropoff_label,
        dropoff_lat,
        dropoff_lng,
        intermediate_stops_json,
        current_stop_index,
        route_polyline,
        route_distance_km,
        route_duration_minutes,
        estimated_distance_km,
        estimated_minutes,
        estimated_amount,
        original_estimated_amount,
        discount_amount,
        final_estimated_amount,
        driver_reimbursement_amount,
        payment_method,
        booking_source,
        dispatched_by_admin_id,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested')`,
      values
    );
  } catch (error) {
    if (!String(error?.message || error?.sqlMessage || '').includes('booking_source')) {
      throw error;
    }
    return query(
      `INSERT INTO ride_requests (
        public_id,
        passenger_user_id,
        passenger_name,
        passenger_phone,
        passenger_count,
        requested_tier_key,
        requested_tier_name,
        pickup_label,
        pickup_lat,
        pickup_lng,
        dropoff_label,
        dropoff_lat,
        dropoff_lng,
        intermediate_stops_json,
        current_stop_index,
        route_polyline,
        route_distance_km,
        route_duration_minutes,
        estimated_distance_km,
        estimated_minutes,
        estimated_amount,
        original_estimated_amount,
        discount_amount,
        final_estimated_amount,
        driver_reimbursement_amount,
        payment_method,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested')`,
      values.slice(0, -2)
    );
  }
}

export async function createDispatchRide({
  passengerName,
  passengerPhone,
  pickupCoordinate,
  dropoffCoordinate,
  pickupLabel,
  dropoffLabel,
  intermediateStops,
  selectedTierKey,
  passengerCount,
  paymentMethod,
  adminUserId,
}) {
  const phone = normalizeZimbabwePhoneNumber(passengerPhone);
  if (!phone.ok) {
    const error = new Error(phone.error);
    error.status = 400;
    throw error;
  }

  const name = String(passengerName || '').trim();
  if (!name) {
    const error = new Error('Enter the passenger\'s name so the driver knows who to pick up.');
    error.status = 400;
    throw error;
  }

  const quote = await buildDispatchQuote({
    pickupCoordinate,
    dropoffCoordinate,
    pickupLabel,
    dropoffLabel,
    intermediateStops,
    selectedTierKey,
    passengerCount,
    paymentMethod,
  });

  const publicId = createPublicRideId();
  const passengerUserId = `dispatch:${crypto.randomUUID()}`;
  const result = await insertDispatchedRide({
    publicId,
    passengerUserId,
    passengerName: name,
    passengerPhone: phone.localPhone,
    quote,
    adminUserId,
  });
  const rideRequestId = result.insertId;

  const nearbyDriversBase = await loadEligibleDriversForRide({
    pickupPoint: quote.pickupPoint,
    estimatedAmount: quote.estimatedAmount,
    tierKey: quote.tier.tier_key,
  });
  const nearbyDrivers = await Promise.all(
    nearbyDriversBase.map(async (driver) => ({
      ...driver,
      amount: quote.estimatedAmount,
      profileImageUrl: await getUserProfileImageUrl(driver.id),
    }))
  );

  await createPendingDriverOffers(rideRequestId, nearbyDrivers);
  await notifyDriversAboutRideRequest({
    drivers: nearbyDrivers,
    passengerName: name,
    pickupLabel: quote.pickupLabel,
    dropoffLabel: quote.dropoffLabel,
    intermediateStops: quote.normalizedIntermediateStops,
    rideRequestId,
    publicId,
    tierName: quote.tier.tier_name,
    passengerCount: quote.partySize,
  });

  nearbyDrivers.forEach((driver) => {
    emitRideRequestToDriver(driver.id, {
      rideRequestId,
      publicId,
      passengerUserId,
      passengerName: name,
      passengerPhone: phone.localPhone,
      pickupLabel: quote.pickupLabel,
      dropoffLabel: quote.dropoffLabel,
      requestedTierKey: quote.tier.tier_key,
      requestedTierName: quote.tier.tier_name,
      passengerCount: quote.partySize,
      paymentMethod: quote.paymentMethod,
    });
  });

  return {
    rideRequest: {
      id: rideRequestId,
      publicId,
      status: 'requested',
      bookingSource: 'admin_dispatch',
      passengerName: name,
      passengerPhone: phone.localPhone,
      pickupLabel: quote.pickupLabel,
      dropoffLabel: quote.dropoffLabel,
      estimatedDistanceKm: quote.distanceKm,
      estimatedMinutes: quote.durationMinutes,
      estimatedAmount: quote.estimatedAmount,
      requestedTierKey: quote.tier.tier_key,
      requestedTierName: quote.tier.tier_name,
      passengerCount: quote.partySize,
      paymentMethod: quote.paymentMethod,
      nearbyDriverCount: nearbyDrivers.length,
    },
  };
}
