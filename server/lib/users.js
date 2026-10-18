import { getUserStore } from './user-store.js';

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
  const normalizedStatus = String(accountStatus || 'active').trim().toLowerCase() || 'active';

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
    status: normalizedStatus,
    accountStatus: normalizedStatus,
    isBlocked: normalizedStatus === 'blocked',
    isFlagged: normalizedStatus === 'flagged',
    isRestricted: normalizedStatus === 'blocked' || normalizedStatus === 'flagged',
    ratingRestrictionReason: privateMeta.ratingRestrictionReason || null,
    passwordEnabled: user.passwordEnabled === true,
    settings: {
      phoneVisibleToDrivers: privateMeta.phoneVisibleToDrivers === true,
    },
    profileImageReview: getDriverProfileImageReview(privateMeta, role),
    publicMetadata: publicMeta,
    privateMetadata: privateMeta,
  };
}

/** Synthetic passenger IDs (admin dispatch, WhatsApp bookings) have no user row. */
export async function getUserById(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId || normalizedUserId.startsWith('dispatch:') || normalizedUserId.startsWith('whatsapp:')) {
    return null;
  }
  return getUserStore().users.getUser(normalizedUserId);
}

export async function setRoleForUser(userId, role) {
  const normalizedRole = normalizeRole(role);
  await getUserStore().users.updateUserMetadata(userId, { publicMetadata: { role: normalizedRole } });
  return normalizedRole;
}

export async function mergePrivateMetadata(userId, patch) {
  const user = await getUserStore().users.updateUserMetadata(userId, { privateMetadata: patch });
  return user.privateMetadata;
}

function isUserNotFoundError(error) {
  if (!error) return false;
  if (Number(error.status) === 404) return true;
  const errors = Array.isArray(error.errors) ? error.errors : [];
  return errors.some((item) => item?.code === 'resource_not_found');
}

/** `clerkUserId` is the users.clerk_user_id column, which is now simply the user's ID. */
export async function resolveUserIdForMetadataSync({ clerkUserId, email, role = 'driver' }) {
  const mysqlUserId = String(clerkUserId || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (mysqlUserId) {
    try {
      await getUserById(mysqlUserId);
      return { clerkUserId: mysqlUserId, repaired: false };
    } catch (error) {
      if (!isUserNotFoundError(error)) {
        throw error;
      }
    }
  }

  if (!normalizedEmail) {
    return { clerkUserId: mysqlUserId || null, repaired: false, notFoundInClerk: true };
  }

  const list = await getUserStore().users.getUserList({ emailAddress: [normalizedEmail], limit: 10 });
  const users = Array.isArray(list?.data) ? list.data : [];
  const expectedRole = normalizeRole(role);
  const match = users.find((user) => normalizeRole(user.publicMetadata?.role) === expectedRole) || users[0] || null;

  if (!match?.id) {
    return { clerkUserId: mysqlUserId || null, repaired: false, notFoundInClerk: true };
  }

  return {
    clerkUserId: match.id,
    repaired: Boolean(mysqlUserId && mysqlUserId !== match.id),
    staleMysqlClerkUserId: mysqlUserId && mysqlUserId !== match.id ? mysqlUserId : null,
  };
}

export async function syncRecruitmentPrivateMetadata(userId, { referredByAgentId, recruitmentSource }) {
  try {
    await mergePrivateMetadata(userId, { referredByAgentId, recruitmentSource });
    return { synced: true };
  } catch (error) {
    if (isUserNotFoundError(error)) {
      return {
        synced: false,
        reason: 'user_not_found',
        message: 'Referral saved, but this user no longer exists.',
      };
    }
    console.error('syncRecruitmentPrivateMetadata failed', { userId, error });
    return {
      synced: false,
      reason: 'sync_failed',
      message: 'Referral saved, but the user profile could not be updated.',
    };
  }
}

export async function clearRecruitmentPrivateMetadata(userId) {
  try {
    const privateMetadata = await mergePrivateMetadata(userId, { referredByAgentId: null, recruitmentSource: null });
    return { cleared: true, privateMetadata };
  } catch (error) {
    if (isUserNotFoundError(error)) {
      return {
        cleared: false,
        reason: 'user_not_found',
        message: 'Referral removed from database. The user was not found, so the profile was not updated.',
      };
    }
    throw error;
  }
}
