import { NativeModules, Platform } from 'react-native';
import Constants from 'expo-constants';

const overlayModule = NativeModules.TrustOverlay;

function isSupported() {
  const isAndroid = Platform.OS === 'android';
  const hasModule = !!overlayModule;
  const isExpoGo = Constants.appOwnership === 'expo';
  const supported = isAndroid && hasModule && !isExpoGo;
  return supported;
}

function normalizePayload(payload = {}) {
  return {
    title: String(payload.title || 'Trust Express'),
    subtitle: String(payload.subtitle || 'Active trip'),
    meta: String(payload.meta || ''),
  };
}

export function isTripOverlaySupported() {
  return isSupported();
}

export async function canUseTripOverlay() {
  if (!isSupported()) {
    console.log('[TripOverlay] Not supported');
    return false;
  }
  try {
    const result = await overlayModule.canDrawOverlays();
    console.log('[TripOverlay] canDrawOverlays result:', result);
    return result;
  } catch (error) {
    console.log('[TripOverlay] canDrawOverlays error:', error);
    return false;
  }
}

export async function openTripOverlaySettings() {
  if (!isSupported()) return false;
  try {
    await overlayModule.openOverlaySettings();
    return true;
  } catch {
    return false;
  }
}

export async function showTripOverlay(payload) {
  if (!isSupported()) {
    console.log('[TripOverlay] showTripOverlay: Not supported');
    return false;
  }
  const canDraw = await canUseTripOverlay();
  if (!canDraw) {
    console.log('[TripOverlay] showTripOverlay: Cannot draw overlays');
    return false;
  }

  try {
    console.log('[TripOverlay] showTripOverlay: Showing overlay with payload:', payload);
    await overlayModule.show(normalizePayload(payload));
    console.log('[TripOverlay] showTripOverlay: Overlay shown successfully');
    return true;
  } catch (error) {
    console.log('[TripOverlay] showTripOverlay: Error showing overlay:', error);
    return false;
  }
}

export async function updateTripOverlay(payload) {
  if (!isSupported()) return false;
  try {
    return await overlayModule.update(normalizePayload(payload));
  } catch {
    return false;
  }
}

export async function hideTripOverlay() {
  if (!isSupported()) {
    console.log('[TripOverlay] hideTripOverlay: Not supported');
    return false;
  }

  try {
    console.log('[TripOverlay] hideTripOverlay: Hiding overlay');
    await overlayModule.hide();
    console.log('[TripOverlay] hideTripOverlay: Overlay hidden successfully');
    return true;
  } catch (error) {
    console.log('[TripOverlay] hideTripOverlay: Error hiding overlay:', error);
    return false;
  }
}
