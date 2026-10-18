/**
 * MySQL-backed user store. Exposes the subset of the old Clerk backend API the server used
 * (users.getUser / getUserList / updateUserMetadata / updateUser / deleteUser) and returns
 * user objects in the same shape, so existing call sites keep working unchanged.
 */
import { query } from '../db/connection.js';
import { getLegacyClerkClient, importClerkUserById, isClerkImportAvailable } from './clerk-import.js';

const USER_SELECT = `SELECT clerk_user_id, email, first_name, last_name, image_url, role,
  phone_number, phone_verified_at, email_verified_at, password_hash,
  public_metadata, private_metadata, unsafe_metadata, clerk_imported_at,
  created_at, updated_at, last_sign_in_at
  FROM users`;

function notFoundError(userId) {
  const error = new Error(`User ${userId} not found`);
  error.status = 404;
  error.errors = [{ code: 'resource_not_found', message: 'User not found' }];
  return error;
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return { ...value };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function toMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toIso(value) {
  const ms = toMs(value);
  return ms === null ? undefined : new Date(ms).toISOString();
}

function rowToUser(row) {
  const email = row.email || null;
  const phone = row.phone_number || null;
  const publicMetadata = { ...parseJson(row.public_metadata), role: row.role === 'driver' ? 'driver' : 'passenger' };
  const privateMetadata = parseJson(row.private_metadata);
  if (phone && !privateMetadata.phoneNumber) privateMetadata.phoneNumber = phone;
  if (row.phone_verified_at && !privateMetadata.phoneVerifiedAt) privateMetadata.phoneVerifiedAt = toIso(row.phone_verified_at);

  return {
    id: row.clerk_user_id,
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    imageUrl: row.image_url || null,
    hasImage: Boolean(row.image_url),
    primaryEmailAddressId: email ? 'email_primary' : null,
    emailAddresses: email
      ? [{ id: 'email_primary', emailAddress: email, verification: { status: row.email_verified_at ? 'verified' : 'unverified' } }]
      : [],
    primaryPhoneNumberId: phone ? 'phone_primary' : null,
    phoneNumbers: phone
      ? [{ id: 'phone_primary', phoneNumber: phone, verification: { status: row.phone_verified_at ? 'verified' : 'unverified' } }]
      : [],
    publicMetadata,
    privateMetadata,
    unsafeMetadata: parseJson(row.unsafe_metadata),
    passwordEnabled: Boolean(row.password_hash),
    createdAt: toMs(row.created_at),
    updatedAt: toMs(row.updated_at),
    lastSignInAt: toMs(row.last_sign_in_at),
    banned: false,
  };
}

async function loadRow(userId) {
  const [row] = await query(`${USER_SELECT} WHERE clerk_user_id = ? LIMIT 1`, [userId]);
  return row || null;
}

/** Copies a Clerk user on first use until the bulk import has run; a no-op once CLERK_SECRET_KEY is removed. */
async function loadRowImportingIfNeeded(userId) {
  let row = await loadRow(userId);
  if ((!row || !row.clerk_imported_at) && isClerkImportAvailable() && String(userId).startsWith('user_')) {
    try {
      if (await importClerkUserById(userId)) row = await loadRow(userId);
    } catch (error) {
      console.error('[user-store] clerk import on read failed', { userId, message: error?.message || String(error) });
    }
  }
  return row;
}

function mergeMetadata(current, patch) {
  if (patch === undefined) return current;
  const next = { ...current };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

const ORDER_BY = {
  created_at: 'created_at ASC',
  '+created_at': 'created_at ASC',
  '-created_at': 'created_at DESC',
  updated_at: 'updated_at ASC',
  '+updated_at': 'updated_at ASC',
  '-updated_at': 'updated_at DESC',
  last_sign_in_at: 'last_sign_in_at ASC',
  '+last_sign_in_at': 'last_sign_in_at ASC',
  '-last_sign_in_at': 'last_sign_in_at DESC',
};

function phoneVariants(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return [];
  const national = digits.startsWith('263') ? digits.slice(3) : digits.replace(/^0/, '');
  return [`+263${national}`, `263${national}`, `0${national}`];
}

export const userStore = {
  users: {
    async getUser(userId) {
      const id = String(userId || '').trim();
      if (!id) throw notFoundError(userId);
      const row = await loadRowImportingIfNeeded(id);
      if (!row) throw notFoundError(id);
      return rowToUser(row);
    },

    async getUserList({ emailAddress, phoneNumber, userId, query: search, limit = 10, offset = 0, orderBy = '-created_at' } = {}) {
      const where = [];
      const params = [];
      const emails = (Array.isArray(emailAddress) ? emailAddress : emailAddress ? [emailAddress] : [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
      if (emails.length) {
        where.push(`LOWER(email) IN (${emails.map(() => '?').join(', ')})`);
        params.push(...emails);
      }
      const phones = (Array.isArray(phoneNumber) ? phoneNumber : phoneNumber ? [phoneNumber] : []).flatMap(phoneVariants);
      if (phones.length) {
        where.push(`phone_number IN (${phones.map(() => '?').join(', ')})`);
        params.push(...phones);
      }
      const ids = (Array.isArray(userId) ? userId : userId ? [userId] : []).map(String).filter(Boolean);
      if (ids.length) {
        where.push(`clerk_user_id IN (${ids.map(() => '?').join(', ')})`);
        params.push(...ids);
      }
      const term = String(search || '').trim();
      if (term) {
        where.push(`(email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone_number LIKE ? OR clerk_user_id = ?
          OR CONCAT_WS(' ', first_name, last_name) LIKE ?)`);
        const like = `%${term}%`;
        params.push(like, like, like, like, term, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 500));
      const safeOffset = Math.max(0, Number(offset) || 0);
      const orderSql = ORDER_BY[String(orderBy || '').trim()] || 'created_at DESC';

      const rows = await query(
        `${USER_SELECT} ${whereSql} ORDER BY ${orderSql}, id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        params
      );
      const [countRow] = await query(`SELECT COUNT(*) AS total FROM users ${whereSql}`, params);
      return { data: rows.map(rowToUser), totalCount: Number(countRow?.total || 0) };
    },

    async updateUserMetadata(userId, { publicMetadata, privateMetadata, unsafeMetadata } = {}) {
      const row = await loadRowImportingIfNeeded(String(userId || '').trim());
      if (!row) throw notFoundError(userId);

      const nextPublic = mergeMetadata(parseJson(row.public_metadata), publicMetadata);
      const nextPrivate = mergeMetadata(parseJson(row.private_metadata), privateMetadata);
      const nextUnsafe = mergeMetadata(parseJson(row.unsafe_metadata), unsafeMetadata);
      const nextRole = nextPublic.role === 'driver' ? 'driver' : (nextPublic.role ? 'passenger' : row.role);

      const updates = ['public_metadata = ?', 'private_metadata = ?', 'unsafe_metadata = ?', 'role = ?'];
      const params = [JSON.stringify(nextPublic), JSON.stringify(nextPrivate), JSON.stringify(nextUnsafe), nextRole];
      if (privateMetadata && Object.prototype.hasOwnProperty.call(privateMetadata, 'phoneNumber')) {
        updates.push('phone_number = ?');
        params.push(privateMetadata.phoneNumber || null);
      }
      if (privateMetadata && Object.prototype.hasOwnProperty.call(privateMetadata, 'phoneVerifiedAt')) {
        updates.push('phone_verified_at = ?');
        params.push(privateMetadata.phoneVerifiedAt ? new Date(privateMetadata.phoneVerifiedAt) : null);
      }

      await query(`UPDATE users SET ${updates.join(', ')} WHERE clerk_user_id = ?`, [...params, row.clerk_user_id]);
      return rowToUser(await loadRow(row.clerk_user_id));
    },

    async updateUser(userId, { firstName, lastName } = {}) {
      const row = await loadRowImportingIfNeeded(String(userId || '').trim());
      if (!row) throw notFoundError(userId);
      const updates = [];
      const params = [];
      if (firstName !== undefined) {
        updates.push('first_name = ?');
        params.push(firstName ? String(firstName).trim().slice(0, 120) : null);
      }
      if (lastName !== undefined) {
        updates.push('last_name = ?');
        params.push(lastName ? String(lastName).trim().slice(0, 120) : null);
      }
      if (updates.length) {
        await query(`UPDATE users SET ${updates.join(', ')} WHERE clerk_user_id = ?`, [...params, row.clerk_user_id]);
      }
      return rowToUser(await loadRow(row.clerk_user_id));
    },

    async deleteUser(userId) {
      const id = String(userId || '').trim();
      await query(
        `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'account_deleted'
         WHERE user_id = ? AND revoked_at IS NULL`,
        [id]
      );
      await query(`DELETE FROM users WHERE clerk_user_id = ?`, [id]);
      // Otherwise an old app still signed in through Clerk would re-import the deleted account.
      const legacy = getLegacyClerkClient();
      if (legacy && id.startsWith('user_')) {
        await legacy.users.deleteUser(id).catch((error) => {
          if (Number(error?.status) !== 404) {
            console.error('[user-store] clerk delete failed', { userId: id, message: error?.message || String(error) });
          }
        });
      }
      return { id, deleted: true };
    },
  },
};

export function getUserStore() {
  return userStore;
}
