import crypto from 'crypto';
import { query, withTransaction } from '../db/connection.js';
import { AGENT_DRIVER_LINK_DAYS } from './agent-referral-expiry.js';

function generateInviteToken() {
  return crypto.randomBytes(24).toString('hex');
}

function mapInviteRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agentUserId: row.agent_user_id,
    token: row.token,
    isActive: !!row.is_active,
    fullName: row.full_name || '',
    employeeCode: row.employee_code || '',
  };
}

async function getDriverReferralWindow(connection, driverUserId) {
  const [rows] = await connection.execute(
    `SELECT created_at
     FROM users
     WHERE clerk_user_id = ?
     LIMIT 1`,
    [driverUserId]
  );
  const linkedAt = rows[0]?.created_at ? new Date(rows[0].created_at) : new Date();
  const expiresAt = new Date(linkedAt.getTime() + AGENT_DRIVER_LINK_DAYS * 24 * 60 * 60 * 1000);
  if (expiresAt.getTime() <= Date.now()) {
    const error = new Error(`The ${AGENT_DRIVER_LINK_DAYS}-day agent link period for this driver has already expired`);
    error.status = 409;
    error.code = 'AGENT_LINK_WINDOW_EXPIRED';
    throw error;
  }
  return { linkedAt, expiresAt };
}

function assertExistingReferralIsActive(row) {
  const expiresAt = row?.expires_at ? new Date(row.expires_at) : null;
  if (!row?.is_active || !expiresAt || expiresAt.getTime() <= Date.now()) {
    const error = new Error(`The ${AGENT_DRIVER_LINK_DAYS}-day agent link period for this driver has expired`);
    error.status = 409;
    error.code = 'AGENT_LINK_WINDOW_EXPIRED';
    throw error;
  }
}

export async function getOrCreateInviteForAgent(agentUserId) {
  const existingRows = await query(
    `SELECT i.id, i.agent_user_id, i.token, i.is_active, a.full_name, a.employee_code
     FROM agent_invites i
     JOIN agent_users a ON a.id = i.agent_user_id
     WHERE i.agent_user_id = ?
     LIMIT 1`,
    [agentUserId]
  );

  if (existingRows[0]) {
    return mapInviteRow(existingRows[0]);
  }

  const token = generateInviteToken();

  await query(
    `INSERT INTO agent_invites (agent_user_id, token, is_active)
     VALUES (?, ?, 1)`,
    [agentUserId, token]
  );

  const createdRows = await query(
    `SELECT i.id, i.agent_user_id, i.token, i.is_active, a.full_name, a.employee_code
     FROM agent_invites i
     JOIN agent_users a ON a.id = i.agent_user_id
     WHERE i.agent_user_id = ?
     LIMIT 1`,
    [agentUserId]
  );

  return mapInviteRow(createdRows[0]);
}

export async function findInviteByToken(token) {
  const rows = await query(
    `SELECT i.id, i.agent_user_id, i.token, i.is_active, a.full_name, a.employee_code
     FROM agent_invites i
     JOIN agent_users a ON a.id = i.agent_user_id
     WHERE i.token = ? AND i.is_active = 1 AND a.is_active = 1
     LIMIT 1`,
    [token]
  );

  return mapInviteRow(rows[0]);
}

export async function attachDriverToAgentManual({ driverUserId, agentUserId, source = 'admin_manual' }) {
  if (!driverUserId || !agentUserId) return null;

  const invite = await getOrCreateInviteForAgent(agentUserId);
  if (!invite) {
    const error = new Error('Agent invite could not be created');
    error.status = 400;
    throw error;
  }

  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute(
      `SELECT id, driver_user_id, agent_user_id, invite_id, source, linked_at, expires_at, is_active
       FROM agent_driver_referrals
       WHERE driver_user_id = ?
       LIMIT 1`,
      [driverUserId]
    );

    if (existingRows[0]) {
      assertExistingReferralIsActive(existingRows[0]);
      if (Number(existingRows[0].agent_user_id) !== Number(agentUserId)) {
        const error = new Error('Driver is already assigned to another agent');
        error.status = 409;
        error.existingAgentUserId = existingRows[0].agent_user_id;
        throw error;
      }
      return {
        driverUserId: existingRows[0].driver_user_id,
        agentUserId: existingRows[0].agent_user_id,
        inviteId: existingRows[0].invite_id,
        source: existingRows[0].source,
        linkedAt: existingRows[0].linked_at,
        expiresAt: existingRows[0].expires_at,
        alreadyExists: true,
      };
    }

    const { linkedAt, expiresAt } = await getDriverReferralWindow(connection, driverUserId);
    const referralSource = String(source || 'admin_manual').trim() || 'admin_manual';
    await connection.execute(
      `INSERT INTO agent_driver_referrals
        (driver_user_id, agent_user_id, invite_id, source, linked_at, expires_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [driverUserId, invite.agentUserId, invite.id, referralSource, linkedAt, expiresAt]
    );

    return {
      driverUserId,
      agentUserId: invite.agentUserId,
      inviteId: invite.id,
      source: referralSource,
      linkedAt,
      expiresAt,
      alreadyExists: false,
    };
  });
}

export async function attachDriverToAgentInvite({ driverUserId, inviteToken }) {
  const token = String(inviteToken || '').trim();
  if (!driverUserId || !token) return null;

  const invite = await findInviteByToken(token);
  if (!invite) {
    const error = new Error('Invalid or inactive invite link');
    error.status = 400;
    throw error;
  }

  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute(
      `SELECT id, driver_user_id, agent_user_id, invite_id, source, linked_at, expires_at, is_active
       FROM agent_driver_referrals
       WHERE driver_user_id = ?
       LIMIT 1`,
      [driverUserId]
    );

    if (existingRows[0]) {
      assertExistingReferralIsActive(existingRows[0]);
      return {
        driverUserId: existingRows[0].driver_user_id,
        agentUserId: existingRows[0].agent_user_id,
        inviteId: existingRows[0].invite_id,
        source: existingRows[0].source,
        linkedAt: existingRows[0].linked_at,
        expiresAt: existingRows[0].expires_at,
      };
    }

    const { linkedAt, expiresAt } = await getDriverReferralWindow(connection, driverUserId);
    await connection.execute(
      `INSERT INTO agent_driver_referrals
        (driver_user_id, agent_user_id, invite_id, source, linked_at, expires_at, is_active)
       VALUES (?, ?, ?, 'agent_deep_link', ?, ?, 1)`,
      [driverUserId, invite.agentUserId, invite.id, linkedAt, expiresAt]
    );

    return {
      driverUserId,
      agentUserId: invite.agentUserId,
      inviteId: invite.id,
      source: 'agent_deep_link',
      linkedAt,
      expiresAt,
    };
  });
}

export async function attachPassengerToAgentInvite({ passengerUserId, inviteToken }) {
  const token = String(inviteToken || '').trim();
  if (!passengerUserId || !token) return null;

  const invite = await findInviteByToken(token);
  if (!invite) {
    const error = new Error('Invalid or inactive invite link');
    error.status = 400;
    throw error;
  }

  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute(
      `SELECT id, passenger_user_id, agent_user_id, invite_id, source
       FROM agent_passenger_referrals
       WHERE passenger_user_id = ?
       LIMIT 1`,
      [passengerUserId]
    );

    if (existingRows[0]) {
      return {
        passengerUserId: existingRows[0].passenger_user_id,
        agentUserId: existingRows[0].agent_user_id,
        inviteId: existingRows[0].invite_id,
        source: existingRows[0].source,
      };
    }

    await connection.execute(
      `INSERT INTO agent_passenger_referrals (passenger_user_id, agent_user_id, invite_id, source)
       VALUES (?, ?, ?, 'agent_deep_link')`,
      [passengerUserId, invite.agentUserId, invite.id]
    );

    return {
      passengerUserId,
      agentUserId: invite.agentUserId,
      inviteId: invite.id,
      source: 'agent_deep_link',
    };
  });
}
