import { Router } from 'express';
import { query } from '../db/connection.js';
import { getOrCreateInviteForAgent, findInviteByToken } from '../lib/agent-invites.js';
import { requireAgentAuth } from '../middleware/agentAuth.js';

const router = Router();

function shapeInvitePayload(invite) {
  if (!invite) return null;

  const driverAppUrl = `trustexpress://driver-signup?invite=${encodeURIComponent(invite.token)}`;
  const driverUniversalUrl = `https://trustexpress.co.zw/driver-signup?invite=${encodeURIComponent(invite.token)}`;
  const passengerAppUrl = `trustexpress://passenger-signup?invite=${encodeURIComponent(invite.token)}`;
  const passengerUniversalUrl = `https://trustexpress.co.zw/passenger-signup?invite=${encodeURIComponent(invite.token)}`;

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
    passengerAppUrl,
    passengerUniversalUrl,
  };
}

router.get('/invites/me', requireAgentAuth, async (req, res) => {
  try {
    const invite = await getOrCreateInviteForAgent(req.agent.id);
    return res.json({ invite: shapeInvitePayload(invite) });
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
      invite: shapeInvitePayload(invite),
    });
  } catch (err) {
    console.error('GET /api/agent/invite/:token', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
