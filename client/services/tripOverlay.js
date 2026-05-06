import { NativeModules, Platform } from 'react-native';
import Constants from 'expo-constants';

let unsupportedLogged = false;

function getOverlayModule() {
  return NativeModules.TrustOverlay;
}

function logOverlay(event, details = {}) {
  console.log(`[TripOverlay] ${event}`, {
    ...details,
    support: getTripOverlaySupportInfo(),
  });
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
  const normalizedVariant = ['request', 'trip'].includes(variant) ? variant : 'online';
  return {
    title: String(payload.title || 'Trust Express'),
    subtitle: String(payload.subtitle || 'Active trip'),
    meta: String(payload.meta || ''),
    variant: normalizedVariant,
  };
}

export function isTripOverlaySupported() {
  const supported = isSupported();
  logOverlay('isTripOverlaySupported', { supported });
  return supported;
}

export async function canUseTripOverlay() {
  if (!isSupported()) {
    logUnsupported('canUseTripOverlay');
    return false;
  }
  try {
    const overlayModule = getOverlayModule();
    logOverlay('canDrawOverlays:start');
    const result = await overlayModule.canDrawOverlays();
    logOverlay('canDrawOverlays:result', { result });
    return result;
  } catch (error) {
    logOverlay('canDrawOverlays:error', {
      message: error?.message || String(error),
      code: error?.code || null,
    });
    return false;
  }
}

export async function openTripOverlaySettings() {
  if (!isSupported()) {
    logUnsupported('openTripOverlaySettings');
    return false;
  }
  try {
    const overlayModule = getOverlayModule();
    logOverlay('openOverlaySettings:start');
    await overlayModule.openOverlaySettings();
    logOverlay('openOverlaySettings:done');
    return true;
  } catch (error) {
    logOverlay('openOverlaySettings:error', {
      message: error?.message || String(error),
      code: error?.code || null,
    });
    return false;
  }
}

export async function showTripOverlay(payload) {
  if (!isSupported()) {
    logUnsupported('showTripOverlay');
    return false;
  }
  const normalizedPayload = normalizePayload(payload);
  logOverlay('show:start', { payload: normalizedPayload });
  const canDraw = await canUseTripOverlay();
  if (!canDraw) {
    logOverlay('show:blocked:no-permission');
    return false;
  }

  try {
    const overlayModule = getOverlayModule();
    await overlayModule.show(normalizedPayload);
    logOverlay('show:done');
    return true;
  } catch (error) {
    logOverlay('show:error', {
      message: error?.message || String(error),
      code: error?.code || null,
    });
    return false;
  }
}

export async function updateTripOverlay(payload) {
  if (!isSupported()) {
    logUnsupported('updateTripOverlay');
    return false;
  }
  const normalizedPayload = normalizePayload(payload);
  logOverlay('update:start', { payload: normalizedPayload });
  try {
    const overlayModule = getOverlayModule();
    const result = await overlayModule.update(normalizedPayload);
    logOverlay('update:done', { result });
    return result;
  } catch (error) {
    logOverlay('update:error', {
      message: error?.message || String(error),
      code: error?.code || null,
    });
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
    logOverlay('hide:start');
    await overlayModule.hide();
    logOverlay('hide:done');
    return true;
  } catch (error) {
    logOverlay('hide:error', {
      message: error?.message || String(error),
      code: error?.code || null,
    });
    return false;
  }
}
