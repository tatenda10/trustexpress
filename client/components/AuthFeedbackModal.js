import React from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const TONES = {
  error: {
    icon: 'alert-circle',
    iconColor: '#dc2626',
    iconBg: '#fee2e2',
    buttonBg: '#111827',
  },
  info: {
    icon: 'information-circle',
    iconColor: '#2563eb',
    iconBg: '#dbeafe',
    buttonBg: '#111827',
  },
};

export default function AuthFeedbackModal({
  visible,
  title,
  message,
  tone = 'error',
  primaryLabel = 'Okay',
  onPrimary,
  secondaryLabel,
  onSecondary,
}) {
  const colors = TONES[tone] || TONES.error;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onPrimary}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-[360px] rounded-[28px] bg-white px-6 py-6">
          <View
            className="mb-4 h-14 w-14 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.iconBg }}
          >
            <Ionicons name={colors.icon} size={28} color={colors.iconColor} />
          </View>

          <Text className="text-xl font-semibold text-gray-950">{title}</Text>
          <Text className="mt-2 text-sm leading-6 text-gray-500">{message}</Text>

          <TouchableOpacity
            className="mt-6 items-center justify-center rounded-[18px] px-4 py-4"
            style={{ backgroundColor: colors.buttonBg }}
            onPress={onPrimary}
            activeOpacity={0.85}
          >
            <Text className="text-base font-semibold text-white">{primaryLabel}</Text>
          </TouchableOpacity>

          {secondaryLabel ? (
            <TouchableOpacity
              className="mt-3 items-center justify-center rounded-[18px] bg-gray-100 px-4 py-4"
              onPress={onSecondary}
              activeOpacity={0.85}
            >
              <Text className="text-base font-medium text-gray-700">{secondaryLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
