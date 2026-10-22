import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, PermissionsAndroid, Platform, Vibration } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { connectRealtime, emitRealtimeWithAck, getRealtimeSocket, onRealtimeEvent } from '../realtime';
import { getInCallManager, getWebRTC, isFreeCallSupported } from './nativeCallModules';
import CallScreen from './CallScreen';

const CallContext = createContext(null);

const RECONNECT_WAIT_MS = 12000;
const ENDED_SCREEN_MS = 1800;
const FALLBACK_ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302'] }];

const END_REASON_TEXT = {
  declined: 'Call declined',
  no_answer: 'No answer',
  hangup: 'Call ended',
  cancelled: 'Call cancelled',
  connection_lost: 'Connection lost',
  failed: 'Call failed. Try a regular call.',
  unsupported: 'Their app needs an update for free calls. Try a regular call.',
  answered_elsewhere: 'Answered on another device',
  max_duration: 'Call ended',
  replaced: 'Call ended',
};

async function ensureMicrophonePermission() {
  if (Platform.OS !== 'android') return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Microphone access',
    message: 'Trust Express needs your microphone for free calls during a ride.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function serializeCandidate(candidate) {
  if (typeof candidate?.toJSON === 'function') return candidate.toJSON();
  return {
    candidate: candidate?.candidate,
    sdpMid: candidate?.sdpMid,
    sdpMLineIndex: candidate?.sdpMLineIndex,
  };
}

function safeInCall(action) {
  try {
    action(getInCallManager());
  } catch {
    // Audio routing is best-effort; the call itself still works.
  }
}

export function CallProvider({ enabled, children }) {
  const { getToken } = useAuth();
  const [call, setCall] = useState(null);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);

  const callRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const iceServersRef = useRef(null);
  const pendingSignalsRef = useRef([]);
  const pendingCandidatesRef = useRef([]);
  const signalChainRef = useRef(Promise.resolve());
  const reconnectTimerRef = useRef(null);
  const dismissTimerRef = useRef(null);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const setCallState = (next) => {
    callRef.current = next;
    setCall(next);
  };

  const patchCall = (patch) => {
    if (!callRef.current) return;
    setCallState({ ...callRef.current, ...patch });
  };

  const sendSignal = (data) => {
    const callId = callRef.current?.callId;
    if (!callId) return;
    getRealtimeSocket()?.emit('call:signal', { callId, data });
  };

  const releaseMedia = () => {
    clearTimeout(reconnectTimerRef.current);
    safeInCall((icm) => {
      icm?.stopRingtone();
      icm?.stopRingback();
      icm?.stop();
    });
    Vibration.cancel();
    try {
      pcRef.current?.close();
    } catch {
      // Already closed.
    }
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    pendingSignalsRef.current = [];
    pendingCandidatesRef.current = [];
    iceServersRef.current = null;
  };

  const finishCall = (reason) => {
    if (!callRef.current) return;
    releaseMedia();
    patchCall({ status: 'ended', endText: END_REASON_TEXT[reason] || 'Call ended' });
    clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setCallState(null);
      setMuted(false);
      setSpeakerOn(false);
    }, ENDED_SCREEN_MS);
  };

  const endFromThisSide = (reason) => {
    const callId = callRef.current?.callId;
    if (callId) emitRealtimeWithAck('call:end', { callId }).catch(() => {});
    finishCall(reason);
  };

  const handleConnectionState = (state) => {
    if (!callRef.current || callRef.current.status === 'ended') return;
    if (state === 'connected') {
      clearTimeout(reconnectTimerRef.current);
      if (callRef.current.status !== 'connected') {
        patchCall({ status: 'connected', connectedAt: callRef.current.connectedAt || Date.now() });
      }
      safeInCall((icm) => icm?.stopRingback());
    } else if (state === 'disconnected') {
      patchCall({ status: 'reconnecting' });
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => endFromThisSide('connection_lost'), RECONNECT_WAIT_MS);
    } else if (state === 'failed') {
      endFromThisSide('failed');
    }
  };

  const getLocalStream = async () => {
    if (!localStreamRef.current) {
      localStreamRef.current = await getWebRTC().mediaDevices.getUserMedia({ audio: true, video: false });
    }
    return localStreamRef.current;
  };

  const createPeerConnection = async () => {
    const { RTCPeerConnection } = getWebRTC();
    const stream = await getLocalStream();
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current || FALLBACK_ICE_SERVERS });
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) sendSignal({ type: 'candidate', candidate: serializeCandidate(event.candidate) });
    });
    pc.addEventListener('connectionstatechange', () => handleConnectionState(pc.connectionState));
    pcRef.current = pc;
    return pc;
  };

  const flushPendingCandidates = async (pc) => {
    const { RTCIceCandidate } = getWebRTC();
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    }
  };

  const processSignal = async (data) => {
    if (!data || !callRef.current) return;
    const pc = pcRef.current;
    if (!pc) {
      pendingSignalsRef.current.push(data);
      return;
    }
    const { RTCSessionDescription, RTCIceCandidate } = getWebRTC();
    if (data.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
      await flushPendingCandidates(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ type: 'answer', sdp: answer.sdp });
    } else if (data.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
      await flushPendingCandidates(pc);
    } else if (data.type === 'candidate' && data.candidate) {
      if (!pc.remoteDescription) {
        pendingCandidatesRef.current.push(data.candidate);
      } else {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
      }
    }
  };

  const enqueueSignal = (data) => {
    signalChainRef.current = signalChainRef.current
      .then(() => processSignal(data))
      .catch((error) => {
        console.warn('[calls] signal failed', error?.message || error);
      });
  };

  const ensureConnected = async () => {
    const token = await getTokenRef.current?.();
    if (token) connectRealtime(token);
  };

  const startFreeCall = async ({ rideRequestId, peerName, peerImageUrl = null }) => {
    if (!isFreeCallSupported()) {
      Alert.alert('Update needed', 'Free calls need the latest version of Trust Express. Please update the app, or use a regular call.');
      return false;
    }
    if (callRef.current) return false;
    if (!(await ensureMicrophonePermission())) {
      Alert.alert('Microphone needed', 'Allow microphone access in your phone settings to make free calls.');
      return false;
    }

    clearTimeout(dismissTimerRef.current);
    setCallState({ callId: null, rideRequestId, direction: 'outgoing', peerName, peerImageUrl, status: 'calling' });
    try {
      await ensureConnected();
      const response = await emitRealtimeWithAck('call:start', { rideRequestId });
      if (response?.error) throw new Error(response.error);
      if (!callRef.current) {
        emitRealtimeWithAck('call:end', { callId: response.callId }).catch(() => {});
        return false;
      }
      iceServersRef.current = response.iceServers || null;
      patchCall({ callId: response.callId, status: 'ringing' });
      safeInCall((icm) => icm?.start({ media: 'audio', ringback: '_DTMF_' }));
      await getLocalStream();
      return true;
    } catch (error) {
      releaseMedia();
      setCallState(null);
      Alert.alert('Free call unavailable', `${error?.message || 'Could not start the call.'}\n\nYou can use a regular call instead.`);
      return false;
    }
  };

  const acceptCall = async () => {
    const current = callRef.current;
    if (!current || current.direction !== 'incoming' || current.status !== 'ringing') return;
    safeInCall((icm) => icm?.stopRingtone());
    Vibration.cancel();
    if (!(await ensureMicrophonePermission())) {
      declineCall();
      Alert.alert('Microphone needed', 'Allow microphone access in your phone settings to answer free calls.');
      return;
    }

    patchCall({ status: 'connecting' });
    try {
      const response = await emitRealtimeWithAck('call:accept', { callId: current.callId });
      if (response?.error) throw new Error(response.error);
      iceServersRef.current = response.iceServers || null;
      safeInCall((icm) => icm?.start({ media: 'audio' }));
      await createPeerConnection();
      const queued = pendingSignalsRef.current;
      pendingSignalsRef.current = [];
      queued.forEach(enqueueSignal);
    } catch (error) {
      console.warn('[calls] accept failed', error?.message || error);
      endFromThisSide('failed');
    }
  };

  const declineCall = () => {
    const current = callRef.current;
    if (!current) return;
    if (current.callId) emitRealtimeWithAck('call:decline', { callId: current.callId }).catch(() => {});
    releaseMedia();
    clearTimeout(dismissTimerRef.current);
    setCallState(null);
  };

  const hangUp = () => {
    const current = callRef.current;
    if (!current) return;
    if (current.status === 'ended') {
      clearTimeout(dismissTimerRef.current);
      setCallState(null);
      return;
    }
    if (!current.callId) {
      releaseMedia();
      setCallState(null);
      return;
    }
    endFromThisSide(current.status === 'ringing' && current.direction === 'outgoing' ? 'cancelled' : 'hangup');
  };

  const toggleMute = () => {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  };

  const toggleSpeaker = () => {
    const next = !speakerOn;
    safeInCall((icm) => icm?.setForceSpeakerphoneOn(next));
    setSpeakerOn(next);
  };

  // Socket listeners read the latest handlers through this ref so they never go stale.
  const handlersRef = useRef({});
  handlersRef.current = {
    onIncoming: (payload) => {
      const callId = String(payload?.callId || '');
      if (!callId) return;
      if (callRef.current) {
        if (callRef.current.callId !== callId) {
          emitRealtimeWithAck('call:decline', { callId }).catch(() => {});
        }
        return;
      }
      if (!isFreeCallSupported()) {
        emitRealtimeWithAck('call:decline', { callId, reason: 'unsupported' }).catch(() => {});
        return;
      }
      clearTimeout(dismissTimerRef.current);
      setCallState({
        callId,
        rideRequestId: payload.rideRequestId,
        direction: 'incoming',
        peerName: payload.callerName || (payload.callerRole === 'driver' ? 'Your driver' : 'Your passenger'),
        peerImageUrl: payload.callerImageUrl || null,
        peerRole: payload.callerRole,
        status: 'ringing',
      });
      let ringing = false;
      safeInCall((icm) => {
        if (icm) {
          icm.startRingtone('_DEFAULT_');
          ringing = true;
        }
      });
      if (!ringing) Vibration.vibrate([0, 800, 800], true);
    },
    onAccepted: async (payload) => {
      if (!callRef.current || callRef.current.callId !== payload?.callId) return;
      patchCall({ status: 'connecting' });
      safeInCall((icm) => icm?.stopRingback());
      try {
        const pc = await createPeerConnection();
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
        await pc.setLocalDescription(offer);
        sendSignal({ type: 'offer', sdp: offer.sdp });
      } catch (error) {
        console.warn('[calls] offer failed', error?.message || error);
        endFromThisSide('failed');
      }
    },
    onSignal: (payload) => {
      if (!callRef.current || callRef.current.callId !== payload?.callId) return;
      enqueueSignal(payload.data);
    },
    onEnded: (payload) => {
      if (!callRef.current || callRef.current.callId !== payload?.callId) return;
      finishCall(payload?.reason);
    },
  };

  useEffect(() => {
    if (!enabled) return undefined;
    const subscriptions = [
      onRealtimeEvent('call:incoming', (payload) => handlersRef.current.onIncoming(payload)),
      onRealtimeEvent('call:accepted', (payload) => handlersRef.current.onAccepted(payload)),
      onRealtimeEvent('call:signal', (payload) => handlersRef.current.onSignal(payload)),
      onRealtimeEvent('call:ended', (payload) => handlersRef.current.onEnded(payload)),
    ];
    ensureConnected().catch(() => {});
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') ensureConnected().catch(() => {});
    });
    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      appStateSubscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => () => {
    clearTimeout(dismissTimerRef.current);
    releaseMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startFreeCallRef = useRef(startFreeCall);
  startFreeCallRef.current = startFreeCall;
  const startFreeCallStable = useCallback((options) => startFreeCallRef.current(options), []);

  const value = useMemo(
    () => ({
      startFreeCall: startFreeCallStable,
      freeCallSupported: isFreeCallSupported(),
      inCall: Boolean(call),
    }),
    [startFreeCallStable, call]
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallScreen
        call={call}
        muted={muted}
        speakerOn={speakerOn}
        onAccept={acceptCall}
        onDecline={declineCall}
        onHangUp={hangUp}
        onToggleMute={toggleMute}
        onToggleSpeaker={toggleSpeaker}
      />
    </CallContext.Provider>
  );
}

export function useRideCalls() {
  return useContext(CallContext) || { startFreeCall: async () => false, freeCallSupported: false, inCall: false };
}
