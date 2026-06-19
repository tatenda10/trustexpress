import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { confirmPhoneVerification, getMe } from '../../api';
import { navigateToPassengerAccountMain } from '../../navigation/passengerNavigation';
import { PRIMARY_BLUE } from '../../constants/colors';

function normalizePhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  if (digits.startsWith('0')) return `+263${digits.slice(1)}`;
  if (digits.startsWith('263')) return `+${digits}`;
  if (digits.length === 9 && digits.startsWith('7')) return `+263${digits}`;
  return `+${digits}`;
}

export default function PassengerPhoneVerificationScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const isFocused = useIsFocused();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);

  const [loading, setLoading] = useState(true);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [currentPhone, setCurrentPhone] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!isFocused) return undefined;
    let active = true;

    const loadProfile = async () => {
      try {
        setLoading(true);
        const token = await getTokenRef.current();
        if (!token) throw new Error('Not signed in');
        const data = await getMe(token);
        if (!active) return;
        setPhoneVerified(data?.phoneVerified === true);
        setCurrentPhone(data?.phone_number || '');
      } catch (error) {
        if (!active) return;
        Alert.alert('Verification unavailable', error?.message || 'Could not load your phone verification status.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, [isFocused]);

  const handleVerifyPhone = async () => {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      Alert.alert('Invalid number', 'Enter a valid phone number like 077 123 4567.');
      return;
    }

    try {
      setSubmitting(true);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      await confirmPhoneVerification(token, normalizedPhone);
      const data = await getMe(token);
      setPhoneVerified(data?.phoneVerified === true);
      setCurrentPhone(data?.phone_number || normalizedPhone);
      setPhone('');
      Alert.alert('Phone saved', 'Your phone number has been saved on your account.');
      navigateToPassengerAccountMain(navigation);
    } catch (error) {
      Alert.alert('Verification failed', error?.message || 'Could not save your phone number right now.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoBack = () => {
    navigateToPassengerAccountMain(navigation);
  };

  const headline = phoneVerified ? 'Your phone is verified' : 'Confirm your information';
  const subtitle = phoneVerified
    ? 'Your number is already saved on your account for ride updates and security.'
    : 'Add your Zimbabwe mobile number so we can save it on your account for ride updates.';

  const scrollBottomPadding = Math.max(tabBarHeight + insets.bottom + 24, insets.bottom + 32);

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center justify-between bg-[#f6f7f3]"
        style={{
          paddingTop: insets.top + 6,
          paddingHorizontal: 20,
          paddingBottom: 14,
          zIndex: 20,
          elevation: 20,
        }}
      >
        <TouchableOpacity
          onPress={handleGoBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          className="h-10 min-w-[40px] flex-row items-center justify-center rounded-full border border-gray-200 bg-white px-2"
          accessibilityRole="button"
          accessibilityLabel="Back to account"
        >
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="flex-1 text-center text-[18px] font-bold text-gray-900">Phone verification</Text>
        <View className="h-10 w-10" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        </View>
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 12 : 0}
        >
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: scrollBottomPadding }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="rounded-[28px] bg-white px-5 py-5">
              <Text className="text-[22px] font-bold text-gray-950">{headline}</Text>
              <Text className="mt-2 text-sm leading-6 text-gray-500">{subtitle}</Text>

              {currentPhone ? (
                <View className="mt-5 rounded-[20px] bg-[#f8fafc] px-4 py-4">
                  <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">
                    {phoneVerified ? 'Saved phone' : 'Current phone'}
                  </Text>
                  <Text className="mt-2 text-[18px] font-semibold text-gray-950">{currentPhone}</Text>
                </View>
              ) : null}

              {!phoneVerified ? (
                <View className="mt-5">
                  <Text className="mb-2 text-sm font-medium text-gray-700">Phone number</Text>
                  <View className="flex-row items-stretch">
                    <View className="mr-3 w-[92px] items-center justify-center rounded-[18px] border border-gray-200 bg-[#f8fafc] px-3 py-3">
                      <Text className="text-lg">ZW</Text>
                      <Text className="mt-1 text-sm font-semibold text-gray-700">+263</Text>
                    </View>
                    <TextInput
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="77 123 4567"
                      placeholderTextColor="#9ca3af"
                      keyboardType="phone-pad"
                      editable={!submitting}
                      className="flex-1 rounded-[18px] border border-gray-200 bg-white px-4 py-3 text-lg font-medium text-gray-900"
                    />
                  </View>
                </View>
              ) : null}
            </View>

            {!phoneVerified ? (
              <TouchableOpacity
                onPress={handleVerifyPhone}
                disabled={submitting}
                className="mt-5 h-12 items-center justify-center rounded-[20px]"
                style={{ backgroundColor: PRIMARY_BLUE, opacity: submitting ? 0.75 : 1 }}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-base font-bold text-white">Save phone number</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
