import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ToastAndroid,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { submitDriverDocuments, uploadFile } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { useDriverStatus } from '../../context/DriverStatusContext';

export const DRIVER_SKIP_ONBOARDING_KEY = 'trust_express_driver_skip_onboarding';
export const DRIVER_SKIP_ENHANCED_SELFIE_KEY = 'trust_express_driver_skip_enhanced_selfie';

const STEP_CURRENT = 4;
const STEP_TOTAL = 6;

const DOCS = [
  { key: 'driverLicence', label: "Driver's License", subtitle: 'Front and back sides', icon: 'id-card-outline' },
  { key: 'nationalIdFront', label: 'National ID (front)', subtitle: 'Identity document', icon: 'id-card-outline' },
  { key: 'nationalIdBack', label: 'National ID (back)', subtitle: 'Back side', icon: 'id-card-outline' },
  { key: 'selfie', label: 'Identity verification', subtitle: 'Clear selfie', icon: 'person-outline' },
  { key: 'selfieWithIdCard', label: 'Selfie with national ID', subtitle: 'Hold your national ID next to your face', icon: 'camera-outline' },
];

function askCropPreference() {
  return new Promise((resolve) => {
    Alert.alert(
      'Photo option',
      'Keep the original image size or crop it before upload?',
      [
        { text: 'Original (Recommended)', onPress: () => resolve(false) },
        { text: 'Crop', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

function showSuccessMessage(message) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  Alert.alert('Success', message);
}

function formatUploadErrorMessage(error, fallback) {
  const apiMessage = String(
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    ''
  ).trim();

  if (!apiMessage) return fallback;
  return apiMessage;
}

export default function DriverUploadDocumentsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { driverStatus: contextDriverStatus, refetchDriverStatus } = useDriverStatus();
  const driverStatus = contextDriverStatus ?? route.params?.driverStatus ?? null;
  const profile = driverStatus?.driverProfile;
  const vehicle = driverStatus?.vehicle;
  const profileApproved = String(profile?.status || '').trim().toLowerCase() === 'approved'
    || String(profile?.status || '').trim().toLowerCase() === 'verified';
  const vehicleApproved = String(vehicle?.status || '').trim().toLowerCase() === 'approved'
    || String(vehicle?.status || '').trim().toLowerCase() === 'verified';
  const enhancedSelfieOnly = route.params?.enhancedSelfieOnly === true
    || (profileApproved && !profile?.selfieWithIdCardUrl);

  const [uris, setUris] = useState({
    nationalIdFront: null,
    nationalIdBack: null,
    driverLicence: null,
    selfie: null,
    selfieWithIdCard: null,
  });
  const [loading, setLoading] = useState(false);

  const hasSubmittedDocs = !!(
    profile?.driverLicenceUrl ||
    profile?.nationalIdFrontUrl ||
    profile?.nationalIdBackUrl ||
    profile?.selfieUrl ||
    profile?.selfieWithIdCardUrl
  );
  const isPending = hasSubmittedDocs && profile?.status === 'pending';
  const isRejected = profile?.status === 'rejected';
  const isBlocked = isRejected && profile?.canResubmit === false;
  const hasAtLeastOneDoc = enhancedSelfieOnly ? !!uris.selfieWithIdCard : Object.values(uris).some(Boolean);
  const docsToRender = DOCS;

  useEffect(() => {
    if (profileApproved && vehicleApproved) {
      navigation.replace('DriverTabs');
    }
  }, [navigation, profileApproved, vehicleApproved]);

  const getExistingDocUrl = (key) => {
    if (key === 'driverLicence') return profile?.driverLicenceUrl || null;
    if (key === 'nationalIdFront') return profile?.nationalIdFrontUrl || null;
    if (key === 'nationalIdBack') return profile?.nationalIdBackUrl || null;
    if (key === 'selfie') return profile?.selfieUrl || null;
    if (key === 'selfieWithIdCard') return profile?.selfieWithIdCardUrl || null;
    return null;
  };

  const handleSkip = async () => {
    try {
      const key = enhancedSelfieOnly ? DRIVER_SKIP_ENHANCED_SELFIE_KEY : DRIVER_SKIP_ONBOARDING_KEY;
      await AsyncStorage.setItem(key, 'true');
      navigation.replace('DriverTabs');
    } catch {}
  };

  const pickImage = async (key) => {
    try {
      const imagePicker = await import('expo-image-picker');
      const allowsEditing = await askCropPreference();
      let result;

      if (key === 'selfie' || key === 'selfieWithIdCard') {
        const permission = await imagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            'Camera permission needed',
            key === 'selfieWithIdCard'
              ? 'Allow camera access to take a selfie while holding your national ID.'
              : 'Allow camera access to take your identity selfie.',
          );
          return;
        }
        result = await imagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing,
          cameraType: imagePicker.CameraType.front,
          quality: 0.8,
        });
      } else {
        result = await imagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing,
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets?.[0]) {
        setUris((prev) => ({ ...prev, [key]: result.assets[0].uri }));
      }
    } catch {
      Alert.alert('Error', key === 'selfie' || key === 'selfieWithIdCard' ? 'Could not open camera' : 'Could not open image picker');
    }
  };

  const uploadUri = async (token, uri, label) => {
    const formData = new FormData();
    formData.append('file', { uri, name: 'photo.jpg', type: 'image/jpeg' });
    try {
      const { url } = await uploadFile(token, formData);
      console.log('[DriverUploadDocumentsScreen] upload success', { label, url });
      return url;
    } catch (error) {
      console.log('[DriverUploadDocumentsScreen] upload failed', {
        label,
        uri,
        error: error?.message || null,
        apiError: error?.response?.data || null,
      });
      throw new Error(formatUploadErrorMessage(error, `${label} upload failed. Please try again.`));
    }
  };

  const handleSubmit = async () => {
    if (!hasAtLeastOneDoc) {
      Alert.alert('Add a document', 'Upload the required document before submitting.');
      return;
    }

    const { nationalIdFront, nationalIdBack, driverLicence, selfie, selfieWithIdCard } = uris;
    if (enhancedSelfieOnly) {
      if (!selfieWithIdCard) {
        Alert.alert('Missing selfie', 'Please take a selfie while holding your national ID.');
        return;
      }
    } else if (!nationalIdFront || !nationalIdBack || !driverLicence || !selfie || !selfieWithIdCard) {
      Alert.alert('Missing documents', 'Please upload all five required identity documents.');
      return;
    }

    setLoading(true);
    try {
      const token = await getToken({ skipCache: true });
      if (!token) throw new Error('Not signed in');

      if (enhancedSelfieOnly) {
        const selfieWithIdCardUrl = await uploadUri(token, selfieWithIdCard, 'Selfie with national ID');
        try {
          await submitDriverDocuments(token, { selfieWithIdCardUrl });
        } catch (error) {
          console.log('[DriverUploadDocumentsScreen] submit documents failed', {
            mode: 'enhancedSelfieOnly',
            error: error?.message || null,
            apiError: error?.response?.data || null,
          });
          throw new Error(formatUploadErrorMessage(error, 'Could not submit your selfie with national ID. Please try again.'));
        }
      } else {
        const nationalIdFrontUrl = await uploadUri(token, nationalIdFront, 'National ID front');
        const nationalIdBackUrl = await uploadUri(token, nationalIdBack, 'National ID back');
        const driverLicenceUrl = await uploadUri(token, driverLicence, "Driver's license");
        const selfieUrl = await uploadUri(token, selfie, 'Selfie');
        const selfieWithIdCardUrl = await uploadUri(token, selfieWithIdCard, 'Selfie with national ID');

        try {
          await submitDriverDocuments(token, {
            nationalIdFrontUrl,
            nationalIdBackUrl,
            driverLicenceUrl,
            selfieUrl,
            selfieWithIdCardUrl,
          });
        } catch (error) {
          console.log('[DriverUploadDocumentsScreen] submit documents failed', {
            mode: 'full',
            error: error?.message || null,
            apiError: error?.response?.data || null,
            payload: {
              nationalIdFrontUrl,
              nationalIdBackUrl,
              driverLicenceUrl,
              selfieUrl,
              selfieWithIdCardUrl,
            },
          });
          throw new Error(formatUploadErrorMessage(error, 'Could not submit your documents for verification. Please try again.'));
        }
      }

      await refetchDriverStatus();

      showSuccessMessage(
        enhancedSelfieOnly
          ? 'Selfie with national ID submitted successfully.'
          : 'Documents submitted successfully for review.',
      );

      if (enhancedSelfieOnly) {
        await AsyncStorage.removeItem(DRIVER_SKIP_ENHANCED_SELFIE_KEY).catch(() => {});
        navigation.replace('DriverTabs');
      }
    } catch (error) {
      Alert.alert('Error', error?.message || 'Failed to submit');
    } finally {
      setLoading(false);
    }
  };

  if (isPending && !enhancedSelfieOnly) {
    return (
      <View className="flex-1 bg-white">
        <View style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12 }}>
          <View className="h-10 w-10" />
        </View>
        <View className="flex-1 px-5 justify-center items-center">
          <Ionicons name="time-outline" size={64} color={PRIMARY_BLUE} />
          <Text className="mt-4 text-xl font-bold text-gray-900">Under review</Text>
          <Text className="mt-2 text-center text-gray-600">Your documents are being verified. We&apos;ll notify you once approved.</Text>
          {/*
          <TouchableOpacity className="mt-6 py-3" onPress={handleSkip}>
            <Text className="text-base text-gray-500">Skip to dashboard</Text>
          </TouchableOpacity>
          */}
        </View>
      </View>
    );
  }

  if (isBlocked) {
    return (
      <View className="flex-1 bg-white">
        <View style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12 }}>
          <View className="h-10 w-10" />
        </View>
        <View className="flex-1 px-5 justify-center items-center">
          <Ionicons name="lock-closed-outline" size={64} color="#6b7280" />
          <Text className="mt-4 text-xl font-bold text-gray-900">Resubmission not allowed</Text>
          <Text className="mt-2 px-4 text-center text-gray-600">
            You are not allowed to resubmit documents. Please contact support if you believe this is an error.
          </Text>
          {profile?.rejectionReason ? (
            <View className="mt-4 mx-4 rounded-xl bg-red-50 p-3">
              <Text className="text-sm font-medium text-red-800">Reason</Text>
              <Text className="mt-1 text-sm text-red-700">{profile.rejectionReason}</Text>
            </View>
          ) : null}
          {/*
          <TouchableOpacity className="mt-6 py-3" onPress={handleSkip}>
            <Text className="text-base text-gray-500">Back to dashboard</Text>
          </TouchableOpacity>
          */}
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <View
        className="flex-row items-center justify-between border-b border-gray-100 bg-white"
        style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12 }}
      >
        <View className="h-10 w-10" />
        <Text className="text-lg font-bold text-gray-900">Registration</Text>
        <TouchableOpacity className="p-2">
          <Ionicons name="help-circle-outline" size={24} color="#6b7280" />
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 24) }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="mt-4 text-sm font-semibold text-gray-500">STEP {STEP_CURRENT} OF {STEP_TOTAL}</Text>
        <View className="mt-2 mb-1 flex-row items-center gap-2">
          <View className="h-2 flex-1 flex-row gap-1 overflow-hidden rounded-full bg-gray-200">
            {Array.from({ length: STEP_TOTAL }).map((_, i) => (
              <View
                key={i}
                className="flex-1 rounded-full"
                style={{ backgroundColor: i < STEP_CURRENT ? PRIMARY_BLUE : '#e5e7eb' }}
              />
            ))}
          </View>
          <Text className="text-sm text-gray-400">Documents</Text>
        </View>

        <Text className="mt-6 mb-2 text-2xl font-bold text-gray-900">
          {enhancedSelfieOnly ? 'Take a selfie with your national ID' : 'Upload Documents'}
        </Text>
        <Text className="mb-4 text-sm text-gray-600">
          {enhancedSelfieOnly
            ? 'Hold your national ID next to your face and take a clear selfie so we can strengthen driver authenticity.'
            : 'Valid documentation is required for passenger safety. Please upload clear photos where all text is readable.'}
        </Text>

        {enhancedSelfieOnly ? (
          <View className="mb-4 rounded-xl bg-amber-50 px-4 py-3">
            <Text className="text-sm font-semibold text-amber-900">One thing left</Text>
            <Text className="mt-1 text-sm leading-5 text-amber-800">
              Your other identity documents are already uploaded. The only missing item is your selfie with your national ID.
            </Text>
          </View>
        ) : null}

        <View className="mb-6 rounded-xl p-4" style={{ backgroundColor: '#EFF6FF' }}>
          <View className="mb-2 flex-row items-center gap-2">
            <Ionicons name="information-circle" size={20} color={PRIMARY_BLUE} />
            <Text className="text-sm font-semibold text-gray-900">Requirements for photos:</Text>
          </View>
          <Text className="ml-6 text-sm text-gray-600">- All four corners must be visible</Text>
          <Text className="ml-6 text-sm text-gray-600">- No camera flash glares or shadows</Text>
          <Text className="ml-6 text-sm text-gray-600">- Text must be sharp and legible</Text>
          {enhancedSelfieOnly ? (
            <Text className="ml-6 text-sm text-gray-600">- Your face and national ID must both be clearly visible</Text>
          ) : null}
        </View>

        {isRejected && profile?.rejectionReason ? (
          <View className="mb-4 rounded-xl bg-red-50 p-3">
            <Text className="font-medium text-red-700">Rejected</Text>
            <Text className="mt-1 text-sm text-red-600">{profile.rejectionReason}</Text>
          </View>
        ) : null}

        {docsToRender.map(({ key, label, subtitle, icon }) => (
          <View key={key} className="mb-4 flex-row items-center rounded-2xl border border-gray-200 bg-white p-4">
            {uris[key] ? (
              <Image source={{ uri: uris[key] }} className="mr-4 h-12 w-12 rounded-xl" />
            ) : (
              <View className="mr-4 h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: '#EFF6FF' }}>
                <Ionicons name={icon} size={24} color={PRIMARY_BLUE} />
              </View>
            )}

            <View className="flex-1">
              <Text className="text-base font-semibold text-gray-900">{label}</Text>
              <Text className="mt-0.5 text-sm text-gray-500">
                {uris[key]
                  ? ((key === 'selfie' || key === 'selfieWithIdCard') ? 'Selfie captured' : 'Image selected')
                  : getExistingDocUrl(key)
                    ? 'Already uploaded'
                    : subtitle}
              </Text>
            </View>

            {enhancedSelfieOnly && key !== 'selfieWithIdCard' ? (
              <View className="h-10 w-10 items-center justify-center rounded-full bg-green-50">
                <Ionicons name="checkmark" size={20} color="#16a34a" />
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => pickImage(key)}
                className="h-10 w-10 items-center justify-center rounded-full"
                style={{ backgroundColor: PRIMARY_BLUE }}
              >
                <Ionicons name={key === 'selfie' || key === 'selfieWithIdCard' ? 'camera' : 'add'} size={22} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        ))}

        <View className="my-4 flex-row items-center justify-center gap-2">
          <Ionicons name="lock-closed-outline" size={16} color="#9ca3af" />
          <Text className="text-xs font-medium uppercase tracking-wide text-gray-400">Encrypted & Secure</Text>
        </View>

        <TouchableOpacity
          className={`mb-2 flex-row items-center justify-center gap-2 rounded-xl py-4 ${!hasAtLeastOneDoc ? 'opacity-60' : ''}`}
          style={{ backgroundColor: '#EFF6FF' }}
          onPress={handleSubmit}
          disabled={loading || !hasAtLeastOneDoc}
        >
          {loading ? (
            <ActivityIndicator size="small" color={PRIMARY_BLUE} />
          ) : (
            <>
              <Text className="text-lg font-semibold" style={{ color: PRIMARY_BLUE }}>
                {enhancedSelfieOnly ? 'Submit selfie' : 'Submit for Verification'}
              </Text>
              <Ionicons name="arrow-forward" size={20} color={PRIMARY_BLUE} />
            </>
          )}
        </TouchableOpacity>

        <Text className="mb-2 text-center text-xs text-gray-400">Reviewing usually takes less than 24 hours.</Text>

        {/*
        <TouchableOpacity className="items-center py-3" onPress={handleSkip}>
          <Text className="text-base text-gray-500">Skip for now</Text>
        </TouchableOpacity>
        */}
      </ScrollView>
    </View>
  );
}
