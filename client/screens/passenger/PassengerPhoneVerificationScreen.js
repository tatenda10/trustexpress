import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import { useAuth } from '@clerk/clerk-expo';
import { confirmPhoneVerification, getMe } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

function normalizePhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  if (digits.startsWith('0')) return `+263${digits.slice(1)}`;
  if (digits.startsWith('263')) return `+${digits}`;
  return `+${digits}`;
}

export default function PassengerPhoneVerificationScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);

  const [loading, setLoading] = useState(true);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [currentPhone, setCurrentPhone] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [verificationStep, setVerificationStep] = useState('phone');
  const [verifyingPhone, setVerifyingPhone] = useState(false);

  const clearVerificationFlow = () => {
    setVerificationStep('phone');
    setConfirmation(null);
    setCode('');
  };

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

  const handleSendCode = async () => {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      Alert.alert('Invalid number', 'Enter a valid phone number like 077 123 4567.');
      return;
    }

    try {
      setVerifyingPhone(true);
      const nextConfirmation = await auth().signInWithPhoneNumber(normalizedPhone);
      setConfirmation(nextConfirmation);
      setVerificationStep('code');
      setCode('');
    } catch (error) {
      Alert.alert('Error', error?.message || 'Failed to send verification code.');
    } finally {
      setVerifyingPhone(false);
    }
  };

  const handleVerifyPhone = async () => {
    if (!confirmation || code.trim().length < 4) {
      Alert.alert('Enter code', 'Enter the SMS code we sent to your phone.');
      return;
    }

    try {
      setVerifyingPhone(true);
      await confirmation.confirm(code.trim());
      const firebaseUser = auth().currentUser;
      if (!firebaseUser) throw new Error('Verification failed');
      const firebaseIdToken = await firebaseUser.getIdToken();
      await auth().signOut();

      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      await confirmPhoneVerification(token, firebaseIdToken);
      const data = await getMe(token);
      setPhoneVerified(data?.phoneVerified === true);
      setCurrentPhone(data?.phone_number || '');
      setVerificationStep('phone');
      setConfirmation(null);
      setPhone('');
      setCode('');
      Alert.alert('Phone verified', 'Your phone number is now verified.');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Verification failed', error?.message || 'Invalid or expired code.');
    } finally {
      setVerifyingPhone(false);
    }
  };

  return (
    <View className="flex-1 bg-white">
      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        </View>
      ) : (
        <View className="flex-1" style={{ paddingTop: insets.top + 12 }}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingBottom: insets.bottom + 140 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text className="mt-6 text-[28px] font-bold leading-[34px] text-gray-950">
              {phoneVerified ? 'Your phone is verified' : verificationStep === 'code' ? 'Confirm your code' : 'Confirm your information'}
            </Text>

            {phoneVerified ? (
              <View className="mt-10 rounded-[24px] bg-[#f5f5f3] px-5 py-5">
                <Text className="text-sm font-medium text-gray-400">Verified phone</Text>
                <Text className="mt-2 text-[18px] font-semibold text-gray-950">
                  {currentPhone || 'Phone number verified'}
                </Text>
              </View>
            ) : verificationStep === 'phone' ? (
              <View className="mt-10">
                {currentPhone ? (
                  <View className="mb-6 rounded-[20px] bg-[#f5f5f3] px-4 py-4">
                    <Text className="text-sm font-medium text-gray-400">Current phone</Text>
                    <Text className="mt-1 text-[16px] font-medium text-gray-950">{currentPhone}</Text>
                  </View>
                ) : null}

                <View className="flex-row items-stretch">
                  <View className="mr-4 w-[98px] rounded-[18px] bg-[#f5f5f3] px-4 py-4">
                    <Text className="text-[28px]">🇿🇼</Text>
                    <Text className="mt-2 text-sm font-medium text-gray-700">+263</Text>
                  </View>

                  <View className="flex-1 rounded-[18px] border-[2px] border-black px-5 py-4">
                    <Text className="text-sm font-medium text-gray-400">Phone number</Text>
                    <TextInput
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="77 123 4567"
                      placeholderTextColor="#9ca3af"
                      keyboardType="phone-pad"
                      className="mt-2 text-[22px] font-medium text-gray-950"
                    />
                  </View>
                </View>
              </View>
            ) : (
              <View className="mt-10">
                <View className="rounded-[20px] bg-[#f5f5f3] px-4 py-4">
                  <Text className="text-sm font-medium text-gray-400">Sent to</Text>
                  <Text className="mt-1 text-[16px] font-medium text-gray-950">+263 {phone.trim()}</Text>
                </View>

                <View className="mt-5 rounded-[18px] border-[2px] border-black px-5 py-4">
                  <Text className="text-sm font-medium text-gray-400">Verification code</Text>
                  <TextInput
                    value={code}
                    onChangeText={setCode}
                    placeholder="Enter code"
                    placeholderTextColor="#9ca3af"
                    keyboardType="number-pad"
                    maxLength={6}
                    className="mt-2 text-[22px] font-medium tracking-[4px] text-gray-950"
                  />
                </View>

                <TouchableOpacity onPress={clearVerificationFlow} className="mt-4 self-start">
                  <Text className="text-sm font-medium" style={{ color: PRIMARY_BLUE }}>Use a different number</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          <View
            className="absolute bottom-0 left-0 right-0 bg-white px-5 pt-4"
            style={{ paddingBottom: Math.max(insets.bottom + 12, 24) }}
          >
            <View className="flex-row items-center justify-between">
              <TouchableOpacity
                onPress={() => {
                  if (phoneVerified || verificationStep === 'phone') navigation.goBack();
                  else clearVerificationFlow();
                }}
                className="h-18 w-18 items-center justify-center rounded-full bg-[#f5f5f3]"
                style={{ width: 72, height: 72 }}
              >
                <Ionicons name="arrow-back" size={28} color="#111827" />
              </TouchableOpacity>

              {!phoneVerified ? (
                <TouchableOpacity
                  onPress={verificationStep === 'phone' ? handleSendCode : handleVerifyPhone}
                  disabled={verifyingPhone}
                  className="h-18 flex-row items-center justify-center rounded-full bg-black px-8"
                  style={{ height: 72, opacity: verifyingPhone ? 0.7 : 1 }}
                >
                  {verifyingPhone ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Text className="text-[18px] font-semibold text-white">
                        {verificationStep === 'phone' ? 'Next' : 'Verify'}
                      </Text>
                      <Ionicons name="arrow-forward" size={24} color="#fff" style={{ marginLeft: 8 }} />
                    </>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
