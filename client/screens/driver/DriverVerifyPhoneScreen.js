import React, { useRef, useState } from 'react';
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
  InteractionManager,
} from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthProvider';
import { confirmPhoneVerification } from '../../api';
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
      // Do not refetch before this Alert: refetch updates App's driver stack `key` and remounts the
      // navigator, which invalidates this screen's `navigation` object.
      // After Continue: merge `phoneVerified` (confirm already succeeded), then root `reset` — survives
      // nested stack remounts; `navigation.replace` from this screen often no-ops on Android.
      continueHandledRef.current = false;
      const continueAfterVerify = () => {
        if (continueHandledRef.current) return;
        continueHandledRef.current = true;
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
            Alert.alert(
              'Could not refresh',
              'Your phone was verified, but we could not reload your driver profile. Tap Continue again to retry.',
            );
          }
        })();
      };
      Alert.alert('Phone verified', 'Your phone number was verified successfully.', [
        { text: 'Continue', onPress: continueAfterVerify },
      ], { onDismiss: continueAfterVerify });
    } catch (e) {
      Alert.alert('Error', e?.message || 'Invalid or expired code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-[#f6f7fb]"
    >
      <View
        className="items-center justify-center bg-white"
        style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 16 }}
      >
        <Text className="text-lg font-bold text-slate-950">Verify phone</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 24) }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="mt-5 rounded-3xl bg-white p-5">
          <View className="mb-5 h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
            <Ionicons name="phone-portrait-outline" size={24} color={PRIMARY_BLUE} />
          </View>
          <Text className="mb-2 text-2xl font-bold text-slate-950">Verify your phone</Text>
          <Text className="mb-6 text-sm leading-5 text-slate-500">
            We'll send a one-time code by SMS to secure your account and keep you updated about rides.
          </Text>
          <Text className="text-sm font-medium text-gray-700 mb-2">Phone number</Text>
          <View
            className="mb-1 h-14 flex-row items-center rounded-2xl bg-white"
            style={{ borderWidth: 1, borderColor: '#E5E7EB' }}
          >
            {countryCode === 'ZA' ? (
              <View className="h-full items-center justify-center px-4">
                <Text className="text-base font-semibold text-slate-700">+27</Text>
              </View>
            ) : null}
            <TextInput
              className="h-full flex-1 px-4 text-base text-slate-950"
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
          {countryCode !== 'ZA' ? (
            <Text className="text-xs text-gray-500 mb-4">10 digits starting with 07.</Text>
          ) : null}
          <TouchableOpacity
            className="mb-1 mt-4 flex-row items-center justify-center gap-2 rounded-2xl py-4"
            style={{ backgroundColor: canSend ? PRIMARY_BLUE : '#cbd5e1' }}
            onPress={handleVerify}
            disabled={loading || !canSend}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
        ) : (
            <>
              <Text className="text-lg font-semibold text-white">Verify</Text>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
            </>
          )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default DriverVerifyPhoneScreen;
