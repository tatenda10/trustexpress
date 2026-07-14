import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
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
import { useDriverStatus } from '../../context/DriverStatusContext';
import {
  INVALID_LOCAL_PHONE_MESSAGE,
  isValidLocalPhoneNumber,
  normalizeZimbabwePhoneNumber,
  sanitizeLocalPhoneInput,
} from '../../utils/phoneNumber';

const DriverPhoneVerificationPage = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { driverStatus: contextDriverStatus, refetchDriverStatus } = useDriverStatus();
  const driverStatus = contextDriverStatus ?? route.params?.driverStatus ?? null;
  const phoneVerified = driverStatus?.phoneVerified === true;

  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSend = isValidLocalPhoneNumber(phone);

  const handleVerify = async () => {
    const phoneResult = normalizeZimbabwePhoneNumber(phone);
    if (!phoneResult.ok) {
      Alert.alert('Invalid number', phoneResult.error || INVALID_LOCAL_PHONE_MESSAGE);
      return;
    }

    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await confirmPhoneVerification(token, phoneResult.e164Phone);
      await refetchDriverStatus?.();
      Alert.alert('Phone verified', 'Your phone number was verified successfully.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      Alert.alert('Verification failed', error?.message || 'Could not verify your phone number right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-white"
    >
      <View
        className="flex-row items-center border-b border-gray-100 bg-white"
        style={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 12 }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <Text className="ml-2 text-lg font-bold text-gray-900">Phone verification</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom + 24, 40) }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center py-8">
          {phoneVerified ? (
            <View className="mb-4 h-20 w-20 items-center justify-center rounded-full bg-green-100">
              <Ionicons name="checkmark-circle" size={48} color="#16a34a" />
            </View>
          ) : (
            <View className="mb-4 h-20 w-20 items-center justify-center rounded-full bg-amber-100">
              <Ionicons name="phone-portrait-outline" size={40} color="#d97706" />
            </View>
          )}
          <Text className="mb-1 text-xl font-semibold text-gray-900">
            {phoneVerified ? 'Verified' : 'Verify your phone'}
          </Text>
          <Text className="px-4 text-center text-sm text-gray-500">
            {phoneVerified
              ? 'Your phone number is already verified for ride alerts and account security.'
              : 'Add and verify your phone number here without leaving account settings.'}
          </Text>
        </View>

        {!phoneVerified ? (
          <>
            <Text className="mb-2 text-sm font-medium text-gray-700">Phone number</Text>
            <TextInput
              className="mb-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
              placeholder="0771234567"
              placeholderTextColor="#9ca3af"
              value={phone}
              onChangeText={(value) => setPhone(sanitizeLocalPhoneInput(value))}
              keyboardType="phone-pad"
              maxLength={10}
              autoCapitalize="none"
              editable={!submitting}
            />
            <Text className="mb-4 text-xs text-gray-500">10 digits starting with 07.</Text>

            <TouchableOpacity
              className="items-center justify-center rounded-[16px] py-4"
              style={{ backgroundColor: canSend && !submitting ? PRIMARY_BLUE : '#93c5fd' }}
              onPress={handleVerify}
              disabled={!canSend || submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-base font-bold text-white">Verify phone</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            className="items-center justify-center rounded-[16px] py-4"
            style={{ backgroundColor: PRIMARY_BLUE }}
            onPress={() => navigation.goBack()}
          >
            <Text className="text-base font-bold text-white">Done</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default DriverPhoneVerificationPage;
