import { query } from '../db/connection.js';
import { getClerkUserById, toAppUser } from './clerk-user.js';
import { upsertClerkUserToMysql } from './user-sync.js';

export function normalizeReferrerEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export async function findReferrerByEmail(email) {
  const normalizedEmail = normalizeReferrerEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes('@')) return null;

  const rows = await query(
    `SELECT clerk_user_id, email, first_name, last_name, role
     FROM users
     WHERE LOWER(email) = ?
       AND role = 'passenger'
     LIMIT 1`,
    [normalizedEmail]
  );
  return rows[0] || null;
}

export async function getExistingPeerReferral(referredUserId) {
  const rows = await query(
    `SELECT
       r.id,
       r.referrer_user_id,
       r.referred_user_id,
       r.source,
       r.created_at,
       u.email AS referrer_email,
       u.first_name AS referrer_first_name,
       u.last_name AS referrer_last_name
     FROM passenger_peer_referrals r
     LEFT JOIN users u ON u.clerk_user_id = r.referrer_user_id
     WHERE r.referred_user_id = ?
     LIMIT 1`,
    [String(referredUserId || '').trim()]
  );
  return rows[0] || null;
}

function buildReferralError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function attachPassengerPeerReferral({
  referredUserId,
  referrerEmail,
  source = 'signup_email',
}) {
  const referredId = String(referredUserId || '').trim();
  if (!referredId) {
    throw buildReferralError('Referred user id is required');
  }

  const existing = await getExistingPeerReferral(referredId);
  if (existing) {
    return {
      alreadyExists: true,
      referral: {
        id: existing.id,
        referrerUserId: existing.referrer_user_id,
        referredUserId: existing.referred_user_id,
        source: existing.source,
        createdAt: existing.created_at,
        referrerEmail: existing.referrer_email || null,
        referrerName: [existing.referrer_first_name, existing.referrer_last_name].filter(Boolean).join(' ').trim() || null,
      },
    };
  }

  const normalizedEmail = normalizeReferrerEmail(referrerEmail);
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw buildReferralError('Enter a valid referrer email');
  }

  const referrerRow = await findReferrerByEmail(normalizedEmail);
  if (!referrerRow) {
    throw buildReferralError('No passenger account found with that email');
  }

  const referrerUserId = referrerRow.clerk_user_id;
  if (referrerUserId === referredId) {
    throw buildReferralError('You cannot refer yourself');
  }

  const referredUser = await getClerkUserById(referredId);
  const referredAppUser = toAppUser(referredUser);
  if (referredAppUser.role !== 'passenger') {
    throw buildReferralError('Only passenger accounts can use passenger referrals');
  }
  await upsertClerkUserToMysql(referredUser);

  const referrerUser = await getClerkUserById(referrerUserId);
  const referrerAppUser = toAppUser(referrerUser);
  if (referrerAppUser.role !== 'passenger') {
    throw buildReferralError('Referrer must be a passenger account');
  }
  await upsertClerkUserToMysql(referrerUser);

  const matchedSource = String(source || 'signup_email').trim() || 'signup_email';

  await query(
    `INSERT INTO passenger_peer_referrals (
       referrer_user_id,
       referred_user_id,
       referral_code,
       source
     ) VALUES (?, ?, NULL, ?)`,
    [referrerUserId, referredId, matchedSource]
  );

  return {
    alreadyExists: false,
    referral: {
      referrerUserId,
      referredUserId: referredId,
      source: matchedSource,
      referrerEmail: referrerAppUser.email || normalizedEmail,
      referrerName: [referrerAppUser.first_name, referrerAppUser.last_name].filter(Boolean).join(' ').trim() || null,
    },
  };
}

export async function getPassengerReferralDashboard(passengerUserId) {
  const userId = String(passengerUserId || '').trim();
  const referredBy = await getExistingPeerReferral(userId);

  const [selfRow] = await query(
    `SELECT email, first_name, last_name
     FROM users
     WHERE clerk_user_id = ?
     LIMIT 1`,
    [userId]
  );

  const referrerEmail = String(selfRow?.email || '').trim().toLowerCase();
  const referrerName = [selfRow?.first_name, selfRow?.last_name].filter(Boolean).join(' ').trim() || null;

  const referralRows = await query(
    `SELECT
       r.id,
       r.referred_user_id,
       r.source,
       r.created_at,
       u.email,
       u.first_name,
       u.last_name,
       u.image_url
     FROM passenger_peer_referrals r
     LEFT JOIN users u ON u.clerk_user_id = r.referred_user_id
     WHERE r.referrer_user_id = ?
     ORDER BY r.created_at DESC
     LIMIT 100`,
    [userId]
  );

  const publicBaseUrl = String(
    process.env.PUBLIC_WEB_BASE_URL ||
      process.env.PUBLIC_BASE_URL ||
      process.env.API_PUBLIC_BASE_URL ||
      'https://ridehailcarsserver.online'
  ).replace(/\/$/, '');

  const webUrl = referrerEmail
    ? `${publicBaseUrl}/passenger-signup?referrerEmail=${encodeURIComponent(referrerEmail)}`
    : `${publicBaseUrl}/passenger-signup`;

  return {
    referrerEmail,
    referrerName,
    webUrl,
    shareMessage: referrerEmail
      ? `Join me on Trust Express! When you sign up as a passenger, enter my email as your referrer: ${referrerEmail}`
      : 'Join me on Trust Express!',
    referredBy: referredBy ? {
      referrerUserId: referredBy.referrer_user_id,
      source: referredBy.source,
      createdAt: referredBy.created_at,
      referrerEmail: referredBy.referrer_email || null,
      referrerName: [referredBy.referrer_first_name, referredBy.referrer_last_name].filter(Boolean).join(' ').trim() || null,
    } : null,
    stats: {
      totalReferrals: referralRows.length,
    },
    referrals: referralRows.map((row) => ({
      id: row.id,
      referredUserId: row.referred_user_id,
      source: row.source,
      createdAt: row.created_at,
      email: row.email || null,
      firstName: row.first_name || null,
      lastName: row.last_name || null,
      imageUrl: row.image_url || null,
      displayName: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.email || 'Passenger',
    })),
  };
}
