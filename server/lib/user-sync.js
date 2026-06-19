import { query } from '../db/connection.js';
import { toAppUser } from './clerk-user.js';

export async function upsertAppUserToMysql(appUser) {
  if (!appUser?.clerk_user_id) return;

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
      role = VALUES(role),
      phone_number = VALUES(phone_number),
      phone_verified_at = VALUES(phone_verified_at),
      updated_at = CURRENT_TIMESTAMP`,
    [
      appUser.clerk_user_id,
      appUser.email || null,
      appUser.first_name || null,
      appUser.last_name || null,
      appUser.image_url || null,
      appUser.role || 'passenger',
      appUser.phone_number || null,
      appUser.phone_verified_at ? new Date(appUser.phone_verified_at) : null,
    ]
  );
}

export async function upsertClerkUserToMysql(clerkUser) {
  if (!clerkUser) return null;
  const appUser = toAppUser(clerkUser);
  await upsertAppUserToMysql(appUser);
  return appUser;
}
