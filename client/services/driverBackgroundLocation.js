import { Alert, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { issueDriverLocationKey, postDriverBackgroundLocation } from '../api';

// Builds made before expo-task-manager was added don't have its native module; importing it there crashes on launch.
const TaskManager = requireOptionalNativeModule('ExpoTaskManager') ? require('expo-task-manager') : null;

export const DRIVER_BACKGROUND_LOCATION_TASK = 'trust-driver-background-location';

const LOCATION_KEY_STORAGE_KEY = 'trust_driver_location_key';
// The task reads the key while the phone may be locked.
const SECURE_STORE_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

async function readLocationKey() {
  try {
    return await SecureStore.getItemAsync(LOCATION_KEY_STORAGE_KEY, SECURE_STORE_OPTIONS);
  } catch {
    return null;
  }
}

async function stopLocationUpdates() {
  runningMode = null;
  if (!TaskManager) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK);
    }
  } catch {
    // Task was never registered on this install.
  }
}

// Must be defined at module scope so it is registered when the OS wakes the app headless.
TaskManager?.defineTask(DRIVER_BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = Array.isArray(data?.locations) ? data.locations : [];
  const latest = locations[locations.length - 1];
  if (!latest?.coords) return;

  const key = await readLocationKey();
  if (!key) {
    await stopLocationUpdates();
    return;
  }

  try {
    const { status, data: body } = await postDriverBackgroundLocation(key, {
      latitude: latest.coords.latitude,
      longitude: latest.coords.longitude,
      accuracy: latest.coords.accuracy ?? null,
    });
    if (status === 401) {
      await SecureStore.deleteItemAsync(LOCATION_KEY_STORAGE_KEY, SECURE_STORE_OPTIONS).catch(() => {});
      await stopLocationUpdates();
    } else if (status === 200 && body?.isOnline === false) {
      await stopLocationUpdates();
    }
  } catch {
    // Offline or server unreachable; the next update retries.
  }
});

function explainBackgroundLocation() {
  return new Promise((resolve) => {
    Alert.alert(
      'Get rides while the app is closed',
      Platform.OS === 'android'
        ? 'While you are online, Trust Express uses your location in the background so you get ride requests near where you are, even when the app is closed. On the next screen choose "Allow all the time". Location stops when you go offline.'
        : 'While you are online, Trust Express uses your location in the background so you get ride requests near where you are, even when the app is closed. Choose "Change to Always Allow" when asked. Location stops when you go offline.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}

async function ensureBackgroundPermission({ prompt }) {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) return false;

  const background = await Location.getBackgroundPermissionsAsync();
  if (background.granted) return true;
  if (!prompt || !background.canAskAgain) return false;

  if (!(await explainBackgroundLocation())) return false;
  const requested = await Location.requestBackgroundPermissionsAsync();
  return requested.granted;
}

async function ensureLocationKey(getToken) {
  const existing = await readLocationKey();
  if (existing) return existing;

  const token = await getToken();
  if (!token) return null;
  const response = await issueDriverLocationKey(token);
  const key = String(response?.key || '').trim();
  if (!key) return null;
  await SecureStore.setItemAsync(LOCATION_KEY_STORAGE_KEY, key, SECURE_STORE_OPTIONS);
  return key;
}

let startInFlight = null;
let runningMode = null;
let requestedMode = 'idle';

// While a passenger is waiting or riding, they watch the car move, so report much more often.
const MODE_OPTIONS = {
  idle: { timeInterval: 60 * 1000, distanceInterval: 150, deferredUpdatesInterval: 60 * 1000 },
  trip: { timeInterval: 4 * 1000, distanceInterval: 10, deferredUpdatesInterval: 4 * 1000 },
};

/**
 * Keeps sending the driver's location while they are online, including when the app is
 * closed, so ride offers are matched against where they are now. Returns false if the
 * driver has not allowed background location.
 */
export function startDriverBackgroundLocation(getToken, options = {}) {
  if (!startInFlight) {
    startInFlight = startBackgroundLocation(getToken, options).finally(() => {
      startInFlight = null;
    });
  }
  return startInFlight;
}

async function startBackgroundLocation(getToken, { prompt = false } = {}) {
  if (Platform.OS === 'web' || !TaskManager) return false;
  if (!(await ensureBackgroundPermission({ prompt }))) return false;
  if (!(await ensureLocationKey(getToken))) return false;

  const mode = requestedMode;
  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK).catch(() => false);
  if (alreadyStarted && runningMode === mode) {
    return true;
  }
  if (alreadyStarted) {
    await Location.stopLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK).catch(() => {});
  }

  await Location.startLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK, {
    accuracy: mode === 'trip' ? Location.Accuracy.High : Location.Accuracy.Balanced,
    ...MODE_OPTIONS[mode],
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: false,
    foregroundService: {
      notificationTitle: 'You are online',
      notificationBody: 'Trust Express is finding ride requests near you.',
      notificationColor: '#206EFF',
      killServiceOnDestroy: false,
    },
  });
  runningMode = mode;
  return true;
}

/**
 * Switches background reporting between the slow idle rate and the fast trip rate.
 * Only restarts updates that are already running; it never prompts for permission.
 */
export async function setDriverBackgroundLocationMode(mode, getToken) {
  requestedMode = mode === 'trip' ? 'trip' : 'idle';
  if (Platform.OS === 'web' || !TaskManager) return false;
  if (startInFlight) await startInFlight.catch(() => {});
  if (runningMode === requestedMode) return true;
  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK).catch(() => false);
  if (!started) return false;
  return startDriverBackgroundLocation(getToken, { prompt: false });
}

export async function stopDriverBackgroundLocation() {
  await stopLocationUpdates();
}

/** For sign-out: stops updates and forgets the key so a different account on this phone can't reuse it. */
export async function clearDriverBackgroundLocation() {
  await stopLocationUpdates();
  await SecureStore.deleteItemAsync(LOCATION_KEY_STORAGE_KEY, SECURE_STORE_OPTIONS).catch(() => {});
}
