import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
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
  const continueHandledRef = useRef(false);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [verificationComplete, setVerificationComplete] = useState(false);
  const countryCode = String(route?.params?.registrationCountryCode || user?.registrationCountryCode || '').toUpperCase() === 'ZA' ? 'ZA' : 'ZW';

  const updatePhone = (value) => {
    if (countryCode !== 'ZA') {
      setPhone(sanitizePhoneInput(value, countryCode));
      return;
    }
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('27')) digits = digits.slice(2);
    if (digits.startsWith('0')) digits = digits.slice(1);
    setPhone(digits.slice(0, 9));
  };

  const canSend = isValidPhoneNumber(phone, countryCode);
  const continueAfterVerify = () => {
    if (continueHandledRef.current) return;
    continueHandledRef.current = true;
    setVerificationComplete(false);
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
  };

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
      continueHandledRef.current = false;
      setVerificationComplete(true);
    } catch (error) {
      Alert.alert('Error', error?.message || 'Could not verify phone number right now.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-white">
      <Modal
        visible={verificationComplete}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="relative w-full overflow-hidden rounded-[30px] bg-white px-6 pb-6 pt-10">
            <Text className="absolute left-5 top-5 text-4xl">🎈</Text>
            <Text className="absolute right-5 top-8 text-3xl">🎈</Text>
            <Text className="absolute left-12 top-28 text-2xl">🎉</Text>
            <Text className="absolute right-10 top-32 text-2xl">✨</Text>
            <View className="self-center rounded-full bg-emerald-100 p-3">
              <View className="h-20 w-20 items-center justify-center rounded-full bg-emerald-500">
                <Ionicons name="checkmark" size={48} color="#fff" />
              </View>
            </View>
            <Text className="mt-6 text-center text-[26px] font-extrabold text-slate-950">Verification complete!</Text>
            <Text className="mt-3 text-center text-sm leading-6 text-slate-600">
              Your phone number has been verified successfully. You can now continue setting up your account.
            </Text>
            <TouchableOpacity
              className="mt-7 h-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: PRIMARY_BLUE }}
              onPress={continueAfterVerify}
            >
              <Text className="text-base font-bold text-white">Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 28, paddingBottom: 130 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-[28px] font-extrabold leading-8 text-slate-950">Verify your phone number</Text>
        <Text className="mt-3 text-sm leading-5 text-slate-600">
          Confirm your {countryCode === 'ZA' ? 'South African' : 'Zimbabwean'} mobile number to continue setting up your account.
        </Text>

        <Text className="mb-1 mt-7 text-xs font-medium text-gray-800">Your phone number</Text>
        <View
          className="h-14 flex-row items-center bg-white"
          style={{ borderWidth: 1, borderColor: '#D7DDE5' }}
        >
          <View className="h-full flex-row items-center border-r border-gray-200 px-3">
            <Text className="mr-2 text-base">{countryCode === 'ZA' ? '🇿🇦' : '🇿🇼'}</Text>
            <Text className="text-sm font-semibold text-slate-700">{countryCode === 'ZA' ? '+27' : '+263'}</Text>
          </View>
          <TextInput
            className="h-full flex-1 px-3 text-base text-slate-950"
            placeholder={countryCode === 'ZA' ? '712345678' : '0771234567'}
            placeholderTextColor="#9ca3af"
            value={phone}
            onChangeText={updatePhone}
            keyboardType="phone-pad"
            maxLength={countryCode === 'ZA' ? 9 : 10}
            autoCapitalize="none"
            underlineColorAndroid="transparent"
            editable={!loading}
          />
        </View>
      </ScrollView>

      <KeyboardStickyView
        offset={{ closed: 0, opened: -8 }}
        style={{
          backgroundColor: '#fff',
          borderTopColor: '#f3f4f6',
          borderTopWidth: 1,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 14),
        }}
      >
        <TouchableOpacity
          className="h-14 items-center justify-center rounded-sm"
          style={{ backgroundColor: PRIMARY_BLUE, opacity: loading || !canSend ? 0.7 : 1 }}
          onPress={handleVerify}
          disabled={loading || !canSend}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-base font-bold text-white">Verify phone</Text>
          )}
        </TouchableOpacity>
      </KeyboardStickyView>
    </View>
  );
};

export default PassengerVerifyPhoneScreen;
