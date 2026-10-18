/**
 * One-way copy of Clerk users into MySQL. Only used while CLERK_SECRET_KEY is still set:
 * by scripts/import-clerk-users.js (bulk) and by the user store for users not yet copied.
 * Delete this file (and @clerk/backend) once every user is imported.
 */
import { createClerkClient } from '@clerk/backend';
import { query } from '../db/connection.js';

let legacyClient = null;

export function isClerkImportAvailable() {
  return Boolean(String(process.env.CLERK_SECRET_KEY || '').trim());
}

export function getLegacyClerkClient() {
  if (!isClerkImportAvailable()) return null;
  if (!legacyClient) legacyClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  return legacyClient;
}

function pickPrimary(list, primaryId) {
  if (!Array.isArray(list) || !list.length) return null;
  return list.find((item) => item.id === primaryId) || list[0];
}

function toDate(ms) {
  const value = Number(ms);
  return Number.isFinite(value) && value > 0 ? new Date(value) : null;
}

function normalizeRole(value) {
  return value === 'driver' ? 'driver' : 'passenger';
}

/** Upserts one Clerk user. Existing MySQL-only columns (password_hash, registration_*, etc.) are kept. */
export async function importClerkUser(clerkUser) {
  if (!clerkUser?.id) return null;
  const email = pickPrimary(clerkUser.emailAddresses, clerkUser.primaryEmailAddressId);
  const phone = pickPrimary(clerkUser.phoneNumbers, clerkUser.primaryPhoneNumberId);
  const privateMeta = clerkUser.privateMetadata || {};
  const publicMeta = clerkUser.publicMetadata || {};
  const phoneNumber = privateMeta.phoneNumber || phone?.phoneNumber || null;
  const phoneVerifiedAt = privateMeta.phoneVerifiedAt
    ? new Date(privateMeta.phoneVerifiedAt)
    : (phone?.verification?.status === 'verified' ? toDate(clerkUser.createdAt) : null);
  const emailVerified = email?.verification?.status === 'verified' || Boolean(email);

  await query(
    `INSERT INTO users (
       clerk_user_id, email, first_name, last_name, image_url, role,
       phone_number, phone_verified_at, email_verified_at,
       public_metadata, private_metadata, unsafe_metadata,
       created_at, last_sign_in_at, clerk_imported_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       email = COALESCE(VALUES(email), email),
       first_name = COALESCE(VALUES(first_name), first_name),
       last_name = COALESCE(VALUES(last_name), last_name),
       image_url = COALESCE(VALUES(image_url), image_url),
       role = CASE WHEN role = 'driver' THEN role ELSE VALUES(role) END,
       phone_number = COALESCE(VALUES(phone_number), phone_number),
       phone_verified_at = COALESCE(phone_verified_at, VALUES(phone_verified_at)),
       email_verified_at = COALESCE(email_verified_at, VALUES(email_verified_at)),
       public_metadata = VALUES(public_metadata),
       private_metadata = VALUES(private_metadata),
       unsafe_metadata = VALUES(unsafe_metadata),
       last_sign_in_at = COALESCE(VALUES(last_sign_in_at), last_sign_in_at),
       clerk_imported_at = CURRENT_TIMESTAMP`,
    [
      clerkUser.id,
      email?.emailAddress ? String(email.emailAddress).toLowerCase() : null,
      clerkUser.firstName || null,
      clerkUser.lastName || null,
      clerkUser.imageUrl && clerkUser.hasImage !== false ? clerkUser.imageUrl : null,
      normalizeRole(publicMeta.role),
      phoneNumber,
      phoneVerifiedAt,
      emailVerified ? (toDate(clerkUser.createdAt) || new Date()) : null,
      JSON.stringify(publicMeta),
      JSON.stringify(privateMeta),
      JSON.stringify(clerkUser.unsafeMetadata || {}),
      toDate(clerkUser.createdAt) || new Date(),
      toDate(clerkUser.lastSignInAt),
    ]
  );
  return clerkUser.id;
}

/** Imports a single user by ID; marks the row as imported when Clerk no longer has it. */
export async function importClerkUserById(userId) {
  const client = getLegacyClerkClient();
  if (!client) return false;
  try {
    const clerkUser = await client.users.getUser(userId);
    await importClerkUser(clerkUser);
    return true;
  } catch (error) {
    const notFound = Number(error?.status) === 404
      || (Array.isArray(error?.errors) && error.errors.some((item) => item?.code === 'resource_not_found'));
    if (notFound) {
      await query(
        `UPDATE users SET clerk_imported_at = CURRENT_TIMESTAMP WHERE clerk_user_id = ? AND clerk_imported_at IS NULL`,
        [userId]
      );
      return false;
    }
    throw error;
  }
}
