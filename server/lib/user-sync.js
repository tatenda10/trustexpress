import { query } from '../db/connection.js';
import { toAppUser } from './clerk-user.js';

function normalizeRole(value) {
  return value === 'driver' ? 'driver' : 'passenger';
}

export async function recordRoleChangeAudit({
  clerkUserId,
  previousRole,
  newRole,
  source,
  reason,
  metadata = null,
}) {
  if (!clerkUserId || previousRole === newRole) return;
  try {
    await query(
      `INSERT INTO user_role_change_audit (
         clerk_user_id,
         previous_role,
         new_role,
         source,
         reason,
         metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        clerkUserId,
        previousRole || null,
        newRole,
        source || 'system',
        reason || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (error) {
    if (error?.code !== 'ER_NO_SUCH_TABLE') {
      console.error('[user-sync] role audit failed', {
        clerkUserId,
        previousRole,
        newRole,
        source,
        message: error?.message || String(error),
      });
    }
  }
}

function resolveSyncedRole(existingRole, incomingRole) {
  const previousRole = normalizeRole(existingRole);
  const nextRole = normalizeRole(incomingRole);
  if (previousRole === 'driver' && nextRole !== 'driver') {
    return {
      role: 'driver',
      preserved: true,
      reason: 'Existing driver role preserved during passenger sync',
    };
  }
  return {
    role: nextRole,
    preserved: false,
    reason: previousRole !== nextRole ? 'Role synced from Clerk metadata' : null,
  };
}

export async function upsertAppUserToMysql(appUser, options = {}) {
  if (!appUser?.clerk_user_id) return;
  const source = String(options.source || 'clerk_user_sync').trim() || 'clerk_user_sync';
  const incomingRole = normalizeRole(appUser.role || 'passenger');
  const [existingUser] = await query(
    `SELECT role
     FROM users
     WHERE clerk_user_id = ?
     LIMIT 1`,
    [appUser.clerk_user_id]
  );
  const resolved = existingUser
    ? resolveSyncedRole(existingUser.role, incomingRole)
    : { role: incomingRole, preserved: false, reason: 'User inserted from Clerk metadata' };

  await query(
    `INSERT INTO users (
      clerk_user_id,
      email,
      first_name,
      last_name,
      image_url,
      role,
      phone_number,
      phone_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      email = VALUES(email),
      first_name = VALUES(first_name),
      last_name = VALUES(last_name),
      image_url = VALUES(image_url),
      role = CASE
        WHEN role = 'driver' AND VALUES(role) <> 'driver' THEN role
        ELSE VALUES(role)
      END,
      phone_number = VALUES(phone_number),
      phone_verified_at = VALUES(phone_verified_at),
      updated_at = CURRENT_TIMESTAMP`,
    [
      appUser.clerk_user_id,
      appUser.email || null,
      appUser.first_name || null,
      appUser.last_name || null,
      appUser.image_url || null,
      resolved.role,
      appUser.phone_number || null,
      appUser.phone_verified_at ? new Date(appUser.phone_verified_at) : null,
    ]
  );

  if (!existingUser || normalizeRole(existingUser.role) !== resolved.role) {
    await recordRoleChangeAudit({
      clerkUserId: appUser.clerk_user_id,
      previousRole: existingUser?.role || null,
      newRole: resolved.role,
      source,
      reason: resolved.reason,
      metadata: {
        incomingRole,
        preservedDriverRole: resolved.preserved,
        email: appUser.email || null,
      },
    });
  }
}

export async function upsertClerkUserToMysql(clerkUser, options = {}) {
  if (!clerkUser) return null;
  const appUser = toAppUser(clerkUser);
  await upsertAppUserToMysql(appUser, options);
  return appUser;
}
