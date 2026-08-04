import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getClerkClient } from '../lib/clerk-client.js';
import { deleteEndUserAccount } from '../lib/account-deletion.js';
import { getClerkUserById, mergePrivateMetadata, normalizeRole, setRoleForUser, toAppUser } from '../lib/clerk-user.js';
import { attachDriverToAgentInvite, attachPassengerToAgentInvite } from '../lib/agent-invites.js';
import { attachPassengerPeerReferral } from '../lib/passenger-referrals.js';
import { getPassengerVerificationFromMysql } from '../lib/passenger-verification-mysql.js';
import { upsertClerkUserToMysql } from '../lib/user-sync.js';
import { emitSupportChatMessageToUser } from '../lib/realtime.js';
import {
  autoCloseInactiveSupportThreads,
  createSupportMessage,
  getOrCreateSupportThreadForUser,
  getSupportThreadForUser,
  listSupportMessages,
  shapeSupportMessage,
  shapeSupportThread,
} from '../lib/support-chat.js';
import { generateSupportAgentReply, getSupportAgentSettings } from '../lib/support-agent.js';
import { sendExpoPushNotifications } from '../lib/push.js';
import { normalizeLookupIdentifier } from '../lib/phone-number.js';

const router = Router();

router.post('/lookup-role', async (req, res) => {
  try {
    const identifier = normalizeLookupIdentifier(req.body?.identifier);
    if (!identifier) {
      return res.status(400).json({ error: 'identifier is required' });
    }

    const clerkClient = getClerkClient();
    let users = [];
    if (identifier.includes('@')) {
      const list = await clerkClient.users.getUserList({ emailAddress: [identifier], limit: 10 });
      users = list.data || [];
    } else {
      const list = await clerkClient.users.getUserList({ phoneNumber: [identifier], limit: 10 });
      users = list.data || [];
    }

    const user = users.find(Boolean);
    if (!user) {
      return res.json({ exists: false, role: null });
    }

    return res.json({
      exists: true,
      role: normalizeRole(user.publicMetadata?.role),
    });
  } catch (err) {
    console.error('POST /api/users/lookup-role', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await getClerkUserById(req.userId);
    const appUser = toAppUser(user);
    await upsertClerkUserToMysql(user);

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
    const { role, inviteToken, referrerEmail } = req.body || {};
    await setRoleForUser(req.userId, role);

    let referral = null;
    if (role === 'driver' && inviteToken) {
      referral = await attachDriverToAgentInvite({
        driverUserId: req.userId,
        inviteToken,
      });
    } else if (role === 'passenger' && inviteToken) {
      referral = await attachPassengerToAgentInvite({
        passengerUserId: req.userId,
        inviteToken,
      });
    }

    let passengerPeerReferral = null;
    if (role === 'passenger' && referrerEmail) {
      try {
        const peerResult = await attachPassengerPeerReferral({
          referredUserId: req.userId,
          referrerEmail,
          source: 'signup_email',
        });
        passengerPeerReferral = peerResult.referral;
      } catch (peerError) {
        if (peerError.status === 400) {
          return res.status(400).json({ error: peerError.message || 'Invalid referral' });
        }
        throw peerError;
      }
    }

    if (referral) {
      console.log('[users.register] agent referral attached', {
        userId: req.userId,
        role,
        inviteToken,
        agentUserId: referral.agentUserId,
        inviteId: referral.inviteId,
        source: referral.source,
      });
      await mergePrivateMetadata(req.userId, {
        referredByAgentId: referral.agentUserId,
        recruitmentSource: referral.source,
      });
    }

    const user = await getClerkUserById(req.userId);
    await upsertClerkUserToMysql(user);
    return res.status(201).json({
      ...toAppUser(user),
      passengerPeerReferral,
    });
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
    await upsertClerkUserToMysql(user);
    let referral = null;
    if (appUser.role === 'driver') {
      referral = await attachDriverToAgentInvite({
        driverUserId: req.userId,
        inviteToken,
      });
    } else if (appUser.role === 'passenger') {
      referral = await attachPassengerToAgentInvite({
        passengerUserId: req.userId,
        inviteToken,
      });
    } else {
      return res.status(400).json({ error: 'Only driver or passenger accounts can be linked to an agent invite' });
    }

    if (referral) {
      console.log('[users.agent-referral.attach] agent referral attached', {
        userId: req.userId,
        role: appUser.role,
        inviteToken,
        agentUserId: referral.agentUserId,
        inviteId: referral.inviteId,
        source: referral.source,
      });
      await mergePrivateMetadata(req.userId, {
        referredByAgentId: referral.agentUserId,
        recruitmentSource: referral.source,
      });
    }

    return res.status(201).json({
      ok: true,
      role: appUser.role,
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
    const role = normalizeRole(currentUser.publicMetadata?.role);
    const firstName = req.body?.firstName === undefined ? currentUser.firstName : String(req.body.firstName || '').trim();
    const lastName = req.body?.lastName === undefined ? currentUser.lastName : String(req.body.lastName || '').trim();
    const phoneVisibleToDrivers = req.body?.phoneVisibleToDrivers;
    const profileImageUrl = req.body?.profileImageUrl;
    const nextProfileImageUrl = profileImageUrl === undefined
      ? undefined
      : (profileImageUrl ? String(profileImageUrl).trim() : null);

    await clerkClient.users.updateUser(req.userId, {
      firstName: firstName || null,
      lastName: lastName || null,
    });

    if (phoneVisibleToDrivers !== undefined || profileImageUrl !== undefined) {
      const nextPrivateMetadataPatch = {
        ...(phoneVisibleToDrivers !== undefined ? { phoneVisibleToDrivers: phoneVisibleToDrivers === true } : {}),
      };

      if (nextProfileImageUrl !== undefined) {
        if (role === 'driver') {
          nextPrivateMetadataPatch.pendingDriverProfileImageUrl = nextProfileImageUrl;
          nextPrivateMetadataPatch.driverProfileImageReviewStatus = nextProfileImageUrl ? 'pending' : null;
          nextPrivateMetadataPatch.driverProfileImageSubmittedAt = nextProfileImageUrl ? new Date().toISOString() : null;
          nextPrivateMetadataPatch.driverProfileImageReviewedAt = null;
          nextPrivateMetadataPatch.driverProfileImageRejectionReason = null;
        } else {
          nextPrivateMetadataPatch.profileImageUrl = nextProfileImageUrl;
        }
      }

      await mergePrivateMetadata(req.userId, nextPrivateMetadataPatch);
    }

    const nextUser = await getClerkUserById(req.userId);
    await upsertClerkUserToMysql(nextUser);
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
    await autoCloseInactiveSupportThreads();
    const user = await getClerkUserById(req.userId);
    const appUser = toAppUser(user);
    await upsertClerkUserToMysql(user);
    const thread = await getSupportThreadForUser(req.userId, appUser.role);
    return res.json({ thread: shapeSupportThread(thread) });
  } catch (err) {
    console.error('GET /api/users/support/thread', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/support/messages', requireAuth, async (req, res) => {
  try {
    await autoCloseInactiveSupportThreads();
    const user = await getClerkUserById(req.userId);
    const appUser = toAppUser(user);
    await upsertClerkUserToMysql(user);
    // Do not create a thread on open — only after the user actually sends a message.
    const thread = await getSupportThreadForUser(req.userId, appUser.role);
    const messages = thread ? await listSupportMessages(thread.id) : [];
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
    const attachmentUrl = String(req.body?.attachmentUrl || req.body?.attachment_url || '').trim();
    if (!message && !attachmentUrl) {
      return res.status(400).json({ error: 'message or photo is required' });
    }

    const user = await getClerkUserById(req.userId);
    const appUser = toAppUser(user);
    await upsertClerkUserToMysql(user);
    const thread = await getOrCreateSupportThreadForUser(req.userId, appUser.role);
    const created = await createSupportMessage({
      threadId: thread.id,
      senderType: appUser.role === 'driver' ? 'driver' : 'passenger',
      senderUserId: req.userId,
      message,
      attachmentUrl,
    });

    let aiReplyRecord = null;
    // Skip AI auto-reply for photo/verification submissions — agents should handle recovery docs.
    if (message && !attachmentUrl) {
      try {
        const supportAgentSettings = await getSupportAgentSettings();
        if (supportAgentSettings.enabled) {
          const allMessages = await listSupportMessages(thread.id);
          const aiReply = await generateSupportAgentReply({
            thread,
            messages: allMessages,
            incomingMessage: message,
          });

          const createdAiReply = await createSupportMessage({
            threadId: thread.id,
            senderType: 'admin',
            isAiReply: true,
            aiProvider: aiReply.provider,
            aiModel: aiReply.model,
            message: String(aiReply?.message || '').trim(),
          });

          aiReplyRecord = shapeSupportMessage(createdAiReply);
          emitSupportChatMessageToUser(req.userId, {
            threadId: thread.id,
            messageRecord: aiReplyRecord,
          });

          const pushToken = String(user?.privateMetadata?.pushToken || '').trim();
          if (pushToken) {
            await sendExpoPushNotifications({
              to: pushToken,
              title: 'Support assistant replied',
              body: aiReply.message.length > 100 ? `${aiReply.message.slice(0, 97)}...` : aiReply.message,
              data: {
                type: 'support_chat',
                threadId: thread.id,
              },
            });
          }
        }
      } catch (agentError) {
        console.error('Support agent auto-reply failed', agentError);
      }
    }

    return res.status(201).json({
      thread: shapeSupportThread(thread),
      messageRecord: shapeSupportMessage(created),
      aiReplyRecord,
    });
  } catch (err) {
    console.error('POST /api/users/support/messages', err);
    return res.status(err?.status || 500).json({ error: err?.message || 'Server error' });
  }
});

router.delete('/me', requireAuth, async (req, res) => {
  try {
    const user = await getClerkUserById(req.userId, { skipCache: true });
    const appUser = toAppUser(user);
    await upsertClerkUserToMysql(user);
    await deleteEndUserAccount(req.userId, appUser.role);
    return res.json({ ok: true, role: appUser.role });
  } catch (err) {
    console.error('DELETE /api/users/me', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
