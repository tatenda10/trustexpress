import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { getClerkUserById, toAppUser } from '../lib/clerk-user.js';
import {
  autoCloseInactiveSupportThreads,
  createSupportMessage,
  deleteSupportThread,
  getSupportThreadById,
  listSupportMessages,
  listSupportThreads,
  searchSupportThreadIdsByMessage,
  shapeSupportMessage,
  shapeSupportThread,
  updateSupportThreadStatus,
} from '../lib/support-chat.js';
import { emitSupportChatMessageToUser } from '../lib/realtime.js';
import { sendExpoPushNotifications } from '../lib/push.js';
import {
  generateSupportAgentReply,
  getSupportAgentSettings,
  markSupportAgentTested,
  updateSupportAgentSettings,
} from '../lib/support-agent.js';
import { DEFAULT_SUPPORT_AGENT_SECTIONS } from '../lib/support-agent-training.js';

const router = Router();

async function enrichThread(row) {
  const thread = shapeSupportThread(row);
  try {
    const clerkUser = await getClerkUserById(thread.userId);
    const appUser = toAppUser(clerkUser);
    return {
      ...thread,
      user: {
        id: appUser.id,
        email: appUser.email || null,
        firstName: appUser.first_name || null,
        lastName: appUser.last_name || null,
        fullName: [appUser.first_name, appUser.last_name].filter(Boolean).join(' ').trim() || null,
        role: appUser.role,
        phoneNumber: appUser.phone_number || null,
      },
    };
  } catch {
    return {
      ...thread,
      user: {
        id: thread.userId,
        email: null,
        firstName: null,
        lastName: null,
        fullName: null,
        role: thread.userRole,
        phoneNumber: null,
      },
    };
  }
}

router.get('/agent/settings', requireAdminAuth, requirePermission('support.read'), async (req, res) => {
  try {
    const settings = await getSupportAgentSettings();
    return res.json({
      settings,
      trainingSections: DEFAULT_SUPPORT_AGENT_SECTIONS.map((section) => ({
        title: section.title,
        questions: section.items.map(([question]) => question),
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/support/agent/settings', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/agent/settings', requireAdminAuth, requirePermission('support.read'), async (req, res) => {
  try {
    const settings = await updateSupportAgentSettings({
      enabled: req.body?.enabled,
      provider: req.body?.provider,
      model: req.body?.model,
      systemPrompt: req.body?.systemPrompt,
      trainingContent: req.body?.trainingContent,
      adminUserId: req.admin.id,
    });
    return res.json({ settings });
  } catch (err) {
    console.error('PUT /api/admin/support/agent/settings', err);
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
});

router.post('/agent/test', requireAdminAuth, requirePermission('support.read'), async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const reply = await generateSupportAgentReply({
      thread: {
        id: 'test',
        user_id: 'test-user',
        user_role: String(req.body?.userRole || 'passenger').trim().toLowerCase() === 'driver' ? 'driver' : 'passenger',
      },
      messages: [],
      testMessage: message,
    });

    await markSupportAgentTested();
    return res.json({ reply });
  } catch (err) {
    console.error('POST /api/admin/support/agent/test', err);
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
});

router.get('/threads', requireAdminAuth, requirePermission('support.read'), async (req, res) => {
  try {
    await autoCloseInactiveSupportThreads();
    const status = String(req.query.status || 'all').toLowerCase();
    const filter = String(req.query.filter || 'all').toLowerCase();
    const search = String(req.query.q || '').trim().toLowerCase();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(5, Number.parseInt(req.query.pageSize, 10) || 10));
    let threads = await listSupportThreads();
    if (status === 'open' || status === 'closed') {
      threads = threads.filter((thread) => thread.status === status);
    }
    if (filter === 'new') {
      threads = threads.filter((thread) => thread.latestSenderType !== 'admin');
    }
    if (filter === 'waiting_admin') {
      threads = threads.filter((thread) => thread.status === 'open' && thread.latestSenderType !== 'admin');
    }
    if (filter === 'replied') {
      threads = threads.filter((thread) => thread.latestSenderType === 'admin');
    }
    const enriched = await Promise.all(threads.map(enrichThread));
    let filteredThreads = enriched;

    if (search) {
      const matchingThreadIds = new Set(await searchSupportThreadIdsByMessage(search));
      filteredThreads = enriched.filter((thread) => {
        const fullName = String(thread.user?.fullName || '').toLowerCase();
        const email = String(thread.user?.email || '').toLowerCase();
        const phone = String(thread.user?.phoneNumber || '').toLowerCase();
        const userId = String(thread.userId || '').toLowerCase();
        const latestMessage = String(thread.latestMessage || '').toLowerCase();
        return (
          fullName.includes(search) ||
          email.includes(search) ||
          phone.includes(search) ||
          userId.includes(search) ||
          latestMessage.includes(search) ||
          matchingThreadIds.has(Number(thread.id))
        );
      });
    }

    const total = filteredThreads.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const startIndex = (safePage - 1) * pageSize;
    const pagedThreads = filteredThreads.slice(startIndex, startIndex + pageSize);

    return res.json({
      threads: pagedThreads,
      pagination: {
        total,
        page: safePage,
        pageSize,
        totalPages,
      },
      summary: {
        open: filteredThreads.filter((thread) => thread.status === 'open').length,
        closed: filteredThreads.filter((thread) => thread.status === 'closed').length,
        new: filteredThreads.filter((thread) => thread.latestSenderType !== 'admin').length,
      },
    });
  } catch (err) {
    console.error('GET /api/admin/support/threads', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/threads/:threadId/messages', requireAdminAuth, requirePermission('support.read'), async (req, res) => {
  try {
    await autoCloseInactiveSupportThreads();
    const threadId = Number(req.params.threadId);
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ error: 'Valid threadId required' });
    }

    const threadRow = await getSupportThreadById(threadId);
    if (!threadRow) {
      return res.status(404).json({ error: 'Support thread not found' });
    }

    const [thread, messages] = await Promise.all([
      enrichThread(threadRow),
      listSupportMessages(threadId),
    ]);

    return res.json({
      thread,
      messages: messages.map(shapeSupportMessage),
    });
  } catch (err) {
    console.error('GET /api/admin/support/threads/:threadId/messages', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/threads/:threadId/messages', requireAdminAuth, requirePermission('support.read'), async (req, res) => {
  try {
    const threadId = Number(req.params.threadId);
    const message = String(req.body?.message || '').trim();
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ error: 'Valid threadId required' });
    }
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const threadRow = await getSupportThreadById(threadId);
    if (!threadRow) {
      return res.status(404).json({ error: 'Support thread not found' });
    }

    const created = await createSupportMessage({
      threadId,
      senderType: 'admin',
      adminUserId: req.admin.id,
      message,
    });
    const messageRecord = shapeSupportMessage(created);

    emitSupportChatMessageToUser(threadRow.user_id, {
      threadId,
      messageRecord,
    });

    try {
      const clerkUser = await getClerkUserById(threadRow.user_id);
      const pushToken = String(clerkUser?.privateMetadata?.pushToken || '').trim();
      if (pushToken) {
        await sendExpoPushNotifications({
          to: pushToken,
          title: 'Support replied',
          body: message.length > 100 ? `${message.slice(0, 97)}...` : message,
          data: {
            type: 'support_chat',
            threadId,
          },
        });
      }
    } catch (pushError) {
      console.error('Failed to send support reply push', pushError);
    }

    return res.status(201).json({ messageRecord });
  } catch (err) {
    console.error('POST /api/admin/support/threads/:threadId/messages', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/threads/:threadId/status', requireAdminAuth, requirePermission('support.read'), async (req, res) => {
  try {
    const threadId = Number(req.params.threadId);
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ error: 'Valid threadId required' });
    }
    if (!['open', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'status must be open or closed' });
    }

    const threadRow = await getSupportThreadById(threadId);
    if (!threadRow) {
      return res.status(404).json({ error: 'Support thread not found' });
    }

    const updated = await updateSupportThreadStatus(threadId, status);
    const enriched = await enrichThread(updated);
    return res.json({ thread: enriched });
  } catch (err) {
    console.error('PATCH /api/admin/support/threads/:threadId/status', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/threads/:threadId', requireAdminAuth, requirePermission('support.read'), async (req, res) => {
  try {
    const threadId = Number(req.params.threadId);
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ error: 'Valid threadId required' });
    }

    const threadRow = await getSupportThreadById(threadId);
    if (!threadRow) {
      return res.status(404).json({ error: 'Support thread not found' });
    }

    await deleteSupportThread(threadId);
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/support/threads/:threadId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
