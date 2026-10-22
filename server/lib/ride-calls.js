import crypto from 'crypto';
import { query } from '../db/connection.js';
import { getUserById } from './users.js';
import { sendExpoPushNotifications } from './push.js';
import { getRealtimeUserRoom } from './realtime.js';

const RING_TIMEOUT_MS = 45 * 1000;
const MAX_CALL_MS = 2 * 60 * 60 * 1000;
const DISCONNECT_GRACE_MS = 20 * 1000;
const TURN_CREDENTIAL_TTL_SECONDS = 6 * 60 * 60;
const CALLABLE_RIDE_EXCLUDED_STATUSES = new Set(['requested', 'completed', 'cancelled', 'expired', 'declined']);

/** callId -> call. Calls are short-lived and only need to survive while both apps are connected. */
const calls = new Map();
/** userId -> callId, so a user is in at most one call at a time. */
const userCalls = new Map();

let ioRef = null;

export async function ensureRideCallsTable() {
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS ride_calls (
         id VARCHAR(36) NOT NULL PRIMARY KEY,
         ride_request_id BIGINT NOT NULL,
         caller_user_id VARCHAR(64) NOT NULL,
         callee_user_id VARCHAR(64) NOT NULL,
         caller_role VARCHAR(16) NOT NULL,
         status VARCHAR(16) NOT NULL DEFAULT 'ringing',
         end_reason VARCHAR(32) NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         answered_at TIMESTAMP NULL DEFAULT NULL,
         ended_at TIMESTAMP NULL DEFAULT NULL,
         duration_seconds INT NULL,
         KEY idx_ride_calls_ride (ride_request_id),
         KEY idx_ride_calls_caller (caller_user_id),
         KEY idx_ride_calls_callee (callee_user_id)
       )`
    );
  } catch (error) {
    console.error('[schema] ride_calls check failed', error?.message || error);
  }
}

function buildIceServers(userId) {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const turnUrls = String(process.env.TURN_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  const turnSecret = String(process.env.TURN_SECRET || '').trim();
  if (turnUrls.length && turnSecret) {
    // coturn `use-auth-secret`: short-lived credentials derived from the shared secret.
    const username = `${Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS}:${userId}`;
    const credential = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
    servers.push({ urls: turnUrls, username, credential });
  }
  return servers;
}

async function loadCallableRide(rideRequestId, userId) {
  const [ride] = await query(
    `SELECT id, passenger_user_id, driver_user_id, passenger_name, driver_name, status
     FROM ride_requests
     WHERE id = ?
       AND (passenger_user_id = ? OR driver_user_id = ?)
     LIMIT 1`,
    [rideRequestId, userId, userId]
  );
  if (!ride || !ride.driver_user_id || !ride.passenger_user_id) return null;
  if (CALLABLE_RIDE_EXCLUDED_STATUSES.has(String(ride.status || '').toLowerCase())) return null;

  const isPassenger = String(ride.passenger_user_id) === String(userId);
  return {
    ride,
    callerRole: isPassenger ? 'passenger' : 'driver',
    calleeUserId: String(isPassenger ? ride.driver_user_id : ride.passenger_user_id),
    fallbackCallerName: isPassenger ? ride.passenger_name || 'Passenger' : ride.driver_name || 'Driver',
  };
}

function emitTo(userId, event, payload) {
  ioRef?.to(getRealtimeUserRoom(userId)).emit(event, payload);
}

function publicCall(call) {
  return {
    callId: call.id,
    rideRequestId: call.rideRequestId,
    callerUserId: call.callerId,
    callerRole: call.callerRole,
    callerName: call.callerName,
    callerImageUrl: call.callerImageUrl,
    status: call.status,
  };
}

function otherParty(call, userId) {
  if (call.callerId === userId) return call.calleeId;
  if (call.calleeId === userId) return call.callerId;
  return null;
}

async function persistCallEnd(call, reason) {
  const durationSeconds = call.answeredAt ? Math.round((Date.now() - call.answeredAt) / 1000) : null;
  await query(
    `UPDATE ride_calls
     SET status = ?, end_reason = ?, ended_at = CURRENT_TIMESTAMP, duration_seconds = ?
     WHERE id = ?`,
    [call.answeredAt ? 'completed' : 'missed', reason, durationSeconds, call.id]
  ).catch((error) => console.error('[ride-calls] persist end failed', error?.message || error));
}

function endCall(callId, reason, endedByUserId = null) {
  const call = calls.get(callId);
  if (!call) return;
  calls.delete(callId);
  clearTimeout(call.ringTimer);
  clearTimeout(call.maxTimer);
  if (userCalls.get(call.callerId) === callId) userCalls.delete(call.callerId);
  if (userCalls.get(call.calleeId) === callId) userCalls.delete(call.calleeId);

  const payload = { callId, reason, endedByUserId };
  emitTo(call.callerId, 'call:ended', payload);
  emitTo(call.calleeId, 'call:ended', payload);
  persistCallEnd(call, reason);
}

async function notifyCalleeByPush(call) {
  try {
    const callee = await getUserById(call.calleeId);
    const pushToken = String(callee?.privateMetadata?.pushToken || '').trim();
    if (!pushToken) return;
    await sendExpoPushNotifications({
      to: pushToken,
      title: `Incoming call from ${call.callerName}`,
      body: 'Tap to answer the free Trust Express call.',
      data: { type: 'ride_call', callId: call.id, rideRequestId: call.rideRequestId },
      channelId: 'default',
      ttl: Math.round(RING_TIMEOUT_MS / 1000),
    });
  } catch (error) {
    console.error('[ride-calls] push failed', error?.message || error);
  }
}

async function handleStart(socket, payload, ack) {
  const userId = socket.data.userId;
  const rideRequestId = Number(payload?.rideRequestId);
  if (!Number.isInteger(rideRequestId) || rideRequestId <= 0) {
    return ack({ error: 'Invalid ride.' });
  }

  const callable = await loadCallableRide(rideRequestId, userId);
  if (!callable) {
    return ack({ error: 'Calls are only available during an active ride.' });
  }

  const existingCallId = userCalls.get(userId);
  if (existingCallId) endCall(existingCallId, 'replaced', userId);
  if (userCalls.has(callable.calleeUserId)) {
    return ack({ error: 'The other person is on another call. Try again shortly.', code: 'BUSY' });
  }

  const caller = await getUserById(userId).catch(() => null);
  const callerName = [caller?.firstName, caller?.lastName].filter(Boolean).join(' ').trim()
    || callable.fallbackCallerName;

  const call = {
    id: crypto.randomUUID(),
    rideRequestId,
    callerId: userId,
    calleeId: callable.calleeUserId,
    callerRole: callable.callerRole,
    callerName,
    callerImageUrl: caller?.imageUrl || null,
    status: 'ringing',
    createdAt: Date.now(),
    answeredAt: null,
  };
  call.ringTimer = setTimeout(() => endCall(call.id, 'no_answer'), RING_TIMEOUT_MS);
  call.maxTimer = setTimeout(() => endCall(call.id, 'max_duration'), MAX_CALL_MS);
  calls.set(call.id, call);
  userCalls.set(call.callerId, call.id);
  userCalls.set(call.calleeId, call.id);

  await query(
    `INSERT INTO ride_calls (id, ride_request_id, caller_user_id, callee_user_id, caller_role)
     VALUES (?, ?, ?, ?, ?)`,
    [call.id, rideRequestId, call.callerId, call.calleeId, call.callerRole]
  ).catch((error) => console.error('[ride-calls] persist start failed', error?.message || error));

  emitTo(call.calleeId, 'call:incoming', publicCall(call));
  notifyCalleeByPush(call);

  return ack({ ok: true, callId: call.id, iceServers: buildIceServers(userId) });
}

function handleAccept(socket, payload, ack) {
  const userId = socket.data.userId;
  const call = calls.get(String(payload?.callId || ''));
  if (!call || call.calleeId !== userId) return ack({ error: 'This call has ended.' });
  if (call.status !== 'ringing') return ack({ error: 'This call was already answered.' });

  call.status = 'active';
  call.answeredAt = Date.now();
  clearTimeout(call.ringTimer);
  query(
    `UPDATE ride_calls SET status = 'active', answered_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [call.id]
  ).catch(() => {});

  emitTo(call.callerId, 'call:accepted', { callId: call.id });
  // Other devices signed in as the callee should stop ringing.
  socket.to(getRealtimeUserRoom(userId)).emit('call:ended', { callId: call.id, reason: 'answered_elsewhere' });
  return ack({ ok: true, iceServers: buildIceServers(userId) });
}

function handleDecline(socket, payload, ack) {
  const userId = socket.data.userId;
  const call = calls.get(String(payload?.callId || ''));
  if (call && call.calleeId === userId) {
    endCall(call.id, payload?.reason === 'unsupported' ? 'unsupported' : 'declined', userId);
  }
  return ack({ ok: true });
}

function handleEnd(socket, payload, ack) {
  const userId = socket.data.userId;
  const call = calls.get(String(payload?.callId || ''));
  if (call && otherParty(call, userId)) {
    endCall(call.id, call.status === 'ringing' && call.callerId === userId ? 'cancelled' : 'hangup', userId);
  }
  return ack({ ok: true });
}

function handleSignal(socket, payload) {
  const userId = socket.data.userId;
  const call = calls.get(String(payload?.callId || ''));
  if (!call || call.status !== 'active') return;
  const target = otherParty(call, userId);
  if (!target) return;
  emitTo(target, 'call:signal', { callId: call.id, data: payload?.data || null });
}

async function handleDisconnect(userId) {
  const callId = userCalls.get(userId);
  if (!callId) return;
  // Token refreshes reconnect the socket; only end the call if the user stays gone.
  setTimeout(async () => {
    if (!calls.has(callId) || !ioRef) return;
    const sockets = await ioRef.in(getRealtimeUserRoom(userId)).fetchSockets().catch(() => []);
    if (sockets.length === 0) endCall(callId, 'connection_lost', userId);
  }, DISCONNECT_GRACE_MS);
}

function wrap(handler) {
  return async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      await handler(payload, reply);
    } catch (error) {
      console.error('[ride-calls] handler failed', error?.message || error);
      reply({ error: 'Call failed. Please try again.' });
    }
  };
}

export function registerRideCallHandlers(io, socket) {
  ioRef = io;
  const userId = socket.data.userId;

  socket.on('call:start', wrap((payload, ack) => handleStart(socket, payload, ack)));
  socket.on('call:accept', wrap((payload, ack) => handleAccept(socket, payload, ack)));
  socket.on('call:decline', wrap((payload, ack) => handleDecline(socket, payload, ack)));
  socket.on('call:end', wrap((payload, ack) => handleEnd(socket, payload, ack)));
  socket.on('call:signal', (payload) => handleSignal(socket, payload));
  socket.on('disconnect', () => handleDisconnect(userId));

  // A user opening the app from the call notification should still see the ringing call.
  const ringingCallId = userCalls.get(userId);
  const ringingCall = ringingCallId ? calls.get(ringingCallId) : null;
  if (ringingCall && ringingCall.status === 'ringing' && ringingCall.calleeId === userId) {
    socket.emit('call:incoming', publicCall(ringingCall));
  }
}
