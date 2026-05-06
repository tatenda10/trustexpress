import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { deleteEndUserAccount } from '../lib/account-deletion.js';
import { getClerkClient } from '../lib/clerk-client.js';
import { getDriverProfileImageReview, getPrimaryEmail, getPrimaryPhone, mergePrivateMetadata, normalizeRole } from '../lib/clerk-user.js';
import { evaluateVehicleAgainstTiers, loadVehicleTierRules } from '../lib/vehicle-tier-matching.js';
import { query } from '../db/connection.js';
import { getDriverIdentity, getDriverVehicle, normalizeUploadPath } from '../lib/driver-verification-mysql.js';

const router = Router();

/** Build admin driver row from Clerk user + MySQL identity/vehicle (source of truth for verification). */
function mapDriverFromClerkAndMysql(user, identityRow, vehicleRow) {
  const publicMeta = user.publicMetadata || {};
  const privateMeta = user.privateMetadata || {};
  const hasProfileDocuments = !!(
    identityRow?.national_id_front_url ||
    identityRow?.national_id_back_url ||
    identityRow?.driver_licence_url ||
    identityRow?.selfie_url ||
    identityRow?.selfie_with_id_card_url
  );
  const hasVehicleDocuments = !!(
    vehicleRow?.car_photo_front_url ||
    vehicleRow?.car_photo_rear_url ||
    vehicleRow?.car_photo_urls ||
    vehicleRow?.vehicle_registration_url ||
    vehicleRow?.vehicle_registration_book_url ||
    vehicleRow?.insurance_url ||
    vehicleRow?.zinara_url
  );
  const profile = identityRow
    ? {
        id: `profile_${user.id}`,
        status: identityRow.profile_status || 'pending',
        submittedAt: identityRow.profile_submitted_at ? new Date(identityRow.profile_submitted_at).toISOString() : null,
        rejectionReason: identityRow.profile_rejection_reason || null,
        hasDocuments: hasProfileDocuments,
        missingRequiredCount: [
          identityRow?.national_id_front_url,
          identityRow?.national_id_back_url,
          identityRow?.driver_licence_url,
          identityRow?.selfie_url,
          identityRow?.selfie_with_id_card_url,
        ].filter((value) => !value).length,
      }
    : null;
  const vehicle = vehicleRow
    ? {
        id: `vehicle_${user.id}`,
        status: vehicleRow.vehicle_status || 'pending',
        submittedAt: vehicleRow.vehicle_submitted_at ? new Date(vehicleRow.vehicle_submitted_at).toISOString() : null,
        make: vehicleRow.make || null,
        model: vehicleRow.model || null,
        numberPlate: vehicleRow.number_plate || null,
        vehicleTierKey: vehicleRow.vehicle_tier_key || null,
        vehicleTierName: vehicleRow.vehicle_tier_name || null,
        rejectionReason: vehicleRow.vehicle_rejection_reason || null,
        hasDocuments: hasVehicleDocuments,
        missingRequiredCount: [
          vehicleRow?.vehicle_registration_book_url || vehicleRow?.vehicle_registration_url,
          vehicleRow?.insurance_url,
          vehicleRow?.zinara_url,
          (() => {
            try {
              const parsed = vehicleRow?.car_photo_urls ? JSON.parse(vehicleRow.car_photo_urls) : [];
              return Array.isArray(parsed) && parsed.filter(Boolean).length >= 3
                ? 'ok'
                : vehicleRow?.car_photo_front_url && vehicleRow?.car_photo_rear_url
                  ? 'ok'
                  : null;
            } catch (_) {
              return vehicleRow?.car_photo_front_url && vehicleRow?.car_photo_rear_url ? 'ok' : null;
            }
          })(),
        ].filter((value) => !value).length,
      }
    : null;

  return {
    id: user.id,
    firstName: user.firstName || null,
    lastName: user.lastName || null,
    fullName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null,
    email: getPrimaryEmail(user),
    phoneNumber: privateMeta.phoneNumber || getPrimaryPhone(user) || null,
    createdAt: user.createdAt || null,
    phoneVerified: !!identityRow?.phone_verified_at,
    phoneVerifiedAt: identityRow?.phone_verified_at || null,
    profile,
    profileImageReview: getDriverProfileImageReview(privateMeta, 'driver'),
    vehicle,
    _role: normalizeRole(publicMeta.role),
  };
}

/** Build Clerk-style vehicle object from MySQL row for tier/specs helpers. */
function vehicleRowToMeta(vehicleRow) {
  if (!vehicleRow) return null;
  let carPhotoUrls = [];
  try {
    if (vehicleRow.car_photo_urls) carPhotoUrls = JSON.parse(vehicleRow.car_photo_urls);
  } catch (_) {}
  return {
    carPhotoFrontUrl: vehicleRow.car_photo_front_url,
    carPhotoRearUrl: vehicleRow.car_photo_rear_url,
    carPhotoUrls: Array.isArray(carPhotoUrls) ? carPhotoUrls : [],
    vehicleRegistrationUrl: vehicleRow.vehicle_registration_url,
    vehicleRegistrationBookUrl: vehicleRow.vehicle_registration_book_url,
    insuranceUrl: vehicleRow.insurance_url,
    year: vehicleRow.year,
    color: vehicleRow.color,
    vehicleTierKey: vehicleRow.vehicle_tier_key,
    vehicleTierName: vehicleRow.vehicle_tier_name,
    seatCount: vehicleRow.seat_count,
    doorCount: vehicleRow.door_count,
    vehicleCategory: vehicleRow.vehicle_category,
    hasAirConditioning: !!vehicleRow.has_air_conditioning,
    hasChargingPorts: !!vehicleRow.has_charging_ports,
    hasWifi: !!vehicleRow.has_wifi,
    hasLeatherSeats: !!vehicleRow.has_leather_seats,
    hasLargeLuggageSpace: !!vehicleRow.has_large_luggage_space,
    hasSlidingDoors: !!vehicleRow.has_sliding_doors,
    isHighEnd: !!vehicleRow.is_high_end,
  };
}

function mapVehicleSpecs(vehicle) {
  if (!vehicle) return null;
  return {
    seatCount: vehicle.seatCount ?? null,
    doorCount: vehicle.doorCount ?? null,
    vehicleCategory: vehicle.vehicleCategory || null,
    hasAirConditioning: vehicle.hasAirConditioning === true,
    hasChargingPorts: vehicle.hasChargingPorts === true,
    hasWifi: vehicle.hasWifi === true,
    hasLeatherSeats: vehicle.hasLeatherSeats === true,
    hasLargeLuggageSpace: vehicle.hasLargeLuggageSpace === true,
    hasSlidingDoors: vehicle.hasSlidingDoors === true,
    isHighEnd: vehicle.isHighEnd === true,
  };
}

function mapReferralRow(row) {
  if (!row) return null;
  return {
    agentUserId: row.agent_user_id,
    inviteId: row.invite_id,
    source: row.source || 'agent_deep_link',
    referredAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    agent: {
      id: row.agent_user_id,
      fullName: row.full_name || null,
      email: row.email || null,
      phoneNumber: row.phone_number || null,
      employeeCode: row.employee_code || null,
      idNumber: row.id_number || null,
      address: row.address || null,
    },
  };
}

function toDateValue(value) {
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveVerificationBucket(item) {
  const profileStatus = item.profile?.status || null;
  const vehicleStatus = item.vehicle?.status || null;
  const profileImageReviewStatus = item.profileImageReview?.status || null;
  const hasIncomingProfile = profileStatus === 'pending' && !!item.profile?.submittedAt && !!item.profile?.hasDocuments;
  const hasIncomingVehicle = vehicleStatus === 'pending' && !!item.vehicle?.submittedAt && !!item.vehicle?.hasDocuments;
  const hasIncomingProfileImage = profileImageReviewStatus === 'pending' && !!item.profileImageReview?.pendingImageUrl;
  const hasApprovedProfile = profileStatus === 'approved' && !!item.profile?.hasDocuments;
  const hasApprovedVehicle = vehicleStatus === 'approved' && !!item.vehicle?.hasDocuments;
  const hasIncoming = hasIncomingProfile || hasIncomingVehicle || hasIncomingProfileImage;
  const isVerified = hasApprovedProfile || hasApprovedVehicle;

  if (hasIncoming) return 'incoming';
  if (isVerified) return 'verified';
  return 'all';
}

function deriveVerificationType(item) {
  const profileStatus = item.profile?.status || null;
  const vehicleStatus = item.vehicle?.status || null;
  const profileImageReviewStatus = item.profileImageReview?.status || null;
  const hasIncomingProfile = profileStatus === 'pending' && !!item.profile?.submittedAt && !!item.profile?.hasDocuments;
  const hasIncomingVehicle = vehicleStatus === 'pending' && !!item.vehicle?.submittedAt && !!item.vehicle?.hasDocuments;
  const hasIncomingProfileImage = profileImageReviewStatus === 'pending' && !!item.profileImageReview?.pendingImageUrl;
  const hasApprovedProfile = profileStatus === 'approved' && !!item.profile?.hasDocuments;
  const hasApprovedVehicle = vehicleStatus === 'approved' && !!item.vehicle?.hasDocuments;

  if (hasIncomingProfileImage) {
    return 'profile_image';
  }

  if (hasIncomingVehicle || hasApprovedVehicle) {
    return 'vehicle';
  }

  if (hasIncomingProfile || hasApprovedProfile) {
    return 'identity';
  }

  return 'identity';
}

function toCsv(rows) {
  const headers = [
    'id',
    'email',
    'phoneNumber',
    'phoneVerified',
    'profileStatus',
    'vehicleStatus',
    'vehicleMake',
    'vehicleModel',
    'numberPlate',
    'createdAt',
  ];

  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const raw = String(value);
    if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.email,
        row.phoneNumber,
        row.phoneVerified ? 'true' : 'false',
        row.profile?.status || '',
        row.vehicle?.status || '',
        row.vehicle?.make || '',
        row.vehicle?.model || '',
        row.vehicle?.numberPlate || '',
        row.createdAt || '',
      ]
        .map(escape)
        .join(',')
    );
  }
  return lines.join('\n');
}

router.get('/', requireAdminAuth, requirePermission('drivers.read'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const verificationStatus = String(req.query.verificationStatus || 'all').toLowerCase();
    const verificationBucket = String(req.query.verificationBucket || 'all').toLowerCase();
    const verificationType = String(req.query.verificationType || 'all').toLowerCase();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 100);
    const sortBy = String(req.query.sortBy || 'createdAt');
    const sortOrder = String(req.query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const clerkClient = getClerkClient();
    const clerkPage = await clerkClient.users.getUserList({
      limit: 500,
      orderBy: '-created_at',
    });

    const users = (clerkPage.data || []).filter((u) => normalizeRole(u.publicMetadata?.role) === 'driver');
    const driverIds = users.map((u) => u.id);
    const identityByUser = new Map();
    const vehicleByUser = new Map();
    if (driverIds.length > 0) {
      const placeholders = driverIds.map(() => '?').join(',');
      const [identityRows, vehicleRows] = await Promise.all([
        query(`SELECT * FROM driver_identity WHERE driver_user_id IN (${placeholders})`, driverIds),
        query(`SELECT * FROM driver_vehicle WHERE driver_user_id IN (${placeholders})`, driverIds),
      ]);
      identityRows.forEach((r) => identityByUser.set(r.driver_user_id, r));
      vehicleRows.forEach((r) => vehicleByUser.set(r.driver_user_id, r));
    }

    let drivers = users.map((user) =>
      mapDriverFromClerkAndMysql(user, identityByUser.get(user.id) || null, vehicleByUser.get(user.id) || null)
    );

    if (search) {
      drivers = drivers.filter((item) => {
        const haystack = [
          item.id,
          item.email,
          item.phoneNumber,
          item.firstName,
          item.lastName,
          item.fullName,
          item.vehicle?.make,
          item.vehicle?.model,
          item.vehicle?.numberPlate,
          item.vehicle?.vehicleTierName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });
    }

    if (['pending', 'approved', 'rejected'].includes(verificationStatus)) {
      drivers = drivers.filter((item) => item.profile?.status === verificationStatus || item.vehicle?.status === verificationStatus);
    }

    if (['incoming', 'verified', 'all'].includes(verificationBucket) && verificationBucket !== 'all') {
      drivers = drivers.filter((item) => deriveVerificationBucket(item) === verificationBucket);
    }

    if (['identity', 'vehicle', 'profile_image'].includes(verificationType)) {
      drivers = drivers.filter((item) => deriveVerificationType(item) === verificationType);
    }

    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    drivers.sort((a, b) => {
      let left = '';
      let right = '';

      if (sortBy === 'email') {
        left = String(a.email || '').toLowerCase();
        right = String(b.email || '').toLowerCase();
      } else if (sortBy === 'profileStatus') {
        left = String(a.profile?.status || '').toLowerCase();
        right = String(b.profile?.status || '').toLowerCase();
      } else if (sortBy === 'vehicleStatus') {
        left = String(a.vehicle?.status || '').toLowerCase();
        right = String(b.vehicle?.status || '').toLowerCase();
      } else {
        left = toDateValue(a.createdAt);
        right = toDateValue(b.createdAt);
      }

      if (left < right) return -1 * sortDirection;
      if (left > right) return 1 * sortDirection;
      return 0;
    });

    const total = drivers.length;
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const pagedDrivers = drivers.slice(start, start + pageSize);

    const payload = pagedDrivers.map(({ _role, ...rest }) => rest);

    return res.json({
      drivers: payload,
      count: payload.length,
      total,
      page: safePage,
      pageSize,
      totalPages,
    });
  } catch (err) {
    console.error('GET /api/admin/drivers', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/export.csv', requireAdminAuth, requirePermission('drivers.read'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const verificationStatus = String(req.query.verificationStatus || 'all').toLowerCase();

    const clerkClient = getClerkClient();
    const clerkPage = await clerkClient.users.getUserList({
      limit: 500,
      orderBy: '-created_at',
    });

    const users = (clerkPage.data || []).filter((u) => normalizeRole(u.publicMetadata?.role) === 'driver');
    const driverIds = users.map((u) => u.id);
    const identityByUser = new Map();
    const vehicleByUser = new Map();
    if (driverIds.length > 0) {
      const placeholders = driverIds.map(() => '?').join(',');
      const [identityRows, vehicleRows] = await Promise.all([
        query(`SELECT * FROM driver_identity WHERE driver_user_id IN (${placeholders})`, driverIds),
        query(`SELECT * FROM driver_vehicle WHERE driver_user_id IN (${placeholders})`, driverIds),
      ]);
      identityRows.forEach((r) => identityByUser.set(r.driver_user_id, r));
      vehicleRows.forEach((r) => vehicleByUser.set(r.driver_user_id, r));
    }

    let drivers = users.map((user) =>
      mapDriverFromClerkAndMysql(user, identityByUser.get(user.id) || null, vehicleByUser.get(user.id) || null)
    );

    if (search) {
      drivers = drivers.filter((item) => {
        const haystack = [
          item.id,
          item.email,
          item.phoneNumber,
          item.firstName,
          item.lastName,
          item.fullName,
          item.vehicle?.make,
          item.vehicle?.model,
          item.vehicle?.numberPlate,
          item.vehicle?.vehicleTierName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });
    }

    if (['pending', 'approved', 'rejected'].includes(verificationStatus)) {
      drivers = drivers.filter((item) => item.profile?.status === verificationStatus || item.vehicle?.status === verificationStatus);
    }

    const payload = drivers.map(({ _role, ...rest }) => rest);
    const csv = toCsv(payload);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="drivers_export_${Date.now()}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('GET /api/admin/drivers/export.csv', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:driverId', requireAdminAuth, requirePermission('drivers.read'), async (req, res) => {
  try {
    const clerkClient = getClerkClient();
    const user = await clerkClient.users.getUser(req.params.driverId);
    if (normalizeRole(user.publicMetadata?.role) !== 'driver') {
      return res.status(404).json({ error: 'Driver not found' });
    }

    const [identityRow, vehicleRow, tripRows, referralRows] = await Promise.all([
      getDriverIdentity(user.id),
      getDriverVehicle(user.id),
      query(
        `SELECT
           id,
           public_id,
           passenger_user_id,
           passenger_name,
           pickup_label,
           dropoff_label,
           requested_tier_name,
           status,
           estimated_amount,
           estimated_distance_km,
           estimated_minutes,
           actual_distance_km,
           actual_minutes,
           passenger_driver_rating,
           passenger_driver_review,
           requested_at,
           assigned_at,
           completed_at,
           cancelled_at
         FROM ride_requests
         WHERE driver_user_id = ?
         ORDER BY requested_at DESC
         LIMIT 50`,
        [user.id]
      ),
      query(
        `SELECT
           r.agent_user_id,
           r.invite_id,
           r.source,
           r.created_at,
           a.full_name,
           a.email,
           a.phone_number,
           a.employee_code,
           a.id_number,
           a.address
         FROM agent_driver_referrals r
         JOIN agent_users a ON a.id = r.agent_user_id
         WHERE r.driver_user_id = ?
         LIMIT 1`,
        [user.id]
      ),
    ]);

    const mapped = mapDriverFromClerkAndMysql(user, identityRow, vehicleRow);

    const profileDocs = identityRow
      ? {
          nationalIdFrontUrl: normalizeUploadPath(identityRow.national_id_front_url),
          nationalIdBackUrl: normalizeUploadPath(identityRow.national_id_back_url),
          driverLicenceUrl: normalizeUploadPath(identityRow.driver_licence_url),
          selfieUrl: normalizeUploadPath(identityRow.selfie_url),
          selfieWithIdCardUrl: normalizeUploadPath(identityRow.selfie_with_id_card_url),
        }
      : null;

    const vehicleMeta = vehicleRowToMeta(vehicleRow);
    const vehicleDocs = vehicleRow
      ? {
          carPhotoFrontUrl: normalizeUploadPath(vehicleRow.car_photo_front_url),
          carPhotoRearUrl: normalizeUploadPath(vehicleRow.car_photo_rear_url),
          carPhotoUrls: (() => {
            try {
              return vehicleRow.car_photo_urls
                ? JSON.parse(vehicleRow.car_photo_urls).map((value) => normalizeUploadPath(value)).filter(Boolean)
                : [];
            } catch (_) {
              return [];
            }
          })(),
          vehicleRegistrationUrl: normalizeUploadPath(vehicleRow.vehicle_registration_url),
          vehicleRegistrationBookUrl: normalizeUploadPath(vehicleRow.vehicle_registration_book_url),
          insuranceUrl: normalizeUploadPath(vehicleRow.insurance_url),
          zinaraUrl: normalizeUploadPath(vehicleRow.zinara_url),
          year: vehicleRow.year || null,
          color: vehicleRow.color || null,
          vehicleTierKey: vehicleRow.vehicle_tier_key || null,
          vehicleTierName: vehicleRow.vehicle_tier_name || null,
        }
      : null;

    const vehicleSpecs = mapVehicleSpecs(vehicleMeta);
    const tierRules = vehicleMeta ? await loadVehicleTierRules() : [];
    const tierAssessment = vehicleMeta ? evaluateVehicleAgainstTiers(vehicleMeta, tierRules) : null;
    const trips = (tripRows || []).map((row) => ({
      id: row.id,
      publicId: row.public_id,
      passengerUserId: row.passenger_user_id,
      passengerName: row.passenger_name || null,
      pickupLabel: row.pickup_label,
      dropoffLabel: row.dropoff_label,
      requestedTierName: row.requested_tier_name || null,
      status: row.status,
      estimatedAmount: row.estimated_amount === null ? null : Number(row.estimated_amount),
      estimatedDistanceKm: row.estimated_distance_km === null ? null : Number(row.estimated_distance_km),
      estimatedMinutes: row.estimated_minutes === null ? null : Number(row.estimated_minutes),
      actualDistanceKm: row.actual_distance_km === null ? null : Number(row.actual_distance_km),
      actualMinutes: row.actual_minutes === null ? null : Number(row.actual_minutes),
      passengerDriverRating: row.passenger_driver_rating === null ? null : Number(row.passenger_driver_rating),
      passengerDriverReview: row.passenger_driver_review || '',
      requestedAt: row.requested_at ? new Date(row.requested_at).toISOString() : null,
      assignedAt: row.assigned_at ? new Date(row.assigned_at).toISOString() : null,
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    }));
    const reviews = trips
      .filter((trip) => trip.passengerDriverRating !== null || trip.passengerDriverReview)
      .map((trip) => ({
        rideId: trip.id,
        ridePublicId: trip.publicId,
        passengerName: trip.passengerName,
        rating: trip.passengerDriverRating,
        review: trip.passengerDriverReview,
        completedAt: trip.completedAt,
        pickupLabel: trip.pickupLabel,
        dropoffLabel: trip.dropoffLabel,
      }));

    const referral = mapReferralRow(referralRows?.[0] || null);

    const { _role, ...driver } = mapped;
    const responseDriver = { ...driver, profileDocs, vehicleDocs, vehicleSpecs, tierAssessment, trips, reviews, referral };

    console.log('[GET /api/admin/drivers/:driverId] document payload', {
      driverId: user.id,
      profileDocs,
      vehicleDocs,
      profileStatus: responseDriver?.profile?.status || null,
      vehicleStatus: responseDriver?.vehicle?.status || null,
    });

    return res.json({ driver: responseDriver });
  } catch (err) {
    console.error('GET /api/admin/drivers/:driverId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:driverId/review', requireAdminAuth, requirePermission('verification.review'), async (req, res) => {
  try {
    const driverId = String(req.params.driverId || '').trim();
    const target = String(req.body?.target || '').trim().toLowerCase();
    const action = String(req.body?.action || '').trim().toLowerCase();
    const rejectionReason = String(req.body?.rejectionReason || '').trim() || null;
    const allowResubmit = req.body?.allowResubmit !== false;
    const approvedTierKey = String(req.body?.approvedTierKey || '').trim().toLowerCase() || null;
    const approvedTierName = String(req.body?.approvedTierName || '').trim() || null;

    if (!driverId) {
      return res.status(400).json({ error: 'Invalid driver id' });
    }
    if (!['profile', 'vehicle', 'profile_image'].includes(target)) {
      return res.status(400).json({ error: 'target must be profile, vehicle, or profile_image' });
    }
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be approve or reject' });
    }
    if (action === 'reject' && !rejectionReason) {
      return res.status(400).json({ error: 'rejectionReason is required when rejecting' });
    }

    const clerkClient = getClerkClient();
    const user = await clerkClient.users.getUser(driverId);
    if (normalizeRole(user.publicMetadata?.role) !== 'driver') {
      return res.status(404).json({ error: 'Driver not found' });
    }

    const [identityRow, vehicleRow] = await Promise.all([
      getDriverIdentity(driverId),
      getDriverVehicle(driverId),
    ]);

    if (target === 'profile_image') {
      const privateMeta = user.privateMetadata || {};
      const pendingImageUrl = String(privateMeta.pendingDriverProfileImageUrl || '').trim();
      if (!pendingImageUrl) {
        return res.status(400).json({ error: 'Driver has not submitted a new profile picture' });
      }

      const nextPrivateMetadata = {
        ...privateMeta,
        driverProfileImageReviewStatus: action === 'approve' ? 'approved' : 'rejected',
        driverProfileImageReviewedAt: new Date().toISOString(),
        driverProfileImageRejectionReason: action === 'reject' ? rejectionReason : null,
      };

      if (action === 'approve') {
        nextPrivateMetadata.profileImageUrl = pendingImageUrl;
        nextPrivateMetadata.pendingDriverProfileImageUrl = null;
      }

      await mergePrivateMetadata(driverId, nextPrivateMetadata);

      return res.json({
        ok: true,
        target,
        action,
        profileImageReview: getDriverProfileImageReview(nextPrivateMetadata, 'driver'),
        driverProfile: null,
        vehicle: null,
      });
    }

    if (target === 'profile') {
      if (
        !identityRow ||
        !identityRow.national_id_front_url ||
        !identityRow.national_id_back_url ||
        !identityRow.driver_licence_url ||
        !identityRow.selfie_url ||
        !identityRow.selfie_with_id_card_url
      ) {
        return res.status(400).json({ error: 'Driver has not submitted profile documents' });
      }
      const status = action === 'approve' ? 'approved' : 'rejected';
      const canResubmit = action === 'approve' ? 1 : (allowResubmit ? 1 : 0);
      await query(
        `UPDATE driver_identity
         SET profile_status = ?, profile_reviewed_at = CURRENT_TIMESTAMP, profile_rejection_reason = ?,
             profile_can_resubmit = ?, updated_at = CURRENT_TIMESTAMP
         WHERE driver_user_id = ?`,
        [status, action === 'reject' ? rejectionReason : null, canResubmit, driverId]
      );
      const [updated] = await query('SELECT * FROM driver_identity WHERE driver_user_id = ? LIMIT 1', [driverId]);
      const driverProfile = updated
        ? {
            id: `profile_${driverId}`,
            status: updated.profile_status,
            submittedAt: updated.profile_submitted_at ? new Date(updated.profile_submitted_at).toISOString() : null,
            rejectionReason: updated.profile_rejection_reason || null,
            canResubmit: updated.profile_can_resubmit === undefined ? true : !!updated.profile_can_resubmit,
          }
        : null;
      return res.json({ ok: true, target, action, driverProfile, vehicle: null });
    }

    if (target === 'vehicle') {
      let vehiclePhotoCount = 0;
      try {
        const parsed = vehicleRow?.car_photo_urls ? JSON.parse(vehicleRow.car_photo_urls) : [];
        vehiclePhotoCount = Array.isArray(parsed) ? parsed.filter(Boolean).length : 0;
      } catch (_) {
        vehiclePhotoCount = 0;
      }
      const hasEnoughVehiclePhotos =
        vehiclePhotoCount >= 3 ||
        !!(vehicleRow?.car_photo_front_url && vehicleRow?.car_photo_rear_url);

      if (
        !vehicleRow ||
        !(vehicleRow.vehicle_registration_book_url || vehicleRow.vehicle_registration_url) ||
        !vehicleRow.insurance_url ||
        !vehicleRow.zinara_url ||
        !hasEnoughVehiclePhotos
      ) {
        return res.status(400).json({ error: 'Driver has not submitted vehicle documents' });
      }
      const status = action === 'approve' ? 'approved' : 'rejected';
      const canResubmit = action === 'approve' ? 1 : (allowResubmit ? 1 : 0);
      const tierKey = action === 'approve' ? (approvedTierKey || vehicleRow.vehicle_tier_key) : vehicleRow.vehicle_tier_key;
      const tierName = action === 'approve' ? (approvedTierName || vehicleRow.vehicle_tier_name) : vehicleRow.vehicle_tier_name;
      await query(
        `UPDATE driver_vehicle
         SET vehicle_status = ?, vehicle_reviewed_at = CURRENT_TIMESTAMP, vehicle_rejection_reason = ?,
             vehicle_can_resubmit = ?, vehicle_tier_key = ?, vehicle_tier_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE driver_user_id = ?`,
        [status, action === 'reject' ? rejectionReason : null, canResubmit, tierKey || null, tierName || null, driverId]
      );
      const [updated] = await query('SELECT * FROM driver_vehicle WHERE driver_user_id = ? LIMIT 1', [driverId]);
      const vehicle = updated
        ? {
            id: `vehicle_${driverId}`,
            status: updated.vehicle_status,
            submittedAt: updated.vehicle_submitted_at ? new Date(updated.vehicle_submitted_at).toISOString() : null,
            make: updated.make,
            model: updated.model,
            numberPlate: updated.number_plate,
            vehicleTierKey: updated.vehicle_tier_key,
            vehicleTierName: updated.vehicle_tier_name,
            rejectionReason: updated.vehicle_rejection_reason || null,
            canResubmit: updated.vehicle_can_resubmit === undefined ? true : !!updated.vehicle_can_resubmit,
          }
        : null;
      return res.json({ ok: true, target, action, driverProfile: null, vehicle });
    }
  } catch (err) {
    console.error('PATCH /api/admin/drivers/:driverId/review', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:driverId', requireAdminAuth, requirePermission('drivers.delete'), async (req, res) => {
  try {
    const driverId = String(req.params.driverId || '').trim();
    if (!driverId) {
      return res.status(400).json({ error: 'Invalid driver id' });
    }

    const clerkClient = getClerkClient();
    const user = await clerkClient.users.getUser(driverId);
    if (normalizeRole(user.publicMetadata?.role) !== 'driver') {
      return res.status(404).json({ error: 'Driver not found' });
    }

    await deleteEndUserAccount(driverId, 'driver');
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/drivers/:driverId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
