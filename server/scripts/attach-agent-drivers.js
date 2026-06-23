import 'dotenv/config';
import { query } from '../db/connection.js';
import { attachDriverToAgentInvite, getOrCreateInviteForAgent } from '../lib/agent-invites.js';

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : '';
}

function getMultiArgs(name) {
  const prefix = `--${name}=`;
  return process.argv
    .filter((arg) => arg.startsWith(prefix))
    .map((arg) => arg.slice(prefix.length).trim())
    .filter(Boolean);
}

function normalizeVehicleNumber(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '');
}

function splitIdentifiers(rawValues = []) {
  return rawValues
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

async function resolveAgent() {
  const agentId = String(getArg('agent-id') || '').trim();
  const agentEmail = String(getArg('agent-email') || '').trim().toLowerCase();
  const agentCode = String(getArg('agent-code') || '').trim();

  let rows = [];
  if (agentId) {
    rows = await query(
      `SELECT id, full_name, email, employee_code, is_active
       FROM agent_users
       WHERE id = ?
       LIMIT 1`,
      [Number(agentId)]
    );
  } else if (agentEmail) {
    rows = await query(
      `SELECT id, full_name, email, employee_code, is_active
       FROM agent_users
       WHERE LOWER(email) = ?
       LIMIT 1`,
      [agentEmail]
    );
  } else if (agentCode) {
    rows = await query(
      `SELECT id, full_name, email, employee_code, is_active
       FROM agent_users
       WHERE employee_code = ?
       LIMIT 1`,
      [agentCode]
    );
  } else {
    throw new Error('Provide --agent-id=, --agent-email=, or --agent-code=');
  }

  const agent = rows[0];
  if (!agent) {
    throw new Error('Agent not found');
  }
  if (!agent.is_active) {
    throw new Error(`Agent ${agent.email} is inactive`);
  }
  return agent;
}

async function resolveDriver(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;

  if (raw.startsWith('user_')) {
    const rows = await query(
      `SELECT id, clerk_user_id, email, role, phone_number
       FROM users
       WHERE clerk_user_id = ?
       LIMIT 1`,
      [raw]
    );
    return rows[0] || null;
  }

  if (raw.includes('@')) {
    const rows = await query(
      `SELECT id, clerk_user_id, email, role, phone_number
       FROM users
       WHERE LOWER(email) = ?
       LIMIT 1`,
      [raw.toLowerCase()]
    );
    return rows[0] || null;
  }

  const vehicleNumber = normalizeVehicleNumber(raw);
  const rows = await query(
    `SELECT u.id, u.clerk_user_id, u.email, u.role, u.phone_number, dv.number_plate
     FROM driver_vehicle dv
     INNER JOIN users u ON u.clerk_user_id = dv.driver_user_id
     WHERE UPPER(REPLACE(REPLACE(dv.number_plate, ' ', ''), '-', '')) = ?
     LIMIT 1`,
    [vehicleNumber]
  );
  return rows[0] || null;
}

async function getExistingReferral(driverUserId) {
  const rows = await query(
    `SELECT
       r.id,
       r.driver_user_id,
       r.agent_user_id,
       r.invite_id,
       r.source,
       r.created_at,
       a.email AS agent_email,
       a.full_name AS agent_name
     FROM agent_driver_referrals r
     INNER JOIN agent_users a ON a.id = r.agent_user_id
     WHERE r.driver_user_id = ?
     LIMIT 1`,
    [driverUserId]
  );
  return rows[0] || null;
}

async function main() {
  const rawDriverArgs = [
    getArg('drivers'),
    ...getMultiArgs('driver'),
    ...process.argv.slice(2).filter((arg) => !arg.startsWith('--agent-') && !arg.startsWith('--drivers=') && !arg.startsWith('--driver=')),
  ];
  const identifiers = splitIdentifiers(rawDriverArgs);
  if (!identifiers.length) {
    throw new Error(
      'Usage: node scripts/attach-agent-drivers.js --agent-email=agent@example.com --drivers=user_x,email@example.com,ABC1234'
    );
  }

  const agent = await resolveAgent();
  const invite = await getOrCreateInviteForAgent(agent.id);
  const results = [];

  for (const identifier of identifiers) {
    const driver = await resolveDriver(identifier);
    if (!driver) {
      results.push({
        input: identifier,
        status: 'not_found',
      });
      continue;
    }

    if (String(driver.role || '').toLowerCase() !== 'driver') {
      results.push({
        input: identifier,
        driverUserId: driver.clerk_user_id,
        email: driver.email,
        status: 'not_driver_role',
      });
      continue;
    }

    const existingReferral = await getExistingReferral(driver.clerk_user_id);
    if (existingReferral && Number(existingReferral.agent_user_id) !== Number(agent.id)) {
      results.push({
        input: identifier,
        driverUserId: driver.clerk_user_id,
        email: driver.email,
        status: 'already_attached_to_other_agent',
        existingAgentEmail: existingReferral.agent_email,
        existingAgentName: existingReferral.agent_name,
      });
      continue;
    }

    const referral = await attachDriverToAgentInvite({
      driverUserId: driver.clerk_user_id,
      inviteToken: invite.token,
    });

    results.push({
      input: identifier,
      driverUserId: driver.clerk_user_id,
      email: driver.email,
      status: existingReferral ? 'already_attached_to_same_agent' : 'attached',
      referral,
    });
  }

  const summary = {
    agent: {
      id: agent.id,
      fullName: agent.full_name,
      email: agent.email,
      employeeCode: agent.employee_code || null,
      inviteToken: invite.token,
    },
    totalRequested: identifiers.length,
    attached: results.filter((item) => item.status === 'attached').length,
    alreadyAttachedToSameAgent: results.filter((item) => item.status === 'already_attached_to_same_agent').length,
    alreadyAttachedToOtherAgent: results.filter((item) => item.status === 'already_attached_to_other_agent').length,
    notFound: results.filter((item) => item.status === 'not_found').length,
    notDriverRole: results.filter((item) => item.status === 'not_driver_role').length,
  };

  console.log('\n=== Agent Referral Repair Summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\n=== Driver Results ===');
  console.log(JSON.stringify(results, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nattach-agent-drivers failed:', error?.message || error);
    process.exit(1);
  });
