import React from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function OptionRow({ icon, iconBg, iconColor, title, subtitle, badge, onPress, disabled }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 16,
        padding: 14,
        marginBottom: 12,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          backgroundColor: iconBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={22} color={iconColor} />
      </View>
      <View style={{ flex: 1, marginLeft: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>{title}</Text>
          {badge ? (
            <View style={{ marginLeft: 8, backgroundColor: '#e8f0ff', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#206EFF' }}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ marginTop: 3, fontSize: 13, color: '#6b7280' }}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
    </TouchableOpacity>
  );
}

/**
 * Lets the user pick a free in-app (internet) call or a regular phone call.
 */
export default function CallOptionsSheet({
  visible,
  onClose,
  peerLabel = 'driver',
  onFreeCall,
  onRegularCall,
  freeCallSupported = true,
  regularCallAvailable = true,
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: '#fff',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, 16) + 8,
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#e5e7eb', marginBottom: 16 }} />
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Call your {peerLabel}</Text>
          <Text style={{ marginTop: 4, marginBottom: 18, fontSize: 13, color: '#6b7280' }}>Choose how you want to call.</Text>

          <OptionRow
            icon="wifi"
            iconBg="#e8f0ff"
            iconColor="#206EFF"
            title="Free call"
            badge="No airtime"
            subtitle={freeCallSupported ? 'Calls over the internet using your data' : 'Update the app to use free calls'}
            disabled={!freeCallSupported}
            onPress={() => {
              onClose?.();
              onFreeCall?.();
            }}
          />
          <OptionRow
            icon="call"
            iconBg="#e9f8ef"
            iconColor="#22a559"
            title="Regular call"
            subtitle={regularCallAvailable ? 'Uses your normal airtime' : 'No phone number available'}
            disabled={!regularCallAvailable}
            onPress={() => {
              onClose?.();
              onRegularCall?.();
            }}
          />

          <TouchableOpacity onPress={onClose} style={{ alignItems: 'center', paddingVertical: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#6b7280' }}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
