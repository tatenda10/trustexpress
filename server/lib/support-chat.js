import { query } from '../db/connection.js';

const SUPPORT_AUTO_CLOSE_HOURS = 24;

function normalizeAttachmentUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // Accept absolute upload URLs or /uploads/... paths only.
  if (raw.startsWith('/uploads/')) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith('/uploads/')) return parsed.pathname;
  } catch {
    // ignore
  }
  if (raw.startsWith('uploads/')) return `/${raw}`;
  return null;
}

export function normalizeSupportRole(role) {
  return role === 'driver' ? 'driver' : 'passenger';
}

export function shapeSupportThread(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    userRole: row.user_role,
    status: row.status || 'open',
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    latestMessage: row.latest_message || (row.latest_attachment_url ? '[Photo]' : ''),
    latestSenderType: row.latest_sender_type || null,
    latestAttachmentUrl: row.latest_attachment_url || null,
  };
}

export function shapeSupportMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    threadId: row.thread_id,
    senderType: row.sender_type,
    senderUserId: row.sender_user_id || null,
    adminUserId: row.admin_user_id || null,
    isAiReply: !!row.is_ai_reply,
    aiProvider: row.ai_provider || null,
    aiModel: row.ai_model || null,
    message: row.message || '',
    attachmentUrl: row.attachment_url || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
  };
}

export async function getSupportThreadById(threadId) {
  const [row] = await query(
    `SELECT t.*
     FROM support_threads t
     WHERE t.id = ?
     LIMIT 1`,
    [threadId]
  );
  return row || null;
}

export async function autoCloseInactiveSupportThreads(hours = SUPPORT_AUTO_CLOSE_HOURS) {
  const safeHours = Math.max(1, Number(hours) || SUPPORT_AUTO_CLOSE_HOURS);
  const result = await query(
    `UPDATE support_threads
     SET status = 'closed',
         updated_at = CURRENT_TIMESTAMP
     WHERE status = 'open'
       AND COALESCE(last_message_at, updated_at, created_at) < (CURRENT_TIMESTAMP - INTERVAL ? HOUR)`,
    [safeHours]
  );

  await pruneEmptySupportThreads();

  return {
    affectedRows: Number(result?.affectedRows || 0),
    hours: safeHours,
  };
}

/** Remove threads that have no real content (text or photo). */
export async function pruneEmptySupportThreads() {
  await query(
    `DELETE FROM support_messages
     WHERE TRIM(COALESCE(message, '')) = ''
       AND (attachment_url IS NULL OR TRIM(attachment_url) = '')`
  );

  const result = await query(
    `DELETE t
     FROM support_threads t
     LEFT JOIN support_messages m ON m.thread_id = t.id
     WHERE m.id IS NULL`
  );

  return {
    affectedRows: Number(result?.affectedRows || 0),
  };
}

export async function getSupportThreadForUser(userId, role) {
  const [row] = await query(
    `SELECT t.*
     FROM support_threads t
     WHERE t.user_id = ? AND t.user_role = ?
     LIMIT 1`,
    [userId, normalizeSupportRole(role)]
  );
  return row || null;
}

export async function getOrCreateSupportThreadForUser(userId, role) {
  const normalizedRole = normalizeSupportRole(role);
  const existing = await getSupportThreadForUser(userId, normalizedRole);
  if (existing) return existing;

  const result = await query(
    `INSERT INTO support_threads (user_id, user_role, status)
     VALUES (?, ?, 'open')`,
    [userId, normalizedRole]
  );

  return getSupportThreadById(result.insertId);
}

export async function listSupportMessages(threadId) {
  const rows = await query(
    `SELECT *
     FROM support_messages
     WHERE thread_id = ?
       AND (
         TRIM(COALESCE(message, '')) <> ''
         OR (attachment_url IS NOT NULL AND TRIM(attachment_url) <> '')
       )
     ORDER BY created_at ASC, id ASC`,
    [threadId]
  );
  return Array.isArray(rows) ? rows : [];
}

export async function createSupportMessage({
  threadId,
  senderType,
  senderUserId = null,
  adminUserId = null,
  isAiReply = false,
  aiProvider = null,
  aiModel = null,
  message,
  attachmentUrl = null,
}) {
  const trimmedMessage = String(message || '').trim();
  const safeAttachment = normalizeAttachmentUrl(attachmentUrl);
  if (!trimmedMessage && !safeAttachment) {
    const error = new Error('Message or photo is required');
    error.status = 400;
    throw error;
  }

  const result = await query(
    `INSERT INTO support_messages (
      thread_id,
      sender_type,
      sender_user_id,
      admin_user_id,
      is_ai_reply,
      ai_provider,
      ai_model,
      message,
      attachment_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      threadId,
      senderType,
      senderUserId,
      adminUserId,
      isAiReply ? 1 : 0,
      aiProvider,
      aiModel,
      trimmedMessage || null,
      safeAttachment,
    ]
  );

  await query(
    `UPDATE support_threads
     SET status = 'open',
         last_message_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [threadId]
  );

  const [row] = await query(
    `SELECT *
     FROM support_messages
     WHERE id = ?
     LIMIT 1`,
    [result.insertId]
  );
  return row || null;
}

export async function listSupportThreads() {
  const rows = await query(
    `SELECT
       t.*,
       m.message AS latest_message,
       m.attachment_url AS latest_attachment_url,
       m.sender_type AS latest_sender_type
     FROM support_threads t
     INNER JOIN support_messages m
       ON m.id = (
         SELECT sm.id
         FROM support_messages sm
         WHERE sm.thread_id = t.id
           AND (
             TRIM(COALESCE(sm.message, '')) <> ''
             OR (sm.attachment_url IS NOT NULL AND TRIM(sm.attachment_url) <> '')
           )
         ORDER BY sm.created_at DESC, sm.id DESC
         LIMIT 1
       )
     ORDER BY COALESCE(t.last_message_at, t.updated_at, t.created_at) DESC, t.id DESC`
  );
  return Array.isArray(rows) ? rows : [];
}

export async function searchSupportThreadIdsByMessage(searchTerm) {
  const term = String(searchTerm || '').trim();
  if (!term) return [];

  const rows = await query(
    `SELECT DISTINCT thread_id
     FROM support_messages
     WHERE message LIKE ?`,
    [`%${term}%`]
  );

  return Array.isArray(rows)
    ? rows.map((row) => Number(row.thread_id)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
}

export async function updateSupportThreadStatus(threadId, status) {
  await query(
    `UPDATE support_threads
     SET status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, threadId]
  );

  return getSupportThreadById(threadId);
}

export async function deleteSupportThread(threadId) {
  await query(
    `DELETE FROM support_threads
     WHERE id = ?`,
    [threadId]
  );
}
