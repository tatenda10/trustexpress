import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { getClerkClient } from '../lib/clerk-client.js';
import { normalizeRole } from '../lib/clerk-user.js';
import { sendExpoPushNotifications, sendFcmNotifications } from '../lib/push.js';
import { query } from '../db/connection.js';

const router = Router();
const AUDIENCES = new Set(['drivers', 'passengers', 'all']);

async function loadAllClerkUsers() {
  const clerkClient = getClerkClient();
  const limit = 100;
  let offset = 0;
  const users = [];

  while (true) {
    const page = await clerkClient.users.getUserList({
      limit,
      offset,
      orderBy: '-created_at',
    });
    const pageUsers = page.data || [];
    if (!pageUsers.length) break;
    users.push(...pageUsers);
    offset += pageUsers.length;
    if (pageUsers.length < limit) break;
  }

  return users;
}

function collectTokens(users, audience) {
  const expoTokens = [];
  const fcmTokens = [];
  const seenExpo = new Set();
  const seenFcm = new Set();

  for (const user of users || []) {
    const role = normalizeRole(user?.publicMetadata?.role);
    if (audience === 'drivers' && role !== 'driver') continue;
    if (audience === 'passengers' && role !== 'passenger') continue;

    const expoToken = String(user?.privateMetadata?.pushToken || '').trim();
    const fcmToken = String(user?.privateMetadata?.fcmToken || '').trim();

    if (expoToken && !seenExpo.has(expoToken)) {
      seenExpo.add(expoToken);
      expoTokens.push(expoToken);
    }
    if (fcmToken && !seenFcm.has(fcmToken)) {
      seenFcm.add(fcmToken);
      fcmTokens.push(fcmToken);
    }
  }

  return { expoTokens, fcmTokens };
}

function chunk(list, size) {
  const batches = [];
  for (let i = 0; i < list.length; i += size) {
    batches.push(list.slice(i, i + size));
  }
  return batches;
}

router.get('/', requireAdminAuth, requirePermission('notifications.manage'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, admin_user_id, audience, title, body, target_count, expo_sent, fcm_sent, created_at
       FROM admin_push_broadcasts
       ORDER BY created_at DESC, id DESC
       LIMIT 25`
    ).catch(() => []);

    return res.json({
      broadcasts: (rows || []).map((row) => ({
        id: row.id,
        audience: row.audience,
        title: row.title,
        body: row.body,
        targetCount: Number(row.target_count || 0),
        expoSent: Number(row.expo_sent || 0),
        fcmSent: Number(row.fcm_sent || 0),
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/notifications', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', requireAdminAuth, requirePermission('notifications.manage'), async (req, res) => {
  try {
    const audience = String(req.body?.audience || 'all').trim().toLowerCase();
    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();

    if (!AUDIENCES.has(audience)) {
      return res.status(400).json({ error: 'Audience must be drivers, passengers, or all.' });
    }
    if (title.length < 2 || title.length > 80) {
      return res.status(400).json({ error: 'Title must be between 2 and 80 characters.' });
    }
    if (body.length < 2 || body.length > 400) {
      return res.status(400).json({ error: 'Message must be between 2 and 400 characters.' });
    }

    const users = await loadAllClerkUsers();
    const { expoTokens, fcmTokens } = collectTokens(users, audience);
    if (!expoTokens.length && !fcmTokens.length) {
      return res.status(404).json({ error: 'No devices found for that audience.' });
    }

    const data = {
      type: 'admin_broadcast',
      audience,
    };

    let expoSent = 0;
    for (const batch of chunk(expoTokens, 80)) {
      await sendExpoPushNotifications(
        batch.map((token) => ({
          to: token,
          title,
          body,
          sound: 'default',
          channelId: 'default',
          data,
        }))
      );
      expoSent += batch.length;
    }

    let fcmSent = 0;
    for (const batch of chunk(fcmTokens, 80)) {
      const results = await sendFcmNotifications(
        batch.map((token) => ({
          to: token,
          title,
          body,
          sound: 'default',
          android: {
            channelId: 'default',
            notification: { sound: 'default' },
          },
          data,
        }))
      );
      fcmSent += Array.isArray(results) ? results.length : batch.length;
    }

    await query(
      `INSERT INTO admin_push_broadcasts (
         admin_user_id, audience, title, body, target_count, expo_sent, fcm_sent
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.admin?.id || null,
        audience,
        title,
        body,
        expoTokens.length + fcmTokens.length,
        expoSent,
        fcmSent,
      ]
    ).catch((error) => {
      console.warn('[admin.notifications] history insert failed', error?.message || error);
    });

    return res.json({
      ok: true,
      audience,
      expoSent,
      fcmSent,
      targetCount: expoTokens.length + fcmTokens.length,
    });
  } catch (err) {
    console.error('POST /api/admin/notifications', err);
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
});

export default router;
