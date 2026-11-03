import fetch from 'node-fetch';
import admin from 'firebase-admin';
import path from 'path';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

function androidSoundName(sound) {
  const raw = String(sound || 'default').trim();
  if (!raw || raw === 'default') return 'default';
  return raw.replace(/\.(mpeg|mp3|wav|ogg|m4a)$/i, '');
}

function stringifyPushData(data) {
  if (!data || typeof data !== 'object') return {};
  const next = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    next[key] = typeof value === 'string' ? value : String(value);
  }
  return next;
}

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    ? process.env.GOOGLE_APPLICATION_CREDENTIALS
    : path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : null;

if (!admin.apps.length) {
  const credential = serviceAccountPath
    ? admin.credential.cert(serviceAccountPath)
    : admin.credential.applicationDefault();
  admin.initializeApp({ credential });
}

export async function sendExpoPushNotifications(messages) {
  const payload = Array.isArray(messages) ? messages : [messages];
  if (!payload.length) return;

  const res = await fetch(EXPO_PUSH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      payload.map((message) => ({
        sound: message.sound || 'default',
        priority: 'high',
        ...message,
      })),
    ),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Expo push error', res.status, data);
    throw new Error(data?.error || `Expo push failed with status ${res.status}`);
  }

  return data;
}

export async function sendFcmNotificationsDetailed(messages) {
  const payload = Array.isArray(messages) ? messages : [messages];
  if (!payload.length) return;

  const results = await Promise.all(
    payload.map(async (message) => {
      if (!message.to) return null;

      const isRideRequest = String(message.data?.type || '') === 'driver_new_ride_request';
      const soundName = androidSoundName(
        message.android?.notification?.sound
        || message.sound
        || (isRideRequest ? 'near_rides' : 'default')
      );
      const clickAction = message.android?.notification?.clickAction
        || (isRideRequest ? 'com.tatenda10.trustexpress.FULL_SCREEN_RIDE_REQUEST' : null);

      const fcmMessage = {
        token: message.to,
        notification: {
          title: message.title,
          body: message.body,
        },
        android: {
          priority: 'high',
          ...(message.android?.collapseKey
            ? { collapseKey: message.android.collapseKey }
            : {}),
          notification: {
            channelId: message.android?.channelId || (isRideRequest ? 'ride-requests-nearby-v4' : 'default'),
            sound: soundName,
            defaultSound: soundName === 'default',
            ...(message.android?.notification?.tag
              ? { tag: message.android.notification.tag }
              : {}),
            ...(clickAction ? { clickAction } : {}),
            defaultVibrateTimings: true,
          },
        },
        data: stringifyPushData(message.data),
      };

      try {
        const messageId = await admin.messaging().send(fcmMessage);
        return { token: message.to, success: true, messageId, errorCode: null };
      } catch (error) {
        console.error('FCM send error', error);
        return {
          token: message.to,
          success: false,
          messageId: null,
          errorCode: error?.code || error?.errorInfo?.code || 'unknown',
        };
      }
    }),
  );

  return results.filter(Boolean);
}

export async function sendFcmNotifications(messages) {
  const results = await sendFcmNotificationsDetailed(messages);
  return (Array.isArray(results) ? results : [])
    .filter((result) => result.success && result.messageId)
    .map((result) => result.messageId);
}
