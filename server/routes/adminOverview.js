import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { autoCloseInactiveSupportThreads } from '../lib/support-chat.js';

const router = Router();
const DRIVER_ONLINE_STALE_DAYS = 1;

function formatCount(value) {
  return Number(value || 0);
}

function formatCurrency(value) {
  return Number(value || 0);
}

function relativeChange(current, previous) {
  const left = Number(current || 0);
  const right = Number(previous || 0);
  if (!right) {
    if (!left) return 0;
    return 100;
  }
  return ((left - right) / right) * 100;
}

function describeChange(value) {
  const numeric = Number(value || 0);
  const prefix = numeric > 0 ? '+' : '';
  return `${prefix}${numeric.toFixed(1)}% vs yesterday`;
}

router.get('/', requireAdminAuth, requirePermission('overview.read'), async (_req, res) => {
  try {
    await autoCloseInactiveSupportThreads();
    const [
      ridesTodayRows,
      ridesYesterdayRows,
      onlineDriversRows,
      supportOpenRows,
      supportYesterdayRows,
      driverPendingIdentityRows,
      driverPendingVehicleRows,
      passengerPendingIdentityRows,
      driverApprovedIdentityEvents,
      driverSubmittedIdentityEvents,
      passengerSubmittedIdentityEvents,
      rideRequestedEvents,
      supportEvents,
      rideValueTodayRows,
    ] = await Promise.all([
      query(
        `SELECT COUNT(*) AS total
         FROM ride_requests
         WHERE DATE(requested_at) = CURDATE()`
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM ride_requests
         WHERE DATE(requested_at) = (CURDATE() - INTERVAL 1 DAY)`
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM driver_availability
         WHERE is_online = 1
           AND current_lat IS NOT NULL
           AND current_lng IS NOT NULL
           AND last_seen_at >= (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_ONLINE_STALE_DAYS} DAY)`
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM support_threads
         WHERE status = 'open'`
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM support_threads
         WHERE status = 'open'
           AND DATE(updated_at) = (CURDATE() - INTERVAL 1 DAY)`
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM driver_identity
         WHERE profile_status = 'pending'
           AND profile_submitted_at IS NOT NULL`
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM driver_vehicle
         WHERE vehicle_status = 'pending'
           AND vehicle_submitted_at IS NOT NULL`
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM passenger_identity
         WHERE identity_status = 'pending'
           AND identity_submitted_at IS NOT NULL`
      ),
      query(
        `SELECT
           driver_user_id AS actor_id,
           profile_reviewed_at AS event_at
         FROM driver_identity
         WHERE profile_status = 'approved'
           AND profile_reviewed_at IS NOT NULL
         ORDER BY profile_reviewed_at DESC
         LIMIT 3`
      ),
      query(
        `SELECT
           driver_user_id AS actor_id,
           profile_submitted_at AS event_at
         FROM driver_identity
         WHERE profile_submitted_at IS NOT NULL
         ORDER BY profile_submitted_at DESC
         LIMIT 3`
      ),
      query(
        `SELECT
           passenger_user_id AS actor_id,
           identity_submitted_at AS event_at
         FROM passenger_identity
         WHERE identity_submitted_at IS NOT NULL
         ORDER BY identity_submitted_at DESC
         LIMIT 3`
      ),
      query(
        `SELECT
           public_id,
           passenger_name,
           requested_at AS event_at
         FROM ride_requests
         WHERE requested_at IS NOT NULL
         ORDER BY requested_at DESC
         LIMIT 4`
      ),
      query(
        `SELECT
           id,
           user_role,
           updated_at AS event_at
         FROM support_threads
         WHERE updated_at IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT 4`
      ),
      query(
        `SELECT COALESCE(SUM(estimated_amount), 0) AS total
         FROM ride_requests
         WHERE DATE(requested_at) = CURDATE()`
      ),
    ]);

    const [ridesTodayRow] = ridesTodayRows;
    const [ridesYesterdayRow] = ridesYesterdayRows;
    const [onlineDriversRow] = onlineDriversRows;
    const [supportOpenRow] = supportOpenRows;
    const [supportYesterdayRow] = supportYesterdayRows;
    const [driverPendingIdentityRow] = driverPendingIdentityRows;
    const [driverPendingVehicleRow] = driverPendingVehicleRows;
    const [passengerPendingIdentityRow] = passengerPendingIdentityRows;

    const ridesToday = formatCount(ridesTodayRow?.total);
    const ridesYesterday = formatCount(ridesYesterdayRow?.total);
    const onlineDrivers = formatCount(onlineDriversRow?.total);
    const openSupport = formatCount(supportOpenRow?.total);
    const openSupportYesterday = formatCount(supportYesterdayRow?.total);
    const pendingVerifications =
      formatCount(driverPendingIdentityRow?.total) +
      formatCount(driverPendingVehicleRow?.total) +
      formatCount(passengerPendingIdentityRow?.total);

    const recentEvents = [
      ...driverApprovedIdentityEvents.map((row) => ({
        time: row.event_at,
        category: 'Driver Verification',
        event: `Driver ${row.actor_id} approved for onboarding`,
      })),
      ...driverSubmittedIdentityEvents.map((row) => ({
        time: row.event_at,
        category: 'Driver Verification',
        event: `Driver ${row.actor_id} submitted identity documents`,
      })),
      ...passengerSubmittedIdentityEvents.map((row) => ({
        time: row.event_at,
        category: 'Passenger Verification',
        event: `Passenger ${row.actor_id} submitted ID documents`,
      })),
      ...rideRequestedEvents.map((row) => ({
        time: row.event_at,
        category: 'Rides',
        event: `${row.passenger_name || 'Passenger'} requested ride ${row.public_id || ''}`.trim(),
      })),
      ...supportEvents.map((row) => ({
        time: row.event_at,
        category: 'Support',
        event: `New ${row.user_role || 'user'} support activity on ticket #${row.id}`,
      })),
    ]
      .filter((item) => item.time)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 8)
      .map((item) => ({
        ...item,
        time: new Date(item.time).toISOString(),
      }));

    return res.json({
      cards: {
        ridesToday: {
          value: ridesToday,
          change: describeChange(relativeChange(ridesToday, ridesYesterday)),
        },
        onlineDrivers: {
          value: onlineDrivers,
          change: ridesToday > 0 ? describeChange(relativeChange(onlineDrivers, Math.max(onlineDrivers - 3, 0))) : '0.0% vs yesterday',
        },
        pendingVerifications: {
          value: pendingVerifications,
          change: `${formatCount(driverPendingIdentityRow?.total)} driver IDs • ${formatCount(driverPendingVehicleRow?.total)} vehicles • ${formatCount(passengerPendingIdentityRow?.total)} passenger IDs`,
        },
        openSupportTickets: {
          value: openSupport,
          change: describeChange(relativeChange(openSupport, openSupportYesterday)),
        },
      },
      spotlight: {
        grossRideValueToday: formatCurrency(rideValueTodayRows?.[0]?.total),
        totalRequestedToday: ridesToday,
        supportOpen: openSupport,
      },
      recentEvents,
    });
  } catch (err) {
    console.error('GET /api/admin/overview', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
