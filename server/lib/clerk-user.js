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

export function getDriverProfileImageReview(privateMeta = {}, role = 'passenger') {
  if (role !== 'driver') return null;

  const status = String(privateMeta.driverProfileImageReviewStatus || '').trim().toLowerCase();
  const pendingImageUrl = privateMeta.pendingDriverProfileImageUrl || null;
  const approvedImageUrl = privateMeta.profileImageUrl || null;

  if (!pendingImageUrl && !approvedImageUrl && !status) {
    return null;
  }

  return {
    status: pendingImageUrl
      ? (status || 'pending')
      : (status === 'rejected' ? 'rejected' : approvedImageUrl ? 'approved' : null),
    approvedImageUrl,
    pendingImageUrl,
    rejectionReason: privateMeta.driverProfileImageRejectionReason || null,
    submittedAt: privateMeta.driverProfileImageSubmittedAt || null,
    reviewedAt: privateMeta.driverProfileImageReviewedAt || null,
  };
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
    profileImageReview: getDriverProfileImageReview(privateMeta, role),
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

function isClerkUserNotFoundError(error) {
  if (!error) return false;
  if (Number(error.status) === 404) return true;
  const errors = Array.isArray(error.errors) ? error.errors : [];
  return errors.some((item) => item?.code === 'resource_not_found');
}

export async function resolveClerkUserIdForMetadataSync({ clerkUserId, email, role = 'driver' }) {
  const mysqlClerkUserId = String(clerkUserId || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (mysqlClerkUserId) {
    try {
      await getClerkUserById(mysqlClerkUserId, { skipCache: true });
      return { clerkUserId: mysqlClerkUserId, repaired: false };
    } catch (error) {
      if (!isClerkUserNotFoundError(error)) {
        throw error;
      }
    }
  }

  if (!normalizedEmail) {
    return {
      clerkUserId: mysqlClerkUserId || null,
      repaired: false,
      notFoundInClerk: true,
    };
  }

  const clerkClient = getClerkClient();
  const list = await clerkClient.users.getUserList({ emailAddress: [normalizedEmail], limit: 10 });
  const users = Array.isArray(list?.data) ? list.data : [];
  const expectedRole = normalizeRole(role);
  const match = users.find((user) => normalizeRole(user.publicMetadata?.role) === expectedRole) || users[0] || null;

  if (!match?.id) {
    return {
      clerkUserId: mysqlClerkUserId || null,
      repaired: false,
      notFoundInClerk: true,
    };
  }

  return {
    clerkUserId: match.id,
    repaired: Boolean(mysqlClerkUserId && mysqlClerkUserId !== match.id),
    staleMysqlClerkUserId: mysqlClerkUserId && mysqlClerkUserId !== match.id ? mysqlClerkUserId : null,
  };
}

export async function syncRecruitmentPrivateMetadata(userId, { referredByAgentId, recruitmentSource }) {
  try {
    await mergePrivateMetadata(userId, {
      referredByAgentId,
      recruitmentSource,
    });
    return { synced: true };
  } catch (error) {
    if (isClerkUserNotFoundError(error)) {
      return {
        synced: false,
        reason: 'clerk_user_not_found',
        message: 'Referral saved, but this Clerk user no longer exists — metadata was not synced.',
      };
    }
    console.error('syncRecruitmentPrivateMetadata failed', { userId, error });
    return {
      synced: false,
      reason: 'clerk_sync_failed',
      message: 'Referral saved, but Clerk metadata could not be updated.',
    };
  }
}

export async function clearRecruitmentPrivateMetadata(userId) {
  const clerkClient = getClerkClient();
  try {
    const user = await clerkClient.users.getUser(userId);
    const nextPrivate = { ...(user.privateMetadata || {}) };
    delete nextPrivate.referredByAgentId;
    delete nextPrivate.recruitmentSource;

    await clerkClient.users.updateUserMetadata(userId, {
      privateMetadata: nextPrivate,
    });

    clerkUserCache.delete(userId);

    return { cleared: true, privateMetadata: nextPrivate };
  } catch (error) {
    if (isClerkUserNotFoundError(error)) {
      return {
        cleared: false,
        reason: 'clerk_user_not_found',
        message: 'Referral removed from database. Clerk user was not found, so metadata was not cleared.',
      };
    }
    throw error;
  }
}
