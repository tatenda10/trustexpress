/**
 * RN Firebase modular initialization helper.
 * Keeps a default app available before Auth usage.
 */
import { getApps, getApp, initializeApp } from '@react-native-firebase/app';

const firebaseConfig = {
  apiKey: 'AIzaSyBifacv33E0i3wkIAt07x7wi3ZUB4wEXvA',
  authDomain: 'trust-vehicles-app.firebaseapp.com',
  projectId: 'trust-vehicles-app',
  storageBucket: 'trust-vehicles-app.firebasestorage.app',
  messagingSenderId: '482151241834',
  appId: '1:482151241834:android:fae586a2d3a50821e71213',
};

let initPromise = null;

export async function ensureFirebaseApp() {
  if (getApps().length) {
    return getApp();
  }
  if (!initPromise) {
    initPromise = initializeApp(firebaseConfig).catch((e) => {
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
}

export function getFirebaseAppIfReady() {
  return getApps().length ? getApp() : null;
}

ensureFirebaseApp().catch((e) => {
  console.log('[firebase] init warning:', e?.message || e);
});
