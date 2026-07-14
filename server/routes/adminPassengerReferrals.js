import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';

const router = Router();

function fullName(firstName, lastName, emailFallback = null) {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  return name || emailFallback || null;
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function clampPageSize(value, fallback = 20) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), 100);
}

function clampPage(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

router.get('/', requireAdminAuth, requirePermission('passengers.read'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const sortByRaw = String(req.query.sortBy || 'referralCount').trim();
    const sortOrder = String(req.query.sortOrder || 'desc').trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const page = clampPage(req.query.page);
    const pageSize = clampPageSize(req.query.pageSize, 20);
    const offset = (page - 1) * pageSize;

    const sortColumn = sortByRaw === 'lastReferralAt'
      ? 'last_referral_at'
      : sortByRaw === 'email'
        ? 'referrer_email'
        : sortByRaw === 'name'
          ? 'referrer_full_name'
          : 'referral_count';

    const [summaryRow] = await query(
      `SELECT
         COUNT(*) AS total_referred_passengers,
         COUNT(DISTINCT referrer_user_id) AS total_referrers
       FROM passenger_peer_referrals`
    );

    const sourceRows = await query(
      `SELECT
         COALESCE(NULLIF(TRIM(source), ''), 'unknown') AS source,
         COUNT(*) AS count
       FROM passenger_peer_referrals
       GROUP BY COALESCE(NULLIF(TRIM(source), ''), 'unknown')
       ORDER BY count DESC`
    );

    const params = [];
    let whereSql = '';
    if (search) {
      whereSql = `
        WHERE (
          LOWER(COALESCE(u.email, '')) LIKE ?
          OR LOWER(COALESCE(u.first_name, '')) LIKE ?
          OR LOWER(COALESCE(u.last_name, '')) LIKE ?
          OR LOWER(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) LIKE ?
          OR LOWER(r.referrer_user_id) LIKE ?
        )
      `;
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }

    const [countRow] = await query(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT r.referrer_user_id
         FROM passenger_peer_referrals r
         LEFT JOIN users u ON u.clerk_user_id = r.referrer_user_id
         ${whereSql}
         GROUP BY r.referrer_user_id
       ) grouped`,
      params
    );

    const total = Number(countRow?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const referrerRows = await query(
      `SELECT
         r.referrer_user_id,
         u.email AS referrer_email,
         u.first_name AS referrer_first_name,
         u.last_name AS referrer_last_name,
         u.image_url AS referrer_image_url,
         COUNT(*) AS referral_count,
         MAX(r.created_at) AS last_referral_at,
         MIN(r.created_at) AS first_referral_at,
         CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS referrer_full_name
       FROM passenger_peer_referrals r
       LEFT JOIN users u ON u.clerk_user_id = r.referrer_user_id
       ${whereSql}
       GROUP BY
         r.referrer_user_id,
         u.email,
         u.first_name,
         u.last_name,
         u.image_url
       ORDER BY ${sortColumn} ${sortOrder}, referral_count DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return res.json({
      summary: {
        totalReferredPassengers: Number(summaryRow?.total_referred_passengers || 0),
        totalReferrers: Number(summaryRow?.total_referrers || 0),
        bySource: sourceRows.map((row) => ({
          source: row.source,
          count: Number(row.count || 0),
        })),
      },
      referrers: referrerRows.map((row) => ({
        referrerUserId: row.referrer_user_id,
        email: row.referrer_email || null,
        firstName: row.referrer_first_name || null,
        lastName: row.referrer_last_name || null,
        fullName: fullName(row.referrer_first_name, row.referrer_last_name, row.referrer_email),
        imageUrl: row.referrer_image_url || null,
        referralCount: Number(row.referral_count || 0),
        firstReferralAt: toIsoOrNull(row.first_referral_at),
        lastReferralAt: toIsoOrNull(row.last_referral_at),
      })),
      page,
      pageSize,
      total,
      totalPages,
    });
  } catch (err) {
    console.error('GET /api/admin/passenger-referrals', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:referrerUserId', requireAdminAuth, requirePermission('passengers.read'), async (req, res) => {
  try {
    const referrerUserId = String(req.params.referrerUserId || '').trim();
    if (!referrerUserId) {
      return res.status(400).json({ error: 'referrerUserId is required' });
    }

    const [referrer] = await query(
      `SELECT clerk_user_id, email, first_name, last_name, image_url, phone_number, created_at, role
       FROM users
       WHERE clerk_user_id = ?
       LIMIT 1`,
      [referrerUserId]
    );

    const [statsRow] = await query(
      `SELECT
         COUNT(*) AS total_referrals,
         MIN(created_at) AS first_referral_at,
         MAX(created_at) AS last_referral_at
       FROM passenger_peer_referrals
       WHERE referrer_user_id = ?`,
      [referrerUserId]
    );

    const totalReferrals = Number(statsRow?.total_referrals || 0);
    if (!referrer && totalReferrals === 0) {
      return res.status(404).json({ error: 'Referrer not found' });
    }

    const referralRows = await query(
      `SELECT
         r.id,
         r.referred_user_id,
         r.source,
         r.created_at,
         u.email AS referred_email,
         u.first_name AS referred_first_name,
         u.last_name AS referred_last_name,
         u.image_url AS referred_image_url,
         u.phone_number AS referred_phone_number,
         u.created_at AS referred_created_at
       FROM passenger_peer_referrals r
       LEFT JOIN users u ON u.clerk_user_id = r.referred_user_id
       WHERE r.referrer_user_id = ?
       ORDER BY r.created_at DESC`,
      [referrerUserId]
    );

    const [referredByRow] = await query(
      `SELECT
         r.referrer_user_id,
         r.source,
         r.created_at,
         u.email AS referrer_email,
         u.first_name AS referrer_first_name,
         u.last_name AS referrer_last_name
       FROM passenger_peer_referrals r
       LEFT JOIN users u ON u.clerk_user_id = r.referrer_user_id
       WHERE r.referred_user_id = ?
       LIMIT 1`,
      [referrerUserId]
    );

    return res.json({
      referrer: {
        id: referrerUserId,
        email: referrer?.email || null,
        firstName: referrer?.first_name || null,
        lastName: referrer?.last_name || null,
        fullName: fullName(referrer?.first_name, referrer?.last_name, referrer?.email) || referrerUserId,
        imageUrl: referrer?.image_url || null,
        phoneNumber: referrer?.phone_number || null,
        role: referrer?.role || 'passenger',
        createdAt: toIsoOrNull(referrer?.created_at),
      },
      stats: {
        totalReferrals,
        firstReferralAt: toIsoOrNull(statsRow?.first_referral_at),
        lastReferralAt: toIsoOrNull(statsRow?.last_referral_at),
      },
      referredBy: referredByRow
        ? {
            referrerUserId: referredByRow.referrer_user_id,
            referrerEmail: referredByRow.referrer_email || null,
            referrerName: fullName(
              referredByRow.referrer_first_name,
              referredByRow.referrer_last_name,
              referredByRow.referrer_email
            ),
            source: referredByRow.source || null,
            createdAt: toIsoOrNull(referredByRow.created_at),
          }
        : null,
      referrals: referralRows.map((row) => ({
        id: row.id,
        referredUserId: row.referred_user_id,
        source: row.source || null,
        createdAt: toIsoOrNull(row.created_at),
        email: row.referred_email || null,
        firstName: row.referred_first_name || null,
        lastName: row.referred_last_name || null,
        fullName: fullName(row.referred_first_name, row.referred_last_name, row.referred_email) || row.referred_user_id,
        imageUrl: row.referred_image_url || null,
        phoneNumber: row.referred_phone_number || null,
        accountCreatedAt: toIsoOrNull(row.referred_created_at),
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/passenger-referrals/:referrerUserId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
