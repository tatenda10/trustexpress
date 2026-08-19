import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { getClerkClient } from '../lib/clerk-client.js';
import { deleteEndUserAccount } from '../lib/account-deletion.js';
import { getPrimaryEmail, getPrimaryPhone, normalizeRole } from '../lib/clerk-user.js';
import { listPassengerIdentities, shapePassengerIdentityFromRow } from '../lib/passenger-verification-mysql.js';
import { query } from '../db/connection.js';
import {
  formatCompliantStatus,
  formatExportName,
  formatPhoneAsText,
  sendXlsx,
} from '../lib/xlsx-export.js';

const router = Router();

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

function mapPassenger(user, passengerIdentity = null) {
  const publicMeta = user.publicMetadata || {};
  const privateMeta = user.privateMetadata || {};

  return {
    id: user.id,
    firstName: user.firstName || null,
    lastName: user.lastName || null,
    fullName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null,
    email: getPrimaryEmail(user),
    phoneNumber: privateMeta.phoneNumber || getPrimaryPhone(user) || null,
    createdAt: user.createdAt || null,
    phoneVerified: !!privateMeta.phoneVerifiedAt,
    phoneVerifiedAt: privateMeta.phoneVerifiedAt || null,
    status: privateMeta.passengerStatus || 'active',
    totalRides: Number(privateMeta.totalRides || 0),
    totalSpend: Number(privateMeta.totalSpend || 0),
    lastRideAt: privateMeta.lastRideAt || null,
    savedAddresses: Array.isArray(privateMeta.savedAddresses) ? privateMeta.savedAddresses : [],
    emergencyContact: privateMeta.emergencyContact || null,
    paymentMethods: Array.isArray(privateMeta.paymentMethods) ? privateMeta.paymentMethods : [],
    passengerIdentity,
    _role: normalizeRole(publicMeta.role),
  };
}

async function loadPassengerRideStats(passengerUserIds = []) {
  const normalizedIds = Array.from(
    new Set(passengerUserIds.map((value) => String(value || '').trim()).filter(Boolean))
  );
  if (normalizedIds.length === 0) return new Map();

  const placeholders = normalizedIds.map(() => '?').join(', ');
  const rows = await query(
    `SELECT
       passenger_user_id,
       COUNT(CASE WHEN status = 'completed' THEN 1 END) AS total_rides,
       COALESCE(SUM(CASE
         WHEN status = 'completed' THEN COALESCE(final_estimated_amount, estimated_amount, 0) + COALESCE(tip_amount, 0)
         ELSE 0
       END), 0) AS total_spend,
       MAX(CASE WHEN status = 'completed' THEN COALESCE(completed_at, started_at, assigned_at, requested_at) END) AS last_ride_at
     FROM ride_requests
     WHERE passenger_user_id IN (${placeholders})
     GROUP BY passenger_user_id`,
    normalizedIds
  );

  return new Map(
    rows.map((row) => [
      row.passenger_user_id,
      {
        totalRides: Number(row.total_rides || 0),
        totalSpend: Number(row.total_spend || 0),
        lastRideAt: row.last_ride_at || null,
      },
    ])
  );
}

function applyPassengerRideStats(passenger, statsMap) {
  const stats = statsMap.get(passenger.id) || null;
  if (!stats) return passenger;
  return {
    ...passenger,
    totalRides: Number(stats.totalRides || 0),
    totalSpend: Number(stats.totalSpend || 0),
    lastRideAt: stats.lastRideAt || null,
  };
}

function toDateValue(value) {
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPassengerCompliant(passenger) {
  const identityApproved = ['approved', 'verified'].includes(
    String(passenger?.passengerIdentity?.status || '').trim().toLowerCase()
  );
  return passenger?.phoneVerified === true && identityApproved;
}

function toPassengerExportRows(passengers) {
  return passengers.map((passenger) => ({
    name: formatExportName(passenger),
    phoneNumber: formatPhoneAsText(passenger.phoneNumber),
    compliantStatus: formatCompliantStatus(isPassengerCompliant(passenger)),
  }));
}

router.get('/', requireAdminAuth, requirePermission('passengers.read'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || 'all').toLowerCase();
    const identityStatus = String(req.query.identityStatus || 'all').toLowerCase();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 100);
    const sortBy = String(req.query.sortBy || 'createdAt');
    const sortOrder = String(req.query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const clerkUsers = await loadAllClerkUsers('-created_at');
    const passengerUsers = clerkUsers.filter((item) => normalizeRole(item?.publicMetadata?.role) === 'passenger');
    const identities = await listPassengerIdentities(passengerUsers.map((item) => item.id));
    const passengerRideStats = await loadPassengerRideStats(passengerUsers.map((item) => item.id));
    const identityByUserId = new Map(
      identities.map((row) => [row.passenger_user_id, shapePassengerIdentityFromRow(row)])
    );

    let passengers = passengerUsers
      .map((item) => applyPassengerRideStats(
        mapPassenger(item, identityByUserId.get(item.id) || null),
        passengerRideStats
      ))
      .filter((item) => item._role === 'passenger');

    if (search) {
      passengers = passengers.filter((item) => {
        const haystack = [item.id, item.email, item.phoneNumber, item.firstName, item.lastName, item.fullName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });
    }

    if (['active', 'blocked', 'flagged'].includes(status)) {
      passengers = passengers.filter((item) => item.status === status);
    }

    if (['pending', 'approved', 'rejected', 'not_submitted'].includes(identityStatus)) {
      passengers = passengers.filter((item) => {
        const currentStatus = item.passengerIdentity?.status || 'not_submitted';
        return currentStatus === identityStatus;
      });
    }

    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    passengers.sort((a, b) => {
      let left = '';
      let right = '';
      if (sortBy === 'email') {
        left = String(a.email || '').toLowerCase();
        right = String(b.email || '').toLowerCase();
      } else if (sortBy === 'status') {
        left = String(a.status || '').toLowerCase();
        right = String(b.status || '').toLowerCase();
      } else if (sortBy === 'totalRides') {
        left = Number(a.totalRides || 0);
        right = Number(b.totalRides || 0);
      } else if (sortBy === 'totalSpend') {
        left = Number(a.totalSpend || 0);
        right = Number(b.totalSpend || 0);
      } else {
        left = toDateValue(a.createdAt);
        right = toDateValue(b.createdAt);
      }

      if (left < right) return -1 * sortDirection;
      if (left > right) return 1 * sortDirection;
      return 0;
    });

    const total = passengers.length;
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const pagedPassengers = passengers.slice(start, start + pageSize);

    const payload = pagedPassengers.map(({ _role, ...rest }) => rest);
    return res.json({
      passengers: payload,
      count: payload.length,
      total,
      page: safePage,
      pageSize,
      totalPages,
    });
  } catch (err) {
    console.error('GET /api/admin/passengers', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

async function exportPassengersWorkbook(req, res) {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || 'all').toLowerCase();
    const identityStatus = String(req.query.identityStatus || 'all').toLowerCase();

    const clerkUsers = await loadAllClerkUsers('-created_at');
    const passengerUsers = clerkUsers.filter((item) => normalizeRole(item?.publicMetadata?.role) === 'passenger');
    const identities = await listPassengerIdentities(passengerUsers.map((item) => item.id));
    const passengerRideStats = await loadPassengerRideStats(passengerUsers.map((item) => item.id));
    const identityByUserId = new Map(
      identities.map((row) => [row.passenger_user_id, shapePassengerIdentityFromRow(row)])
    );

    let passengers = passengerUsers
      .map((item) => applyPassengerRideStats(
        mapPassenger(item, identityByUserId.get(item.id) || null),
        passengerRideStats
      ))
      .filter((item) => item._role === 'passenger');

    if (search) {
      passengers = passengers.filter((item) => {
        const haystack = [item.id, item.email, item.phoneNumber, item.firstName, item.lastName, item.fullName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });
    }

    if (['active', 'blocked', 'flagged'].includes(status)) {
      passengers = passengers.filter((item) => item.status === status);
    }

    if (['pending', 'approved', 'rejected', 'not_submitted'].includes(identityStatus)) {
      passengers = passengers.filter((item) => {
        const currentStatus = item.passengerIdentity?.status || 'not_submitted';
        return currentStatus === identityStatus;
      });
    }

    const payload = passengers.map(({ _role, ...rest }) => rest);
    return sendXlsx(res, {
      filename: `passengers_export_${Date.now()}.xlsx`,
      sheetName: 'Passengers',
      columns: [
        { key: 'name', header: 'Name', width: 28 },
        { key: 'phoneNumber', header: 'Phone Number', width: 22, text: true },
        { key: 'compliantStatus', header: 'Compliant Status', width: 20 },
      ],
      rows: toPassengerExportRows(payload),
    });
  } catch (err) {
    console.error('GET /api/admin/passengers/export', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

router.get('/export.xlsx', requireAdminAuth, requirePermission('passengers.read'), exportPassengersWorkbook);
router.get('/export.csv', requireAdminAuth, requirePermission('passengers.read'), exportPassengersWorkbook);

router.get('/:passengerId', requireAdminAuth, requirePermission('passengers.read'), async (req, res) => {
  try {
    const clerkClient = getClerkClient();
    const user = await clerkClient.users.getUser(req.params.passengerId);
    const identities = await listPassengerIdentities([req.params.passengerId]);
    const passengerRideStats = await loadPassengerRideStats([req.params.passengerId]);
    const mapped = applyPassengerRideStats(
      mapPassenger(user, shapePassengerIdentityFromRow(identities[0] || null)),
      passengerRideStats
    );

    if (mapped._role !== 'passenger') {
      return res.status(404).json({ error: 'Passenger not found' });
    }

    const { _role, ...passenger } = mapped;
    return res.json({
      passenger: {
        ...passenger,
        notes: user.privateMetadata?.adminNotes || '',
      },
    });
  } catch (err) {
    console.error('GET /api/admin/passengers/:passengerId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:passengerId/review', requireAdminAuth, requirePermission('verification.review'), async (req, res) => {
  try {
    const passengerId = String(req.params.passengerId || '').trim();
    const action = String(req.body?.action || '').trim().toLowerCase();
    const rejectionReason = String(req.body?.rejectionReason || '').trim();
    const allowResubmit = req.body?.allowResubmit !== false;

    if (!passengerId) {
      return res.status(400).json({ error: 'Invalid passenger id' });
    }

    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const existingRows = await query(
      `SELECT *
       FROM passenger_identity
       WHERE passenger_user_id = ?
       LIMIT 1`,
      [passengerId]
    );
    const existing = existingRows[0] || null;

    if (!existing) {
      return res.status(404).json({ error: 'Passenger identity record not found' });
    }

    if (!existing.national_id_front_url || !existing.national_id_back_url) {
      return res.status(400).json({ error: 'Passenger has not submitted both ID documents yet' });
    }

    if (action === 'approve') {
      await query(
        `UPDATE passenger_identity
         SET identity_status = 'approved',
             identity_reviewed_at = CURRENT_TIMESTAMP,
             identity_rejection_reason = NULL,
             identity_can_resubmit = 1
         WHERE passenger_user_id = ?`,
        [passengerId]
      );
    } else {
      if (!rejectionReason) {
        return res.status(400).json({ error: 'Rejection reason is required' });
      }
      await query(
        `UPDATE passenger_identity
         SET identity_status = 'rejected',
             identity_reviewed_at = CURRENT_TIMESTAMP,
             identity_rejection_reason = ?,
             identity_can_resubmit = ?
         WHERE passenger_user_id = ?`,
        [rejectionReason, allowResubmit ? 1 : 0, passengerId]
      );
    }

    const clerkClient = getClerkClient();
    const user = await clerkClient.users.getUser(passengerId);
    const identities = await listPassengerIdentities([passengerId]);
    const mapped = mapPassenger(user, shapePassengerIdentityFromRow(identities[0] || null));
    const { _role, ...passenger } = mapped;
    return res.json({ passenger });
  } catch (err) {
    console.error('PATCH /api/admin/passengers/:passengerId/review', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:passengerId', requireAdminAuth, requirePermission('passengers.delete'), async (req, res) => {
  try {
    const passengerId = String(req.params.passengerId || '').trim();
    if (!passengerId) {
      return res.status(400).json({ error: 'Invalid passenger id' });
    }

    const clerkClient = getClerkClient();
    const user = await clerkClient.users.getUser(passengerId);
    const mapped = mapPassenger(user);
    if (mapped._role !== 'passenger') {
      return res.status(404).json({ error: 'Passenger not found' });
    }

    await deleteEndUserAccount(passengerId, 'passenger');
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/passengers/:passengerId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
