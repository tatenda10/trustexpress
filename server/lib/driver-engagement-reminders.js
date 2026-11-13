import { query } from '../db/connection.js';
import { sendExpoPushNotifications, sendFcmNotificationsDetailed } from './push.js';

const DEFAULT_TIMES = ['07:30', '12:30', '17:30'];
const DEFAULT_TIME_ZONE = 'Africa/Harare';
const CHECK_INTERVAL_MS = 60 * 1000;
const SEND_WINDOW_MINUTES = 15;
const PUSH_BATCH_SIZE = 80;

const SLOT_MESSAGES = {
  morning: {
    title: 'Start earning this morning',
    body: 'Open Trust Express and go online to receive nearby ride requests.',
  },
  afternoon: {
    title: 'Drivers are needed nearby',
    body: 'Open Trust Express and go online for afternoon ride requests.',
  },
  evening: {
    title: 'Ready for evening rides?',
    body: 'Open Trust Express and go online to receive evening ride requests.',
  },
};

let schedulerTimer = null;
let runInFlight = false;

function chunk(values, size) {
  const batches = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function parseReminderTimes() {
  const configured = String(process.env.DRIVER_REMINDER_TIMES || '').trim();
  const values = configured ? configured.split(',') : DEFAULT_TIMES;
  return [...new Set(values.map((value) => String(value || '').trim()).filter((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)))]
    .sort();
}

function getLocalClock(date = new Date()) {
  const timeZone = String(process.env.DRIVER_REMINDER_TIME_ZONE || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(byType.hour || 0);
  const minute = Number(byType.minute || 0);
  return {
    date: `${byType.year}-${byType.month}-${byType.day}`,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    minuteOfDay: hour * 60 + minute,
    timeZone,
  };
}

function getDueSlot(now = new Date()) {
  const clock = getLocalClock(now);
  const times = parseReminderTimes();
  for (let index = 0; index < times.length; index += 1) {
    const [hour, minute] = times[index].split(':').map(Number);
    const scheduledMinute = hour * 60 + minute;
    const ageMinutes = clock.minuteOfDay - scheduledMinute;
    if (ageMinutes < 0 || ageMinutes > SEND_WINDOW_MINUTES) continue;
    const name = index === 0 ? 'morning' : index === times.length - 1 ? 'evening' : 'afternoon';
    return { ...clock, scheduledTime: times[index], key: `${name}_${times[index].replace(':', '')}`, name };
  }
  return null;
}

async function claimSlot(slot) {
  const result = await query(
    `INSERT IGNORE INTO driver_engagement_reminder_runs (
       reminder_date, reminder_slot, scheduled_time, status
     ) VALUES (?, ?, ?, 'running')`,
    [slot.date, slot.key, `${slot.scheduledTime}:00`]
  );
  return Number(result?.affectedRows || 0) > 0;
}

async function loadOfflineVerifiedDrivers() {
  return query(
    `SELECT
       u.clerk_user_id AS driver_user_id,
       dpt.expo_push_token,
       dpt.fcm_token
     FROM users u
     INNER JOIN driver_identity di
       ON di.driver_user_id = u.clerk_user_id
      AND di.profile_status = 'approved'
     INNER JOIN driver_vehicle dv
       ON dv.driver_user_id = u.clerk_user_id
      AND dv.vehicle_status = 'approved'
     INNER JOIN driver_push_tokens dpt
       ON dpt.driver_user_id = u.clerk_user_id
     LEFT JOIN driver_availability da
       ON da.driver_user_id = u.clerk_user_id
     WHERE u.role = 'driver'
       AND COALESCE(da.is_online, 0) = 0
       AND (dpt.fcm_token IS NOT NULL OR dpt.expo_push_token IS NOT NULL)`
  );
}

async function sendReminder(slot, drivers) {
  const message = SLOT_MESSAGES[slot.name] || SLOT_MESSAGES.afternoon;
  const data = {
    type: 'driver_engagement_reminder',
    route: 'DriverHome',
    reminderSlot: slot.key,
  };
  let fcmSent = 0;
  let expoSent = 0;
  const expoFallbackTokens = [];

  const fcmDrivers = drivers.filter((driver) => String(driver.fcm_token || '').trim());
  for (const batch of chunk(fcmDrivers, PUSH_BATCH_SIZE)) {
    const results = await sendFcmNotificationsDetailed(batch.map((driver) => ({
      to: String(driver.fcm_token).trim(),
      title: message.title,
      body: message.body,
      sound: 'default',
      android: {
        channelId: 'default',
        collapseKey: `driver-reminder-${slot.key}`,
        notification: {
          sound: 'default',
          tag: `driver-reminder-${slot.key}`,
        },
      },
      data,
    }))) || [];
    const resultByToken = new Map(results.map((result) => [result.token, result]));
    for (const driver of batch) {
      const token = String(driver.fcm_token).trim();
      if (resultByToken.get(token)?.success) {
        fcmSent += 1;
      } else if (String(driver.expo_push_token || '').trim()) {
        expoFallbackTokens.push(String(driver.expo_push_token).trim());
      }
    }
  }

  for (const driver of drivers) {
    if (!String(driver.fcm_token || '').trim() && String(driver.expo_push_token || '').trim()) {
      expoFallbackTokens.push(String(driver.expo_push_token).trim());
    }
  }

  const uniqueExpoTokens = [...new Set(expoFallbackTokens)];
  for (const batch of chunk(uniqueExpoTokens, PUSH_BATCH_SIZE)) {
    await sendExpoPushNotifications(batch.map((token) => ({
      to: token,
      title: message.title,
      body: message.body,
      sound: 'default',
      channelId: 'default',
      data,
    })));
    expoSent += batch.length;
  }

  return { fcmSent, expoSent };
}

async function runReminderCheck() {
  if (runInFlight) return;
  const slot = getDueSlot();
  if (!slot) return;
  runInFlight = true;
  let claimed = false;
  try {
    claimed = await claimSlot(slot);
    if (!claimed) return;
    const drivers = await loadOfflineVerifiedDrivers();
    const { fcmSent, expoSent } = await sendReminder(slot, drivers);
    await query(
      `UPDATE driver_engagement_reminder_runs
       SET status = 'completed', target_count = ?, fcm_sent = ?, expo_sent = ?, completed_at = CURRENT_TIMESTAMP
       WHERE reminder_date = ? AND reminder_slot = ?`,
      [drivers.length, fcmSent, expoSent, slot.date, slot.key]
    );
    console.log('[driver.engagement-reminders] sent', {
      slot: slot.key,
      date: slot.date,
      timeZone: slot.timeZone,
      targetCount: drivers.length,
      fcmSent,
      expoSent,
    });
  } catch (error) {
    console.error('[driver.engagement-reminders] failed', error);
    if (claimed) {
      await query(
        `UPDATE driver_engagement_reminder_runs
         SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
         WHERE reminder_date = ? AND reminder_slot = ?`,
        [String(error?.message || 'Unknown reminder error').slice(0, 500), slot.date, slot.key]
      ).catch(() => {});
    }
  } finally {
    runInFlight = false;
  }
}

export function startDriverEngagementReminderScheduler() {
  if (schedulerTimer || String(process.env.DRIVER_REMINDERS_ENABLED || 'true').toLowerCase() === 'false') return;
  const times = parseReminderTimes();
  if (!times.length) {
    console.warn('[driver.engagement-reminders] scheduler disabled: no valid times configured');
    return;
  }
  console.log('[driver.engagement-reminders] scheduler started', {
    times,
    timeZone: String(process.env.DRIVER_REMINDER_TIME_ZONE || DEFAULT_TIME_ZONE),
  });
  void runReminderCheck();
  schedulerTimer = setInterval(() => void runReminderCheck(), CHECK_INTERVAL_MS);
  schedulerTimer.unref?.();
}

export { getDueSlot };
