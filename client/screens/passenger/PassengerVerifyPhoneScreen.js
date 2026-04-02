import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { confirmPhoneVerification } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

function normalizePhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  if (digits.startsWith('0')) return `+263${digits.slice(1)}`;
  if (digits.startsWith('263')) return `+${digits}`;
  return `+${digits}`;
}

const PassengerVerifyPhoneScreen = ({ onVerified, onSkip }) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const normalizedPhone = normalizePhone(phone);
  const canSend = !!normalizedPhone;
  const handleVerify = async () => {
    if (!canSend) {
      Alert.alert('Invalid number', 'Enter a valid phone number like 077 123 4567.');
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await confirmPhoneVerification(token, normalizedPhone);
      onVerified?.();
    } catch (error) {
      Alert.alert('Error', error?.message || 'Could not verify phone number right now.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-white">
      <View
        className="items-center border-b border-gray-100 bg-white px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        <Text className="text-lg font-bold text-gray-900">Verify phone</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom + 140, 180) }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text className="mt-8 text-3xl font-bold text-gray-900">Verify your phone number</Text>
        <Text className="mt-3 text-base leading-7 text-gray-500">
          Add a verified number for ride updates and easier contact. You can skip this for now and we will ask again next time.
        </Text>

        <Text className="mb-2 mt-8 text-sm font-medium text-gray-700">Phone number</Text>
        <View className="flex-row items-stretch">
          <TouchableOpacity
            activeOpacity={0.85}
            className="mr-3 w-[148px] rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"
          >
            <View className="flex-row items-center justify-between">
              <Text className="text-sm text-gray-700">+263</Text>
              <Ionicons name="chevron-down" size={16} color="#6b7280" />
            </View>
          </TouchableOpacity>
          <TextInput
            className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
            placeholder="77 123 4567"
            placeholderTextColor="#9ca3af"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            editable={!loading}
          />
        </View>
      </ScrollView>

      <View
        className="absolute bottom-0 left-0 right-0 bg-white px-5 pt-4"
        style={{ paddingBottom: Math.max(insets.bottom + 14, 24) }}
      >
        <TouchableOpacity
          className="h-14 items-center justify-center rounded-lg"
          style={{ backgroundColor: canSend ? PRIMARY_BLUE : '#cbd5e1' }}
          onPress={handleVerify}
          disabled={loading || !canSend}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-lg font-bold text-white">Verify phone</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity className="mt-4 items-center py-2" onPress={onSkip} disabled={loading}>
          <Text className="text-base text-gray-500">Skip for now</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

export default PassengerVerifyPhoneScreen;
