import { query } from '../db/connection.js';

const DEFAULT_DAILY_GOAL = 50;
const EARNINGS_SQL = `COALESCE(original_estimated_amount, estimated_amount, 0) + COALESCE(tip_amount, 0)`;

function normalizeMoney(value, fallback = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.round(amount * 100) / 100;
}

function startOfLocalDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Monday-start week */
function startOfWeek(date = new Date()) {
  const d = startOfLocalDay(date);
  const day = d.getDay(); // 0 Sun … 6 Sat
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(d, offset);
}

function startOfMonth(date = new Date()) {
  const d = startOfLocalDay(date);
  d.setDate(1);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatPeriodLabel(period, rangeStart, rangeEnd) {
  const optsDay = { month: 'short', day: 'numeric', year: 'numeric' };
  const optsMonth = { month: 'long', year: 'numeric' };
  if (period === 'day') {
    return rangeStart.toLocaleDateString('en-ZW', optsDay);
  }
  if (period === 'month') {
    return rangeStart.toLocaleDateString('en-ZW', optsMonth);
  }
  const sameMonth = rangeStart.getMonth() === rangeEnd.getMonth()
    && rangeStart.getFullYear() === rangeEnd.getFullYear();
  if (sameMonth) {
    return `${rangeStart.toLocaleDateString('en-ZW', { month: 'short', day: 'numeric' })} – ${rangeEnd.getDate()}, ${rangeEnd.getFullYear()}`;
  }
  return `${rangeStart.toLocaleDateString('en-ZW', optsDay)} – ${rangeEnd.toLocaleDateString('en-ZW', optsDay)}`;
}

export function resolveIncomePeriodRange(period = 'day', offset = 0) {
  const safePeriod = ['day', 'week', 'month'].includes(String(period || '').toLowerCase())
    ? String(period).toLowerCase()
    : 'day';
  const safeOffset = Number.isFinite(Number(offset)) ? Math.trunc(Number(offset)) : 0;
  // Negative offsets look into the past; 0 = current period.
  const lookBack = Math.min(0, safeOffset);

  let rangeStart;
  let rangeEnd;
  if (safePeriod === 'day') {
    rangeStart = addDays(startOfLocalDay(new Date()), lookBack);
    rangeEnd = endOfDay(rangeStart);
  } else if (safePeriod === 'week') {
    rangeStart = addDays(startOfWeek(new Date()), lookBack * 7);
    rangeEnd = endOfDay(addDays(rangeStart, 6));
  } else {
    rangeStart = addMonths(startOfMonth(new Date()), lookBack);
    const nextMonth = addMonths(rangeStart, 1);
    rangeEnd = endOfDay(addDays(nextMonth, -1));
  }

  const now = new Date();
  if (rangeEnd > now) rangeEnd = now;

  return {
    period: safePeriod,
    offset: lookBack,
    rangeStart,
    rangeEnd,
    label: formatPeriodLabel(safePeriod, rangeStart, rangeEnd),
    // Can only step forward up to the current period.
    canGoForward: lookBack < 0,
  };
}

export async function getDriverIncomeGoal(driverUserId) {
  const [row] = await query(
    `SELECT daily_goal_amount, currency, updated_at
     FROM driver_income_goals
     WHERE driver_user_id = ?
     LIMIT 1`,
    [driverUserId]
  );
  return {
    dailyGoalAmount: normalizeMoney(row?.daily_goal_amount, DEFAULT_DAILY_GOAL),
    currency: row?.currency || 'USD',
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function setDriverIncomeGoal(driverUserId, dailyGoalAmount, currency = 'USD') {
  const goal = normalizeMoney(dailyGoalAmount, NaN);
  if (!Number.isFinite(goal) || goal < 1) {
    const error = new Error('Daily goal must be at least 1');
    error.status = 400;
    throw error;
  }
  if (goal > 100000) {
    const error = new Error('Daily goal is too high');
    error.status = 400;
    throw error;
  }
  const safeCurrency = String(currency || 'USD').trim().toUpperCase() || 'USD';

  await query(
    `INSERT INTO driver_income_goals (driver_user_id, daily_goal_amount, currency)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       daily_goal_amount = VALUES(daily_goal_amount),
       currency = VALUES(currency),
       updated_at = CURRENT_TIMESTAMP`,
    [driverUserId, goal, safeCurrency]
  );

  return getDriverIncomeGoal(driverUserId);
}

export async function getDriverIncomeDashboard(driverUserId, { period = 'day', offset = 0, rideLimit = 20 } = {}) {
  const range = resolveIncomePeriodRange(period, offset);
  const goal = await getDriverIncomeGoal(driverUserId);
  const safeLimit = Math.min(Math.max(Number(rideLimit) || 20, 1), 50);

  const [summaryRow] = await query(
    `SELECT
       COUNT(*) AS completed_rides,
       COALESCE(SUM(${EARNINGS_SQL}), 0) AS earnings,
       COALESCE(AVG(${EARNINGS_SQL}), 0) AS avg_per_ride
     FROM ride_requests
     WHERE driver_user_id = ?
       AND status = 'completed'
       AND completed_at IS NOT NULL
       AND completed_at >= ?
       AND completed_at <= ?`,
    [driverUserId, range.rangeStart, range.rangeEnd]
  );

  const rides = await query(
    `SELECT
       id,
       public_id,
       passenger_name,
       pickup_label,
       dropoff_label,
       requested_tier_name,
       estimated_amount,
       original_estimated_amount,
       tip_amount,
       completed_at
     FROM ride_requests
     WHERE driver_user_id = ?
       AND status = 'completed'
       AND completed_at IS NOT NULL
       AND completed_at >= ?
       AND completed_at <= ?
     ORDER BY completed_at DESC, id DESC
     LIMIT ${safeLimit}`,
    [driverUserId, range.rangeStart, range.rangeEnd]
  );

  const earnings = normalizeMoney(summaryRow?.earnings);
  const completedRides = Number(summaryRow?.completed_rides || 0);
  const averagePerRide = normalizeMoney(summaryRow?.avg_per_ride);
  const dailyGoalAmount = goal.dailyGoalAmount;
  // Goal tracking is most relevant for "day" view; still show the plan on week/month for reference.
  const remainingToGoal = Math.max(0, normalizeMoney(dailyGoalAmount - earnings));
  const progressPercent = dailyGoalAmount > 0
    ? Math.min(100, Math.round((earnings / dailyGoalAmount) * 100))
    : 0;
  const estimatedOrdersLeft = remainingToGoal > 0 && averagePerRide > 0
    ? Math.max(1, Math.ceil(remainingToGoal / averagePerRide))
    : (remainingToGoal > 0 ? null : 0);

  return {
    period: range.period,
    offset: range.offset,
    label: range.label,
    rangeStart: range.rangeStart.toISOString(),
    rangeEnd: range.rangeEnd.toISOString(),
    canGoForward: range.canGoForward,
    currency: goal.currency,
    earnings,
    completedRides,
    averagePerRide,
    dailyGoal: {
      amount: dailyGoalAmount,
      remaining: remainingToGoal,
      progressPercent,
      estimatedOrdersLeft,
      met: remainingToGoal <= 0 && completedRides > 0
        ? true
        : remainingToGoal <= 0 && earnings >= dailyGoalAmount,
    },
    rides: rides.map((row) => ({
      id: row.id,
      publicId: row.public_id,
      passengerName: row.passenger_name || 'Passenger',
      pickupLabel: row.pickup_label,
      dropoffLabel: row.dropoff_label,
      tierName: row.requested_tier_name,
      tipAmount: normalizeMoney(row.tip_amount),
      totalEarned: normalizeMoney(
        Number(row.original_estimated_amount || row.estimated_amount || 0) + Number(row.tip_amount || 0)
      ),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    })),
  };
}
