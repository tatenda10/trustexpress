import fetch from 'node-fetch';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

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

