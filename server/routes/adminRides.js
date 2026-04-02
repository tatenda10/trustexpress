import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';

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

router.get('/', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 10, 1), 100);
    const offset = (page - 1) * pageSize;
    const { whereSql, params } = buildRideFilters(req);

    const [rows, summaryRows, countRows] = await Promise.all([
      query(
        `SELECT
          id,
          public_id,
          passenger_name,
          driver_name,
          pickup_label,
          dropoff_label,
          estimated_amount,
          status,
          requested_tier_name,
          requested_at,
          completed_at,
          cancelled_at
        FROM ride_requests
        ${whereSql}
        ORDER BY requested_at DESC, id DESC
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
    ]);

    const summary = {
      activeTrips: 0,
      completed: 0,
      cancelled: 0,
      requested: 0,
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
        fare: `$${Number(row.estimated_amount || 0).toFixed(2)}`,
        payment: 'Cash',
        status: mapRideStatus(row.status),
        rawStatus: row.status,
        tierName: row.requested_tier_name,
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

router.get('/:rideId', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
  try {
    const rideId = String(req.params.rideId || '').trim();
    if (!rideId) {
      return res.status(400).json({ error: 'Invalid ride id' });
    }

    const [row] = await query(
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
        status,
        requested_at,
        assigned_at,
        arrived_at,
        started_at,
        completed_at,
        actual_distance_km,
        actual_minutes,
        cancelled_at,
        cancellation_reason
      FROM ride_requests
      WHERE public_id = ? OR id = ?
      LIMIT 1`,
      [rideId, Number(rideId) || -1]
    );

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
        pickupLat: row.pickup_lat === null ? null : Number(row.pickup_lat),
        pickupLng: row.pickup_lng === null ? null : Number(row.pickup_lng),
        dropoffLat: row.dropoff_lat === null ? null : Number(row.dropoff_lat),
        dropoffLng: row.dropoff_lng === null ? null : Number(row.dropoff_lng),
        routePolyline: row.route_polyline || null,
        routeDistanceKm: row.route_distance_km === null ? null : Number(row.route_distance_km),
        routeDurationMinutes: row.route_duration_minutes === null ? null : Number(row.route_duration_minutes),
        estimatedDistanceKm: Number(row.estimated_distance_km || 0),
        estimatedMinutes: Number(row.estimated_minutes || 0),
        estimatedAmount: Number(row.estimated_amount || 0),
        requestedAt: row.requested_at || null,
        assignedAt: row.assigned_at || null,
        arrivedAt: row.arrived_at || null,
        startedAt: row.started_at || null,
        completedAt: row.completed_at || null,
        actualDistanceKm: row.actual_distance_km === null ? null : Number(row.actual_distance_km),
        actualMinutes: row.actual_minutes === null ? null : Number(row.actual_minutes),
        cancelledAt: row.cancelled_at || null,
        cancellationReason: row.cancellation_reason || null,
      },
    });
  } catch (err) {
    console.error('GET /api/admin/rides/:rideId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
