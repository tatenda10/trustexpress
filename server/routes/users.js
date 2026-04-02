import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getClerkClient } from '../lib/clerk-client.js';
import { deleteEndUserAccount } from '../lib/account-deletion.js';
import { getClerkUserById, mergePrivateMetadata, setRoleForUser, toAppUser } from '../lib/clerk-user.js';
import { attachDriverToAgentInvite } from '../lib/agent-invites.js';
import { getPassengerVerificationFromMysql } from '../lib/passenger-verification-mysql.js';
import {
  createSupportMessage,
  getOrCreateSupportThreadForUser,
  listSupportMessages,
  shapeSupportMessage,
  shapeSupportThread,
} from '../lib/support-chat.js';

const router = Router();

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await getClerkUserById(req.userId);
    const appUser = toAppUser(user);

    if (appUser.role !== 'passenger') {
      return res.json(appUser);
    }

    const verification = await getPassengerVerificationFromMysql(req.userId);
    return res.json({
      ...appUser,
      ...verification,
    });
  } catch (err) {
    console.error('GET /api/users/me', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/register', requireAuth, async (req, res) => {
  try {
    const { role, inviteToken } = req.body || {};
    await setRoleForUser(req.userId, role);

    if (role === 'driver' && inviteToken) {
      const referral = await attachDriverToAgentInvite({
        driverUserId: req.userId,
        inviteToken,
      });

      if (referral) {
        await mergePrivateMetadata(req.userId, {
          referredByAgentId: referral.agentUserId,
          recruitmentSource: referral.source,
        });
      }
    }

    const user = await getClerkUserById(req.userId);
    return res.status(201).json(toAppUser(user));
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message || 'Invalid invite link' });
    }
    console.error('POST /api/users/register', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/agent-referral/attach', requireAuth, async (req, res) => {
  try {
    const inviteToken = String(req.body?.inviteToken || '').trim();
    if (!inviteToken) {
      return res.status(400).json({ error: 'inviteToken is required' });
    }

    const user = await getClerkUserById(req.userId);
    const appUser = toAppUser(user);
    if (appUser.role !== 'driver') {
      return res.status(400).json({ error: 'Only driver accounts can be linked to an agent invite' });
    }

    const referral = await attachDriverToAgentInvite({
      driverUserId: req.userId,
      inviteToken,
    });

    if (referral) {
      await mergePrivateMetadata(req.userId, {
        referredByAgentId: referral.agentUserId,
        recruitmentSource: referral.source,
      });
    }

    return res.status(201).json({
      ok: true,
      referral,
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message || 'Invalid invite link' });
    }
    console.error('POST /api/users/agent-referral/attach', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/me', requireAuth, async (req, res) => {
  try {
    const clerkClient = getClerkClient();
    const currentUser = await getClerkUserById(req.userId);
    const firstName = req.body?.firstName === undefined ? currentUser.firstName : String(req.body.firstName || '').trim();
    const lastName = req.body?.lastName === undefined ? currentUser.lastName : String(req.body.lastName || '').trim();
    const phoneVisibleToDrivers = req.body?.phoneVisibleToDrivers;
    const profileImageUrl = req.body?.profileImageUrl;

    await clerkClient.users.updateUser(req.userId, {
      firstName: firstName || null,
      lastName: lastName || null,
    });

    if (phoneVisibleToDrivers !== undefined || profileImageUrl !== undefined) {
      await mergePrivateMetadata(req.userId, {
        ...(currentUser.privateMetadata || {}),
        ...(phoneVisibleToDrivers !== undefined ? { phoneVisibleToDrivers: phoneVisibleToDrivers === true } : {}),
        ...(profileImageUrl !== undefined ? { profileImageUrl: profileImageUrl ? String(profileImageUrl).trim() : null } : {}),
      });
    }

    const nextUser = await getClerkUserById(req.userId);
    return res.json(toAppUser(nextUser));
  } catch (err) {
    console.error('PATCH /api/users/me', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/push-token', requireAuth, async (req, res) => {
  try {
    const pushToken = String(req.body?.pushToken || '').trim();
    if (!pushToken) {
      return res.status(400).json({ error: 'pushToken is required' });
    }

    const nextMeta = await mergePrivateMetadata(req.userId, {
      pushToken,
    });

    console.log('[users.push-token] saved', {
      userId: req.userId,
      hasToken: !!(nextMeta.pushToken || pushToken),
      tokenPreview: String(nextMeta.pushToken || pushToken).slice(0, 18),
    });

    return res.status(201).json({ pushToken: nextMeta.pushToken || pushToken });
  } catch (err) {
    console.error('POST /api/users/push-token', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/support/thread', requireAuth, async (req, res) => {
  try {
    const user = await getClerkUserById(req.userId);
    const appUser = toAppUser(user);
    const thread = await getOrCreateSupportThreadForUser(req.userId, appUser.role);
    return res.json({ thread: shapeSupportThread(thread) });
  } catch (err) {
    console.error('GET /api/users/support/thread', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/support/messages', requireAuth, async (req, res) => {
  try {
    const user = await getClerkUserById(req.userId);
    const appUser = toAppUser(user);
    const thread = await getOrCreateSupportThreadForUser(req.userId, appUser.role);
    const messages = await listSupportMessages(thread.id);
    return res.json({
      thread: shapeSupportThread(thread),
      messages: messages.map(shapeSupportMessage),
    });
  } catch (err) {
    console.error('GET /api/users/support/messages', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/support/messages', requireAuth, async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const user = await getClerkUserById(req.userId);
    const appUser = toAppUser(user);
    const thread = await getOrCreateSupportThreadForUser(req.userId, appUser.role);
    const created = await createSupportMessage({
      threadId: thread.id,
      senderType: appUser.role === 'driver' ? 'driver' : 'passenger',
      senderUserId: req.userId,
      message,
    });

    return res.status(201).json({
      thread: shapeSupportThread(thread),
      messageRecord: shapeSupportMessage(created),
    });
  } catch (err) {
    console.error('POST /api/users/support/messages', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/me', requireAuth, async (req, res) => {
  try {
    const user = await getClerkUserById(req.userId, { skipCache: true });
    const appUser = toAppUser(user);
    await deleteEndUserAccount(req.userId, appUser.role);
    return res.json({ ok: true, role: appUser.role });
  } catch (err) {
    console.error('DELETE /api/users/me', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
