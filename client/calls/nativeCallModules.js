import { NativeModules } from 'react-native';

let webrtc;
let inCallManager;

/** Builds made before free calls were added don't include WebRTC; requiring it there throws. */
export function getWebRTC() {
  if (webrtc !== undefined) return webrtc;
  try {
    webrtc = NativeModules.WebRTCModule ? require('react-native-webrtc') : null;
  } catch {
    webrtc = null;
  }
  return webrtc;
}

export function getInCallManager() {
  if (inCallManager !== undefined) return inCallManager;
  try {
    inCallManager = NativeModules.InCallManager ? require('react-native-incall-manager').default : null;
  } catch {
    inCallManager = null;
  }
  return inCallManager;
}

export function isFreeCallSupported() {
  return Boolean(getWebRTC());
}
