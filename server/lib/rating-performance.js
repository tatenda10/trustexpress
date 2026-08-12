import { query } from '../db/connection.js';
import { getClerkUserById, mergePrivateMetadata } from './clerk-user.js';
import { getDriverVehicle } from './driver-verification-mysql.js';
import { evaluateVehicleAgainstTiers, loadVehicleTierRules } from './vehicle-tier-matching.js';
import { sendExpoPushNotifications } from './push.js';

export const RATING_PERFORMANCE = {
  windowSize: 20,
  minSample: 10,
  upgradeAvg: 4.8,
  downgradeAvg: 4.2,
  flagAvg: 3.5,
  clearFlagAvg: 4.0,
};

const RESTRICTED_MESSAGE =
  'Your account is restricted due to recent ratings. Contact support if you need help.';

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shapeVehicleForTierEval(row) {
  if (!row) return null;
  return {
    year: row.year ?? null,
    seatCount: row.seat_count ?? null,
    doorCount: row.door_count ?? null,
    vehicleCategory: row.vehicle_category || null,
    make: row.make || null,
    model: row.model || null,
    hasAirConditioning: !!row.has_air_conditioning,
    hasChargingPorts: !!row.has_charging_ports,
    hasWifi: !!row.has_wifi,
    hasLeatherSeats: !!row.has_leather_seats,
    hasLargeLuggageSpace: !!row.has_large_luggage_space,
    hasSlidingDoors: !!row.has_sliding_doors,
    isHighEnd: !!row.is_high_end,
    vehicleTierKey: row.vehicle_tier_key || null,
    vehicleTierName: row.vehicle_tier_name || null,
  };
}

export function getAccountStatusFromUser(user, role = 'driver') {
  const privateMeta = user?.privateMetadata || {};
  const status = normalizeText(
    role === 'driver' ? privateMeta.driverStatus || 'active' : privateMeta.passengerStatus || 'active'
  ) || 'active';
  return {
    status,
    isBlocked: status === 'blocked',
    isFlagged: status === 'flagged',
    isRestricted: status === 'blocked' || status === 'flagged',
    ratingRestrictionReason: privateMeta.ratingRestrictionReason || null,
  };
}

export function assertAccountNotRestricted(user, role = 'driver') {
  const account = getAccountStatusFromUser(user, role);
  if (!account.isRestricted) return account;

  const error = new Error(
    account.isBlocked
      ? 'Your account has been blocked. Contact support for help.'
      : RESTRICTED_MESSAGE
  );
  error.status = 403;
  error.code = account.isBlocked ? 'ACCOUNT_BLOCKED' : 'ACCOUNT_FLAGGED';
  error.accountStatus = account.status;
  throw error;
}

export async function getRollingStarAverage({ subjectUserId, role, windowSize = RATING_PERFORMANCE.windowSize }) {
  const userId = String(subjectUserId || '').trim();
  if (!userId) {
    return { average: null, sampleSize: 0, ratings: [] };
  }

  const limit = Math.max(1, Number(windowSize) || RATING_PERFORMANCE.windowSize);
  let rows = [];

  if (role === 'passenger') {
    rows = await query(
      `SELECT driver_passenger_rating AS rating, driver_passenger_rated_at AS rated_at
       FROM ride_requests
       WHERE passenger_user_id = ?
         AND driver_passenger_rating IS NOT NULL
       ORDER BY COALESCE(driver_passenger_rated_at, completed_at, requested_at) DESC, id DESC
       LIMIT ${limit}`,
      [userId]
    );
  } else {
    rows = await query(
      `SELECT passenger_driver_rating AS rating, passenger_driver_rated_at AS rated_at
       FROM ride_requests
       WHERE driver_user_id = ?
         AND passenger_driver_rating IS NOT NULL
       ORDER BY COALESCE(passenger_driver_rated_at, completed_at, requested_at) DESC, id DESC
       LIMIT ${limit}`,
      [userId]
    );
  }

  const ratings = (rows || [])
    .map((row) => toNumber(row.rating))
    .filter((value) => value !== null);

  if (!ratings.length) {
    return { average: null, sampleSize: 0, ratings: [] };
  }

  const sum = ratings.reduce((total, value) => total + value, 0);
  return {
    average: Number((sum / ratings.length).toFixed(2)),
    sampleSize: ratings.length,
    ratings,
  };
}

async function recordPerformanceEvent({
  subjectUserId,
  role,
  action,
  avgRating,
  sampleSize,
  fromTier = null,
  toTier = null,
  fromStatus = null,
  toStatus = null,
  details = null,
}) {
  try {
    await query(
      `INSERT INTO rating_performance_events (
         subject_user_id, role, action, avg_rating, sample_size,
         from_tier, to_tier, from_status, to_status, details_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        subjectUserId,
        role,
        action,
        avgRating,
        sampleSize,
        fromTier,
        toTier,
        fromStatus,
        toStatus,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      console.warn('[rating-performance] rating_performance_events table missing; skipping audit write');
      return;
    }
    throw error;
  }
}

export async function listRatingPerformanceEvents(subjectUserId, { limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  try {
    const rows = await query(
      `SELECT id, subject_user_id, role, action, avg_rating, sample_size,
              from_tier, to_tier, from_status, to_status, details_json, created_at
       FROM rating_performance_events
       WHERE subject_user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ${safeLimit}`,
      [subjectUserId]
    );
    return (rows || []).map((row) => ({
      id: row.id,
      subjectUserId: row.subject_user_id,
      role: row.role,
      action: row.action,
      avgRating: row.avg_rating === null ? null : Number(row.avg_rating),
      sampleSize: Number(row.sample_size || 0),
      fromTier: row.from_tier || null,
      toTier: row.to_tier || null,
      fromStatus: row.from_status || null,
      toStatus: row.to_status || null,
      details: (() => {
        try {
          return row.details_json ? JSON.parse(row.details_json) : null;
        } catch {
          return null;
        }
      })(),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    }));
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') return [];
    throw error;
  }
}

async function notifyUser(userId, { title, body, data = {} }) {
  try {
    const user = await getClerkUserById(userId, { skipCache: true });
    const pushToken = user?.privateMetadata?.pushToken;
    if (!pushToken) return;
    await sendExpoPushNotifications({
      to: pushToken,
      title,
      body,
      data: {
        type: 'rating_performance',
        ...data,
      },
    });
  } catch (error) {
    console.error('[rating-performance] push failed', { userId, message: error?.message });
  }
}

async function setAccountStatus(userId, role, nextStatus, reason = null) {
  const patch = role === 'driver'
    ? {
        driverStatus: nextStatus,
        ratingRestrictionReason: reason,
        ratingRestrictionAt: reason ? new Date().toISOString() : null,
      }
    : {
        passengerStatus: nextStatus,
        ratingRestrictionReason: reason,
        ratingRestrictionAt: reason ? new Date().toISOString() : null,
      };

  if (!reason) {
    patch.ratingRestrictionReason = null;
    patch.ratingRestrictionAt = null;
  }

  await mergePrivateMetadata(userId, patch);
}

async function forceDriverOffline(driverUserId) {
  await query(
    `UPDATE driver_availability
     SET is_online = 0, last_seen_at = CURRENT_TIMESTAMP
     WHERE driver_user_id = ?`,
    [driverUserId]
  );
}

async function updateDriverTier(driverUserId, { tierKey, tierName }) {
  await query(
    `UPDATE driver_vehicle
     SET vehicle_tier_key = ?, vehicle_tier_name = ?, updated_at = CURRENT_TIMESTAMP
     WHERE driver_user_id = ?`,
    [tierKey, tierName, driverUserId]
  );
  await query(
    `UPDATE driver_availability
     SET vehicle_tier_key = ?, vehicle_tier_name = ?
     WHERE driver_user_id = ?`,
    [tierKey, tierName, driverUserId]
  );
}

function findAdjacentTier(tiers, currentTierKey, direction) {
  const ordered = [...tiers].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const currentIndex = ordered.findIndex((tier) => normalizeText(tier.tierKey) === normalizeText(currentTierKey));
  if (currentIndex < 0) return null;
  const nextIndex = direction === 'up' ? currentIndex + 1 : currentIndex - 1;
  if (nextIndex < 0 || nextIndex >= ordered.length) return null;
  return ordered[nextIndex];
}

async function applyDriverTierAutomation(driverUserId, { average, sampleSize }) {
  const vehicleRow = await getDriverVehicle(driverUserId);
  if (!vehicleRow) return null;

  const vehicleStatus = normalizeText(vehicleRow.vehicle_status);
  if (vehicleStatus !== 'approved' && vehicleStatus !== 'verified') {
    return null;
  }

  const currentTierKey = vehicleRow.vehicle_tier_key || null;
  const currentTierName = vehicleRow.vehicle_tier_name || null;
  if (!currentTierKey) return null;

  const tiers = await loadVehicleTierRules();
  if (!tiers.length) return null;

  const vehicle = shapeVehicleForTierEval(vehicleRow);
  const assessment = evaluateVehicleAgainstTiers(vehicle, tiers);

  let target = null;
  let action = null;

  if (average < RATING_PERFORMANCE.downgradeAvg) {
    const lower = findAdjacentTier(tiers, currentTierKey, 'down');
    if (lower) {
      target = lower;
      action = 'tier_downgrade';
    }
  } else if (average >= RATING_PERFORMANCE.upgradeAvg) {
    const higher = findAdjacentTier(tiers, currentTierKey, 'up');
    if (higher) {
      const eligible = assessment.evaluations.find(
        (item) => normalizeText(item.tierKey) === normalizeText(higher.tierKey)
      );
      if (eligible?.eligible) {
        target = higher;
        action = 'tier_upgrade';
      }
    }
  }

  if (!target || !action) return null;
  if (normalizeText(target.tierKey) === normalizeText(currentTierKey)) return null;

  await updateDriverTier(driverUserId, {
    tierKey: target.tierKey,
    tierName: target.tierName,
  });

  await recordPerformanceEvent({
    subjectUserId: driverUserId,
    role: 'driver',
    action,
    avgRating: average,
    sampleSize,
    fromTier: currentTierKey,
    toTier: target.tierKey,
    details: {
      fromTierName: currentTierName,
      toTierName: target.tierName,
    },
  });

  await notifyUser(driverUserId, {
    title: action === 'tier_upgrade' ? 'Tier upgraded' : 'Tier updated',
    body: action === 'tier_upgrade'
      ? `Great work — you are now approved for ${target.tierName}.`
      : `Your approved tier is now ${target.tierName} based on recent passenger ratings.`,
    data: {
      action,
      fromTier: currentTierKey,
      toTier: target.tierKey,
    },
  });

  return {
    action,
    fromTier: currentTierKey,
    toTier: target.tierKey,
    toTierName: target.tierName,
  };
}

async function applyAccountAutomation(userId, role, { average, sampleSize }) {
  const user = await getClerkUserById(userId, { skipCache: true });
  const account = getAccountStatusFromUser(user, role);
  if (account.isBlocked) {
    return null;
  }

  if (average < RATING_PERFORMANCE.flagAvg && account.status !== 'flagged') {
    const reason = `Rolling average ${average.toFixed(2)} over last ${sampleSize} ratings fell below ${RATING_PERFORMANCE.flagAvg}.`;
    await setAccountStatus(userId, role, 'flagged', reason);
    if (role === 'driver') {
      await forceDriverOffline(userId);
    }
    await recordPerformanceEvent({
      subjectUserId: userId,
      role,
      action: 'account_flagged',
      avgRating: average,
      sampleSize,
      fromStatus: account.status,
      toStatus: 'flagged',
      details: { reason },
    });
    await notifyUser(userId, {
      title: 'Account under review',
      body: 'Recent ratings are below our standard. Your account is restricted until ratings improve. Contact support if you need help.',
      data: { action: 'account_flagged' },
    });
    return { action: 'account_flagged', fromStatus: account.status, toStatus: 'flagged' };
  }

  if (
    average >= RATING_PERFORMANCE.clearFlagAvg
    && account.status === 'flagged'
    && String(user?.privateMetadata?.ratingRestrictionReason || '').includes('Rolling average')
  ) {
    await setAccountStatus(userId, role, 'active', null);
    await recordPerformanceEvent({
      subjectUserId: userId,
      role,
      action: 'account_unflagged',
      avgRating: average,
      sampleSize,
      fromStatus: 'flagged',
      toStatus: 'active',
    });
    await notifyUser(userId, {
      title: 'Account restored',
      body: 'Your ratings have improved and account restrictions have been lifted.',
      data: { action: 'account_unflagged' },
    });
    return { action: 'account_unflagged', fromStatus: 'flagged', toStatus: 'active' };
  }

  return null;
}

export async function applyRatingAutomationAfterDriverRated(driverUserId) {
  const userId = String(driverUserId || '').trim();
  if (!userId) return null;

  try {
    const rolling = await getRollingStarAverage({ subjectUserId: userId, role: 'driver' });
    if (rolling.sampleSize < RATING_PERFORMANCE.minSample || rolling.average === null) {
      return { skipped: true, reason: 'insufficient_sample', ...rolling };
    }

    const accountResult = await applyAccountAutomation(userId, 'driver', rolling);
    const tierResult = await applyDriverTierAutomation(userId, rolling);

    return {
      average: rolling.average,
      sampleSize: rolling.sampleSize,
      accountResult,
      tierResult,
    };
  } catch (error) {
    console.error('[rating-performance] applyRatingAutomationAfterDriverRated failed', {
      driverUserId: userId,
      message: error?.message,
    });
    return { error: error?.message || 'automation_failed' };
  }
}

export async function applyRatingAutomationAfterPassengerRated(passengerUserId) {
  const userId = String(passengerUserId || '').trim();
  if (!userId) return null;

  try {
    const rolling = await getRollingStarAverage({ subjectUserId: userId, role: 'passenger' });
    if (rolling.sampleSize < RATING_PERFORMANCE.minSample || rolling.average === null) {
      return { skipped: true, reason: 'insufficient_sample', ...rolling };
    }

    const accountResult = await applyAccountAutomation(userId, 'passenger', rolling);
    return {
      average: rolling.average,
      sampleSize: rolling.sampleSize,
      accountResult,
    };
  } catch (error) {
    console.error('[rating-performance] applyRatingAutomationAfterPassengerRated failed', {
      passengerUserId: userId,
      message: error?.message,
    });
    return { error: error?.message || 'automation_failed' };
  }
}

export async function getDriverRatingPerformanceSummary(driverUserId) {
  const rolling = await getRollingStarAverage({ subjectUserId: driverUserId, role: 'driver' });
  const events = await listRatingPerformanceEvents(driverUserId, { limit: 10 });
  return {
    windowSize: RATING_PERFORMANCE.windowSize,
    minSample: RATING_PERFORMANCE.minSample,
    thresholds: {
      upgradeAvg: RATING_PERFORMANCE.upgradeAvg,
      downgradeAvg: RATING_PERFORMANCE.downgradeAvg,
      flagAvg: RATING_PERFORMANCE.flagAvg,
      clearFlagAvg: RATING_PERFORMANCE.clearFlagAvg,
    },
    rollingAverage: rolling.average,
    sampleSize: rolling.sampleSize,
    lastEvent: events[0] || null,
    events,
  };
}
