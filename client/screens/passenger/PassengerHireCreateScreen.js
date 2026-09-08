import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createHireRequest } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

export default function PassengerHireCreateScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [pickupLabel, setPickupLabel] = useState('');
  const [dropoffLabel, setDropoffLabel] = useState('');
  const [startAt, setStartAt] = useState('');
  const [passengerCount, setPassengerCount] = useState('1');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    try {
      if (!pickupLabel.trim()) {
        Alert.alert('Pickup required', 'Enter where the hire should start.');
        return;
      }
      if (!startAt.trim()) {
        Alert.alert('Start time required', 'Use format YYYY-MM-DD HH:MM');
        return;
      }
      const parsedStart = new Date(startAt.replace(' ', 'T'));
      if (Number.isNaN(parsedStart.getTime())) {
        Alert.alert('Invalid time', 'Use format YYYY-MM-DD HH:MM');
        return;
      }
      setSaving(true);
      const token = await getToken({ skipCache: true });
      const data = await createHireRequest(token, {
        pickupLabel: pickupLabel.trim(),
        dropoffLabel: dropoffLabel.trim() || undefined,
        startAt: parsedStart.toISOString(),
        passengerCount: Number(passengerCount) || 1,
        category: category.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      Alert.alert('Request posted', 'Drivers can now send quotes.');
      navigation.replace('PassengerHireDetail', { requestId: data?.request?.id });
    } catch (err) {
      Alert.alert('Could not create request', err?.message || 'Try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center justify-between"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 14 }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-[18px] font-bold text-gray-900">New hire request</Text>
        <View className="h-10 w-10" />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 28 }}>
        <View className="rounded-[28px] bg-white px-5 py-5">
          <Field label="Pickup / start point" value={pickupLabel} onChangeText={setPickupLabel} placeholder="Bulawayo CBD" />
          <Field label="Drop-off / destination" value={dropoffLabel} onChangeText={setDropoffLabel} placeholder="Optional" />
          <Field label="Start date & time" value={startAt} onChangeText={setStartAt} placeholder="2026-09-20 08:00" autoCapitalize="none" />
          <Field label="Passengers" value={passengerCount} onChangeText={setPassengerCount} keyboardType="number-pad" placeholder="4" />
          <Field label="Preferred category" value={category} onChangeText={setCategory} placeholder="van, suv, sedan..." autoCapitalize="none" />
          <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Luggage, wait time, etc." multiline />

          <TouchableOpacity
            onPress={handleCreate}
            disabled={saving}
            className="mt-6 h-12 items-center justify-center rounded-[18px]"
            style={{ backgroundColor: PRIMARY_BLUE, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <Text className="text-sm font-bold uppercase text-white">Post request</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  multiline = false,
}) {
  return (
    <View className="mt-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        className={`${multiline ? 'min-h-[96px] py-3' : 'h-12'} rounded-[18px] border border-gray-200 bg-[#f8fafc] px-4 text-base text-gray-900`}
      />
    </View>
  );
}
