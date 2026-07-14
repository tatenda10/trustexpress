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
import { useAuth } from '@clerk/clerk-expo';
import { confirmPhoneVerification } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { useDriverStatus } from '../../context/DriverStatusContext';
import { navigationRef } from '../../navigationRef';
import {
  INVALID_LOCAL_PHONE_MESSAGE,
  isValidLocalPhoneNumber,
  normalizeZimbabwePhoneNumber,
  sanitizeLocalPhoneInput,
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
  if (needVehicle) return 'DriverRegisterCar';
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

const STEP_CURRENT = 5;
const STEP_TOTAL = 6;

const DriverVerifyPhoneScreen = () => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { driverStatus, refetchDriverStatus, patchDriverStatus } = useDriverStatus();
  const continueHandledRef = useRef(false);
  const driverStatusRef = useRef(driverStatus);
  driverStatusRef.current = driverStatus;

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
      className="flex-1 bg-white"
    >
      <View
        className="items-center justify-center border-b border-gray-100 bg-white"
        style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 14 }}
      >
        <Text className="text-lg font-bold text-gray-900">Verify phone</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 24) }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-sm font-semibold text-gray-500 mt-4">STEP {STEP_CURRENT} OF {STEP_TOTAL}</Text>
        <View className="flex-row items-center gap-2 mt-2 mb-1">
          <View className="flex-1 flex-row gap-1 h-2 rounded-full bg-gray-200 overflow-hidden">
            {Array.from({ length: STEP_TOTAL }).map((_, i) => (
              <View
                key={i}
                className="flex-1 rounded-full"
                style={{ backgroundColor: i < STEP_CURRENT ? PRIMARY_BLUE : '#e5e7eb' }}
              />
            ))}
          </View>
          <Text className="text-sm text-gray-400">Phone</Text>
        </View>

        <Text className="text-2xl font-bold text-gray-900 mt-6 mb-2">Verify your phone number</Text>
        <Text className="text-sm text-gray-600 mb-6">
          We'll send a one-time code by SMS. Use it to confirm your number for ride notifications and account security.
        </Text>
        <>
          <Text className="text-sm font-medium text-gray-700 mb-2">Phone number</Text>
          <TextInput
            className="border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 mb-1"
            placeholder="0771234567"
            placeholderTextColor="#9ca3af"
            value={phone}
            onChangeText={(value) => setPhone(sanitizeLocalPhoneInput(value))}
            keyboardType="phone-pad"
            maxLength={10}
            autoCapitalize="none"
            editable={!loading}
          />
          <Text className="text-xs text-gray-500 mb-4">10 digits starting with 07.</Text>
          <TouchableOpacity
            className="flex-row items-center justify-center gap-2 py-4 rounded-xl mb-2"
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
        </>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default DriverVerifyPhoneScreen;
