import { NativeModules, Platform } from 'react-native';
import Constants from 'expo-constants';

let unsupportedLogged = false;

function getOverlayModule() {
  return NativeModules.TrustOverlay;
}

export function getTripOverlaySupportInfo() {
  const matchingNativeModules = Object.keys(NativeModules || {})
    .filter((key) => /trust|overlay/i.test(key))
    .sort();

  return {
    platform: Platform.OS,
    appOwnership: Constants.appOwnership || null,
    hasNativeModule: !!getOverlayModule(),
    matchingNativeModules,
  };
}

function isSupported() {
  const isAndroid = Platform.OS === 'android';
  const hasModule = !!getOverlayModule();
  const isExpoGo = Constants.appOwnership === 'expo';
  const supported = isAndroid && hasModule && !isExpoGo;
  return supported;
}

function logUnsupported(source) {
  if (unsupportedLogged) return;
  unsupportedLogged = true;
  console.log(`[TripOverlay] ${source}: unsupported`, getTripOverlaySupportInfo());
}

function normalizePayload(payload = {}) {
  const variant = String(payload.variant || 'online').trim().toLowerCase();
  return {
    title: String(payload.title || 'Trust Express'),
    subtitle: String(payload.subtitle || 'Active trip'),
    meta: String(payload.meta || ''),
    variant: variant === 'request' ? 'request' : 'online',
  };
}

export function isTripOverlaySupported() {
  return isSupported();
}

export async function canUseTripOverlay() {
  if (!isSupported()) {
    logUnsupported('canUseTripOverlay');
    return false;
  }
  try {
    const overlayModule = getOverlayModule();
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
    const overlayModule = getOverlayModule();
    await overlayModule.openOverlaySettings();
    return true;
  } catch {
    return false;
  }
}

export async function showTripOverlay(payload) {
  if (!isSupported()) {
    logUnsupported('showTripOverlay');
    return false;
  }
  const canDraw = await canUseTripOverlay();
  if (!canDraw) {
    console.log('[TripOverlay] showTripOverlay: Cannot draw overlays');
    return false;
  }

  try {
    const overlayModule = getOverlayModule();
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
    const overlayModule = getOverlayModule();
    return await overlayModule.update(normalizePayload(payload));
  } catch {
    return false;
  }
}

export async function hideTripOverlay() {
  if (!isSupported()) {
    logUnsupported('hideTripOverlay');
    return false;
  }

  try {
    const overlayModule = getOverlayModule();
    console.log('[TripOverlay] hideTripOverlay: Hiding overlay');
    await overlayModule.hide();
    console.log('[TripOverlay] hideTripOverlay: Overlay hidden successfully');
    return true;
  } catch (error) {
    console.log('[TripOverlay] hideTripOverlay: Error hiding overlay:', error);
    return false;
  }
}
