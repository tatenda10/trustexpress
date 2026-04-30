import fetch from 'node-fetch';
import admin from 'firebase-admin';
import path from 'path';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

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
        sound: 'default',
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

export async function sendFcmNotifications(messages) {
  const payload = Array.isArray(messages) ? messages : [messages];
  if (!payload.length) return;

  const results = await Promise.all(
    payload.map(async (message) => {
      if (!message.to) return null;

      const fcmMessage = {
        token: message.to,
        notification: {
          title: message.title,
          body: message.body,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: message.android?.channelId || 'ride-requests',
            sound: message.android?.notification?.sound || 'default',
            clickAction: message.android?.notification?.clickAction || 'TRUST_EXPRESS_FULL_SCREEN_RIDE_REQUEST',
            defaultVibrateTimings: true,
          },
        },
        data: message.data || {},
      };

      try {
        return await admin.messaging().send(fcmMessage);
      } catch (error) {
        console.error('FCM send error', error);
        return null;
      }
    }),
  );

  return results.filter(Boolean);
}
