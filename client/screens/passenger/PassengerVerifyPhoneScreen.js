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
import { useAuth, useUser } from '../../auth/AuthProvider';
import { confirmPhoneVerification } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import {
  isValidPhoneNumber,
  normalizePhoneNumber,
  sanitizePhoneInput,
} from '../../utils/phoneNumber';

const PassengerVerifyPhoneScreen = ({ navigation, route, onVerified, nextRouteName = null }) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { user } = useUser();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const countryCode = String(route?.params?.registrationCountryCode || user?.registrationCountryCode || '').toUpperCase() === 'ZA' ? 'ZA' : 'ZW';

  const canSend = isValidPhoneNumber(phone, countryCode);
  const handleVerify = async () => {
    const phoneResult = normalizePhoneNumber(phone, countryCode);
    if (!phoneResult.ok) {
      Alert.alert('Invalid number', phoneResult.error || 'Enter a valid mobile number.');
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await confirmPhoneVerification(token, phoneResult.e164Phone, countryCode);
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
          Add your {countryCode === 'ZA' ? 'South African' : 'Zimbabwean'} mobile number for ride updates and account security.
        </Text>

        <Text className="mb-2 mt-8 text-sm font-medium text-gray-700">Phone number</Text>
        <TextInput
          className="rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
          placeholder={countryCode === 'ZA' ? '+27712345678' : '0771234567'}
          placeholderTextColor="#9ca3af"
          value={phone}
          onChangeText={(value) => setPhone(sanitizePhoneInput(value, countryCode))}
          keyboardType="phone-pad"
          maxLength={countryCode === 'ZA' ? 12 : 10}
          editable={!loading}
        />
        {countryCode !== 'ZA' ? (
          <Text className="mt-2 text-xs text-gray-500">10 digits starting with 07.</Text>
        ) : null}
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
