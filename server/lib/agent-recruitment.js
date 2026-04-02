import { query } from '../db/connection.js';
import { getClerkUserById, getPrimaryEmail, getPrimaryPhone } from './clerk-user.js';

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function countTruthy(values = []) {
  return values.filter(Boolean).length;
}

function buildApplicationStatus({ identity, vehicle }) {
  const identityDocs = [
    hasValue(identity?.national_id_front_url),
    hasValue(identity?.national_id_back_url),
    hasValue(identity?.driver_licence_url),
    hasValue(identity?.selfie_url),
    hasValue(identity?.selfie_with_id_card_url),
  ];
  const vehicleDocs = [
    hasValue(vehicle?.car_photo_front_url),
    hasValue(vehicle?.car_photo_rear_url),
    hasValue(vehicle?.vehicle_registration_book_url),
    hasValue(vehicle?.insurance_url),
    hasValue(vehicle?.zinara_url),
  ];

  const identityUploadedCount = countTruthy(identityDocs);
  const vehicleUploadedCount = countTruthy(vehicleDocs);
  const totalUploadedCount = identityUploadedCount + vehicleUploadedCount;

  const identityStatus = String(identity?.profile_status || '').toLowerCase();
  const vehicleStatus = String(vehicle?.vehicle_status || '').toLowerCase();

  if (identityStatus === 'rejected' || vehicleStatus === 'rejected') {
    return {
      key: 'rejected',
      label: 'Rejected',
      tone: 'rose',
      totalUploadedCount,
      identityUploadedCount,
      vehicleUploadedCount,
    };
  }

  if (identityStatus === 'approved' && vehicleStatus === 'approved') {
    return {
      key: 'approved',
      label: 'Approved',
      tone: 'emerald',
      totalUploadedCount,
      identityUploadedCount,
      vehicleUploadedCount,
    };
  }

  if (identityStatus === 'pending' || vehicleStatus === 'pending') {
    const hasAllIdentityDocs = identityUploadedCount === identityDocs.length;
    const hasAllVehicleDocs = vehicleUploadedCount === vehicleDocs.length;
    const pendingKey = hasAllIdentityDocs && hasAllVehicleDocs ? 'pending_review' : 'partially_submitted';
    return {
      key: pendingKey,
      label: pendingKey === 'pending_review' ? 'Pending Review' : 'Partially Submitted',
      tone: pendingKey === 'pending_review' ? 'amber' : 'blue',
      totalUploadedCount,
      identityUploadedCount,
      vehicleUploadedCount,
    };
  }

  if (totalUploadedCount > 0) {
    return {
      key: 'documents_started',
      label: 'Documents Started',
      tone: 'blue',
      totalUploadedCount,
      identityUploadedCount,
      vehicleUploadedCount,
    };
  }

  return {
    key: 'account_created',
    label: 'Account Created',
    tone: 'slate',
    totalUploadedCount,
    identityUploadedCount,
    vehicleUploadedCount,
  };
}

export async function listAgentRecruitmentApplications(agentUserId) {
  const rows = await query(
    `SELECT
      r.id,
      r.driver_user_id,
      r.agent_user_id,
      r.invite_id,
      r.source,
      r.created_at AS referral_created_at,
      i.created_at AS invite_created_at,
      di.profile_status,
      di.profile_submitted_at,
      di.profile_reviewed_at,
      di.profile_rejection_reason,
      di.national_id_front_url,
      di.national_id_back_url,
      di.driver_licence_url,
      di.selfie_url,
      di.selfie_with_id_card_url,
      dv.vehicle_status,
      dv.vehicle_submitted_at,
      dv.vehicle_reviewed_at,
      dv.vehicle_rejection_reason,
      dv.car_photo_front_url,
      dv.car_photo_rear_url,
      dv.vehicle_registration_book_url,
      dv.insurance_url,
      dv.zinara_url,
      dv.make,
      dv.model,
      dv.number_plate
    FROM agent_driver_referrals r
    INNER JOIN agent_invites i ON i.id = r.invite_id
    LEFT JOIN driver_identity di ON di.driver_user_id = r.driver_user_id
    LEFT JOIN driver_vehicle dv ON dv.driver_user_id = r.driver_user_id
    WHERE r.agent_user_id = ?
    ORDER BY r.created_at DESC, r.id DESC`,
    [agentUserId]
  );

  const applications = await Promise.all(
    rows.map(async (row) => {
      let clerkUser = null;
      try {
        clerkUser = await getClerkUserById(row.driver_user_id, { skipCache: true });
      } catch {
        clerkUser = null;
      }

      const fullName = [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ').trim();
      const applicationStatus = buildApplicationStatus({
        identity: row,
        vehicle: row,
      });

      return {
        id: row.id,
        driverUserId: row.driver_user_id,
        agentUserId: row.agent_user_id,
        inviteId: row.invite_id,
        source: row.source,
        referredAt: row.referral_created_at,
        inviteCreatedAt: row.invite_created_at,
        driver: {
          fullName: fullName || null,
          email: clerkUser ? getPrimaryEmail(clerkUser) : null,
          phoneNumber: clerkUser?.privateMetadata?.phoneNumber || (clerkUser ? getPrimaryPhone(clerkUser) : null),
        },
        vehicle: {
          make: row.make || null,
          model: row.model || null,
          numberPlate: row.number_plate || null,
        },
        identityStatus: row.profile_status || null,
        vehicleStatus: row.vehicle_status || null,
        submittedAt: row.profile_submitted_at || row.vehicle_submitted_at || null,
        reviewedAt: row.profile_reviewed_at || row.vehicle_reviewed_at || null,
        rejectionReason: row.profile_rejection_reason || row.vehicle_rejection_reason || null,
        status: applicationStatus,
      };
    })
  );

  return applications;
}

export async function getAgentRecruitmentDashboard(agentUserId) {
  const [applications, inviteOpenRows] = await Promise.all([
    listAgentRecruitmentApplications(agentUserId),
    query(
      `SELECT COUNT(*) AS total
       FROM agent_invite_events e
       INNER JOIN agent_invites i ON i.id = e.invite_id
       WHERE i.agent_user_id = ? AND e.event_type = 'invite_opened'`,
      [agentUserId]
    ),
  ]);

  const summary = {
    inviteOpens: Number(inviteOpenRows?.[0]?.total || 0),
    accountCreated: applications.length,
    documentsStarted: applications.filter((item) => ['documents_started', 'partially_submitted', 'pending_review', 'approved', 'rejected'].includes(item.status.key)).length,
    pendingReview: applications.filter((item) => item.status.key === 'pending_review').length,
    approved: applications.filter((item) => item.status.key === 'approved').length,
    rejected: applications.filter((item) => item.status.key === 'rejected').length,
  };

  return { summary, applications };
}
