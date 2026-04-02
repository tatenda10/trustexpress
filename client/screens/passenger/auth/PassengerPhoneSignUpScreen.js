import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
} from 'react-native';
import { useSignUp } from '@clerk/clerk-expo';

const PassengerPhoneSignUpScreen = ({ navigation }) => {
  const { signUp, setActive, isLoaded } = useSignUp();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSendCode = async () => {
    if (!isLoaded) return;

    if (!phoneNumber) {
      Alert.alert('Error', 'Please enter your phone number');
      return;
    }

    setLoading(true);
    try {
      await signUp.create({
        phoneNumber: phoneNumber,
      });

      await signUp.preparePhoneNumberVerification({ strategy: 'phone_code' });
      setPendingVerification(true);
    } catch (error) {
      Alert.alert('Error', error.errors?.[0]?.message || 'Failed to send code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!isLoaded) return;

    if (!code) {
      Alert.alert('Error', 'Please enter the verification code');
      return;
    }

    setLoading(true);
    try {
      const completeSignUp = await signUp.attemptPhoneNumberVerification({
        code,
      });

      if (completeSignUp.status === 'complete') {
        await setActive({ session: completeSignUp.createdSessionId });
        navigation.navigate('PassengerHome');
      }
    } catch (error) {
      Alert.alert('Error', error.errors?.[0]?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ flex: 1, padding: 20 }}>
        <View className="mb-8 mt-5">
          <Text className="text-3xl font-bold text-gray-900 mb-2">Create Account</Text>
          <Text className="text-base text-gray-600">Sign up with your phone number</Text>
        </View>

        <View className="gap-4">
          {!pendingVerification ? (
            <>
              <TextInput
                className="border border-gray-300 rounded-xl p-4 text-base bg-gray-50"
                placeholder="+263 77 123 4567"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                keyboardType="phone-pad"
                autoComplete="tel"
              />

              <TouchableOpacity
                className={`bg-blue-500 p-4 rounded-xl items-center mt-2 ${loading ? 'opacity-60' : ''}`}
                onPress={handleSendCode}
                disabled={loading}
              >
                <Text className="text-white text-lg font-semibold">
                  {loading ? 'Sending Code...' : 'Send Verification Code'}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text className="text-sm text-gray-600 text-center mb-2">
                Enter the verification code sent to {phoneNumber}
              </Text>

              <TextInput
                className="border border-gray-300 rounded-xl p-4 text-base bg-gray-50"
                placeholder="6-digit code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
              />

              <TouchableOpacity
                className={`bg-blue-500 p-4 rounded-xl items-center mt-2 ${loading ? 'opacity-60' : ''}`}
                onPress={handleVerifyCode}
                disabled={loading}
              >
                <Text className="text-white text-lg font-semibold">
                  {loading ? 'Verifying...' : 'Verify Code'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="items-center p-4"
                onPress={() => {
                  setPendingVerification(false);
                  setCode('');
                }}
              >
                <Text className="text-blue-500 text-base">Change Phone Number</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default PassengerPhoneSignUpScreen;

