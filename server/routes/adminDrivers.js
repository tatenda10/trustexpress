import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { upload } from '../middleware/upload.js';
import { deleteEndUserAccount } from '../lib/account-deletion.js';
import { getClerkClient } from '../lib/clerk-client.js';
import { getDriverProfileImageReview, getPrimaryEmail, getPrimaryPhone, mergePrivateMetadata, normalizeRole } from '../lib/clerk-user.js';
import { evaluateVehicleAgainstTiers, loadVehicleTierRules } from '../lib/vehicle-tier-matching.js';
import { query } from '../db/connection.js';
import { getDriverIdentity, getDriverVehicle, normalizeUploadPath } from '../lib/driver-verification-mysql.js';
import { getDriverWalletStatus, getDriverWalletSummariesByUserIds, getAdminDriverWalletLedger } from '../lib/driver-wallet.js';
import { getAccountStatusFromUser, getDriverRatingPerformanceSummary } from '../lib/rating-performance.js';
import {
  describeDriverVerification,
  formatExportName,
  formatPhoneAsText,
  sendXlsx,
} from '../lib/xlsx-export.js';

const router = Router();
const DRIVER_ONLINE_STALE_DAYS = 1;
const PROFILE_DOCUMENT_UPLOAD_FIELDS = [
  { name: 'nationalIdFront', maxCount: 1 },
  { name: 'nationalIdBack', maxCount: 1 },
  { name: 'driverLicence', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
  { name: 'selfieWithIdCard', maxCount: 1 },
];

function normalizeOptionalText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function runProfileDocumentUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.fields(PROFILE_DOCUMENT_UPLOAD_FIELDS)(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getUploadedPath(req, fieldName) {
  const file = Array.isArray(req.files?.[fieldName]) ? req.files[fieldName][0] : null;
  return file?.filename ? `/uploads/${file.filename}` : null;
}

function mapIdentityProfileDocs(row) {
  if (!row) return null;
  return {
    nationalIdFrontUrl: normalizeUploadPath(row.national_id_front_url),
    nationalIdBackUrl: normalizeUploadPath(row.national_id_back_url),
    driverLicenceUrl: normalizeUploadPath(row.driver_licence_url),
    selfieUrl: normalizeUploadPath(row.selfie_url),
    selfieWithIdCardUrl: normalizeUploadPath(row.selfie_with_id_card_url),
    nationalIdNumber: row.national_id_number || null,
    driverLicenceNumber: row.driver_licence_number || null,
  };
}

function mapOnlineDriverRow(row) {
  const rideStatus = String(row.ride_status || '');
  const status = rideStatus === 'in_progress'
    ? 'On Trip'
    : ['driver_assigned', 'driver_arrived'].includes(rideStatus)
      ? 'Pickup'
      : 'Available';

  return {
    id: row.driver_user_id,
    name: row.driver_name || 'Driver',
    phoneNumber: row.phone_number || null,
    vehicleTierName: row.vehicle_tier_name || null,
    vehicleLabel: [row.vehicle_make, row.vehicle_model, row.number_plate ? `(${row.number_plate})` : '']
      .filter(Boolean)
      .join(' ')
      .trim() || null,
    status,
    lastSeenAt: row.last_seen_at || null,
    lat: row.current_lat === null ? null : Number(row.current_lat),
    lng: row.current_lng === null ? null : Number(row.current_lng),
    rideRequestId: row.ride_request_id || null,
    ridePublicId: row.public_id || null,
    passengerName: row.passenger_name || null,
    route: row.pickup_label && row.dropoff_label
      ? `${row.pickup_label} -> ${row.dropoff_label}`
      : null,
  };
}

async function loadAllClerkUsers(orderBy = '-created_at') {
  const clerkClient = getClerkClient();
  const limit = 100;
  let offset = 0;
  const users = [];

  while (true) {
    const page = await clerkClient.users.getUserList({
      limit,
      offset,
      orderBy,
    });
    const pageUsers = page.data || [];
    if (!pageUsers.length) break;
    users.push(...pageUsers);
    offset += pageUsers.length;
    if (pageUsers.length < limit) break;
  }

  return users;
}

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
        ecocashNumber: identityRow.ecocash_number || null,
        ecocashRegisteredName: identityRow.ecocash_registered_name || null,
        dateOfBirth: identityRow.date_of_birth
          ? String(identityRow.date_of_birth).slice(0, 10)
          : null,
        gender: identityRow.gender || null,
        smileCashMobile: identityRow.smile_cash_mobile || null,
        smileCashStatus: identityRow.smile_cash_status || null,
        smileCashOpenedAt: identityRow.smile_cash_opened_at
          ? new Date(identityRow.smile_cash_opened_at).toISOString()
          : null,
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
    accountStatus: getAccountStatusFromUser(user, 'driver').status,
    ratingRestrictionReason: privateMeta.ratingRestrictionReason || null,
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

function toDriverExportRows(drivers) {
  return drivers.map((driver) => {
    const verification = describeDriverVerification(driver);
    return {
      name: formatExportName(driver),
      phoneNumber: formatPhoneAsText(driver.phoneNumber),
      verificationStatus: verification.verificationStatus,
      identityStatus: verification.identityStatus,
      vehicleStatus: verification.vehicleStatus,
      details: verification.details,
    };
  });
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

    const clerkUsers = await loadAllClerkUsers('-created_at');
    const users = clerkUsers.filter((u) => normalizeRole(u.publicMetadata?.role) === 'driver');
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

    const walletByUserId = await getDriverWalletSummariesByUserIds(pagedDrivers.map((item) => item.id));
    const payload = pagedDrivers.map(({ _role, ...rest }) => ({
      ...rest,
      wallet: walletByUserId.get(rest.id) || null,
    }));

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

async function exportDriversWorkbook(req, res) {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const verificationStatus = String(req.query.verificationStatus || 'all').toLowerCase();

    const clerkUsers = await loadAllClerkUsers('-created_at');
    const users = clerkUsers.filter((u) => normalizeRole(u.publicMetadata?.role) === 'driver');
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
    return sendXlsx(res, {
      filename: `drivers_export_${Date.now()}.xlsx`,
      sheetName: 'Drivers',
      columns: [
        { key: 'name', header: 'Name', width: 28 },
        { key: 'phoneNumber', header: 'Phone Number', width: 22, text: true },
        { key: 'verificationStatus', header: 'Verification Status', width: 32 },
        { key: 'identityStatus', header: 'Identity', width: 18 },
        { key: 'vehicleStatus', header: 'Vehicle', width: 18 },
        { key: 'details', header: 'Details', width: 48 },
      ],
      rows: toDriverExportRows(payload),
    });
  } catch (err) {
    console.error('GET /api/admin/drivers/export', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

router.get('/export.xlsx', requireAdminAuth, requirePermission('drivers.read'), exportDriversWorkbook);
router.get('/export.csv', requireAdminAuth, requirePermission('drivers.read'), exportDriversWorkbook);

router.get('/online', requireAdminAuth, requirePermission('drivers.read'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const rows = await query(
      `SELECT
         da.driver_user_id,
         da.driver_name,
         da.phone_number,
         da.vehicle_tier_name,
         da.vehicle_make,
         da.vehicle_model,
         da.number_plate,
         da.current_lat,
         da.current_lng,
         da.last_seen_at,
         da.is_online,
         rr.id AS ride_request_id,
         rr.public_id,
         rr.passenger_name,
         rr.pickup_label,
         rr.dropoff_label,
         rr.status AS ride_status
       FROM driver_availability da
       LEFT JOIN ride_requests rr
         ON rr.driver_user_id = da.driver_user_id
        AND rr.status IN ('driver_assigned', 'driver_arrived', 'in_progress')
       WHERE da.is_online = 1
         AND da.last_seen_at >= (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_ONLINE_STALE_DAYS} DAY)
       ORDER BY da.driver_name ASC, da.updated_at DESC`
    );

    let drivers = rows.map(mapOnlineDriverRow);
    if (search) {
      drivers = drivers.filter((driver) => {
        const haystack = [
          driver.id,
          driver.name,
          driver.phoneNumber,
          driver.vehicleTierName,
          driver.vehicleLabel,
          driver.status,
          driver.passengerName,
          driver.route,
          driver.ridePublicId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });
    }

    const summary = {
      total: drivers.length,
      available: drivers.filter((driver) => driver.status === 'Available').length,
      pickup: drivers.filter((driver) => driver.status === 'Pickup').length,
      onTrip: drivers.filter((driver) => driver.status === 'On Trip').length,
    };

    return res.json({
      drivers,
      summary,
      refreshedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /api/admin/drivers/online', err);
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
           passenger_driver_feedback_tags,
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

    const profileDocs = mapIdentityProfileDocs(identityRow);

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
      passengerDriverFeedbackTags: (() => {
        try {
          const parsed = JSON.parse(row.passenger_driver_feedback_tags || '[]');
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })(),
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
    const [wallet, walletLedger, ratingPerformance] = await Promise.all([
      getDriverWalletStatus(user.id),
      getAdminDriverWalletLedger({ driverUserId: user.id, limit: 30 }).catch(() => null),
      getDriverRatingPerformanceSummary(user.id).catch(() => null),
    ]);

    const { _role, ...driver } = mapped;
    const responseDriver = {
      ...driver,
      profileDocs,
      vehicleDocs,
      vehicleSpecs,
      tierAssessment,
      trips,
      reviews,
      referral,
      wallet,
      walletTransactions: walletLedger?.transactions || [],
      walletSummary: walletLedger?.summary || null,
      ratingPerformance,
    };

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

router.post(
  '/:driverId/documents',
  requireAdminAuth,
  requirePermission('verification.review'),
  async (req, res) => {
    try {
      await runProfileDocumentUpload(req, res);

      const driverId = String(req.params.driverId || '').trim();
      if (!driverId) {
        return res.status(400).json({ error: 'Invalid driver id' });
      }

      const uploaded = {
        nationalIdFrontUrl: getUploadedPath(req, 'nationalIdFront'),
        nationalIdBackUrl: getUploadedPath(req, 'nationalIdBack'),
        driverLicenceUrl: getUploadedPath(req, 'driverLicence'),
        selfieUrl: getUploadedPath(req, 'selfie'),
        selfieWithIdCardUrl: getUploadedPath(req, 'selfieWithIdCard'),
      };
      const nationalIdNumber = normalizeOptionalText(req.body?.nationalIdNumber);
      const driverLicenceNumber = normalizeOptionalText(req.body?.driverLicenceNumber);
      const hasUpload = Object.values(uploaded).some(Boolean);
      const hasNumberUpdate = !!(nationalIdNumber || driverLicenceNumber);

      if (!hasUpload && !hasNumberUpdate) {
        return res.status(400).json({ error: 'Upload at least one document or enter an ID/licence number' });
      }

      const clerkClient = getClerkClient();
      const user = await clerkClient.users.getUser(driverId);
      if (normalizeRole(user.publicMetadata?.role) !== 'driver') {
        return res.status(404).json({ error: 'Driver not found' });
      }

      if (nationalIdNumber) {
        const [duplicate] = await query(
          `SELECT driver_user_id
           FROM driver_identity
           WHERE national_id_number = ? AND driver_user_id <> ?
           LIMIT 1`,
          [nationalIdNumber, driverId]
        );
        if (duplicate) {
          return res.status(409).json({ error: 'National ID number is already used by another driver' });
        }
      }

      if (driverLicenceNumber) {
        const [duplicate] = await query(
          `SELECT driver_user_id
           FROM driver_identity
           WHERE driver_licence_number = ? AND driver_user_id <> ?
           LIMIT 1`,
          [driverLicenceNumber, driverId]
        );
        if (duplicate) {
          return res.status(409).json({ error: 'Driver licence number is already used by another driver' });
        }
      }

      const existing = await getDriverIdentity(driverId);
      const nextDocs = {
        nationalIdFrontUrl: uploaded.nationalIdFrontUrl || normalizeUploadPath(existing?.national_id_front_url),
        nationalIdBackUrl: uploaded.nationalIdBackUrl || normalizeUploadPath(existing?.national_id_back_url),
        driverLicenceUrl: uploaded.driverLicenceUrl || normalizeUploadPath(existing?.driver_licence_url),
        selfieUrl: uploaded.selfieUrl || normalizeUploadPath(existing?.selfie_url),
        selfieWithIdCardUrl: uploaded.selfieWithIdCardUrl || normalizeUploadPath(existing?.selfie_with_id_card_url),
        nationalIdNumber: nationalIdNumber || existing?.national_id_number || null,
        driverLicenceNumber: driverLicenceNumber || existing?.driver_licence_number || null,
      };
      const isComplete = !!(
        nextDocs.nationalIdFrontUrl &&
        nextDocs.nationalIdBackUrl &&
        nextDocs.driverLicenceUrl &&
        nextDocs.selfieUrl &&
        nextDocs.selfieWithIdCardUrl &&
        nextDocs.nationalIdNumber &&
        nextDocs.driverLicenceNumber
      );
      const nextStatus = isComplete ? 'pending' : (existing?.profile_status || 'pending');

      await query(
        `INSERT INTO driver_identity (
           driver_user_id,
           national_id_front_url,
           national_id_back_url,
           driver_licence_url,
           selfie_url,
           selfie_with_id_card_url,
           national_id_number,
           driver_licence_number,
           profile_status,
           profile_submitted_at,
           profile_rejection_reason,
           profile_can_resubmit
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, 1)
         ON DUPLICATE KEY UPDATE
           national_id_front_url = VALUES(national_id_front_url),
           national_id_back_url = VALUES(national_id_back_url),
           driver_licence_url = VALUES(driver_licence_url),
           selfie_url = VALUES(selfie_url),
           selfie_with_id_card_url = VALUES(selfie_with_id_card_url),
           national_id_number = VALUES(national_id_number),
           driver_licence_number = VALUES(driver_licence_number),
           profile_status = VALUES(profile_status),
           profile_submitted_at = CURRENT_TIMESTAMP,
           profile_reviewed_at = NULL,
           profile_rejection_reason = NULL,
           profile_can_resubmit = 1,
           updated_at = CURRENT_TIMESTAMP`,
        [
          driverId,
          nextDocs.nationalIdFrontUrl,
          nextDocs.nationalIdBackUrl,
          nextDocs.driverLicenceUrl,
          nextDocs.selfieUrl,
          nextDocs.selfieWithIdCardUrl,
          nextDocs.nationalIdNumber,
          nextDocs.driverLicenceNumber,
          nextStatus,
        ]
      );

      const refreshed = await getDriverIdentity(driverId);
      return res.json({
        ok: true,
        complete: isComplete,
        profileStatus: refreshed?.profile_status || nextStatus,
        profileDocs: mapIdentityProfileDocs(refreshed),
      });
    } catch (err) {
      console.error('POST /api/admin/drivers/:driverId/documents', err);
      if (err?.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'National ID or driver licence number is already used by another driver' });
      }
      const message = err?.message || 'Server error';
      const status = message.includes('Unsupported file type') ? 400 : 500;
      return res.status(status).json({ error: status === 400 ? message : 'Server error' });
    }
  }
);

function collectVehiclePhotoCandidates(vehicleRow) {
  const candidates = [];
  const pushUnique = (value) => {
    const normalized = normalizeUploadPath(value);
    if (!normalized) return;
    if (candidates.some((item) => item === normalized)) return;
    candidates.push(normalized);
  };

  pushUnique(vehicleRow?.car_photo_front_url);
  pushUnique(vehicleRow?.car_photo_rear_url);
  try {
    const parsed = vehicleRow?.car_photo_urls ? JSON.parse(vehicleRow.car_photo_urls) : [];
    if (Array.isArray(parsed)) {
      parsed.forEach((item) => pushUnique(item));
    }
  } catch {
    // ignore invalid JSON
  }
  return candidates;
}

router.patch(
  '/:driverId/vehicle-display-photo',
  requireAdminAuth,
  requirePermission('verification.review'),
  async (req, res) => {
    try {
      const driverId = String(req.params.driverId || '').trim();
      const photoUrl = normalizeUploadPath(req.body?.photoUrl);
      if (!driverId) {
        return res.status(400).json({ error: 'Invalid driver id' });
      }
      if (!photoUrl) {
        return res.status(400).json({ error: 'photoUrl is required' });
      }

      const clerkClient = getClerkClient();
      const user = await clerkClient.users.getUser(driverId);
      if (normalizeRole(user.publicMetadata?.role) !== 'driver') {
        return res.status(404).json({ error: 'Driver not found' });
      }

      const vehicleRow = await getDriverVehicle(driverId);
      if (!vehicleRow) {
        return res.status(404).json({ error: 'Vehicle documents not found for this driver' });
      }

      const candidates = collectVehiclePhotoCandidates(vehicleRow);
      if (!candidates.includes(photoUrl)) {
        return res.status(400).json({
          error: 'Selected photo is not one of this driver\'s uploaded vehicle photos',
        });
      }

      const remaining = candidates.filter((item) => item !== photoUrl);
      const nextFrontUrl = photoUrl;
      const nextRearUrl = remaining[0] || vehicleRow.car_photo_rear_url || null;
      const nextPhotoUrls = [nextFrontUrl, ...remaining];

      await query(
        `UPDATE driver_vehicle
         SET car_photo_front_url = ?,
             car_photo_rear_url = ?,
             car_photo_urls = ?
         WHERE driver_user_id = ?`,
        [
          nextFrontUrl,
          nextRearUrl,
          JSON.stringify(nextPhotoUrls),
          driverId,
        ]
      );

      await query(
        `UPDATE driver_availability
         SET car_photo_url = ?
         WHERE driver_user_id = ?`,
        [nextFrontUrl, driverId]
      );

      const refreshedVehicle = await getDriverVehicle(driverId);
      return res.json({
        ok: true,
        vehicleDocs: refreshedVehicle
          ? {
              carPhotoFrontUrl: normalizeUploadPath(refreshedVehicle.car_photo_front_url),
              carPhotoRearUrl: normalizeUploadPath(refreshedVehicle.car_photo_rear_url),
              carPhotoUrls: (() => {
                try {
                  return refreshedVehicle.car_photo_urls
                    ? JSON.parse(refreshedVehicle.car_photo_urls)
                        .map((value) => normalizeUploadPath(value))
                        .filter(Boolean)
                    : nextPhotoUrls;
                } catch {
                  return nextPhotoUrls;
                }
              })(),
            }
          : {
              carPhotoFrontUrl: nextFrontUrl,
              carPhotoRearUrl: nextRearUrl,
              carPhotoUrls: nextPhotoUrls,
            },
      });
    } catch (err) {
      console.error('PATCH /api/admin/drivers/:driverId/vehicle-display-photo', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }
);

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

    await deleteEndUserAccount(driverId, 'driver', {
      email: getPrimaryEmail(user),
      fullName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null,
    });
    return res.json({ ok: true });
  } catch (err) {
    const status = Number(err?.status) || 500;
    console.error('DELETE /api/admin/drivers/:driverId', err);
    return res.status(status).json({
      error: err?.message || 'Server error',
      code: err?.code || undefined,
      availableBalance: err?.availableBalance,
    });
  }
});

export default router;
