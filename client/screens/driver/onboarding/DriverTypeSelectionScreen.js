import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { updateDriverKind } from '../../../api';
import { PRIMARY_BLUE } from '../../../constants/colors';
import { DRIVER_KIND_STANDARD, DRIVER_KIND_TRUCK, writePendingDriverKind } from '../../../constants/driverKind';
import { useDriverStatus } from '../../../context/DriverStatusContext';

const OPTIONS = [
  {
    value: DRIVER_KIND_STANDARD,
    title: 'Normal driver',
    subtitle: 'Register a car and take Trust Express ride requests.',
    icon: 'car-outline',
  },
  {
    value: DRIVER_KIND_TRUCK,
    title: 'Truck driver',
    subtitle: 'Register your truck and take hire jobs for deliveries and moves.',
    icon: 'bus-outline',
  },
];

export default function DriverTypeSelectionScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { getToken, userId } = useAuth();
  const { driverStatus, refetchDriverStatus, patchDriverStatus } = useDriverStatus() || {};
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);

  const applyLocalKind = (kind, driverProfile = null) => {
    if (typeof patchDriverStatus !== 'function') return;
    patchDriverStatus({
      driverProfile: {
        ...(driverStatus?.driverProfile || {}),
        ...(driverProfile || {}),
        driverKind: kind,
      },
    });
  };

  const handleContinue = async () => {
    if (!selected) {
      Alert.alert('Choose a driver type', 'Are you a truck driver or a normal driver?');
      return;
    }
    try {
      setSaving(true);
      await writePendingDriverKind(userId, selected);
      applyLocalKind(selected);

      const token = await getToken({ skipCache: true });
      if (token) {
        try {
          const data = await updateDriverKind(token, { driverKind: selected });
          applyLocalKind(selected, data?.driverProfile || null);
          if (typeof refetchDriverStatus === 'function') {
            await refetchDriverStatus();
          }
        } catch {
          // Live API may not have this route yet. Local choice still unlocks truck/normal onboarding.
        }
      }

      navigation.replace('DriverUploadDocuments');
    } catch (error) {
      Alert.alert('Could not save choice', error?.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="flex-1 bg-[#f6f7f3]" style={{ paddingTop: insets.top + 12 }}>
      <View className="px-5 pb-4">
        <Text className="text-[26px] font-bold text-gray-900">How will you drive?</Text>
        <Text className="mt-2 text-base text-gray-600">
          Choose once so we can show the right documents and admin review for your vehicle.
        </Text>
      </View>

      <View className="px-5">
        {OPTIONS.map((option) => {
          const active = selected === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              onPress={() => setSelected(option.value)}
              activeOpacity={0.85}
              className="mb-3 rounded-[24px] border px-4 py-5"
              style={{
                borderColor: active ? PRIMARY_BLUE : '#e5e7eb',
                backgroundColor: active ? '#eff6ff' : '#fff',
              }}
            >
              <View className="flex-row items-center">
                <View
                  className="h-12 w-12 items-center justify-center rounded-full"
                  style={{ backgroundColor: active ? '#dbeafe' : '#f1f5f9' }}
                >
                  <Ionicons name={option.icon} size={22} color={active ? PRIMARY_BLUE : '#334155'} />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-lg font-bold text-gray-900">{option.title}</Text>
                  <Text className="mt-1 text-sm text-gray-600">{option.subtitle}</Text>
                </View>
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={active ? PRIMARY_BLUE : '#94a3b8'}
                />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View className="mt-auto px-5" style={{ paddingBottom: insets.bottom + 24 }}>
        <TouchableOpacity
          onPress={handleContinue}
          disabled={saving}
          className="h-14 items-center justify-center rounded-[18px]"
          style={{ backgroundColor: PRIMARY_BLUE, opacity: saving ? 0.7 : 1 }}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-sm font-bold uppercase text-white">Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
