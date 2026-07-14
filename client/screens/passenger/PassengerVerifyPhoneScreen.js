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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { confirmPhoneVerification } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import {
  INVALID_LOCAL_PHONE_MESSAGE,
  isValidLocalPhoneNumber,
  normalizeZimbabwePhoneNumber,
  sanitizeLocalPhoneInput,
} from '../../utils/phoneNumber';

const PassengerVerifyPhoneScreen = ({ navigation, onVerified, nextRouteName = null }) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const canSend = isValidLocalPhoneNumber(phone);
  const handleVerify = async () => {
    const phoneResult = normalizeZimbabwePhoneNumber(phone);
    if (!phoneResult.ok) {
      Alert.alert('Invalid number', phoneResult.error || INVALID_LOCAL_PHONE_MESSAGE);
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await confirmPhoneVerification(token, phoneResult.e164Phone);
      Alert.alert('Phone saved', 'Your phone number has been saved on your account.', [
        {
          text: 'Continue',
          onPress: () => {
            void (async () => {
              try {
                await onVerified?.();
              } finally {
                if (nextRouteName) {
                  navigation.replace(nextRouteName);
                } else if (navigation?.canGoBack?.()) {
                  navigation.goBack();
                } else {
                  navigation.replace('PassengerTabs');
                }
              }
            })();
          },
        },
      ]);
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
        <Text className="mt-8 text-3xl font-bold text-gray-900">Add your phone number</Text>
        <Text className="mt-3 text-base leading-7 text-gray-500">
          Add your Zimbabwe mobile number for ride updates and account security.
        </Text>

        <Text className="mb-2 mt-8 text-sm font-medium text-gray-700">Phone number</Text>
        <TextInput
          className="rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
          placeholder="0771234567"
          placeholderTextColor="#9ca3af"
          value={phone}
          onChangeText={(value) => setPhone(sanitizeLocalPhoneInput(value))}
          keyboardType="phone-pad"
          maxLength={10}
          editable={!loading}
        />
        <Text className="mt-2 text-xs text-gray-500">10 digits starting with 07.</Text>
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
            <Text className="text-lg font-bold text-white">Save phone number</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

export default PassengerVerifyPhoneScreen;
