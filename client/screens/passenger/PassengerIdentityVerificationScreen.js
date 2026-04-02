import React, { useEffect, useRef, useState } from 'react';
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

function showSuccessMessage(message) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  Alert.alert('Success', message);
}

export default function PassengerIdentityVerificationScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [profile, setProfile] = useState(null);
  const [uris, setUris] = useState({
    nationalIdFront: null,
    nationalIdBack: null,
  });

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
        setProfile(data?.passengerIdentity || null);
      } catch (error) {
        if (!active) return;
        Alert.alert('Verification unavailable', error?.message || 'Could not load your ID verification details.');
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

  const pickImage = async (key) => {
    try {
      const imagePicker = await import('expo-image-picker');
      const result = await imagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets?.[0]) {
        setUris((prev) => ({ ...prev, [key]: result.assets[0].uri }));
      }
    } catch {
      Alert.alert('Error', 'Could not open image picker');
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
      showSuccessMessage('Passenger ID documents submitted for review.');
    } catch (error) {
      Alert.alert('Submit failed', error?.message || 'Could not submit your ID documents.');
    } finally {
      setSubmitting(false);
    }
  };

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
        <TouchableOpacity onPress={() => navigation.goBack()} className="h-10 w-10 items-center justify-center rounded-full bg-white">
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
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
