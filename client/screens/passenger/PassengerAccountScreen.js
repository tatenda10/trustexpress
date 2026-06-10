import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Image,
  Modal,
} from 'react-native';
import { useUser, useClerk, useAuth } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { deleteMe, getMe, resolveUploadedMediaUrl, updateMe, uploadFile } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

const PassengerAccountScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [phoneVisibleToDrivers, setPhoneVisibleToDrivers] = useState(false);
  const [updatingProfileImage, setUpdatingProfileImage] = useState(false);
  const [showProfileImagePreview, setShowProfileImagePreview] = useState(false);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!isFocused) return undefined;
    let active = true;

    const loadProfile = async () => {
      try {
        setLoading(true);
        setError('');
        const token = await getTokenRef.current();
        if (!token) throw new Error('Not signed in');
        const data = await getMe(token);
        if (!active) return;
        setProfile(data);
        setPhoneVisibleToDrivers(data?.settings?.phoneVisibleToDrivers === true);
      } catch (loadError) {
        if (!active) return;
        setError(loadError?.message || 'Could not load your account.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, [isFocused]);

  const handleTogglePhoneVisibility = async (nextValue) => {
    try {
      setSavingVisibility(true);
      setPhoneVisibleToDrivers(nextValue);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const data = await updateMe(token, { phoneVisibleToDrivers: nextValue });
      setProfile(data);
      setPhoneVisibleToDrivers(data?.settings?.phoneVisibleToDrivers === true);
    } catch (saveError) {
      setPhoneVisibleToDrivers((current) => !current);
      Alert.alert('Update failed', saveError?.message || 'Could not save this setting.');
    } finally {
      setSavingVisibility(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This permanently deletes your passenger account. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeleting(true);
              const token = await getTokenRef.current({ skipCache: true });
              if (!token) throw new Error('Not signed in');
              await deleteMe(token);
              await signOut();
            } catch (deleteError) {
              Alert.alert('Delete failed', deleteError?.message || 'Could not delete your account.');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const handleEmergencyCall = async (label, phoneNumber) => {
    try {
      const url = `tel:${phoneNumber}`;
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Call unavailable', `Calling ${label.toLowerCase()} is not available on this device right now.`);
        return;
      }

      Alert.alert(
        `Call ${label}`,
        `Do you want to call ${label} on ${phoneNumber}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Call', onPress: () => Linking.openURL(url) },
        ]
      );
    } catch {
      Alert.alert('Call unavailable', `Could not start a call to ${label.toLowerCase()} right now.`);
    }
  };

  const passengerName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.firstName || 'Passenger';
  const passengerEmail = profile?.email || user?.primaryEmailAddress?.emailAddress || 'No email connected';
  const appProfileImageUrl = resolveUploadedMediaUrl(profile?.privateMetadata?.profileImageUrl);
  const clerkFallbackImageUrl = String(user?.imageUrl || '').trim() || null;
  const displayProfileImageUrl =
    appProfileImageUrl ||
    resolveUploadedMediaUrl(profile?.image_url) ||
    clerkFallbackImageUrl ||
    null;
  const hasAppProfilePicture = !!appProfileImageUrl;
  const phoneVerified = profile?.phoneVerified === true;
  const passengerIdentity = profile?.passengerIdentity || null;
  const identityStatus = passengerIdentity?.status || 'not_submitted';
  const identityDocsSubmitted = !!(
    passengerIdentity?.nationalIdFrontUrl &&
    passengerIdentity?.nationalIdBackUrl
  );
  const identityApproved = identityStatus === 'approved' || identityStatus === 'verified';
  const identityPending = identityStatus === 'pending' && identityDocsSubmitted;
  const identityRejected = identityStatus === 'rejected';
  /** Full ID pack submitted and awaiting admin — same pattern as driver documentation row. */
  const identityAwaitingReviewOnly = identityPending;
  const verificationHeadline = phoneVerified ? 'Phone verified' : 'Verification in progress';
  const verificationTone = phoneVerified
    ? { bg: '#dcfce7', text: '#166534' }
    : { bg: '#fef3c7', text: '#92400e' };

  const verificationRows = [
    {
      key: 'phone',
      title: 'Phone verification',
      subtitle: phoneVerified ? 'Verified and ready for ride updates' : 'Add and verify your phone number',
      icon: 'call-outline',
      onPress: () => navigation.navigate('PassengerPhoneVerificationDetails'),
    },
    {
      key: 'identity',
      title: 'Identity documents',
      subtitle: identityApproved
        ? 'Approved'
        : identityPending
          ? 'Under review'
        : identityRejected
            ? 'Needs resubmission'
            : 'Upload selfie and national ID',
      icon: 'card-outline',
      identityReviewOnly: identityAwaitingReviewOnly,
      onPress: () => {
        if (identityAwaitingReviewOnly) {
          Alert.alert(
            'Documents under review',
            'We are reviewing your submission. You will be notified when there is an update. Status is also shown above on this screen.',
          );
          return;
        }
        navigation.navigate('PassengerIdentityVerification');
      },
    },
  ];

  const accountRows = [
    {
      key: 'profile',
      title: 'Profile details',
      subtitle: 'Update your first and last name',
      icon: 'person-outline',
      onPress: () => navigation.navigate('PassengerProfileDetails'),
    },
    {
      key: 'reviews',
      title: 'Reviews',
      subtitle: 'See what drivers said about you',
      icon: 'star-outline',
      onPress: () => navigation.navigate('PassengerReviews'),
    },
    {
      key: 'support',
      title: 'Support',
      subtitle: 'Chat with the support team',
      icon: 'headset-outline',
      onPress: () => navigation.navigate('PassengerSupportChat'),
    },
    {
      key: 'sharing',
      title: 'Phone sharing',
      subtitle: phoneVisibleToDrivers ? 'Drivers can see your phone number' : 'Drivers cannot see your phone number',
      icon: 'shield-outline',
    },
  ];

  const legalRows = [
    {
      key: 'privacy',
      title: 'Privacy policy',
      subtitle: 'See how TrustCars handles your data',
      icon: 'document-text-outline',
      onPress: () => navigation.navigate('PassengerLegalDocument', { document: 'privacy' }),
      danger: false,
    },
    {
      key: 'terms',
      title: 'Terms of use',
      subtitle: 'Review the rules for using the passenger app',
      icon: 'reader-outline',
      onPress: () => navigation.navigate('PassengerLegalDocument', { document: 'terms' }),
      danger: false,
    },
    {
      key: 'delete',
      title: 'Delete account',
      subtitle: 'Permanently remove your passenger account',
      icon: 'trash-outline',
      onPress: handleDeleteAccount,
      danger: true,
    },
  ];

  const safetyRows = [
    {
      key: 'police',
      title: 'Police emergency',
      subtitle: 'Call 995 for urgent police assistance',
      icon: 'shield-checkmark-outline',
      onPress: () => handleEmergencyCall('Police emergency', '995'),
    },
    {
      key: 'ambulance',
      title: 'Ambulance',
      subtitle: 'Call 994 for medical emergency help',
      icon: 'medkit-outline',
      onPress: () => handleEmergencyCall('Ambulance', '994'),
    },
    {
      key: 'fire',
      title: 'Fire brigade',
      subtitle: 'Call 993 for fire emergencies',
      icon: 'flame-outline',
      onPress: () => handleEmergencyCall('Fire brigade', '993'),
    },
  ];

  const handleChangeProfilePhoto = async () => {
    try {
      setUpdatingProfileImage(true);
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo library access to choose a profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      const token = await getTokenRef.current({ skipCache: true });
      if (!token) throw new Error('Not signed in');

      const formData = new FormData();
      formData.append('file', {
        uri: result.assets[0].uri,
        name: `passenger-profile-${Date.now()}.jpg`,
        type: 'image/jpeg',
      });

      const { url } = await uploadFile(token, formData);
      const nextProfile = await updateMe(token, { profileImageUrl: url });
      setProfile(nextProfile);
      Alert.alert('Profile updated', 'Your profile picture has been updated.');
    } catch (saveError) {
      Alert.alert('Update failed', saveError?.message || 'Could not update your profile picture.');
    } finally {
      setUpdatingProfileImage(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-[#f6f7f3]"
    >
      <View
        className="flex-row items-center justify-between bg-[#f6f7f3]"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 14 }}
      >
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => navigation?.getParent?.()?.navigate?.('PassengerHome')}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-[18px] font-bold text-gray-900">Account info</Text>
        <View className="h-10 w-10" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
          <Text className="mt-4 text-base text-gray-500">Loading your account...</Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 110 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View className="mb-4 rounded-[24px] bg-red-50 px-4 py-4">
              <Text className="text-base font-medium text-red-600">{error}</Text>
            </View>
          ) : null}

          <View className="items-center px-4 pb-6 pt-4">
            <View className="relative">
              <View className="h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-white">
                {displayProfileImageUrl ? (
                  <Image
                    source={{ uri: displayProfileImageUrl }}
                    style={{ width: 96, height: 96 }}
                    resizeMode="cover"
                  />
                ) : (
                  <Ionicons name="person" size={30} color="#374151" />
                )}
              </View>
              <TouchableOpacity
                className="absolute bottom-0 right-0 h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-[#1f2937]"
                activeOpacity={0.8}
                onPress={handleChangeProfilePhoto}
                disabled={updatingProfileImage}
              >
                {updatingProfileImage ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="camera" size={16} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => {
                if (hasAppProfilePicture) {
                  setShowProfileImagePreview(true);
                } else {
                  handleChangeProfilePhoto();
                }
              }}
              disabled={updatingProfileImage}
            >
              <Text className="mt-3 text-sm font-semibold text-[#2f73c9]">
                {hasAppProfilePicture ? 'View profile picture' : 'Add profile picture'}
              </Text>
            </TouchableOpacity>
            <Text className="mt-5 text-center text-[22px] font-bold text-gray-950">{passengerName}</Text>
            <View className="mt-3 rounded-full bg-white px-4 py-2">
              <Text className="text-sm font-medium text-gray-500">{passengerEmail}</Text>
            </View>
            <View className="mt-4 rounded-full px-4 py-2" style={{ backgroundColor: verificationTone.bg }}>
              <Text className="text-xs font-semibold uppercase tracking-[1.2px]" style={{ color: verificationTone.text }}>
                {verificationHeadline}
              </Text>
            </View>
          </View>

          <Text className="mb-3 px-1 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Verification</Text>
        <View className="mb-5 overflow-hidden rounded-[28px] bg-white">
            {verificationRows.map((row, index) => (
              <View key={row.key}>
              <TouchableOpacity key={row.key} className="px-5 py-4" activeOpacity={0.75} onPress={row.onPress}>
                <View className="flex-row items-center">
                  <View className="h-11 w-11 items-center justify-center rounded-full bg-[#f3f4f6]">
                    <Ionicons name={row.icon} size={22} color="#374151" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-[15px] font-medium text-gray-900">{row.title}</Text>
                    <Text
                      className={`mt-0.5 text-sm ${
                        row.key === 'identity'
                          ? identityApproved
                            ? 'text-green-600'
                            : identityPending
                              ? 'text-amber-600'
                              : identityRejected
                                ? 'text-red-600'
                                : 'text-gray-500'
                          : phoneVerified
                            ? 'text-green-600'
                            : 'text-gray-500'
                      }`}
                    >
                      {row.subtitle}
                    </Text>
                  </View>
                  {row.key === 'identity' ? (
                    identityApproved ? (
                      <View className="h-8 w-8 items-center justify-center rounded-full bg-green-100">
                        <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
                      </View>
                    ) : row.identityReviewOnly ? (
                      <Ionicons name="information-circle-outline" size={22} color="#9ca3af" />
                    ) : (
                      <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                    )
                  ) : phoneVerified ? (
                    <View className="h-8 w-8 items-center justify-center rounded-full bg-green-100">
                      <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                  )}
                </View>
              </TouchableOpacity>
              {index < verificationRows.length - 1 ? <View className="mx-5 bg-gray-100" style={{ height: 1 }} /> : null}
              </View>
            ))}
          </View>

          <Text className="mb-3 px-1 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Account</Text>
          <View className="mb-5 overflow-hidden rounded-[28px] bg-white">
            {accountRows.map((row, index) => (
              <View key={row.key}>
                <TouchableOpacity className="flex-row items-center px-5 py-4" activeOpacity={row.onPress ? 0.75 : 1} onPress={row.onPress}>
                  <View className="h-11 w-11 items-center justify-center rounded-full bg-[#f3f4f6]">
                    <Ionicons name={row.icon} size={22} color="#111827" />
                  </View>
                  <View className="ml-3 flex-1 pr-3">
                    <Text className="text-[15px] font-medium text-gray-900">{row.title}</Text>
                    <Text className="mt-0.5 text-sm text-gray-500">{row.subtitle}</Text>
                  </View>
                  {row.key === 'profile' || row.key === 'reviews' || row.key === 'support' ? (
                    <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                  ) : null}
                </TouchableOpacity>

                {row.key === 'sharing' ? (
                  <View className="px-5 pb-4">
                    <View className="flex-row items-center justify-between rounded-[20px] bg-[#f8fafc] px-4 py-4">
                      <View className="flex-1 pr-4">
                        <Text className="text-sm font-medium text-gray-900">Make phone visible to drivers</Text>
                        <Text className="mt-1 text-sm text-gray-500">
                          When enabled, drivers can see your phone number on new ride requests.
                        </Text>
                      </View>
                      {savingVisibility ? (
                        <ActivityIndicator size="small" color={PRIMARY_BLUE} />
                      ) : (
                        <Switch
                          value={phoneVisibleToDrivers}
                          onValueChange={handleTogglePhoneVisibility}
                          trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
                          thumbColor={phoneVisibleToDrivers ? PRIMARY_BLUE : '#f9fafb'}
                        />
                      )}
                    </View>
                  </View>
                ) : null}

                {index < accountRows.length - 1 ? (
                  <View className="mx-5 bg-gray-100" style={{ height: 1 }} />
                ) : null}
              </View>
            ))}
          </View>

          <Text className="mb-3 px-1 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Safety</Text>
          <View className="mb-5 overflow-hidden rounded-[28px] bg-white">
            {safetyRows.map((row, index) => (
              <TouchableOpacity
                key={row.key}
                className="flex-row items-center px-5 py-4"
                activeOpacity={0.75}
                onPress={row.onPress}
              >
                <View className="h-11 w-11 items-center justify-center rounded-full bg-[#f3f4f6]">
                  <Ionicons name={row.icon} size={22} color="#111827" />
                </View>
                <View className="ml-3 flex-1 pr-3">
                  <Text className="text-[15px] font-medium text-gray-900">{row.title}</Text>
                  <Text className="mt-0.5 text-sm text-gray-500">{row.subtitle}</Text>
                </View>
                <Ionicons name="call-outline" size={20} color="#9ca3af" />
                {index < safetyRows.length - 1 ? (
                  <View className="absolute bottom-0 left-20 right-5 bg-gray-100" style={{ height: 1 }} />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>

          <Text className="mb-3 px-1 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Legal</Text>
          <View className="mb-5 overflow-hidden rounded-[28px] bg-white">
            {legalRows.map((row, index) => (
              <TouchableOpacity
                key={row.key}
                className="flex-row items-center px-5 py-4"
                activeOpacity={0.75}
                onPress={row.onPress}
                disabled={row.danger && deleting}
              >
                <View className={`h-11 w-11 items-center justify-center rounded-full ${row.danger ? 'bg-red-50' : 'bg-[#f3f4f6]'}`}>
                  <Ionicons name={row.icon} size={22} color={row.danger ? '#dc2626' : '#111827'} />
                </View>
                <View className="ml-3 flex-1 pr-3">
                  <Text className={`text-[15px] font-medium ${row.danger ? 'text-red-600' : 'text-gray-900'}`}>{row.title}</Text>
                  <Text className="mt-0.5 text-sm text-gray-500">{row.subtitle}</Text>
                </View>
                {row.danger && deleting ? (
                  <ActivityIndicator size="small" color="#dc2626" />
                ) : (
                  <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                )}
                {index < legalRows.length - 1 ? (
                  <View className="absolute bottom-0 left-20 right-5 bg-gray-100" style={{ height: 1 }} />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            className="mb-4 flex-row items-center justify-center rounded-[24px] bg-white px-5 py-5"
            onPress={() => signOut()}
            activeOpacity={0.8}
          >
            <Ionicons name="log-out-outline" size={22} color="#dc2626" />
            <Text className="ml-3 text-base font-semibold text-red-600">Sign out</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
      <Modal
        visible={showProfileImagePreview}
        transparent
        animationType="fade"
        onRequestClose={() => setShowProfileImagePreview(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/90">
          <TouchableOpacity
            className="absolute right-6 top-14 h-10 w-10 items-center justify-center rounded-full bg-black/40"
            onPress={() => setShowProfileImagePreview(false)}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          {appProfileImageUrl ? (
            <Image
              source={{ uri: appProfileImageUrl }}
              style={{ width: 320, height: 320, borderRadius: 160 }}
              resizeMode="cover"
            />
          ) : null}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

export default PassengerAccountScreen;
