import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { getClerkClient } from '../lib/clerk-client.js';
import { normalizeRole } from '../lib/clerk-user.js';
import { query } from '../db/connection.js';
import { autoCloseInactiveSupportThreads } from '../lib/support-chat.js';

const router = Router();

function toDateValue(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return new Date(numeric);
  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed)) return new Date(parsed);
  return null;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function toIsoDay(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function buildDailySeries(rows = [], days = 7, key = 'count') {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const byDate = new Map(
    rows.map((row) => [
      toIsoDay(row.day),
      Number(row[key] || 0),
    ])
  );

  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const current = new Date(today);
    current.setUTCDate(today.getUTCDate() - offset);
    const isoDay = current.toISOString().slice(0, 10);
    series.push({
      label: current.toLocaleDateString('en-ZW', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      value: byDate.get(isoDay) || 0,
    });
  }
  return series;
}

function normalizeDateInput(value, endOfDay = false) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const suffix = endOfDay ? ' 23:59:59' : ' 00:00:00';
  return `${raw}${suffix}`;
}

router.get('/summary', requireAdminAuth, requirePermission('reports.read'), async (req, res) => {
  try {
    await autoCloseInactiveSupportThreads();
    const dateFrom = normalizeDateInput(req.query.dateFrom, false);
    const dateTo = normalizeDateInput(req.query.dateTo, true);
    const rideWhere = [];
    const rideParams = [];

    if (dateFrom) {
      rideWhere.push('requested_at >= ?');
      rideParams.push(dateFrom);
    }
    if (dateTo) {
      rideWhere.push('requested_at <= ?');
      rideParams.push(dateTo);
    }

    const rideWhereSql = rideWhere.length ? `WHERE ${rideWhere.join(' AND ')}` : '';

    const [
      [rideSummary],
      rideSeriesRows,
      rideWeekdayRows,
      rideLocationRows,
      rideStatusRows,
      rideTierRows,
      [onlineDriversRow],
      [driverStatusRow],
      [passengerIdentityRow],
      [supportSummaryRow],
      supportSeriesRows,
      hotspotRows,
      [safetyRow],
    ] = await Promise.all([
      query(
        `SELECT
           COUNT(*) AS total_rides,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_rides,
           SUM(CASE WHEN status IN ('accepted', 'driver_assigned', 'arrived', 'in_progress') THEN 1 ELSE 0 END) AS active_rides,
           SUM(CASE WHEN assigned_at IS NOT NULL THEN 1 ELSE 0 END) AS assigned_rides,
           SUM(CASE WHEN status IN ('cancelled', 'driver_cancelled', 'passenger_cancelled') THEN 1 ELSE 0 END) AS cancelled_rides,
           SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_rides,
           ROUND(AVG(COALESCE(actual_distance_km, route_distance_km, estimated_distance_km)), 1) AS avg_distance_km,
           ROUND(AVG(COALESCE(actual_minutes, route_duration_minutes, estimated_minutes)), 1) AS avg_minutes,
           ROUND(AVG(CASE WHEN status = 'completed' THEN COALESCE(estimated_amount, 0) END), 2) AS average_fare,
           ROUND(
             (SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)) * 100,
             1
           ) AS completion_rate
         FROM ride_requests
         ${rideWhereSql}`,
        rideParams
      ),
      query(
        `SELECT DATE(requested_at) AS day, COUNT(*) AS count
         FROM ride_requests
         ${rideWhere.length ? `${rideWhereSql} AND` : 'WHERE'} requested_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
         GROUP BY DATE(requested_at)
         ORDER BY DATE(requested_at) ASC`,
        rideParams
      ),
      query(
        `SELECT DAYOFWEEK(requested_at) AS weekday_index, DAYNAME(requested_at) AS weekday_label, COUNT(*) AS count
         FROM ride_requests
         ${rideWhereSql}
         GROUP BY DAYOFWEEK(requested_at), DAYNAME(requested_at)
         ORDER BY DAYOFWEEK(requested_at) ASC`,
        rideParams
      ),
      query(
        `SELECT pickup_label AS area, COUNT(*) AS total
         FROM ride_requests
         ${rideWhere.length ? `${rideWhereSql} AND` : 'WHERE'} pickup_label IS NOT NULL AND pickup_label <> ''
         GROUP BY pickup_label
         ORDER BY total DESC
         LIMIT 8`,
        rideParams
      ),
      query(
        `SELECT status, COUNT(*) AS total
         FROM ride_requests
         ${rideWhereSql}
         GROUP BY status
         ORDER BY total DESC`,
        rideParams
      ),
      query(
        `SELECT requested_tier_name AS tier_name, COUNT(*) AS total
         FROM ride_requests
         ${rideWhereSql}
         GROUP BY requested_tier_name
         ORDER BY total DESC`,
        rideParams
      ),
      query(
        `SELECT COUNT(*) AS online_drivers
         FROM driver_availability
         WHERE is_online = 1`
      ),
      query(
        `SELECT
           SUM(CASE WHEN profile_status = 'pending' THEN 1 ELSE 0 END) AS identity_pending,
           SUM(CASE WHEN profile_status = 'approved' THEN 1 ELSE 0 END) AS identity_approved,
           SUM(CASE WHEN profile_status = 'rejected' THEN 1 ELSE 0 END) AS identity_rejected,
           SUM(CASE WHEN vehicle_status = 'pending' THEN 1 ELSE 0 END) AS vehicle_pending,
           SUM(CASE WHEN vehicle_status = 'approved' THEN 1 ELSE 0 END) AS vehicle_approved,
           SUM(CASE WHEN vehicle_status = 'rejected' THEN 1 ELSE 0 END) AS vehicle_rejected
         FROM driver_identity di
         LEFT JOIN driver_vehicle dv
           ON dv.driver_user_id = di.driver_user_id`
      ),
      query(
        `SELECT
           SUM(CASE WHEN identity_status = 'pending' THEN 1 ELSE 0 END) AS passenger_pending,
           SUM(CASE WHEN identity_status = 'approved' THEN 1 ELSE 0 END) AS passenger_approved,
           SUM(CASE WHEN identity_status = 'rejected' THEN 1 ELSE 0 END) AS passenger_rejected
         FROM passenger_identity`
      ),
      query(
        `SELECT
           COUNT(*) AS total_threads,
           SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_threads,
           SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_threads
         FROM support_threads`
      ),
      query(
        `SELECT DATE(COALESCE(last_message_at, created_at)) AS day, COUNT(*) AS count
         FROM support_threads
         WHERE COALESCE(last_message_at, created_at) >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
         GROUP BY DATE(COALESCE(last_message_at, created_at))
         ORDER BY DATE(COALESCE(last_message_at, created_at)) ASC`
      ),
      query(
        `SELECT pickup_label AS area, COUNT(*) AS total
         FROM ride_requests
         WHERE pickup_label IS NOT NULL AND pickup_label <> ''
         GROUP BY pickup_label
         ORDER BY total DESC
         LIMIT 5`
      ),
      query(
        `SELECT
           SUM(CASE WHEN status IN ('cancelled', 'driver_cancelled', 'passenger_cancelled') THEN 1 ELSE 0 END) AS cancelled_rides,
           SUM(CASE WHEN cancellation_reason IS NOT NULL AND cancellation_reason <> '' THEN 1 ELSE 0 END) AS documented_cancellations,
           SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_rides
         FROM ride_requests`
      ),
    ]);

    return res.json({
      sections: {
        rides: {
          metrics: [
            { label: 'Total Rides', value: Number(rideSummary?.total_rides || 0) },
            { label: 'Completed', value: Number(rideSummary?.completed_rides || 0) },
            { label: 'Active', value: Number(rideSummary?.active_rides || 0) },
            { label: 'Assigned', value: Number(rideSummary?.assigned_rides || 0) },
            { label: 'Cancelled', value: Number(rideSummary?.cancelled_rides || 0) },
            { label: 'Expired', value: Number(rideSummary?.expired_rides || 0) },
            { label: 'Completion Rate', value: `${Number(rideSummary?.completion_rate || 0).toFixed(1)}%` },
            { label: 'Avg Distance', value: `${Number(rideSummary?.avg_distance_km || 0).toFixed(1)} km` },
            { label: 'Avg Duration', value: `${Number(rideSummary?.avg_minutes || 0).toFixed(1)} min` },
            { label: 'Avg Fare', value: `$${Number(rideSummary?.average_fare || 0).toFixed(2)}` },
          ],
          chart: buildDailySeries(rideSeriesRows, 7),
          weeklyDistribution: (rideWeekdayRows || []).map((row) => ({
            label: row.weekday_label || 'Unknown',
            value: Number(row.count || 0),
          })),
          locations: (rideLocationRows || []).map((row) => ({
            label: row.area || 'Unknown',
            value: Number(row.total || 0),
          })),
          statusBreakdown: (rideStatusRows || []).map((row) => ({
            label: row.status || 'Unknown',
            value: Number(row.total || 0),
          })),
          tierMix: (rideTierRows || []).map((row) => ({
            label: row.tier_name || 'Unknown',
            value: Number(row.total || 0),
          })),
        },
        drivers: {
          metrics: [
            { label: 'Online Drivers', value: Number(onlineDriversRow?.online_drivers || 0) },
            { label: 'Identity Approved', value: Number(driverStatusRow?.identity_approved || 0) },
            { label: 'Vehicle Approved', value: Number(driverStatusRow?.vehicle_approved || 0) },
            { label: 'Identity Pending', value: Number(driverStatusRow?.identity_pending || 0) },
            { label: 'Vehicle Pending', value: Number(driverStatusRow?.vehicle_pending || 0) },
          ],
          chart: [
            { label: 'Identity Approved', value: Number(driverStatusRow?.identity_approved || 0) },
            { label: 'Vehicle Approved', value: Number(driverStatusRow?.vehicle_approved || 0) },
            { label: 'Identity Pending', value: Number(driverStatusRow?.identity_pending || 0) },
            { label: 'Vehicle Pending', value: Number(driverStatusRow?.vehicle_pending || 0) },
          ],
        },
        passengers: {
          metrics: [
            { label: 'Identity Approved', value: Number(passengerIdentityRow?.passenger_approved || 0) },
            { label: 'Identity Pending', value: Number(passengerIdentityRow?.passenger_pending || 0) },
            { label: 'Identity Rejected', value: Number(passengerIdentityRow?.passenger_rejected || 0) },
          ],
          chart: [
            { label: 'Approved', value: Number(passengerIdentityRow?.passenger_approved || 0) },
            { label: 'Pending', value: Number(passengerIdentityRow?.passenger_pending || 0) },
            { label: 'Rejected', value: Number(passengerIdentityRow?.passenger_rejected || 0) },
          ],
        },
        support: {
          metrics: [
            { label: 'Total Threads', value: Number(supportSummaryRow?.total_threads || 0) },
            { label: 'Open Threads', value: Number(supportSummaryRow?.open_threads || 0) },
            { label: 'Closed Threads', value: Number(supportSummaryRow?.closed_threads || 0) },
          ],
          chart: buildDailySeries(supportSeriesRows, 7),
        },
        verification: {
          metrics: [
            { label: 'Driver Pending', value: Number(driverStatusRow?.identity_pending || 0) + Number(driverStatusRow?.vehicle_pending || 0) },
            { label: 'Driver Approved', value: Number(driverStatusRow?.identity_approved || 0) + Number(driverStatusRow?.vehicle_approved || 0) },
            { label: 'Passenger Pending', value: Number(passengerIdentityRow?.passenger_pending || 0) },
            { label: 'Passenger Approved', value: Number(passengerIdentityRow?.passenger_approved || 0) },
          ],
          chart: [
            { label: 'Driver Pending', value: Number(driverStatusRow?.identity_pending || 0) + Number(driverStatusRow?.vehicle_pending || 0) },
            { label: 'Driver Approved', value: Number(driverStatusRow?.identity_approved || 0) + Number(driverStatusRow?.vehicle_approved || 0) },
            { label: 'Passenger Pending', value: Number(passengerIdentityRow?.passenger_pending || 0) },
            { label: 'Passenger Approved', value: Number(passengerIdentityRow?.passenger_approved || 0) },
          ],
        },
        geography: {
          metrics: hotspotRows.map((row) => ({
            label: row.area || 'Unknown',
            value: Number(row.total || 0),
          })),
          chart: hotspotRows.map((row) => ({
            label: row.area || 'Unknown',
            value: Number(row.total || 0),
          })),
        },
        safety: {
          metrics: [
            { label: 'Cancelled Rides', value: Number(safetyRow?.cancelled_rides || 0) },
            { label: 'Documented Cancellations', value: Number(safetyRow?.documented_cancellations || 0) },
            { label: 'Expired Rides', value: Number(safetyRow?.expired_rides || 0) },
          ],
          chart: [
            { label: 'Cancelled', value: Number(safetyRow?.cancelled_rides || 0) },
            { label: 'Documented', value: Number(safetyRow?.documented_cancellations || 0) },
            { label: 'Expired', value: Number(safetyRow?.expired_rides || 0) },
          ],
        },
      },
    });
  } catch (err) {
    console.error('GET /api/admin/reports/summary', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/export.csv', requireAdminAuth, requirePermission('reports.read'), async (req, res) => {
  try {
    const clerkClient = getClerkClient();
    const clerkPage = await clerkClient.users.getUserList({
      limit: 500,
      orderBy: '-created_at',
    });

    const users = clerkPage.data || [];
    const roleCounts = {
      driver: 0,
      passenger: 0,
      admin: 0,
      unknown: 0,
    };

    const monthly = new Map();
    for (const user of users) {
      const role = normalizeRole(user?.publicMetadata?.role);
      if (roleCounts[role] !== undefined) roleCounts[role] += 1;
      else roleCounts.unknown += 1;

      const date = toDateValue(user.createdAt);
      if (date) {
        const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
        monthly.set(key, (monthly.get(key) || 0) + 1);
      }
    }

    const lines = [];
    lines.push('section,metric,value');
    lines.push(['summary', 'total_users', users.length].map(csvEscape).join(','));
    lines.push(['summary', 'drivers', roleCounts.driver].map(csvEscape).join(','));
    lines.push(['summary', 'passengers', roleCounts.passenger].map(csvEscape).join(','));
    lines.push(['summary', 'admins', roleCounts.admin].map(csvEscape).join(','));
    lines.push(['summary', 'unknown_role', roleCounts.unknown].map(csvEscape).join(','));

    lines.push('');
    lines.push('section,month,new_users');
    [...monthly.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .forEach(([month, count]) => {
        lines.push(['monthly_signups', month, count].map(csvEscape).join(','));
      });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reports_export_${Date.now()}.csv"`);
    return res.status(200).send(lines.join('\n'));
  } catch (err) {
    console.error('GET /api/admin/reports/export.csv', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
