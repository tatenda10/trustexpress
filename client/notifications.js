import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';

const DRIVER_REQUEST_SOUND_FILE = 'notificationaudio.mpeg';
const DRIVER_REQUEST_CHANNEL_ID = 'ride-requests';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // Keep only the normal OS foreground banner behavior.
    shouldShowAlert: true,
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
      await Notifications.setNotificationChannelAsync(DRIVER_REQUEST_CHANNEL_ID, {
        name: 'Ride requests',
        importance: Notifications.AndroidImportance.MAX,
        sound: DRIVER_REQUEST_SOUND_FILE,
        vibrationPattern: [0, 300, 180, 300, 180, 300],
        lightColor: '#2f73c9',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        sound: DRIVER_REQUEST_SOUND_FILE,
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

    const authStatus = await messaging().requestPermission();
    const enabled = authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (!enabled) {
      return null;
    }

    const fcmToken = await messaging().getToken();
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
} = {}) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: DRIVER_REQUEST_SOUND_FILE,
        priority: Notifications.AndroidNotificationPriority.MAX,
        sticky: true,
        channelId: DRIVER_REQUEST_CHANNEL_ID,
        data,
      },
      trigger: null,
    });
  } catch (error) {
    console.warn('[notifications] showLocalRideNotification failed', error);
  }
}
