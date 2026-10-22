import React, { useEffect, useState } from 'react';
import { Image, Modal, StatusBar, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function statusText(call, now) {
  switch (call.status) {
    case 'calling':
      return 'Calling...';
    case 'ringing':
      return call.direction === 'incoming' ? 'Incoming free call' : 'Ringing...';
    case 'connecting':
      return 'Connecting...';
    case 'reconnecting':
      return 'Reconnecting...';
    case 'connected':
      return formatDuration(now - (call.connectedAt || now));
    case 'ended':
      return call.endText || 'Call ended';
    default:
      return '';
  }
}

function RoundButton({ icon, label, onPress, color = 'rgba(255,255,255,0.14)', iconColor = '#fff', size = 64, disabled = false }) {
  return (
    <View style={{ alignItems: 'center', width: 88 }}>
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.8}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Ionicons name={icon} size={Math.round(size * 0.42)} color={iconColor} />
      </TouchableOpacity>
      <Text style={{ marginTop: 8, fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>{label}</Text>
    </View>
  );
}

export default function CallScreen({ call, muted, speakerOn, onAccept, onDecline, onHangUp, onToggleMute, onToggleSpeaker }) {
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (call?.status !== 'connected') return undefined;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [call?.status]);

  if (!call) return null;

  const isIncomingRinging = call.direction === 'incoming' && call.status === 'ringing';
  const isEnded = call.status === 'ended';
  const initials = String(call.peerName || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => {}} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <View
        style={{
          flex: 1,
          backgroundColor: '#0f1b3d',
          paddingTop: insets.top + 48,
          paddingBottom: Math.max(insets.bottom, 16) + 40,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ alignItems: 'center', paddingHorizontal: 24 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: 'rgba(32,110,255,0.25)',
              borderRadius: 99,
              paddingHorizontal: 12,
              paddingVertical: 5,
              marginBottom: 28,
            }}
          >
            <Ionicons name="wifi" size={13} color="#9ec1ff" />
            <Text style={{ marginLeft: 6, fontSize: 12, fontWeight: '600', color: '#cfe0ff' }}>
              Free call · uses internet data
            </Text>
          </View>

          <View
            style={{
              width: 112,
              height: 112,
              borderRadius: 56,
              backgroundColor: '#206EFF',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              borderWidth: 3,
              borderColor: 'rgba(255,255,255,0.2)',
            }}
          >
            {call.peerImageUrl ? (
              <Image source={{ uri: call.peerImageUrl }} style={{ width: 112, height: 112 }} />
            ) : (
              <Text style={{ fontSize: 38, fontWeight: '700', color: '#fff' }}>{initials || '?'}</Text>
            )}
          </View>

          <Text style={{ marginTop: 20, fontSize: 26, fontWeight: '700', color: '#fff', textAlign: 'center' }} numberOfLines={1}>
            {call.peerName || 'Trust Express'}
          </Text>
          <Text style={{ marginTop: 8, fontSize: 16, color: isEnded ? '#ffb4b4' : 'rgba(255,255,255,0.75)', textAlign: 'center' }}>
            {statusText(call, now)}
          </Text>
        </View>

        {isIncomingRinging ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', width: '100%', paddingHorizontal: 32 }}>
            <RoundButton icon="close" label="Decline" color="#e5484d" size={72} onPress={onDecline} />
            <RoundButton icon="call" label="Accept" color="#22a559" size={72} onPress={onAccept} />
          </View>
        ) : (
          <View style={{ alignItems: 'center', width: '100%' }}>
            {!isEnded ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', width: '100%', paddingHorizontal: 40, marginBottom: 36 }}>
                <RoundButton
                  icon={muted ? 'mic-off' : 'mic'}
                  label={muted ? 'Unmute' : 'Mute'}
                  color={muted ? '#fff' : 'rgba(255,255,255,0.14)'}
                  iconColor={muted ? '#0f1b3d' : '#fff'}
                  onPress={onToggleMute}
                />
                <RoundButton
                  icon={speakerOn ? 'volume-high' : 'volume-medium'}
                  label="Speaker"
                  color={speakerOn ? '#fff' : 'rgba(255,255,255,0.14)'}
                  iconColor={speakerOn ? '#0f1b3d' : '#fff'}
                  onPress={onToggleSpeaker}
                />
              </View>
            ) : null}
            <RoundButton
              icon={isEnded ? 'close' : 'call'}
              label={isEnded ? 'Close' : 'End call'}
              color="#e5484d"
              size={72}
              onPress={onHangUp}
            />
          </View>
        )}
      </View>
    </Modal>
  );
}
