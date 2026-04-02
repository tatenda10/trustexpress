import { getClerkClient } from './clerk-client.js';

// Short TTL so driver approval from admin is visible soon after refetch (e.g. multi-instance).
const USER_CACHE_TTL_MS = 15 * 1000;
const clerkUserCache = new Map();

export function normalizeRole(value) {
  return value === 'driver' ? 'driver' : 'passenger';
}

export function getPrimaryEmail(user) {
  if (!user) return null;
  if (user.primaryEmailAddressId && Array.isArray(user.emailAddresses)) {
    const primary = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
    if (primary?.emailAddress) return primary.emailAddress;
  }
  return user.emailAddresses?.[0]?.emailAddress || null;
}

export function getPrimaryPhone(user) {
  if (!user) return null;
  if (user.primaryPhoneNumberId && Array.isArray(user.phoneNumbers)) {
    const primary = user.phoneNumbers.find((item) => item.id === user.primaryPhoneNumberId);
    if (primary?.phoneNumber) return primary.phoneNumber;
  }
  return user.phoneNumbers?.[0]?.phoneNumber || null;
}

export function toAppUser(user) {
  const publicMeta = user?.publicMetadata || {};
  const privateMeta = user?.privateMetadata || {};
  const role = normalizeRole(publicMeta.role);
  const email = getPrimaryEmail(user);
  const phoneNumber = privateMeta.phoneNumber || getPrimaryPhone(user) || null;
  const accountStatus = role === 'driver'
    ? (privateMeta.driverStatus || 'active')
    : (privateMeta.passengerStatus || 'active');

  return {
    id: user.id,
    clerk_user_id: user.id,
    first_name: user.firstName || null,
    last_name: user.lastName || null,
    image_url: privateMeta.profileImageUrl || user.imageUrl || null,
    email,
    role,
    phone_number: phoneNumber,
    phone_verified_at: privateMeta.phoneVerifiedAt || null,
    created_at: user.createdAt || null,
    phoneVerified: !!privateMeta.phoneVerifiedAt,
    status: accountStatus,
    accountStatus,
    isBlocked: accountStatus === 'blocked',
    settings: {
      phoneVisibleToDrivers: privateMeta.phoneVisibleToDrivers === true,
    },
    publicMetadata: publicMeta,
    privateMetadata: privateMeta,
  };
}

/**
 * @param {string} userId - Clerk user ID
 * @param {{ skipCache?: boolean }} [opts] - skipCache: true to always fetch from Clerk (e.g. for driver /me so approval status is fresh)
 */
export async function getClerkUserById(userId, opts = {}) {
  const skipCache = opts.skipCache === true;
  const cached = clerkUserCache.get(userId);
  if (!skipCache && cached && (Date.now() - cached.cachedAt) < USER_CACHE_TTL_MS) {
    return cached.user;
  }

  const clerkClient = getClerkClient();
  try {
    const user = await clerkClient.users.getUser(userId);
    if (!skipCache) clerkUserCache.set(userId, { user, cachedAt: Date.now() });
    return user;
  } catch (error) {
    if (cached && !skipCache) {
      return cached.user;
    }
    throw error;
  }
}

export async function setRoleForUser(userId, role) {
  const clerkClient = getClerkClient();
  const normalizedRole = normalizeRole(role);
  await clerkClient.users.updateUserMetadata(userId, {
    publicMetadata: {
      role: normalizedRole,
    },
  });
  clerkUserCache.delete(userId);
  return normalizedRole;
}

export async function mergePrivateMetadata(userId, patch) {
  const clerkClient = getClerkClient();
  const user = await clerkClient.users.getUser(userId);
  const nextPrivate = {
    ...(user.privateMetadata || {}),
    ...patch,
  };

  await clerkClient.users.updateUserMetadata(userId, {
    privateMetadata: nextPrivate,
  });

  clerkUserCache.delete(userId);

  return nextPrivate;
}
