import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { buildRideStopsPayload } from '../lib/ride-stops.js';

const router = Router();
const LIVE_MAP_PLACE_RADIUS_KM = 8;

function mapRideStatus(status) {
  if (status === 'driver_assigned' || status === 'driver_arrived' || status === 'in_progress') return 'In Progress';
  if (status === 'completed') return 'Completed';
  if (status === 'driver_found' || status === 'requested') return 'Requested';
  return 'Cancelled';
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function calculateDistanceKm(start, end) {
  if (!start || !end) return Infinity;
  const earthRadiusKm = 6371;
  const dLat = toRadians(end.lat - start.lat);
  const dLng = toRadians(end.lng - start.lng);
  const lat1 = toRadians(start.lat);
  const lat2 = toRadians(end.lat);
  const a = (
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
  );
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function buildRideFilters(req) {
  const search = String(req.query.search || '').trim().toLowerCase();
  const status = String(req.query.status || 'all').trim().toLowerCase();
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();
  const clauses = [];
  const params = [];

  if (search) {
    clauses.push(`(
      LOWER(COALESCE(public_id, '')) LIKE ?
      OR LOWER(COALESCE(passenger_name, '')) LIKE ?
      OR LOWER(COALESCE(driver_name, '')) LIKE ?
      OR LOWER(COALESCE(pickup_label, '')) LIKE ?
      OR LOWER(COALESCE(dropoff_label, '')) LIKE ?
    )`);
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam, searchParam, searchParam);
  }

  if (status === 'requested') {
    clauses.push(`status IN ('requested', 'driver_found')`);
  } else if (status === 'in_progress') {
    clauses.push(`status IN ('driver_assigned', 'driver_arrived', 'in_progress')`);
  } else if (status === 'completed') {
    clauses.push(`status = 'completed'`);
  } else if (status === 'cancelled') {
    clauses.push(`status IN ('cancelled', 'expired')`);
  }

  if (dateFrom) {
    clauses.push(`DATE(requested_at) >= ?`);
    params.push(dateFrom);
  }

  if (dateTo) {
    clauses.push(`DATE(requested_at) <= ?`);
    params.push(dateTo);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function normalizePanicAlertStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePanicFollowUpStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePanicCasePriority(value) {
  return String(value || '').trim().toLowerCase();
}

router.get('/', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 10, 1), 100);
    const offset = (page - 1) * pageSize;
    const { whereSql, params } = buildRideFilters(req);

    const [rows, summaryRows, countRows, panicAlertRows, lostItemRows] = await Promise.all([
      query(
        `SELECT
          rr.id,
          rr.public_id,
          rr.passenger_name,
          rr.driver_name,
          rr.pickup_label,
          rr.dropoff_label,
          rr.estimated_amount,
          rr.original_estimated_amount,
          rr.discount_amount,
          rr.final_estimated_amount,
          rr.driver_reimbursement_amount,
          rr.discount_code,
          rr.tip_amount,
          rr.status,
          rr.requested_tier_name,
          rr.requested_at,
          rr.completed_at,
          rr.cancelled_at,
          COALESCE(li.open_lost_items, 0) AS open_lost_items,
          COALESCE(pa.open_panic_alerts, 0) AS open_panic_alerts
        FROM ride_requests rr
        LEFT JOIN (
          SELECT ride_request_id, COUNT(*) AS open_lost_items
          FROM ride_lost_items
          WHERE status IN ('open', 'contacted')
          GROUP BY ride_request_id
        ) li ON li.ride_request_id = rr.id
        LEFT JOIN (
          SELECT ride_request_id, COUNT(*) AS open_panic_alerts
          FROM ride_panic_alerts
          WHERE status = 'open'
          GROUP BY ride_request_id
        ) pa ON pa.ride_request_id = rr.id
        ${whereSql}
        ORDER BY rr.requested_at DESC, rr.id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
        params
      ),
      query(
        `SELECT status, COUNT(*) AS total
         FROM ride_requests
         ${whereSql}
         GROUP BY status`,
        params
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM ride_requests
         ${whereSql}`,
        params
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM ride_panic_alerts
         WHERE status = 'open'`
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM ride_lost_items
         WHERE status IN ('open', 'contacted')`
      ),
    ]);

    const summary = {
      activeTrips: 0,
      completed: 0,
      cancelled: 0,
      requested: 0,
      panicAlerts: Number(panicAlertRows?.[0]?.total || 0),
      lostItems: Number(lostItemRows?.[0]?.total || 0),
    };

    for (const row of summaryRows) {
      const status = String(row.status || '');
      const total = Number(row.total || 0);
      if (['driver_assigned', 'driver_arrived', 'in_progress'].includes(status)) summary.activeTrips += total;
      else if (status === 'completed') summary.completed += total;
      else if (status === 'cancelled' || status === 'expired') summary.cancelled += total;
      else summary.requested += total;
    }

    const total = Number(countRows?.[0]?.total || 0);
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);

    return res.json({
      summary,
      rides: rows.map((row) => ({
        rowId: row.id,
        id: row.public_id,
        rider: row.passenger_name || 'Passenger',
        driver: row.driver_name || 'No driver assigned',
        route: `${row.pickup_label} -> ${row.dropoff_label}`,
        fare: `$${Number(row.final_estimated_amount || row.estimated_amount || 0).toFixed(2)}`,
        fareAmount: Number(row.final_estimated_amount || row.estimated_amount || 0),
        originalEstimatedAmount: Number(row.original_estimated_amount || row.estimated_amount || 0),
        discountAmount: Number(row.discount_amount || 0),
        driverReimbursementAmount: Number(row.driver_reimbursement_amount || 0),
        discountCode: row.discount_code || null,
        tipAmount: Number(row.tip_amount || 0),
        totalAmount: Number(row.final_estimated_amount || row.estimated_amount || 0) + Number(row.tip_amount || 0),
        payment: 'Cash',
        status: mapRideStatus(row.status),
        rawStatus: row.status,
        tierName: row.requested_tier_name,
        openLostItems: Number(row.open_lost_items || 0),
        openPanicAlerts: Number(row.open_panic_alerts || 0),
        requestedAt: row.requested_at,
        completedAt: row.completed_at,
        cancelledAt: row.cancelled_at,
      })),
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (err) {
    console.error('GET /api/admin/rides', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/live-map', requireAdminAuth, requirePermission('live_map.read'), async (req, res) => {
  try {
    const placeSearch = String(req.query.placeSearch || '').trim().toLowerCase();
    const driverRows = await query(
      `SELECT
         da.driver_user_id,
         da.driver_name,
         da.is_online,
         da.current_lat,
         da.current_lng,
         da.last_seen_at,
         rr.id AS ride_request_id,
         rr.public_id,
         rr.passenger_name,
         rr.pickup_label,
         rr.dropoff_label,
         rr.pickup_lat,
         rr.pickup_lng,
         rr.dropoff_lat,
         rr.dropoff_lng,
         rr.status AS ride_status
       FROM driver_availability da
       LEFT JOIN ride_requests rr
         ON rr.driver_user_id = da.driver_user_id
        AND rr.status IN ('driver_assigned', 'driver_arrived', 'in_progress')
       WHERE da.current_lat IS NOT NULL
         AND da.current_lng IS NOT NULL
       ORDER BY da.updated_at DESC`
    );

    const tripRows = await query(
      `SELECT
         id,
         public_id,
         passenger_user_id,
         passenger_name,
         driver_user_id,
         driver_name,
         requested_tier_name,
         pickup_label,
         dropoff_label,
         pickup_lat,
         pickup_lng,
         dropoff_lat,
         dropoff_lng,
         status
       FROM ride_requests
       WHERE status IN ('driver_assigned', 'driver_arrived', 'in_progress')
       ORDER BY COALESCE(arrived_at, assigned_at, requested_at) DESC`
    );

    let searchContext = null;
    if (placeSearch) {
      const placeRows = await query(
        `SELECT
           pickup_label,
           dropoff_label,
           pickup_lat,
           pickup_lng,
           dropoff_lat,
           dropoff_lng
         FROM ride_requests
         WHERE (
           LOWER(COALESCE(pickup_label, '')) LIKE ?
           OR LOWER(COALESCE(dropoff_label, '')) LIKE ?
         )
           AND (
             (pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL)
             OR (dropoff_lat IS NOT NULL AND dropoff_lng IS NOT NULL)
           )
         ORDER BY requested_at DESC
         LIMIT 20`,
        [`%${placeSearch}%`, `%${placeSearch}%`]
      );

      const anchorPoints = [];
      placeRows.forEach((row) => {
        if (row.pickup_lat !== null && row.pickup_lng !== null) {
          anchorPoints.push({ lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) });
        }
        if (row.dropoff_lat !== null && row.dropoff_lng !== null) {
          anchorPoints.push({ lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) });
        }
      });

      if (anchorPoints.length > 0) {
        const anchor = {
          lat: anchorPoints.reduce((sum, point) => sum + point.lat, 0) / anchorPoints.length,
          lng: anchorPoints.reduce((sum, point) => sum + point.lng, 0) / anchorPoints.length,
        };

        searchContext = {
          query: placeSearch,
          anchor,
          matchedPlaces: placeRows.length,
          radiusKm: LIVE_MAP_PLACE_RADIUS_KM,
        };

        const driverNearMatch = (row) => {
          const rowPoint = { lat: Number(row.current_lat), lng: Number(row.current_lng) };
          const routeText = [row.pickup_label, row.dropoff_label, row.passenger_name].filter(Boolean).join(' ').toLowerCase();
          return routeText.includes(placeSearch) || calculateDistanceKm(anchor, rowPoint) <= LIVE_MAP_PLACE_RADIUS_KM;
        };

        const tripNearMatch = (row) => {
          const routeText = [row.pickup_label, row.dropoff_label, row.passenger_name, row.driver_name].filter(Boolean).join(' ').toLowerCase();
          const pickupDistance = row.pickup_lat !== null && row.pickup_lng !== null
            ? calculateDistanceKm(anchor, { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) })
            : Infinity;
          const dropoffDistance = row.dropoff_lat !== null && row.dropoff_lng !== null
            ? calculateDistanceKm(anchor, { lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) })
            : Infinity;
          return routeText.includes(placeSearch) || pickupDistance <= LIVE_MAP_PLACE_RADIUS_KM || dropoffDistance <= LIVE_MAP_PLACE_RADIUS_KM;
        };

        driverRows.splice(0, driverRows.length, ...driverRows.filter(driverNearMatch));
        tripRows.splice(0, tripRows.length, ...tripRows.filter(tripNearMatch));
      } else {
        searchContext = {
          query: placeSearch,
          anchor: null,
          matchedPlaces: 0,
          radiusKm: LIVE_MAP_PLACE_RADIUS_KM,
        };
        driverRows.splice(0, driverRows.length);
        tripRows.splice(0, tripRows.length);
      }
    }

    const allPoints = [];
    driverRows.forEach((row) => {
      if (row.current_lat !== null && row.current_lng !== null) {
        allPoints.push({ lat: Number(row.current_lat), lng: Number(row.current_lng) });
      }
      if (row.pickup_lat !== null && row.pickup_lng !== null) {
        allPoints.push({ lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) });
      }
      if (row.dropoff_lat !== null && row.dropoff_lng !== null) {
        allPoints.push({ lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) });
      }
    });
    tripRows.forEach((row) => {
      if (row.pickup_lat !== null && row.pickup_lng !== null) {
        allPoints.push({ lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) });
      }
      if (row.dropoff_lat !== null && row.dropoff_lng !== null) {
        allPoints.push({ lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) });
      }
    });

    const bounds = allPoints.length
      ? {
          minLat: Math.min(...allPoints.map((point) => point.lat)),
          maxLat: Math.max(...allPoints.map((point) => point.lat)),
          minLng: Math.min(...allPoints.map((point) => point.lng)),
          maxLng: Math.max(...allPoints.map((point) => point.lng)),
        }
      : null;

    const summary = {
      totalDrivers: driverRows.length,
      availableDrivers: driverRows.filter((row) => row.is_online && !row.ride_status).length,
      pickupDrivers: driverRows.filter((row) => row.ride_status === 'driver_arrived').length,
      onTripDrivers: driverRows.filter((row) => row.ride_status === 'in_progress').length,
      activeTrips: tripRows.length,
    };

    return res.json({
      summary,
      bounds,
      searchContext,
      refreshedAt: new Date().toISOString(),
      drivers: driverRows.map((row) => ({
        id: row.driver_user_id,
        name: row.driver_name || 'Driver',
        status: row.ride_status === 'in_progress'
          ? 'On Trip'
          : row.ride_status === 'driver_arrived'
            ? 'Pickup'
            : row.is_online
              ? 'Available'
              : 'Offline',
        lat: Number(row.current_lat),
        lng: Number(row.current_lng),
        lastSeenAt: row.last_seen_at || null,
        rideRequestId: row.ride_request_id || null,
        publicId: row.public_id || null,
        passengerName: row.passenger_name || null,
        route: row.pickup_label && row.dropoff_label ? `${row.pickup_label} -> ${row.dropoff_label}` : null,
        pickupCoordinate: row.pickup_lat === null || row.pickup_lng === null
          ? null
          : { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) },
        dropoffCoordinate: row.dropoff_lat === null || row.dropoff_lng === null
          ? null
          : { lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) },
      })),
      trips: tripRows.map((row) => ({
        rowId: row.id,
        id: row.public_id,
        rider: row.passenger_name || 'Passenger',
        riderUserId: row.passenger_user_id || null,
        driver: row.driver_name || 'Driver',
        driverUserId: row.driver_user_id || null,
        tierName: row.requested_tier_name || null,
        stage: row.status === 'in_progress'
          ? 'In Progress'
          : row.status === 'driver_arrived'
            ? 'Waiting for Customer'
            : 'Driver Arriving',
        route: `${row.pickup_label} -> ${row.dropoff_label}`,
        pickupCoordinate: {
          lat: Number(row.pickup_lat),
          lng: Number(row.pickup_lng),
        },
        dropoffCoordinate: {
          lat: Number(row.dropoff_lat),
          lng: Number(row.dropoff_lng),
        },
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/rides/live-map', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/panic-alerts', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
  try {
    const status = normalizePanicAlertStatus(req.query.status || 'open');
    const search = String(req.query.search || '').trim().toLowerCase();
    const clauses = [];
    const params = [];

    if (status && status !== 'all') {
      clauses.push('pa.status = ?');
      params.push(status);
    }

    if (search) {
      const searchParam = `%${search}%`;
      clauses.push(`(
        LOWER(COALESCE(pa.actor_name, '')) LIKE ?
        OR LOWER(COALESCE(pa.message, '')) LIKE ?
        OR LOWER(COALESCE(pa.case_reference, '')) LIKE ?
        OR LOWER(COALESCE(rr.public_id, '')) LIKE ?
        OR LOWER(COALESCE(rr.passenger_name, '')) LIKE ?
        OR LOWER(COALESCE(rr.driver_name, '')) LIKE ?
        OR LOWER(COALESCE(rr.pickup_label, '')) LIKE ?
        OR LOWER(COALESCE(rr.dropoff_label, '')) LIKE ?
      )`);
      params.push(searchParam, searchParam, searchParam, searchParam, searchParam, searchParam, searchParam, searchParam);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await query(
      `SELECT
         pa.id,
         pa.ride_request_id,
         pa.ride_public_id,
         pa.actor_role,
         pa.actor_user_id,
         pa.actor_name,
         pa.ride_status,
         pa.alert_stage,
         pa.message,
         pa.case_reference,
         pa.case_priority,
         pa.latitude,
         pa.longitude,
         pa.status,
         pa.admin_note,
         pa.assigned_admin_id,
         pa.follow_up_status,
         pa.follow_up_note,
         pa.follow_up_due_at,
         pa.last_followed_up_at,
         pa.resolved_at,
         pa.created_at,
         pa.updated_at,
         rr.public_id AS trip_public_id,
         rr.passenger_name,
         rr.driver_name,
         rr.pickup_label,
         rr.dropoff_label
       FROM ride_panic_alerts pa
       LEFT JOIN ride_requests rr
         ON rr.id = pa.ride_request_id
       ${whereSql}
       ORDER BY
         CASE pa.status
           WHEN 'open' THEN 0
           WHEN 'reviewed' THEN 1
           ELSE 2
         END,
         CASE pa.case_priority
           WHEN 'critical' THEN 0
           WHEN 'high' THEN 1
           ELSE 2
         END,
         pa.created_at DESC,
         pa.id DESC`,
      params,
    );

    return res.json({
      panicAlerts: (rows || []).map((row) => ({
        id: row.id,
        rideRequestId: row.ride_request_id,
        ridePublicId: row.ride_public_id || row.trip_public_id || null,
        actorRole: row.actor_role,
        actorUserId: row.actor_user_id,
        actorName: row.actor_name || null,
        rideStatus: row.ride_status,
        alertStage: row.alert_stage || null,
        message: row.message || null,
        caseReference: row.case_reference || null,
        casePriority: row.case_priority || 'critical',
        latitude: row.latitude === null ? null : Number(row.latitude),
        longitude: row.longitude === null ? null : Number(row.longitude),
        status: row.status,
        adminNote: row.admin_note || null,
        assignedAdminId: row.assigned_admin_id === null ? null : Number(row.assigned_admin_id),
        followUpStatus: row.follow_up_status || 'pending',
        followUpNote: row.follow_up_note || null,
        followUpDueAt: row.follow_up_due_at || null,
        lastFollowedUpAt: row.last_followed_up_at || null,
        resolvedAt: row.resolved_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        rider: row.passenger_name || 'Passenger',
        driver: row.driver_name || 'No driver assigned',
        route: `${row.pickup_label || '-'} -> ${row.dropoff_label || '-'}`,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/rides/panic-alerts', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/lost-items', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
  try {
    const status = String(req.query?.status || 'open').trim().toLowerCase();
    const search = String(req.query?.search || '').trim();

    const where = [];
    const params = [];

    if (status && status !== 'all') {
      where.push('li.status = ?');
      params.push(status);
    }

    if (search) {
      where.push(`(
        li.case_reference LIKE ?
        OR li.item_description LIKE ?
        OR li.contact_phone LIKE ?
        OR rr.public_id LIKE ?
        OR rr.passenger_name LIKE ?
        OR rr.driver_name LIKE ?
        OR rr.pickup_label LIKE ?
        OR rr.dropoff_label LIKE ?
      )`);
      const likeValue = `%${search}%`;
      params.push(likeValue, likeValue, likeValue, likeValue, likeValue, likeValue, likeValue, likeValue);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await query(
      `SELECT
         li.id,
         li.ride_request_id,
         li.ride_public_id,
         li.passenger_user_id,
         li.driver_user_id,
         li.item_description,
         li.contact_phone,
         li.case_reference,
         li.case_priority,
         li.status,
         li.admin_note,
         li.assigned_admin_id,
         li.follow_up_status,
         li.follow_up_note,
         li.follow_up_due_at,
         li.last_followed_up_at,
         li.resolved_at,
         li.created_at,
         li.updated_at,
         rr.public_id AS trip_public_id,
         rr.passenger_name,
         rr.driver_name,
         rr.pickup_label,
         rr.dropoff_label
       FROM ride_lost_items li
       LEFT JOIN ride_requests rr
         ON rr.id = li.ride_request_id
       ${whereSql}
       ORDER BY
         CASE li.status
           WHEN 'open' THEN 0
           WHEN 'contacted' THEN 1
           WHEN 'returned' THEN 2
           ELSE 3
         END,
         CASE li.case_priority
           WHEN 'high' THEN 0
           ELSE 1
         END,
         li.created_at DESC,
         li.id DESC`,
      params,
    );

    return res.json({
      lostItems: (rows || []).map((row) => ({
        id: row.id,
        rideRequestId: row.ride_request_id,
        ridePublicId: row.ride_public_id || row.trip_public_id || null,
        passengerUserId: row.passenger_user_id || null,
        driverUserId: row.driver_user_id || null,
        itemDescription: row.item_description,
        contactPhone: row.contact_phone || null,
        caseReference: row.case_reference || null,
        casePriority: row.case_priority || 'normal',
        status: row.status,
        adminNote: row.admin_note || null,
        assignedAdminId: row.assigned_admin_id === null ? null : Number(row.assigned_admin_id),
        followUpStatus: row.follow_up_status || 'pending',
        followUpNote: row.follow_up_note || null,
        followUpDueAt: row.follow_up_due_at || null,
        lastFollowedUpAt: row.last_followed_up_at || null,
        resolvedAt: row.resolved_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        rider: row.passenger_name || 'Passenger',
        driver: row.driver_name || 'No driver assigned',
        route: `${row.pickup_label || '-'} -> ${row.dropoff_label || '-'}`,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/rides/lost-items', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/lost-items/:lostItemId', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
  try {
    const lostItemId = Number(req.params.lostItemId);
    if (!Number.isFinite(lostItemId) || lostItemId <= 0) {
      return res.status(400).json({ error: 'Valid lost item id is required' });
    }

    const status = String(req.body?.status || '').trim().toLowerCase();
    const followUpStatus = String(req.body?.followUpStatus || '').trim().toLowerCase();
    const adminNote = String(req.body?.adminNote || '').trim();
    const followUpNote = String(req.body?.followUpNote || '').trim();
    const casePriority = String(req.body?.casePriority || '').trim().toLowerCase();
    const followUpDueAt = String(req.body?.followUpDueAt || '').trim() || null;

    if (status && !['open', 'contacted', 'returned', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid lost item status' });
    }
    if (followUpStatus && !['pending', 'contacted', 'resolved', 'closed'].includes(followUpStatus)) {
      return res.status(400).json({ error: 'Invalid follow-up status' });
    }
    if (casePriority && !['normal', 'high'].includes(casePriority)) {
      return res.status(400).json({ error: 'Invalid case priority' });
    }

    await query(
      `UPDATE ride_lost_items
       SET status = COALESCE(NULLIF(?, ''), status),
           admin_note = ?,
           case_priority = COALESCE(NULLIF(?, ''), case_priority),
           assigned_admin_id = ?,
           follow_up_status = COALESCE(NULLIF(?, ''), follow_up_status),
           follow_up_note = ?,
           follow_up_due_at = ?,
           last_followed_up_at = CURRENT_TIMESTAMP,
           resolved_at = CASE
             WHEN COALESCE(NULLIF(?, ''), status) IN ('returned', 'closed') OR COALESCE(NULLIF(?, ''), follow_up_status) IN ('resolved', 'closed')
               THEN COALESCE(resolved_at, CURRENT_TIMESTAMP)
             ELSE resolved_at
           END
       WHERE id = ?`,
      [
        status,
        adminNote || null,
        casePriority,
        req.admin.id,
        followUpStatus,
        followUpNote || null,
        followUpDueAt,
        status,
        followUpStatus,
        lostItemId,
      ]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/admin/rides/lost-items/:lostItemId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/panic-alerts/:alertId', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
  try {
    const alertId = Number(req.params.alertId);
    if (!Number.isFinite(alertId) || alertId <= 0) {
      return res.status(400).json({ error: 'Valid panic alert id is required' });
    }

    const status = normalizePanicAlertStatus(req.body?.status);
    const followUpStatus = normalizePanicFollowUpStatus(req.body?.followUpStatus);
    const adminNote = String(req.body?.adminNote || '').trim();
    const followUpNote = String(req.body?.followUpNote || '').trim();
    const casePriority = normalizePanicCasePriority(req.body?.casePriority);
    const followUpDueAt = String(req.body?.followUpDueAt || '').trim() || null;

    if (status && !['open', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid panic alert status' });
    }
    if (followUpStatus && !['pending', 'contacted', 'monitoring', 'police_alerted', 'resolved'].includes(followUpStatus)) {
      return res.status(400).json({ error: 'Invalid follow-up status' });
    }
    if (casePriority && !['high', 'critical'].includes(casePriority)) {
      return res.status(400).json({ error: 'Invalid case priority' });
    }

    await query(
      `UPDATE ride_panic_alerts
       SET status = COALESCE(NULLIF(?, ''), status),
           admin_note = ?,
           case_priority = COALESCE(NULLIF(?, ''), case_priority),
           assigned_admin_id = ?,
           follow_up_status = COALESCE(NULLIF(?, ''), follow_up_status),
           follow_up_note = ?,
           follow_up_due_at = ?,
           last_followed_up_at = CURRENT_TIMESTAMP,
           resolved_at = CASE
             WHEN COALESCE(NULLIF(?, ''), status) = 'resolved' OR COALESCE(NULLIF(?, ''), follow_up_status) = 'resolved'
               THEN COALESCE(resolved_at, CURRENT_TIMESTAMP)
             ELSE resolved_at
           END
       WHERE id = ?`,
      [
        status,
        adminNote || null,
        casePriority,
        req.admin.id,
        followUpStatus,
        followUpNote || null,
        followUpDueAt,
        status,
        followUpStatus,
        alertId,
      ]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/admin/rides/panic-alerts/:alertId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:rideId', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
  try {
    const rideId = String(req.params.rideId || '').trim();
    if (!rideId) {
      return res.status(400).json({ error: 'Invalid ride id' });
    }

    const [rideRows, lostItems, panicAlerts] = await Promise.all([
      query(
        `SELECT
        id,
        public_id,
        passenger_user_id,
        passenger_name,
        passenger_phone,
        driver_user_id,
        driver_name,
        requested_tier_key,
        requested_tier_name,
        pickup_label,
        dropoff_label,
        intermediate_stops_json,
        current_stop_index,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
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
        discount_code,
        tip_amount,
        status,
        requested_at,
        assigned_at,
        arrived_at,
        started_at,
        completed_at,
        actual_distance_km,
        actual_minutes,
        cancelled_at,
        cancellation_reason,
        passenger_driver_rating,
        passenger_driver_review,
        passenger_driver_feedback_tags,
        passenger_driver_rated_at,
        driver_passenger_rating,
        driver_passenger_review,
        driver_passenger_feedback_tags,
        driver_passenger_rated_at
      FROM ride_requests
      WHERE public_id = ? OR id = ?
      LIMIT 1`,
        [rideId, Number(rideId) || -1]
      ),
      query(
        `SELECT
           id,
           item_description,
           contact_phone,
           case_reference,
           case_priority,
           status,
           admin_note,
           assigned_admin_id,
           follow_up_status,
           follow_up_note,
           follow_up_due_at,
           last_followed_up_at,
           resolved_at,
           created_at,
           updated_at
         FROM ride_lost_items
         WHERE ride_public_id = ? OR ride_request_id = ?
         ORDER BY created_at DESC, id DESC`,
        [rideId, Number(rideId) || -1]
      ),
      query(
        `SELECT
           id,
           actor_role,
           actor_user_id,
           actor_name,
           ride_status,
           alert_stage,
           message,
           case_reference,
           case_priority,
           latitude,
           longitude,
           status,
           admin_note,
           assigned_admin_id,
           follow_up_status,
           follow_up_note,
           follow_up_due_at,
           last_followed_up_at,
           resolved_at,
           created_at,
           updated_at
         FROM ride_panic_alerts
         WHERE ride_public_id = ? OR ride_request_id = ?
         ORDER BY created_at DESC, id DESC`,
        [rideId, Number(rideId) || -1]
      ),
    ]);

    const row = rideRows?.[0];

    if (!row) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    return res.json({
      ride: {
        id: row.id,
        publicId: row.public_id,
        rider: row.passenger_name || 'Passenger',
        riderPhone: row.passenger_phone || null,
        riderUserId: row.passenger_user_id || null,
        driver: row.driver_name || 'No driver assigned',
        driverUserId: row.driver_user_id || null,
        status: mapRideStatus(row.status),
        rawStatus: row.status,
        tierKey: row.requested_tier_key || null,
        tierName: row.requested_tier_name || null,
        pickupLabel: row.pickup_label,
        dropoffLabel: row.dropoff_label,
        ...buildRideStopsPayload(row),
        pickupLat: row.pickup_lat === null ? null : Number(row.pickup_lat),
        pickupLng: row.pickup_lng === null ? null : Number(row.pickup_lng),
        dropoffLat: row.dropoff_lat === null ? null : Number(row.dropoff_lat),
        dropoffLng: row.dropoff_lng === null ? null : Number(row.dropoff_lng),
        routePolyline: row.route_polyline || null,
        routeDistanceKm: row.route_distance_km === null ? null : Number(row.route_distance_km),
        routeDurationMinutes: row.route_duration_minutes === null ? null : Number(row.route_duration_minutes),
        estimatedDistanceKm: Number(row.estimated_distance_km || 0),
        estimatedMinutes: Number(row.estimated_minutes || 0),
        estimatedAmount: Number(row.final_estimated_amount || row.estimated_amount || 0),
        originalEstimatedAmount: Number(row.original_estimated_amount || row.estimated_amount || 0),
        discountAmount: Number(row.discount_amount || 0),
        driverReimbursementAmount: Number(row.driver_reimbursement_amount || 0),
        discountCode: row.discount_code || null,
        tipAmount: Number(row.tip_amount || 0),
        totalAmount: Number(row.final_estimated_amount || row.estimated_amount || 0) + Number(row.tip_amount || 0),
        requestedAt: row.requested_at || null,
        assignedAt: row.assigned_at || null,
        arrivedAt: row.arrived_at || null,
        startedAt: row.started_at || null,
        completedAt: row.completed_at || null,
        actualDistanceKm: row.actual_distance_km === null ? null : Number(row.actual_distance_km),
        actualMinutes: row.actual_minutes === null ? null : Number(row.actual_minutes),
        cancelledAt: row.cancelled_at || null,
        cancellationReason: row.cancellation_reason || null,
        passengerDriverRating: row.passenger_driver_rating === null ? null : Number(row.passenger_driver_rating),
        passengerDriverReview: row.passenger_driver_review || '',
        passengerDriverFeedbackTags: (() => {
          try {
            const parsed = JSON.parse(row.passenger_driver_feedback_tags || '[]');
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })(),
        passengerDriverRatedAt: row.passenger_driver_rated_at || null,
        driverPassengerRating: row.driver_passenger_rating === null ? null : Number(row.driver_passenger_rating),
        driverPassengerReview: row.driver_passenger_review || '',
        driverPassengerFeedbackTags: (() => {
          try {
            const parsed = JSON.parse(row.driver_passenger_feedback_tags || '[]');
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })(),
        driverPassengerRatedAt: row.driver_passenger_rated_at || null,
      },
      lostItems: (lostItems || []).map((item) => ({
        id: item.id,
        itemDescription: item.item_description,
        contactPhone: item.contact_phone || null,
        caseReference: item.case_reference || null,
        casePriority: item.case_priority || 'normal',
        status: item.status,
        adminNote: item.admin_note || null,
        assignedAdminId: item.assigned_admin_id === null ? null : Number(item.assigned_admin_id),
        followUpStatus: item.follow_up_status || 'pending',
        followUpNote: item.follow_up_note || null,
        followUpDueAt: item.follow_up_due_at || null,
        lastFollowedUpAt: item.last_followed_up_at || null,
        resolvedAt: item.resolved_at || null,
        createdAt: item.created_at || null,
        updatedAt: item.updated_at || null,
      })),
      panicAlerts: (panicAlerts || []).map((alert) => ({
        id: alert.id,
        actorRole: alert.actor_role,
        actorUserId: alert.actor_user_id,
        actorName: alert.actor_name || null,
        rideStatus: alert.ride_status,
        alertStage: alert.alert_stage || null,
        message: alert.message || null,
        caseReference: alert.case_reference || null,
        casePriority: alert.case_priority || 'critical',
        latitude: alert.latitude === null ? null : Number(alert.latitude),
        longitude: alert.longitude === null ? null : Number(alert.longitude),
        status: alert.status,
        adminNote: alert.admin_note || null,
        assignedAdminId: alert.assigned_admin_id === null ? null : Number(alert.assigned_admin_id),
        followUpStatus: alert.follow_up_status || 'pending',
        followUpNote: alert.follow_up_note || null,
        followUpDueAt: alert.follow_up_due_at || null,
        lastFollowedUpAt: alert.last_followed_up_at || null,
        resolvedAt: alert.resolved_at || null,
        createdAt: alert.created_at || null,
        updatedAt: alert.updated_at || null,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/rides/:rideId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:rideId/lost-items/:lostItemId', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
  try {
    const rideId = String(req.params.rideId || '').trim();
    const lostItemId = Number(req.params.lostItemId);
    if (!rideId || !Number.isFinite(lostItemId) || lostItemId <= 0) {
      return res.status(400).json({ error: 'Valid ride and lost item ids are required' });
    }

    const status = String(req.body?.status || '').trim().toLowerCase();
    const followUpStatus = String(req.body?.followUpStatus || '').trim().toLowerCase();
    const adminNote = String(req.body?.adminNote || '').trim();
    const followUpNote = String(req.body?.followUpNote || '').trim();
    const casePriority = String(req.body?.casePriority || '').trim().toLowerCase();
    const followUpDueAt = String(req.body?.followUpDueAt || '').trim() || null;

    if (status && !['open', 'contacted', 'returned', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid lost item status' });
    }
    if (followUpStatus && !['pending', 'contacted', 'resolved', 'closed'].includes(followUpStatus)) {
      return res.status(400).json({ error: 'Invalid follow-up status' });
    }
    if (casePriority && !['normal', 'high'].includes(casePriority)) {
      return res.status(400).json({ error: 'Invalid case priority' });
    }

    await query(
      `UPDATE ride_lost_items
       SET status = COALESCE(NULLIF(?, ''), status),
           admin_note = ?,
           case_priority = COALESCE(NULLIF(?, ''), case_priority),
           assigned_admin_id = ?,
           follow_up_status = COALESCE(NULLIF(?, ''), follow_up_status),
           follow_up_note = ?,
           follow_up_due_at = ?,
           last_followed_up_at = CURRENT_TIMESTAMP,
           resolved_at = CASE
             WHEN COALESCE(NULLIF(?, ''), status) IN ('returned', 'closed') OR COALESCE(NULLIF(?, ''), follow_up_status) IN ('resolved', 'closed')
               THEN COALESCE(resolved_at, CURRENT_TIMESTAMP)
             ELSE resolved_at
           END
       WHERE id = ?
         AND (ride_public_id = ? OR ride_request_id = ?)`,
      [
        status,
        adminNote || null,
        casePriority,
        req.admin.id,
        followUpStatus,
        followUpNote || null,
        followUpDueAt,
        status,
        followUpStatus,
        lostItemId,
        rideId,
        Number(rideId) || -1,
      ]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/admin/rides/:rideId/lost-items/:lostItemId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:rideId/panic-alerts/:alertId', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
  try {
    const rideId = String(req.params.rideId || '').trim();
    const alertId = Number(req.params.alertId);
    if (!rideId || !Number.isFinite(alertId) || alertId <= 0) {
      return res.status(400).json({ error: 'Valid ride and alert ids are required' });
    }

    const status = String(req.body?.status || '').trim().toLowerCase();
    const followUpStatus = String(req.body?.followUpStatus || '').trim().toLowerCase();
    const adminNote = String(req.body?.adminNote || '').trim();
    const followUpNote = String(req.body?.followUpNote || '').trim();
    const casePriority = String(req.body?.casePriority || '').trim().toLowerCase();
    const followUpDueAt = String(req.body?.followUpDueAt || '').trim() || null;

    if (status && !['open', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid panic alert status' });
    }
    if (followUpStatus && !['pending', 'contacted', 'monitoring', 'police_alerted', 'resolved'].includes(followUpStatus)) {
      return res.status(400).json({ error: 'Invalid follow-up status' });
    }
    if (casePriority && !['high', 'critical'].includes(casePriority)) {
      return res.status(400).json({ error: 'Invalid case priority' });
    }

    await query(
      `UPDATE ride_panic_alerts
       SET status = COALESCE(NULLIF(?, ''), status),
           admin_note = ?,
           case_priority = COALESCE(NULLIF(?, ''), case_priority),
           assigned_admin_id = ?,
           follow_up_status = COALESCE(NULLIF(?, ''), follow_up_status),
           follow_up_note = ?,
           follow_up_due_at = ?,
           last_followed_up_at = CURRENT_TIMESTAMP,
           resolved_at = CASE
             WHEN COALESCE(NULLIF(?, ''), status) = 'resolved' OR COALESCE(NULLIF(?, ''), follow_up_status) = 'resolved'
               THEN COALESCE(resolved_at, CURRENT_TIMESTAMP)
             ELSE resolved_at
           END
       WHERE id = ?
         AND (ride_public_id = ? OR ride_request_id = ?)`,
      [
        status,
        adminNote || null,
        casePriority,
        req.admin.id,
        followUpStatus,
        followUpNote || null,
        followUpDueAt,
        status,
        followUpStatus,
        alertId,
        rideId,
        Number(rideId) || -1,
      ]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/admin/rides/:rideId/panic-alerts/:alertId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
