import crypto from 'crypto';
import { query, withTransaction } from '../db/connection.js';

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
      `SELECT id, driver_user_id, agent_user_id, invite_id, source
       FROM agent_driver_referrals
       WHERE driver_user_id = ?
       LIMIT 1`,
      [driverUserId]
    );

    if (existingRows[0]) {
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
        alreadyExists: true,
      };
    }

    const referralSource = String(source || 'admin_manual').trim() || 'admin_manual';
    await connection.execute(
      `INSERT INTO agent_driver_referrals (driver_user_id, agent_user_id, invite_id, source)
       VALUES (?, ?, ?, ?)`,
      [driverUserId, invite.agentUserId, invite.id, referralSource]
    );

    return {
      driverUserId,
      agentUserId: invite.agentUserId,
      inviteId: invite.id,
      source: referralSource,
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
      `SELECT id, driver_user_id, agent_user_id, invite_id, source
       FROM agent_driver_referrals
       WHERE driver_user_id = ?
       LIMIT 1`,
      [driverUserId]
    );

    if (existingRows[0]) {
      return {
        driverUserId: existingRows[0].driver_user_id,
        agentUserId: existingRows[0].agent_user_id,
        inviteId: existingRows[0].invite_id,
        source: existingRows[0].source,
      };
    }

    await connection.execute(
      `INSERT INTO agent_driver_referrals (driver_user_id, agent_user_id, invite_id, source)
       VALUES (?, ?, ?, 'agent_deep_link')`,
      [driverUserId, invite.agentUserId, invite.id]
    );

    return {
      driverUserId,
      agentUserId: invite.agentUserId,
      inviteId: invite.id,
      source: 'agent_deep_link',
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
