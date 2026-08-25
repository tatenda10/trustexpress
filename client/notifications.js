import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  AuthorizationStatus,
  getMessaging,
  getToken,
  requestPermission,
} from '@react-native-firebase/messaging';

const NEARBY_RIDE_SOUND_FILE = 'notificationaudio.mpeg';
const DISTANT_RIDE_SOUND_FILE = 'sound2.mpeg';
// Android channel sounds cannot be changed after channel creation, so use new IDs.
const DISTANT_RIDE_CHANNEL_ID = 'ride-requests-distant-v3';
const NEARBY_RIDE_CHANNEL_ID = 'ride-requests-nearby-v3';
const RIDE_REQUEST_NOTIFICATION_TYPE = 'driver_new_ride_request';

const rideRequestNotificationIdsByRide = new Map();

function rememberRideRequestNotificationId(rideRequestId, notificationId) {
  const id = Number(rideRequestId);
  if (!Number.isInteger(id) || id <= 0 || !notificationId) return;
  const existing = rideRequestNotificationIdsByRide.get(id) || new Set();
  existing.add(notificationId);
  rideRequestNotificationIdsByRide.set(id, existing);
}

function isRideRequestNotificationData(data, rideRequestId = null) {
  if (String(data?.type || '') !== RIDE_REQUEST_NOTIFICATION_TYPE) {
    return false;
  }
  if (rideRequestId === null || rideRequestId === undefined || rideRequestId === '') {
    return true;
  }
  return Number(data?.rideRequestId || 0) === Number(rideRequestId);
}

function isRideRequestNotification(notification, rideRequestId = null) {
  const data = notification?.request?.content?.data || {};
  if (isRideRequestNotificationData(data, rideRequestId)) {
    return true;
  }
  if (rideRequestId !== null && rideRequestId !== undefined && rideRequestId !== '') {
    return false;
  }
  const title = String(notification?.request?.content?.title || '').trim().toLowerCase();
  return title === 'new ride request';
}

export async function clearRideRequestNotifications({ rideRequestId } = {}) {
  try {
    const hasTargetRide = rideRequestId !== undefined && rideRequestId !== null && rideRequestId !== '';
    const targetRideId = hasTargetRide ? Number(rideRequestId) : null;
    const dismissPromises = [];

    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const notification of presented) {
      if (!isRideRequestNotification(notification, hasTargetRide ? targetRideId : null)) {
        continue;
      }
      const identifier = notification?.request?.identifier;
      if (identifier) {
        dismissPromises.push(Notifications.dismissNotificationAsync(identifier));
      }
    }

    if (hasTargetRide && Number.isInteger(targetRideId) && targetRideId > 0) {
      const tracked = rideRequestNotificationIdsByRide.get(targetRideId);
      if (tracked) {
        tracked.forEach((identifier) => {
          dismissPromises.push(Notifications.dismissNotificationAsync(identifier));
        });
        rideRequestNotificationIdsByRide.delete(targetRideId);
      }
    } else {
      rideRequestNotificationIdsByRide.forEach((tracked) => {
        tracked.forEach((identifier) => {
          dismissPromises.push(Notifications.dismissNotificationAsync(identifier));
        });
      });
      rideRequestNotificationIdsByRide.clear();
    }

    await Promise.allSettled(dismissPromises);
  } catch (error) {
    console.warn('[notifications] clearRideRequestNotifications failed', error);
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // Keep only the normal OS foreground banner behavior.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotificationsAsync() {
  try {
    if (!Device.isDevice) {
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return null;
    }

    const projectId =
      Constants?.easConfig?.projectId ||
      Constants?.expoConfig?.extra?.eas?.projectId ||
      undefined;

    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenResponse?.data || null;

    if (!token) {
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(NEARBY_RIDE_CHANNEL_ID, {
        name: 'Nearby ride requests',
        importance: Notifications.AndroidImportance.MAX,
        sound: NEARBY_RIDE_SOUND_FILE,
        vibrationPattern: [0, 500, 180, 500, 180, 500],
        bypassDnd: true,
        lightColor: '#2f73c9',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
      await Notifications.setNotificationChannelAsync(DISTANT_RIDE_CHANNEL_ID, {
        name: 'Distant ride requests',
        importance: Notifications.AndroidImportance.HIGH,
        sound: DISTANT_RIDE_SOUND_FILE,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2f73c9',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2f73c9',
      });
    }

    return token;
  } catch (error) {
    // Handle network connectivity issues gracefully
    if (error.message?.includes('Network error') || 
        error.message?.includes('connect') || 
        error.message?.includes('timeout') ||
        error.message?.includes('503') ||
        error.message?.includes('upstream')) {
      console.log('[notifications] Network issue with Expo push token registration, will retry later');
      return null;
    }
    // Log other errors (like permission issues) as warnings
    console.warn('[notifications] registerForPushNotificationsAsync failed', error);
    return null;
  }
}

export async function registerForFcmTokenAsync() {
  try {
    if (!Device.isDevice) {
      return null;
    }

    const messagingInstance = getMessaging();
    const authStatus = await requestPermission(messagingInstance);
    const enabled = authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL;

    if (!enabled) {
      return null;
    }

    const fcmToken = await getToken(messagingInstance);
    return fcmToken || null;
  } catch (error) {
    console.log('[notifications] registerForFcmTokenAsync failed', error);
    return null;
  }
}

export async function showLocalRideNotification({
  title = 'New ride request',
  body = 'A new ride request is waiting for you.',
  data = {},
  priorityType = 'standard',
} = {}) {
  try {
    const rideRequestId = data?.rideRequestId;
    // Only one incoming request notification should be visible at a time.
    await clearRideRequestNotifications();

    const usePriorityChannel = String(priorityType || '').toLowerCase() === 'priority';
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: usePriorityChannel ? NEARBY_RIDE_SOUND_FILE : DISTANT_RIDE_SOUND_FILE,
        priority: Notifications.AndroidNotificationPriority.MAX,
        channelId: usePriorityChannel ? NEARBY_RIDE_CHANNEL_ID : DISTANT_RIDE_CHANNEL_ID,
        data,
      },
      trigger: null,
    });
    if (rideRequestId) {
      rememberRideRequestNotificationId(rideRequestId, notificationId);
    }
    return notificationId;
  } catch (error) {
    console.warn('[notifications] showLocalRideNotification failed', error);
    return null;
  }
}
