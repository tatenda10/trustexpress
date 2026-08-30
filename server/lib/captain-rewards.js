import { query, withTransaction } from '../db/connection.js';
import { getClerkUserById } from './clerk-user.js';
import { getDriverVerificationFromMysql } from '../lib/driver-verification-mysql.js';
import { getAccountStatusFromUser } from './rating-performance.js';
import { creditCaptainPromotionalFloat } from './driver-wallet.js';

export const CAPTAIN_REWARD_CURRENCY = 'USD';
export const CAPTAIN_CYCLE_LENGTH_DAYS = 14;

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function normalizeMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function clampWeekday(value, fallback = 1) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6) return fallback;
  return parsed;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapTier(row) {
  return {
    id: Number(row.id),
    tierKey: row.tier_key,
    tierName: row.tier_name,
    badgeColor: row.badge_color,
    minRides: Number(row.min_rides || 0),
    maxRides: row.max_rides === null ? null : Number(row.max_rides),
    rewardAmountUsd: normalizeMoney(row.reward_amount_usd),
    sortOrder: Number(row.sort_order || 0),
    isActive: Number(row.is_active || 0) === 1,
  };
}

function mapCycle(row) {
  return {
    id: Number(row.id),
    cycleKey: row.cycle_key,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    creditedAt: row.credited_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCycleDriver(row) {
  return {
    id: Number(row.id),
    cycleId: Number(row.cycle_id),
    driverUserId: row.driver_user_id,
    qualifyingRidesCount: Number(row.qualifying_rides_count || 0),
    achievedTierKey: row.achieved_tier_key || null,
    rewardAmountUsd: normalizeMoney(row.reward_amount_usd),
    rewardStatus: row.reward_status,
    creditedAt: row.credited_at || null,
    walletTransactionId: row.wallet_transaction_id ? Number(row.wallet_transaction_id) : null,
  };
}

export function getWeekdayLabel(weekday) {
  return WEEKDAY_LABELS[clampWeekday(weekday, 1)] || 'Monday';
}

export function computeCycleWindowFromAnchor(anchorStartsAt, cycleLengthDays = CAPTAIN_CYCLE_LENGTH_DAYS, now = new Date()) {
  const anchor = toDate(anchorStartsAt);
  if (!anchor) {
    throw new Error('Captain reward anchor date is not configured.');
  }
  const lengthMs = Math.max(1, Number(cycleLengthDays) || CAPTAIN_CYCLE_LENGTH_DAYS) * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  const anchorMs = anchor.getTime();

  let cycleIndex = 0;
  if (nowMs >= anchorMs) {
    cycleIndex = Math.floor((nowMs - anchorMs) / lengthMs);
  } else {
    cycleIndex = -1;
  }

  const startsAt = new Date(anchorMs + Math.max(0, cycleIndex) * lengthMs);
  const endsAt = new Date(startsAt.getTime() + lengthMs);
  const cycleKey = `captain-${startsAt.toISOString().slice(0, 10)}`;

  return {
    cycleIndex: Math.max(0, cycleIndex),
    cycleKey,
    startsAt,
    endsAt,
    daysRemaining: Math.max(0, Math.ceil((endsAt.getTime() - nowMs) / (24 * 60 * 60 * 1000))),
  };
}

export async function getCaptainRewardSettings({ force = false } = {}) {
  const rows = await query(
    `SELECT id, enabled, cycle_length_days, cycle_weekday, cycle_anchor_starts_at, currency,
            updated_by_admin_id, created_at, updated_at
     FROM captain_reward_settings
     WHERE id = 1
     LIMIT 1`
  );
  const row = rows?.[0];
  if (!row) {
    const anchor = new Date();
    anchor.setHours(0, 0, 0, 0);
    return {
      enabled: true,
      cycleLengthDays: CAPTAIN_CYCLE_LENGTH_DAYS,
      cycleWeekday: 1,
      cycleWeekdayLabel: getWeekdayLabel(1),
      cycleAnchorStartsAt: anchor.toISOString(),
      currency: CAPTAIN_REWARD_CURRENCY,
      updatedByAdminId: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    enabled: Number(row.enabled || 0) === 1,
    cycleLengthDays: Number(row.cycle_length_days || CAPTAIN_CYCLE_LENGTH_DAYS),
    cycleWeekday: clampWeekday(row.cycle_weekday, 1),
    cycleWeekdayLabel: getWeekdayLabel(row.cycle_weekday),
    cycleAnchorStartsAt: new Date(row.cycle_anchor_starts_at).toISOString(),
    currency: String(row.currency || CAPTAIN_REWARD_CURRENCY).toUpperCase(),
    updatedByAdminId: row.updated_by_admin_id ? Number(row.updated_by_admin_id) : null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function updateCaptainRewardSettings({
  enabled,
  cycleLengthDays,
  cycleWeekday,
  cycleAnchorStartsAt,
  currency,
  adminId,
}) {
  const current = await getCaptainRewardSettings();
  const nextAnchor = cycleAnchorStartsAt ? toDate(cycleAnchorStartsAt) : toDate(current.cycleAnchorStartsAt);
  if (!nextAnchor) {
    const error = new Error('A valid cycle anchor start date is required.');
    error.status = 400;
    throw error;
  }

  const nextWeekday = cycleWeekday === undefined ? current.cycleWeekday : clampWeekday(cycleWeekday, 1);
  const anchorDate = new Date(nextAnchor);
  if (anchorDate.getDay() !== nextWeekday) {
    const error = new Error(`Anchor date must fall on ${getWeekdayLabel(nextWeekday)}.`);
    error.status = 400;
    throw error;
  }

  await query(
    `INSERT INTO captain_reward_settings (
       id, enabled, cycle_length_days, cycle_weekday, cycle_anchor_starts_at, currency, updated_by_admin_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled),
       cycle_length_days = VALUES(cycle_length_days),
       cycle_weekday = VALUES(cycle_weekday),
       cycle_anchor_starts_at = VALUES(cycle_anchor_starts_at),
       currency = VALUES(currency),
       updated_by_admin_id = VALUES(updated_by_admin_id)`,
    [
      1,
      enabled === false ? 0 : 1,
      Math.min(Math.max(Number(cycleLengthDays) || CAPTAIN_CYCLE_LENGTH_DAYS, 7), 28),
      nextWeekday,
      anchorDate,
      String(currency || CAPTAIN_REWARD_CURRENCY).toUpperCase(),
      adminId || null,
    ]
  );

  return getCaptainRewardSettings({ force: true });
}

export async function listCaptainRewardTiers() {
  const rows = await query(
    `SELECT id, tier_key, tier_name, badge_color, min_rides, max_rides, reward_amount_usd, sort_order, is_active
     FROM captain_reward_tiers
     ORDER BY sort_order ASC, min_rides ASC, id ASC`
  );
  return (rows || []).map(mapTier);
}

export async function replaceCaptainRewardTiers(inputTiers = []) {
  await query('DELETE FROM captain_reward_tiers');
  const tiers = Array.isArray(inputTiers) ? inputTiers : [];
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index] || {};
    const tierKey = String(tier.tierKey || '').trim().toLowerCase();
    const tierName = String(tier.tierName || '').trim();
    const minRides = Number.parseInt(String(tier.minRides ?? ''), 10);
    const maxRides = tier.maxRides === null || tier.maxRides === undefined || tier.maxRides === ''
      ? null
      : Number.parseInt(String(tier.maxRides), 10);
    if (!tierKey || !tierName || !Number.isInteger(minRides) || minRides < 0) continue;

    await query(
      `INSERT INTO captain_reward_tiers (
         tier_key, tier_name, badge_color, min_rides, max_rides, reward_amount_usd, sort_order, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tierKey,
        tierName,
        String(tier.badgeColor || '#2563EB').trim() || '#2563EB',
        minRides,
        Number.isInteger(maxRides) ? maxRides : null,
        normalizeMoney(tier.rewardAmountUsd),
        Number.isFinite(Number(tier.sortOrder)) ? Number(tier.sortOrder) : index + 1,
        tier.isActive === false ? 0 : 1,
      ]
    );
  }
  return listCaptainRewardTiers();
}

export function resolveTierForRideCount(rideCount, tiers = []) {
  const count = Number(rideCount || 0);
  const activeTiers = (tiers || []).filter((tier) => tier.isActive !== false);
  let matched = null;
  for (const tier of activeTiers) {
    if (count < Number(tier.minRides || 0)) continue;
    if (tier.maxRides !== null && count > Number(tier.maxRides)) continue;
    if (!matched || Number(tier.minRides) >= Number(matched.minRides)) {
      matched = tier;
    }
  }
  return matched;
}

export function resolveNextTier(rideCount, tiers = []) {
  const count = Number(rideCount || 0);
  const activeTiers = (tiers || [])
    .filter((tier) => tier.isActive !== false)
    .sort((a, b) => Number(a.minRides) - Number(b.minRides));
  return activeTiers.find((tier) => count < Number(tier.minRides || 0)) || null;
}

export async function isDriverCaptainEligible(driverUserId, user = null) {
  const clerkUser = user || await getClerkUserById(driverUserId).catch(() => null);
  if (!clerkUser) return { eligible: false, reason: 'missing_user' };

  const account = getAccountStatusFromUser(clerkUser, 'driver');
  if (account.isRestricted) {
    return { eligible: false, reason: 'account_restricted' };
  }

  const verification = await getDriverVerificationFromMysql(driverUserId, clerkUser);
  const profileStatus = String(verification?.driverProfile?.status || '').trim().toLowerCase();
  const vehicleStatus = String(verification?.vehicle?.status || '').trim().toLowerCase();
  const profileApproved = profileStatus === 'approved' || profileStatus === 'verified';
  const vehicleApproved = vehicleStatus === 'approved' || vehicleStatus === 'verified';
  const phoneVerified = verification?.phoneVerified === true;

  if (!profileApproved || !vehicleApproved || !phoneVerified) {
    return { eligible: false, reason: 'not_fully_verified' };
  }

  return { eligible: true, reason: null };
}

export async function ensureCaptainCycleForNow(now = new Date()) {
  const settings = await getCaptainRewardSettings();
  const window = computeCycleWindowFromAnchor(
    settings.cycleAnchorStartsAt,
    settings.cycleLengthDays,
    now
  );

  const [existing] = await query(
    `SELECT id, cycle_key, starts_at, ends_at, status, credited_at, created_at, updated_at
     FROM captain_reward_cycles
     WHERE cycle_key = ?
     LIMIT 1`,
    [window.cycleKey]
  );

  if (existing) {
    return { settings, window, cycle: mapCycle(existing) };
  }

  const result = await query(
    `INSERT INTO captain_reward_cycles (cycle_key, starts_at, ends_at, status)
     VALUES (?, ?, ?, 'active')`,
    [window.cycleKey, window.startsAt, window.endsAt]
  );

  const [created] = await query(
    `SELECT id, cycle_key, starts_at, ends_at, status, credited_at, created_at, updated_at
     FROM captain_reward_cycles
     WHERE id = ?
     LIMIT 1`,
    [result.insertId]
  );

  return { settings, window, cycle: mapCycle(created) };
}

async function ensureCycleDriverRow(cycleId, driverUserId, connection = null) {
  const exec = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows)
    : (sql, params) => query(sql, params);

  await exec(
    `INSERT INTO captain_reward_cycle_drivers (cycle_id, driver_user_id, reward_status)
     VALUES (?, ?, 'in_progress')
     ON DUPLICATE KEY UPDATE driver_user_id = VALUES(driver_user_id)`,
    [cycleId, driverUserId]
  );

  const [row] = await exec(
    `SELECT id, cycle_id, driver_user_id, qualifying_rides_count, achieved_tier_key,
            reward_amount_usd, reward_status, credited_at, wallet_transaction_id
     FROM captain_reward_cycle_drivers
     WHERE cycle_id = ? AND driver_user_id = ?
     LIMIT 1`,
    [cycleId, driverUserId]
  );
  return mapCycleDriver(row);
}

async function refreshCycleDriverSummary(cycleId, driverUserId, tiers, connection = null) {
  const exec = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows)
    : (sql, params) => query(sql, params);

  const [countRow] = await exec(
    `SELECT COUNT(*) AS total
     FROM captain_reward_qualifying_rides
     WHERE cycle_id = ? AND driver_user_id = ?`,
    [cycleId, driverUserId]
  );
  const qualifyingRidesCount = Number(countRow?.total || 0);
  const achievedTier = resolveTierForRideCount(qualifyingRidesCount, tiers);
  const rewardAmountUsd = normalizeMoney(achievedTier?.rewardAmountUsd || 0);
  const rewardStatus = qualifyingRidesCount > 0
    ? (rewardAmountUsd > 0 ? 'qualified' : 'in_progress')
    : 'in_progress';

  await exec(
    `UPDATE captain_reward_cycle_drivers
     SET qualifying_rides_count = ?,
         achieved_tier_key = ?,
         reward_amount_usd = ?,
         reward_status = CASE
           WHEN reward_status = 'credited' THEN reward_status
           WHEN reward_status = 'ineligible' THEN reward_status
           ELSE ?
         END
     WHERE cycle_id = ? AND driver_user_id = ?`,
    [
      qualifyingRidesCount,
      achievedTier?.tierKey || null,
      rewardAmountUsd,
      rewardStatus,
      cycleId,
      driverUserId,
    ]
  );

  return ensureCycleDriverRow(cycleId, driverUserId, connection);
}

export async function recordCaptainQualifyingRide({
  driverUserId,
  rideRequestId,
  completedAt = new Date(),
}) {
  const settings = await getCaptainRewardSettings();
  if (!settings.enabled) {
    return { counted: false, reason: 'disabled' };
  }

  const eligibility = await isDriverCaptainEligible(driverUserId);
  if (!eligibility.eligible) {
    return { counted: false, reason: eligibility.reason };
  }

  const completedDate = toDate(completedAt);
  if (!completedDate) {
    return { counted: false, reason: 'invalid_completed_at' };
  }

  const { cycle, window } = await ensureCaptainCycleForNow(completedDate);
  if (completedDate < window.startsAt || completedDate >= window.endsAt) {
    return { counted: false, reason: 'outside_active_cycle' };
  }

  const tiers = await listCaptainRewardTiers();

  return withTransaction(async (connection) => {
    const [existingRide] = await connection.execute(
      `SELECT id
       FROM captain_reward_qualifying_rides
       WHERE cycle_id = ? AND ride_request_id = ?
       LIMIT 1`,
      [cycle.id, Number(rideRequestId)]
    );
    if (existingRide[0]) {
      return { counted: false, alreadyCounted: true, cycleId: cycle.id };
    }

    await connection.execute(
      `INSERT INTO captain_reward_qualifying_rides (
         cycle_id, driver_user_id, ride_request_id, completed_at
       ) VALUES (?, ?, ?, ?)`,
      [cycle.id, driverUserId, Number(rideRequestId), completedDate]
    );

    const summary = await refreshCycleDriverSummary(cycle.id, driverUserId, tiers, connection);
    return {
      counted: true,
      cycleId: cycle.id,
      qualifyingRidesCount: summary.qualifyingRidesCount,
      achievedTierKey: summary.achievedTierKey,
      rewardAmountUsd: summary.rewardAmountUsd,
    };
  });
}

export async function buildCaptainStatusForDriver(driverUserId) {
  const settings = await getCaptainRewardSettings();
  const tiers = await listCaptainRewardTiers();
  const eligibility = await isDriverCaptainEligible(driverUserId);
  const { cycle, window } = await ensureCaptainCycleForNow();

  let driverRow = null;
  if (eligibility.eligible) {
    driverRow = await ensureCycleDriverRow(cycle.id, driverUserId);
    if (Number(driverRow.qualifyingRidesCount || 0) > 0) {
      driverRow = await refreshCycleDriverSummary(cycle.id, driverUserId, tiers);
    }
  }

  const rideCount = Number(driverRow?.qualifyingRidesCount || 0);
  const currentTier = resolveTierForRideCount(rideCount, tiers);
  const nextTier = resolveNextTier(rideCount, tiers);
  const ridesToNextTier = nextTier ? Math.max(0, Number(nextTier.minRides) - rideCount) : 0;
  const progressPercent = nextTier
    ? Math.min(100, Math.round((rideCount / Number(nextTier.minRides || 1)) * 100))
    : (currentTier ? 100 : 0);

  let rewardStatus = 'in_progress';
  if (!settings.enabled) rewardStatus = 'disabled';
  else if (!eligibility.eligible) rewardStatus = 'ineligible';
  else if (driverRow?.rewardStatus === 'credited') rewardStatus = 'credited';
  else if (normalizeMoney(driverRow?.rewardAmountUsd) > 0) rewardStatus = 'qualified';
  else if (rideCount > 0) rewardStatus = 'in_progress';

  return {
    enabled: settings.enabled,
    eligible: eligibility.eligible,
    ineligibleReason: eligibility.reason,
    currency: settings.currency || CAPTAIN_REWARD_CURRENCY,
    cycle: {
      id: cycle.id,
      cycleKey: cycle.cycleKey,
      startsAt: cycle.startsAt,
      endsAt: cycle.endsAt,
      daysRemaining: window.daysRemaining,
      weekdayLabel: settings.cycleWeekdayLabel,
    },
    tierKey: currentTier?.tierKey || null,
    tierName: currentTier?.tierName || (rideCount > 0 ? 'Blue Captain' : 'No tier yet'),
    badgeColor: currentTier?.badgeColor || '#2563EB',
    qualifyingRides: rideCount,
    nextTierKey: nextTier?.tierKey || null,
    nextTierName: nextTier?.tierName || null,
    ridesToNextTier,
    progressPercent,
    currentRewardUsd: normalizeMoney(driverRow?.rewardAmountUsd || currentTier?.rewardAmountUsd || 0),
    rewardStatus,
    rewardStatusLabel: rewardStatus === 'credited'
      ? 'Credited'
      : rewardStatus === 'qualified'
        ? 'Qualified'
        : rewardStatus === 'ineligible'
          ? 'Ineligible'
          : rewardStatus === 'disabled'
            ? 'Disabled'
            : 'In Progress',
  };
}

export async function creditCaptainRewardsForCycle(cycleId, { force = false } = {}) {
  const [cycleRow] = await query(
    `SELECT id, cycle_key, starts_at, ends_at, status, credited_at
     FROM captain_reward_cycles
     WHERE id = ?
     LIMIT 1`,
    [Number(cycleId)]
  );
  if (!cycleRow) {
    const error = new Error('Captain reward cycle not found.');
    error.status = 404;
    throw error;
  }

  const cycle = mapCycle(cycleRow);
  const now = new Date();
  if (!force && toDate(cycle.endsAt) > now) {
    const error = new Error('This cycle has not ended yet.');
    error.status = 409;
    throw error;
  }

  const tiers = await listCaptainRewardTiers();
  const driverRows = await query(
    `SELECT id, cycle_id, driver_user_id, qualifying_rides_count, achieved_tier_key,
            reward_amount_usd, reward_status, credited_at, wallet_transaction_id
     FROM captain_reward_cycle_drivers
     WHERE cycle_id = ?`,
    [cycle.id]
  );

  let creditedCount = 0;
  let skippedCount = 0;

  for (const row of driverRows || []) {
    const summary = await refreshCycleDriverSummary(cycle.id, row.driver_user_id, tiers);
    const eligibility = await isDriverCaptainEligible(row.driver_user_id);
    if (!eligibility.eligible) {
      await query(
        `UPDATE captain_reward_cycle_drivers
         SET reward_status = 'ineligible'
         WHERE id = ? AND reward_status <> 'credited'`,
        [summary.id]
      );
      skippedCount += 1;
      continue;
    }

    const rewardAmount = normalizeMoney(summary.rewardAmountUsd);
    if (rewardAmount <= 0 || summary.rewardStatus === 'credited') {
      skippedCount += 1;
      continue;
    }

    const credit = await creditCaptainPromotionalFloat({
      driverUserId: row.driver_user_id,
      amount: rewardAmount,
      cycleId: cycle.id,
      description: `Captain reward — ${cycle.cycleKey}`,
    });

    if (credit.credited || credit.alreadyCredited) {
      await query(
        `UPDATE captain_reward_cycle_drivers
         SET reward_status = 'credited',
             credited_at = COALESCE(credited_at, CURRENT_TIMESTAMP),
             wallet_transaction_id = COALESCE(wallet_transaction_id, ?),
             reward_amount_usd = ?,
             achieved_tier_key = ?
         WHERE id = ?`,
        [
          credit.transactionId || null,
          rewardAmount,
          summary.achievedTierKey,
          summary.id,
        ]
      );
      creditedCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  await query(
    `UPDATE captain_reward_cycles
     SET status = 'credited',
         credited_at = COALESCE(credited_at, CURRENT_TIMESTAMP)
     WHERE id = ?`,
    [cycle.id]
  );

  return {
    cycleId: cycle.id,
    creditedCount,
    skippedCount,
  };
}

export async function processDueCaptainRewardCycles(now = new Date()) {
  const dueRows = await query(
    `SELECT id, cycle_key, starts_at, ends_at, status
     FROM captain_reward_cycles
     WHERE status = 'active' AND ends_at <= ?
     ORDER BY ends_at ASC`,
    [now]
  );

  const results = [];
  for (const row of dueRows || []) {
    const result = await creditCaptainRewardsForCycle(row.id, { force: true });
    results.push(result);
    await ensureCaptainCycleForNow(now);
  }
  return results;
}

export async function listAdminCaptainCycles(limit = 20) {
  const rows = await query(
    `SELECT c.id, c.cycle_key, c.starts_at, c.ends_at, c.status, c.credited_at, c.created_at, c.updated_at,
            COUNT(d.id) AS driver_count,
            COALESCE(SUM(CASE WHEN d.reward_status = 'credited' THEN 1 ELSE 0 END), 0) AS credited_drivers,
            COALESCE(SUM(CASE WHEN d.reward_status = 'credited' THEN d.reward_amount_usd ELSE 0 END), 0) AS credited_total_usd
     FROM captain_reward_cycles c
     LEFT JOIN captain_reward_cycle_drivers d ON d.cycle_id = c.id
     GROUP BY c.id
     ORDER BY c.starts_at DESC
     LIMIT ?`,
    [Math.min(Math.max(Number(limit) || 20, 1), 100)]
  );

  return (rows || []).map((row) => ({
    ...mapCycle(row),
    driverCount: Number(row.driver_count || 0),
    creditedDrivers: Number(row.credited_drivers || 0),
    creditedTotalUsd: normalizeMoney(row.credited_total_usd),
  }));
}

export async function listAdminCaptainCycleDrivers(cycleId) {
  const rows = await query(
    `SELECT d.id, d.cycle_id, d.driver_user_id, d.qualifying_rides_count, d.achieved_tier_key,
            d.reward_amount_usd, d.reward_status, d.credited_at, d.wallet_transaction_id,
            da.driver_name, da.phone_number
     FROM captain_reward_cycle_drivers d
     LEFT JOIN driver_availability da ON da.driver_user_id = d.driver_user_id
     WHERE d.cycle_id = ?
     ORDER BY d.qualifying_rides_count DESC, d.id DESC`,
    [Number(cycleId)]
  );

  return (rows || []).map((row) => ({
    ...mapCycleDriver(row),
    driverName: row.driver_name || 'Driver',
    driverPhone: row.phone_number || null,
  }));
}
