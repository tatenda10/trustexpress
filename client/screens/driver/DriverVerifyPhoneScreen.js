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
  InteractionManager,
} from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthProvider';
import { confirmPhoneVerification, requestPhoneVerificationCode } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { getDriverVehicleRoute } from '../../constants/driverKind';
import { useDriverStatus } from '../../context/DriverStatusContext';
import { navigationRef } from '../../navigationRef';
import {
  isValidPhoneNumber,
  normalizePhoneNumber,
  sanitizePhoneInput,
} from '../../utils/phoneNumber';

export const DRIVER_SKIP_PHONE_VERIFY_KEY = 'trust_express_driver_skip_phone_verify';

/** Mirrors `App.js` driver onboarding: next stack screen after phone is verified. */
function getNextDriverOnboardingRouteAfterPhoneVerified(driverMe) {
  if (!driverMe || typeof driverMe !== 'object') return 'DriverTabs';
  const profile = driverMe.driverProfile;
  const vehicle = driverMe.vehicle;
  const profileStatus = String(profile?.status || '').trim().toLowerCase();
  const profileApproved = profileStatus === 'approved' || profileStatus === 'verified';
  const vehicleStatus = String(vehicle?.status || '').trim().toLowerCase();
  const vehicleApproved = vehicleStatus === 'approved' || vehicleStatus === 'verified';
  const needDriverEnhancedSelfie = profileApproved && !vehicleApproved && !profile?.selfieWithIdCardUrl;
  const hasDriverSubmittedIdentityDocs = !!(
    profile &&
    (profile.nationalIdFrontUrl ||
      profile.nationalIdBackUrl ||
      profile.driverLicenceUrl ||
      profile.selfieUrl ||
      profile.selfieWithIdCardUrl)
  );
  const identityAwaitingAdminReview =
    !!profile && profileStatus === 'pending' && hasDriverSubmittedIdentityDocs;
  const needDriverDocumentUpload =
    !profile ||
    (!profileApproved &&
      !identityAwaitingAdminReview &&
      (profileStatus === 'rejected' ||
        profileStatus === 'not_submitted' ||
        !String(profileStatus || '').trim() ||
        !hasDriverSubmittedIdentityDocs));
  const needVehicle =
    profileApproved &&
    (!vehicle || (!vehicleApproved && vehicleStatus !== 'pending'));
  if (needDriverEnhancedSelfie) return 'DriverEnhancedSelfie';
  if (needDriverDocumentUpload) return 'DriverUploadDocuments';
  if (needVehicle) return getDriverVehicleRoute(driverMe, driverMe?.driverProfile?.driverKind);
  return 'DriverTabs';
}

function resetRootToDriverRoute(routeName) {
  if (!navigationRef.isReady()) return;
  try {
    navigationRef.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: routeName }],
      }),
    );
  } catch {
    // Root may still be swapping Auth/App — ignore.
  }
}

const DriverVerifyPhoneScreen = () => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { driverStatus, refetchDriverStatus, patchDriverStatus } = useDriverStatus();
  const continueHandledRef = useRef(false);
  const driverStatusRef = useRef(driverStatus);
  driverStatusRef.current = driverStatus;

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentPhone, setSentPhone] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationComplete, setVerificationComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const countryCode = String(driverStatus?.registrationCountryCode || driverStatus?.driverProfile?.registrationCountryCode || '').toUpperCase() === 'ZA' ? 'ZA' : 'ZW';

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
  const canVerify = /^\d{6}$/.test(code.trim());

  const continueAfterVerify = () => {
    if (continueHandledRef.current) return;
    continueHandledRef.current = true;
    setVerificationComplete(false);
    void (async () => {
      try {
        const latest = await refetchDriverStatus();
        patchDriverStatus({ phoneVerified: true });
        const snap = driverStatusRef.current && typeof driverStatusRef.current === 'object' ? driverStatusRef.current : {};
        const merged = { ...snap, ...(latest && typeof latest === 'object' ? latest : {}), phoneVerified: true };
        const next = getNextDriverOnboardingRouteAfterPhoneVerified(merged);
        InteractionManager.runAfterInteractions(() => {
          requestAnimationFrame(() => resetRootToDriverRoute(next));
        });
      } catch {
        continueHandledRef.current = false;
        setVerificationComplete(true);
        Alert.alert(
          'Could not refresh',
          'Your phone was verified, but we could not reload your driver profile. Tap Continue again to retry.',
        );
      }
    })();
  };

  const handleSendCode = async () => {
    const phoneResult = normalizePhoneNumber(phone, countryCode);
    if (!phoneResult.ok) {
      Alert.alert('Invalid number', phoneResult.error || 'Enter a valid mobile number.');
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      if (countryCode === 'ZA') {
        await confirmPhoneVerification(token, phoneResult.e164Phone, countryCode);
        setSentPhone(phoneResult.e164Phone);
        continueHandledRef.current = false;
        setVerificationComplete(true);
        return;
      }
      await requestPhoneVerificationCode(
        token,
        phoneResult.e164Phone,
        countryCode,
        'sms',
      );
      setSentPhone(phoneResult.e164Phone);
      setVerificationSent(true);
      setCode('');
    } catch (error) {
      Alert.alert(
        countryCode === 'ZA' ? 'Verification failed' : 'Code not sent',
        error?.message || (countryCode === 'ZA'
          ? 'Could not verify your phone number. Please try again.'
          : 'Could not send the verification code. Please try again.'),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!sentPhone || !canVerify) {
      Alert.alert('Enter code', 'Enter the 6-digit code sent to your phone.');
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await confirmPhoneVerification(token, sentPhone, countryCode, code.trim());
      continueHandledRef.current = false;
      setVerificationComplete(true);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Invalid or expired code');
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
              Your phone number has been verified successfully. You can now continue your registration.
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
        <View>
          <Text className="text-[28px] font-extrabold leading-8 text-slate-950">
            {verificationSent
              ? 'Enter your verification code'
              : countryCode === 'ZA'
                ? 'Verify your phone number'
                : 'Verify your phone number with code'}
          </Text>
          <Text className="mt-3 text-sm leading-5 text-slate-600">
            {verificationSent
              ? `Enter the 6-digit code sent to ${sentPhone}.`
              : countryCode === 'ZA'
                ? 'Confirm your South African mobile number to continue your registration.'
                : `We'll send you a code. It helps keep your account secure.`}
          </Text>

          {!verificationSent ? (
            <>
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
            </>
          ) : (
            <>
              <Text className="mb-1 mt-7 text-xs font-medium text-gray-800">Verification code</Text>
              <TextInput
                className="h-14 bg-white px-3 text-lg tracking-[5px] text-slate-950"
                style={{ borderWidth: 1, borderColor: '#D7DDE5' }}
                placeholder="000000"
                placeholderTextColor="#9ca3af"
                value={code}
                onChangeText={(value) => setCode(String(value || '').replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                editable={!loading}
              />
              <View className="mt-4 flex-row items-center">
                <TouchableOpacity
                  onPress={() => {
                    setVerificationSent(false);
                    setCode('');
                  }}
                  disabled={loading}
                >
                  <Text className="text-sm font-semibold" style={{ color: PRIMARY_BLUE }}>Change number</Text>
                </TouchableOpacity>
                <Text className="mx-3 text-gray-300">|</Text>
                <TouchableOpacity onPress={handleSendCode} disabled={loading}>
                  <Text className="text-sm font-semibold" style={{ color: PRIMARY_BLUE }}>Resend code</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
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
            style={{ backgroundColor: PRIMARY_BLUE, opacity: loading || (verificationSent ? !canVerify : !canSend) ? 0.7 : 1 }}
            onPress={verificationSent ? handleVerify : handleSendCode}
            disabled={loading || (verificationSent ? !canVerify : !canSend)}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-base font-bold text-white">
                {verificationSent ? 'Verify code' : countryCode === 'ZA' ? 'Verify phone' : 'Send code'}
              </Text>
            )}
          </TouchableOpacity>
      </KeyboardStickyView>
    </View>
  );
};

export default DriverVerifyPhoneScreen;
