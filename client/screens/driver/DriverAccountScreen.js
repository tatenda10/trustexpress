import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Image, Linking, Modal } from 'react-native';
import { useUser, useClerk, useAuth } from '@clerk/clerk-expo';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { deleteMe, getApiUrl, getMe, resolveUploadedMediaUrl, updateMe, uploadFile } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { useDriverStatus } from '../../context/DriverStatusContext';

const DriverAccountScreen = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { driverStatus: contextDriverStatus, refetchDriverStatus } = useDriverStatus();
  const { getToken } = useAuth();

  const [driverStatus, setDriverStatus] = useState(contextDriverStatus ?? route.params?.driverStatus ?? null);
  const [loading, setLoading] = useState(contextDriverStatus == null);
  const [averageRating, setAverageRating] = useState(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [updatingProfileImage, setUpdatingProfileImage] = useState(false);
  const [showProfileImagePreview, setShowProfileImagePreview] = useState(false);

  const refetchRef = useRef(refetchDriverStatus);
  refetchRef.current = refetchDriverStatus;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    if (contextDriverStatus !== undefined) {
      setDriverStatus(contextDriverStatus ?? null);
      setLoading(false);
    }
  }, [contextDriverStatus]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      const timeoutId = setTimeout(() => {
        if (!active) return;
        setLoading(false);
      }, 8000);

      refetchRef.current()
        .then((latestStatus) => {
          if (!active) return;
          setDriverStatus(latestStatus ?? null);
        })
        .catch(() => {
          if (!active) return;
          setDriverStatus(null);
        })
        .finally(() => {
          if (!active) return;
          clearTimeout(timeoutId);
          setLoading(false);
        });

      getTokenRef.current()
        .then((token) => {
          if (!token || !active) return null;
          return getMe(token);
        })
        .then((profile) => {
          if (!active || !profile) return;
          setProfileData(profile);
        })
        .catch(() => {
          if (!active) return;
          setProfileData(null);
        });

      return () => {
        active = false;
        clearTimeout(timeoutId);
      };
    }, [])
  );

  useEffect(() => {
    let cancelled = false;

    const loadRatingSummary = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const { getApiUrl } = require('../../api');
        const res = await fetch(getApiUrl('/api/drivers/history?page=1&limit=1'), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const summary = data?.summary || {};
        setAverageRating(
          summary.averageRating === null || summary.averageRating === undefined
            ? null
            : Number(summary.averageRating)
        );
        setRatingCount(Number(summary.ratingCount || 0));
      } catch {
        if (cancelled) return;
        setAverageRating(null);
        setRatingCount(0);
      }
    };

    loadRatingSummary();

    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This permanently deletes your driver account. This action cannot be undone.',
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

  const phoneVerified = driverStatus?.phoneVerified === true;
  const profile = driverStatus?.driverProfile;
  const vehicle = driverStatus?.vehicle;
  const hasSubmittedProfileDocs = !!(
    profile?.driverLicenceUrl ||
    profile?.nationalIdFrontUrl ||
    profile?.nationalIdBackUrl ||
    profile?.selfieUrl ||
    profile?.selfieWithIdCardUrl
  );
  const missingProfileDocCount = [
    profile?.driverLicenceUrl,
    profile?.nationalIdFrontUrl,
    profile?.nationalIdBackUrl,
    profile?.selfieUrl,
    profile?.selfieWithIdCardUrl,
  ].filter((value) => !value).length;
  const onlyEnhancedSelfieMissing = !!(
    profile?.driverLicenceUrl &&
    profile?.nationalIdFrontUrl &&
    profile?.nationalIdBackUrl &&
    profile?.selfieUrl &&
    !profile?.selfieWithIdCardUrl
  );
  const docsSubtitle = !hasSubmittedProfileDocs
    ? 'Not submitted'
    : onlyEnhancedSelfieMissing
      ? 'Selfie with national ID left'
    : profile?.status === 'approved'
      ? missingProfileDocCount > 0
        ? `${missingProfileDocCount} document${missingProfileDocCount === 1 ? '' : 's'} still missing`
        : 'Approved'
      : profile?.status === 'pending'
        ? missingProfileDocCount > 0
          ? 'Partially submitted'
          : 'Under review'
        : profile?.status === 'rejected'
          ? 'Needs resubmission'
          : 'Uploaded';
  const profileApproved = ['approved', 'verified'].includes(String(profile?.status || '').trim().toLowerCase());
  const vehicleApproved = ['approved', 'verified'].includes(String(vehicle?.status || '').trim().toLowerCase());

  const allVerified = phoneVerified && profileApproved && vehicleApproved;
  const driverName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.firstName || 'Driver';
  const driverEmail = user?.primaryEmailAddress?.emailAddress || 'No email connected';
  // API merges Clerk OAuth avatar into `image_url`; only `privateMetadata.profileImageUrl` is an in-app upload.
  const appProfileImageUrl = resolveUploadedMediaUrl(profileData?.privateMetadata?.profileImageUrl);
  const clerkFallback = String(user?.imageUrl || '').trim();
  const displayProfileImageUrl =
    appProfileImageUrl ||
    resolveUploadedMediaUrl(profileData?.image_url) ||
    clerkFallback ||
    null;
  const hasAppProfilePicture = !!appProfileImageUrl;

  const verificationHeadline = allVerified ? 'Ready to drive' : 'Verification in progress';
  const verificationTone = allVerified
    ? { bg: '#dcfce7', text: '#166534' }
    : { bg: '#fef3c7', text: '#92400e' };

  /** Full identity pack submitted and awaiting admin — no separate documentation screen. */
  const documentationAwaitingReviewOnly =
    profile?.status === 'pending' && hasSubmittedProfileDocs && missingProfileDocCount === 0;

  const vehicleRegistrationAwaitingReviewOnly = vehicle?.status === 'pending';
  const handleCarRegistrationPress = () => {
    if (vehicleApproved) {
      Alert.alert(
        'Change car?',
        'Changing your car will submit the new vehicle for admin review. You will be taken offline and cannot go online again until the new car is approved.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Continue',
            onPress: () => {
              const rootNavigation = navigation.getParent()?.getParent();
              if (rootNavigation?.navigate) {
                rootNavigation.navigate('DriverRegisterCar', { driverStatus, changeVehicle: true });
              } else {
                navigation.navigate('DriverCarRegistration', { driverStatus, changeVehicle: true });
              }
            },
          },
        ],
      );
      return;
    }
    if (vehicleRegistrationAwaitingReviewOnly) {
      Alert.alert(
        'Vehicle under review',
        'We are reviewing your registration. You will be notified when there is an update. Status is also shown above on this screen.',
      );
      return;
    }
    navigation.navigate('DriverCarRegistration', { driverStatus });
  };

  const verificationRows = [
    {
      key: 'phone',
      title: 'Phone number verification',
      subtitle: phoneVerified ? 'Verified' : 'Not yet verified',
      verified: phoneVerified,
      screen: 'DriverPhoneVerification',
      icon: 'phone-portrait-outline',
    },
    {
      key: 'docs',
      title: 'Documentation',
      subtitle: docsSubtitle,
      verified: profile?.status === 'approved' || onlyEnhancedSelfieMissing,
      icon: 'document-text-outline',
      documentationReviewOnly: documentationAwaitingReviewOnly,
      onPress: () => {
        if (profileApproved) {
          Alert.alert(
            'Document approved',
            'Your documents are approved.',
          );
          return;
        }
        if (documentationAwaitingReviewOnly) {
          Alert.alert(
            'Documents under review',
            'We are reviewing your submission. You will be notified when there is an update. Status is also shown above on this screen.',
          );
          return;
        }
        navigation.navigate('DriverDocumentation', { driverStatus });
      },
    },
    {
      key: 'car',
      title: 'Car registration',
      subtitle: !vehicle ? 'Not registered' : vehicle.status === 'approved' ? 'Verified · Tap to change car' : vehicle.status === 'pending' ? 'Under review' : 'Rejected',
      verified: vehicle?.status === 'approved',
      icon: 'car-outline',
      changeableWhenVerified: vehicle?.status === 'approved',
      vehicleRegistrationReviewOnly: vehicleRegistrationAwaitingReviewOnly,
      onPress: handleCarRegistrationPress,
    },
  ];

  // const accountRows = [
  //   {
  //     key: 'docs',
  //     title: 'Documentation',
  //     subtitle: profileApproved ? 'Approved and active' : 'Submit or update your verification documents',
  //     icon: 'document-outline',
  //     onPress: () => navigation.getParent()?.getParent()?.navigate?.('DriverUploadDocuments'),
  //     rightText: profileApproved ? 'Done' : null,
  //   },
  //   {
  //     key: 'vehicle',
  //     title: 'Car registration',
  //     subtitle: vehicleApproved ? 'Vehicle verified for trips' : 'Update your car and tier details',
  //     icon: 'car-outline',
  //     onPress: () => navigation.navigate('DriverCarRegistration', { driverStatus }),
  //     rightText: vehicleApproved ? 'Done' : null,
  //   },
  // ];

  const supportRows = [
    {
      key: 'reviews',
      title: 'Reviews',
      subtitle: ratingCount > 0 ? `${ratingCount} passenger review${ratingCount === 1 ? '' : 's'}` : 'See what passengers said about you',
      icon: 'star-outline',
      onPress: () => navigation.navigate('DriverReviews'),
      danger: false,
    },
    {
      key: 'support',
      title: 'Support',
      subtitle: 'Chat with the support team',
      icon: 'headset-outline',
      onPress: () => navigation.navigate('DriverSupportChat'),
      danger: false,
    },
    {
      key: 'privacy',
      title: 'Privacy policy',
      subtitle: 'See how TrustCars handles your data',
      icon: 'shield-outline',
      onPress: () => navigation.navigate('DriverLegalDocument', { document: 'privacy' }),
      danger: false,
    },
    {
      key: 'terms',
      title: 'Terms of use',
      subtitle: 'Review the rules for using the driver app',
      icon: 'document-text-outline',
      onPress: () => navigation.navigate('DriverLegalDocument', { document: 'terms' }),
      danger: false,
    },
    {
      key: 'delete',
      title: 'Delete account',
      subtitle: 'Permanently remove your driver account',
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
        name: `driver-profile-${Date.now()}.jpg`,
        type: 'image/jpeg',
      });

      const { url } = await uploadFile(token, formData);
      const nextProfile = await updateMe(token, { profileImageUrl: url });
      setProfileData(nextProfile);
      Alert.alert('Profile updated', 'Your profile picture has been updated.');
    } catch (error) {
      Alert.alert('Update failed', error?.message || 'Could not update your profile picture.');
    } finally {
      setUpdatingProfileImage(false);
    }
  };

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center justify-between bg-[#f6f7f3]"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 14 }}
      >
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => navigation.getParent()?.navigate?.('DriverHome')}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-[18px] font-bold text-gray-900">Account info</Text>
        <View className="h-10 w-10" />
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center px-4 pb-6 pt-2">
          <View className="relative">
            <View className="h-[108px] w-[108px] items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[#e8f1ff] shadow-sm">
              {displayProfileImageUrl ? (
                <Image
                  source={{ uri: displayProfileImageUrl }}
                  style={{ width: 108, height: 108 }}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="person" size={36} color="#1f2937" />
              )}
            </View>
            {allVerified ? (
              <View className="absolute right-1 top-1 h-4 w-4 rounded-full border-2 border-white bg-[#25D366]" />
            ) : null}
            <TouchableOpacity
              className="absolute bottom-0 right-0 h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-[#1f2937]"
              activeOpacity={0.8}
              onPress={handleChangeProfilePhoto}
              disabled={updatingProfileImage}
            >
              {updatingProfileImage ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="camera" size={18} color="#fff" />
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
          <Text className="mt-5 text-center text-[22px] font-bold text-gray-950">{driverName}</Text>
          {averageRating !== null ? (
            <View className="mt-2 flex-row items-center rounded-full bg-white px-3 py-1.5">
              <Ionicons name="star" size={14} color="#f59e0b" />
              <Text className="ml-1 text-sm font-semibold text-gray-700">{averageRating.toFixed(1)}</Text>
              <Text className="ml-1 text-sm text-gray-400">({ratingCount})</Text>
            </View>
          ) : null}
          <View className="mt-3 rounded-full bg-white px-4 py-2">
            <Text className="text-sm font-medium text-gray-500">{driverEmail}</Text>
          </View>
          <View className="mt-4 rounded-full px-4 py-2" style={{ backgroundColor: verificationTone.bg }}>
            <Text
              className="text-xs font-semibold uppercase tracking-[1.2px]"
              style={{ color: verificationTone.text }}
            >
              {verificationHeadline}
            </Text>
          </View>
        </View>

        <Text className="mb-3 px-1 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Verification</Text>
        <View className="mb-5 overflow-hidden rounded-[28px] bg-white">
          {loading ? (
            <View className="items-center py-8">
              <ActivityIndicator size="small" color={PRIMARY_BLUE} />
            </View>
          ) : (
            <>
              {verificationRows.map((row) => (
                <TouchableOpacity
                  key={row.key}
                  className="flex-row items-center px-5 py-4"
                  onPress={() => {
                    if (row.onPress) {
                      row.onPress();
                      return;
                    }
                    navigation.navigate(row.screen, { driverStatus });
                  }}
                  activeOpacity={0.7}
                >
                  <View className="h-11 w-11 items-center justify-center rounded-full bg-[#f3f4f6]">
                    <Ionicons name={row.icon} size={22} color="#374151" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-[15px] font-medium text-gray-900">{row.title}</Text>
                    <Text className={`mt-0.5 text-sm ${row.verified ? 'text-green-600' : 'text-gray-500'}`}>{row.subtitle}</Text>
                  </View>
                  {row.changeableWhenVerified ? (
                    <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                  ) : row.verified ? (
                    <View className="h-8 w-8 items-center justify-center rounded-full bg-green-100">
                      <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
                    </View>
                  ) : row.documentationReviewOnly || row.vehicleRegistrationReviewOnly ? (
                    <Ionicons name="information-circle-outline" size={22} color="#9ca3af" />
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                  )}
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>

        {/* <Text className="mb-3 px-1 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Account</Text>
        <View className="mb-5 overflow-hidden rounded-[28px] bg-white">
          {accountRows.map((row, index) => (
            <TouchableOpacity
              key={row.key}
              className="flex-row items-center px-5 py-4"
              activeOpacity={0.75}
              onPress={row.onPress}
              disabled={row.danger && deleting}
            >
              <View className="h-11 w-11 items-center justify-center rounded-full bg-[#f3f4f6]">
                <Ionicons name={row.icon} size={22} color="#111827" />
              </View>
              <View className="ml-3 flex-1 pr-3">
                <Text className="text-[15px] font-medium text-gray-900">{row.title}</Text>
                <Text className="mt-0.5 text-sm text-gray-500">{row.subtitle}</Text>
              </View>
              {row.rightText ? <Text className="mr-2 text-sm font-medium text-gray-400">{row.rightText}</Text> : null}
              {row.danger && deleting ? (
                <ActivityIndicator size="small" color="#dc2626" />
              ) : (
                <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
              )}
              {index < accountRows.length - 1 ? (
                <View className="absolute bottom-0 left-20 right-5 bg-gray-100" style={{ height: 1 }} />
              ) : null}
            </TouchableOpacity>
          ))}
        </View> */}

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
          {supportRows.map((row, index) => (
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
              {index < supportRows.length - 1 ? (
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

      <Modal
        visible={showProfileImagePreview}
        transparent
        animationType="fade"
        onRequestClose={() => setShowProfileImagePreview(false)}
      >
        <View className="flex-1 bg-black/90 items-center justify-center">
          <TouchableOpacity
            className="absolute top-14 right-6 h-10 w-10 items-center justify-center rounded-full bg-black/40"
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
    </View>
  );
};

export default DriverAccountScreen;
