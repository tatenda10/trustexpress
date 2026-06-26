import { Router } from 'express';
import { query } from '../db/connection.js';
import { getOrCreateInviteForAgent, findInviteByToken } from '../lib/agent-invites.js';
import { requireAgentAuth } from '../middleware/agentAuth.js';

const router = Router();

function getPublicBaseUrl(req) {
  const envBaseUrl = String(
    process.env.PUBLIC_WEB_BASE_URL ||
      process.env.PUBLIC_BASE_URL ||
      process.env.API_PUBLIC_BASE_URL ||
      'https://ridehailcarsserver.online'
  ).trim();

  if (envBaseUrl) {
    return envBaseUrl.replace(/\/$/, '');
  }

  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || req?.protocol || 'https';
  const host = String(req?.get?.('host') || '').trim();
  if (!host) return 'https://ridehailcarsserver.online';
  return `${proto}://${host}`.replace(/\/$/, '');
}

function shapeInvitePayload(invite, req) {
  if (!invite) return null;

  const publicBaseUrl = getPublicBaseUrl(req);
  const driverAppUrl = `trustexpress://driver-signup?invite=${encodeURIComponent(invite.token)}`;
  const driverUniversalUrl = `${publicBaseUrl}/driver-signup?invite=${encodeURIComponent(invite.token)}`;
  const driverSmartInviteUrl = `${publicBaseUrl}/invite/driver?invite=${encodeURIComponent(invite.token)}`;
  const passengerAppUrl = `trustexpress://passenger-signup?invite=${encodeURIComponent(invite.token)}`;
  const passengerUniversalUrl = `${publicBaseUrl}/passenger-signup?invite=${encodeURIComponent(invite.token)}`;
  const passengerSmartInviteUrl = `${publicBaseUrl}/invite/passenger?invite=${encodeURIComponent(invite.token)}`;

  return {
    id: invite.id,
    token: invite.token,
    agentUserId: invite.agentUserId,
    agentName: invite.fullName,
    agentCode: invite.employeeCode,
    appUrl: driverAppUrl,
    universalUrl: driverUniversalUrl,
    driverAppUrl,
    driverUniversalUrl,
    driverSmartInviteUrl,
    passengerAppUrl,
    passengerUniversalUrl,
    passengerSmartInviteUrl,
  };
}

router.get('/invites/me', requireAgentAuth, async (req, res) => {
  try {
    const invite = await getOrCreateInviteForAgent(req.agent.id);
    return res.json({ invite: shapeInvitePayload(invite, req) });
  } catch (err) {
    console.error('GET /api/agent/invites/me', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/invite/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Invite token is required' });
    }

    const invite = await findInviteByToken(token);
    if (!invite) {
      return res.status(404).json({ error: 'Invite link not found' });
    }

    await query(
      `INSERT INTO agent_invite_events (invite_id, event_type, metadata_json)
       VALUES (?, 'invite_opened', JSON_OBJECT('source', 'public_resolve'))`,
      [invite.id]
    );

    return res.json({
      valid: true,
      invite: shapeInvitePayload(invite, req),
    });
  } catch (err) {
    console.error('GET /api/agent/invite/:token', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
