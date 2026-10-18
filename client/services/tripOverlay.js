import { NativeModules, Platform } from 'react-native';
import Constants from 'expo-constants';

function getOverlayModule() {
  return NativeModules.TrustOverlay;
}

function logOverlay(event, details = {}) {
  return undefined;
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
  return undefined;
}

const DEFAULT_ALERT_TIMEOUT_SECONDS = 30;
const MAX_ALERT_TIMEOUT_SECONDS = 45;

function resolveAlertTimeoutSeconds(payload = {}) {
  const candidates = [];
  const explicit = Number(payload?.alertTimeoutSeconds);
  if (Number.isFinite(explicit) && explicit > 0) candidates.push(explicit);
  const remaining = Number(payload?.remainingSeconds);
  if (Number.isFinite(remaining) && remaining > 0) candidates.push(remaining);
  const expiresAtMs = payload?.expiresAt ? new Date(payload.expiresAt).getTime() : NaN;
  if (Number.isFinite(expiresAtMs)) {
    const secondsLeft = (expiresAtMs - Date.now()) / 1000;
    if (secondsLeft > 0) candidates.push(secondsLeft);
  }
  const seconds = candidates.length ? Math.min(...candidates) : DEFAULT_ALERT_TIMEOUT_SECONDS;
  return Math.max(5, Math.min(MAX_ALERT_TIMEOUT_SECONDS, Math.round(seconds)));
}

function normalizePayload(payload = {}) {
  const variant = String(payload.variant || 'online').trim().toLowerCase();
  const normalizedVariant = ['request', 'trip'].includes(variant) ? variant : 'online';
  const rideRequestId = payload?.rideRequestId != null ? String(payload.rideRequestId) : '';
  const estimatedAmount = Number(payload?.estimatedAmount);
  const fareLabel = payload?.fareLabel
    || (Number.isFinite(estimatedAmount) && estimatedAmount > 0
      ? `$${estimatedAmount.toFixed(2)}`
      : '');
  return {
    title: String(payload.title || 'Trust Express'),
    subtitle: String(payload.subtitle || payload.body || 'Active trip'),
    meta: String(payload.meta || ''),
    variant: normalizedVariant,
    pickupLabel: String(payload.pickupLabel || payload.pickup || ''),
    dropoffLabel: String(payload.dropoffLabel || payload.dropoff || ''),
    fareLabel: String(fareLabel || ''),
    rideRequestId,
    alertTimeoutSeconds: resolveAlertTimeoutSeconds(payload),
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

export async function showFullScreenRideRequest(payload = {}) {
  if (!isSupported()) {
    logUnsupported('showFullScreenRideRequest');
    return false;
  }

  try {
    const overlayModule = getOverlayModule();
    if (typeof overlayModule?.showFullScreenRideRequest !== 'function') {
      logOverlay('showFullScreenRideRequest:missing-native-method');
      return false;
    }

    const normalized = normalizePayload({
      ...payload,
      variant: 'request',
      title: payload?.title || 'New ride request',
      subtitle: payload?.body || payload?.subtitle || 'A new ride request has arrived.',
    });
    await overlayModule.showFullScreenRideRequest({
      title: normalized.title,
      body: normalized.subtitle,
      pickupLabel: normalized.pickupLabel,
      dropoffLabel: normalized.dropoffLabel,
      fareLabel: normalized.fareLabel,
      rideRequestId: normalized.rideRequestId,
      alertTimeoutSeconds: normalized.alertTimeoutSeconds,
    });
    logOverlay('showFullScreenRideRequest:done', { rideRequestId: normalized.rideRequestId || null });
    return true;
  } catch (error) {
    logOverlay('showFullScreenRideRequest:error', {
      message: error?.message || String(error),
      code: error?.code || null,
    });
    return false;
  }
}
