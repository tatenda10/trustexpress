import { query } from '../db/connection.js';

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
    latestMessage: row.latest_message || '',
    latestSenderType: row.latest_sender_type || null,
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
    message: row.message || '',
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
     ORDER BY created_at ASC, id ASC`,
    [threadId]
  );
  return Array.isArray(rows) ? rows : [];
}

export async function createSupportMessage({ threadId, senderType, senderUserId = null, adminUserId = null, message }) {
  const trimmedMessage = String(message || '').trim();
  if (!trimmedMessage) {
    throw new Error('Message is required');
  }

  const result = await query(
    `INSERT INTO support_messages (
      thread_id,
      sender_type,
      sender_user_id,
      admin_user_id,
      message
    ) VALUES (?, ?, ?, ?, ?)`,
    [threadId, senderType, senderUserId, adminUserId, trimmedMessage]
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
       m.sender_type AS latest_sender_type
     FROM support_threads t
     LEFT JOIN support_messages m
       ON m.id = (
         SELECT sm.id
         FROM support_messages sm
         WHERE sm.thread_id = t.id
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
