import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  BackHandler,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { getMe, submitPassengerIdentity, uploadFile } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

const DOCS = [
  { key: 'nationalIdFront', label: 'National ID front', subtitle: 'Front side of your ID card', icon: 'document-outline' },
  { key: 'nationalIdBack', label: 'National ID back', subtitle: 'Back side of your ID card', icon: 'document-outline' },
];

function chooseImageSource() {
  return new Promise((resolve) => {
    Alert.alert(
      'Upload document',
      'Use your camera or choose an existing photo from your gallery.',
      [
        { text: 'Take photo', onPress: () => resolve('camera') },
        { text: 'Choose from gallery', onPress: () => resolve('gallery') },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

export default function PassengerIdentityVerificationScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);

  const [loading, setLoading] = useState(true);
  const [identityLoadFailed, setIdentityLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [profile, setProfile] = useState(null);
  const [uris, setUris] = useState({
    nationalIdFront: null,
    nationalIdBack: null,
  });
  /** After successful submit — show alert before goBack; blocks auto goBack from pending state. */
  const pendingSubmitAlertRef = useRef(false);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!isFocused) return undefined;
    let active = true;

    const loadProfile = async () => {
      try {
        setLoading(true);
        setIdentityLoadFailed(false);
        const token = await getTokenRef.current();
        if (!token) throw new Error('Not signed in');
        const data = await getMe(token);
        if (!active) return;
        setProfile(data?.passengerIdentity || null);
      } catch (error) {
        if (!active) return;
        setIdentityLoadFailed(true);
        Alert.alert('Verification unavailable', error?.message || 'Could not load your ID verification details.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, [isFocused]);

  const status = profile?.status || 'not_submitted';
  const hasSubmittedDocs = !!(profile?.nationalIdFrontUrl || profile?.nationalIdBackUrl);
  const isRejected = status === 'rejected';
  const isBlocked = isRejected && profile?.canResubmit === false;
  const isApproved = status === 'approved';
  const isPending = status === 'pending' && hasSubmittedDocs;

  /** No leaving without submitting while ID is still required (rejected-with-resubmit counts as required). */
  const mustCompleteIdentity =
    !loading && !identityLoadFailed && !isApproved && !isBlocked && !isPending;

  useEffect(() => {
    if (!mustCompleteIdentity) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [mustCompleteIdentity]);

  useLayoutEffect(() => {
    navigation.setOptions({ gestureEnabled: !mustCompleteIdentity });
  }, [navigation, mustCompleteIdentity]);

  // Status lives under Account → Identity documents; no blocking "under review" screen here.
  useLayoutEffect(() => {
    if (!isPending || isBlocked) return;
    if (pendingSubmitAlertRef.current) return;
    navigation.goBack();
  }, [isPending, isBlocked, navigation]);

  const pickImage = async (key) => {
    try {
      const imagePicker = await import('expo-image-picker');
      const source = await chooseImageSource();
      if (!source) return;

      let result;
      if (source === 'camera') {
        const permission = await imagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera permission needed', 'Allow camera access to take a photo of your ID.');
          return;
        }
        result = await imagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.8,
        });
      } else {
        const permission = await imagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Gallery permission needed', 'Allow photo library access to choose an ID image from your gallery.');
          return;
        }
        result = await imagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets?.[0]) {
        setUris((prev) => ({ ...prev, [key]: result.assets[0].uri }));
      }
    } catch {
      Alert.alert('Error', 'Could not open the document picker');
    }
  };

  const uploadUri = async (token, uri) => {
    const formData = new FormData();
    formData.append('file', { uri, name: 'photo.jpg', type: 'image/jpeg' });
    const { url } = await uploadFile(token, formData);
    return url;
  };

  const handleSubmit = async () => {
    if (!uris.nationalIdFront || !uris.nationalIdBack) {
      Alert.alert('Missing documents', 'Please upload both the front and back of your national ID.');
      return;
    }

    setSubmitting(true);
    try {
      const token = await getTokenRef.current({ skipCache: true });
      if (!token) throw new Error('Not signed in');

      const [nationalIdFrontUrl, nationalIdBackUrl] = await Promise.all([
        uploadUri(token, uris.nationalIdFront),
        uploadUri(token, uris.nationalIdBack),
      ]);

      const data = await submitPassengerIdentity(token, { nationalIdFrontUrl, nationalIdBackUrl });
      setProfile(data?.passengerIdentity || null);
      setUris({ nationalIdFront: null, nationalIdBack: null });
      pendingSubmitAlertRef.current = true;
      let finishedAfterSubmit = false;
      const finishAfterSubmit = () => {
        if (finishedAfterSubmit) return;
        finishedAfterSubmit = true;
        pendingSubmitAlertRef.current = false;
        navigation.goBack();
      };
      Alert.alert(
        'Documents under review',
        'We are reviewing your ID submission. You will be notified when there is an update. Status is also shown under Account → Identity documents.',
        [{ text: 'OK', onPress: finishAfterSubmit }],
        { onDismiss: finishAfterSubmit }
      );
    } catch (error) {
      Alert.alert('Submit failed', error?.message || 'Could not submit your ID documents.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isPending && !isBlocked && !pendingSubmitAlertRef.current) {
    return <View className="flex-1 bg-[#f6f7f3]" />;
  }

  const statusTone = isApproved
    ? { bg: '#dcfce7', text: '#166534', label: 'Approved' }
    : isPending
      ? { bg: '#fef3c7', text: '#92400e', label: 'Sent for review' }
      : isRejected
        ? { bg: '#fee2e2', text: '#991b1b', label: 'Needs resubmission' }
        : { bg: '#e5e7eb', text: '#374151', label: 'Not submitted' };

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center justify-between bg-[#f6f7f3]"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 14 }}
      >
        {mustCompleteIdentity ? (
          <View className="h-10 w-10" />
        ) : (
          <TouchableOpacity onPress={() => navigation.goBack()} className="h-10 w-10 items-center justify-center rounded-full bg-white">
            <Ionicons name="chevron-back" size={22} color="#111827" />
          </TouchableOpacity>
        )}
        <Text className="text-[18px] font-bold text-gray-900">ID verification</Text>
        <View className="h-10 w-10" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
          <View className="mb-5 rounded-[28px] bg-white px-5 py-5">
            <Text className="text-[22px] font-bold text-gray-950">Verify your identity</Text>
            <Text className="mt-2 text-sm leading-6 text-gray-500">
              Upload the front and back of your national ID so support can review and confirm your passenger identity.
            </Text>

            <View className="mt-4 self-start rounded-full px-4 py-2" style={{ backgroundColor: statusTone.bg }}>
              <Text className="text-xs font-semibold uppercase tracking-[1.2px]" style={{ color: statusTone.text }}>
                {statusTone.label}
              </Text>
            </View>

            {profile?.rejectionReason ? (
              <View className="mt-4 rounded-[20px] bg-red-50 px-4 py-4">
                <Text className="text-sm font-semibold text-red-700">Why it was rejected</Text>
                <Text className="mt-1 text-sm leading-5 text-red-600">{profile.rejectionReason}</Text>
              </View>
            ) : null}
          </View>

          <View className="mb-5 rounded-[28px] bg-white px-5 py-5">
            <Text className="mb-3 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Documents</Text>

            {DOCS.map((doc) => {
              const localUri = uris[doc.key];
              const existingUrl = doc.key === 'nationalIdFront' ? profile?.nationalIdFrontUrl : profile?.nationalIdBackUrl;
              return (
                <View key={doc.key} className="mb-4 flex-row items-center rounded-[24px] border border-gray-200 bg-white px-4 py-4">
                  {localUri ? (
                    <Image source={{ uri: localUri }} className="mr-4 h-14 w-14 rounded-[16px]" />
                  ) : (
                    <View className="mr-4 h-14 w-14 items-center justify-center rounded-[16px] bg-[#f3f4f6]">
                      <Ionicons name={doc.icon} size={24} color="#374151" />
                    </View>
                  )}
                  <View className="flex-1">
                    <Text className="text-[15px] font-medium text-gray-900">{doc.label}</Text>
                    <Text className="mt-1 text-sm text-gray-500">
                      {localUri ? 'Image selected' : existingUrl ? 'Already uploaded' : doc.subtitle}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => pickImage(doc.key)}
                    disabled={isBlocked || submitting}
                    className="h-10 w-10 items-center justify-center rounded-full"
                    style={{ backgroundColor: isBlocked ? '#d1d5db' : PRIMARY_BLUE }}
                  >
                    <Ionicons name={existingUrl || localUri ? 'refresh' : 'add'} size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              );
            })}

            <View className="rounded-[20px] bg-[#f8fafc] px-4 py-4">
              <Text className="text-sm font-medium text-gray-900">Photo tips</Text>
              <Text className="mt-1 text-sm text-gray-500">Make sure all text is readable, there is no glare, and the full card is visible in the frame.</Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting || isBlocked}
            className="mb-3 h-12 items-center justify-center rounded-[20px]"
            style={{ backgroundColor: isBlocked ? '#d1d5db' : PRIMARY_BLUE, opacity: submitting ? 0.75 : 1 }}
          >
            {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-base font-bold text-white">Submit for review</Text>}
          </TouchableOpacity>

          {isBlocked ? (
            <Text className="text-center text-sm text-red-600">Resubmission is currently blocked. Please contact support.</Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
