import { Router } from 'express';
import { handleWhatsAppRideMessage } from '../lib/whatsapp/ride-booking.js';

const router = Router();

function extractMessages(body) {
  const messages = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const incoming = Array.isArray(value.messages) ? value.messages : [];
      for (const message of incoming) {
        messages.push(message);
      }
    }
  }
  return messages;
}

function extractStatuses(body) {
  const statuses = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const incoming = Array.isArray(value.statuses) ? value.statuses : [];
      for (const status of incoming) {
        statuses.push(status);
      }
    }
  }
  return statuses;
}

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || '';
  console.log('[whatsapp.webhook] verify request', {
    mode: mode || null,
    hasToken: !!token,
    expectedTokenConfigured: !!expectedToken,
    challenge: challenge ? 'present' : 'missing',
  });

  if (mode === 'subscribe' && expectedToken && token === expectedToken) {
    return res.status(200).send(challenge);
  }
  console.warn('[whatsapp.webhook] verify rejected', {
    mode: mode || null,
    hasToken: !!token,
    expectedTokenConfigured: !!expectedToken,
  });
  return res.status(403).send('Forbidden');
});

router.post('/webhook', async (req, res) => {
  const messages = extractMessages(req.body);
  const statuses = extractStatuses(req.body);
  console.log('[whatsapp.webhook] inbound received', {
    object: req.body?.object || null,
    entryCount: Array.isArray(req.body?.entry) ? req.body.entry.length : 0,
    messageCount: messages.length,
    statusCount: statuses.length,
    messageTypes: messages.map((message) => message?.type || 'unknown'),
    from: messages.map((message) => message?.from || null).filter(Boolean),
    statuses: statuses.map((status) => ({
      id: status?.id || null,
      recipientId: status?.recipient_id || null,
      status: status?.status || null,
      timestamp: status?.timestamp || null,
      errors: Array.isArray(status?.errors) ? status.errors.map((error) => ({
        code: error?.code || null,
        title: error?.title || null,
        message: error?.message || null,
      })) : [],
    })),
  });
  res.sendStatus(200);

  for (const message of messages) {
    if (!message?.from) continue;
    handleWhatsAppRideMessage(message.from, message).catch((error) => {
      console.error('[whatsapp.webhook] message handling failed', {
        from: message.from,
        messageId: message.id || null,
        type: message.type || null,
        error: error?.message || String(error),
      });
    });
  }
});

export default router;
