import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Image, Linking, Modal } from 'react-native';
import { useUser, useClerk, useAuth } from '../../auth/AuthProvider';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { deleteMe, getApiUrl, getMe, resolveUploadedMediaUrl, updateMe, uploadFile } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import BiometricSignInSetting from '../../components/BiometricSignInSetting';
import { getDriverVehicleRoute, isTruckDriver } from '../../constants/driverKind';
import { useDriverStatus } from '../../context/DriverStatusContext';

const STATUS_TONES = {
  done: { bg: '#dcfce7', text: '#166534', label: 'Verified' },
  review: { bg: '#e0ecff', text: '#1d4ed8', label: 'Under review' },
  action: { bg: '#fef3c7', text: '#92400e', label: 'Action needed' },
  rejected: { bg: '#fee2e2', text: '#b91c1c', label: 'Resubmit' },
};

function SectionTitle({ children }) {
  return (
    <Text className="mb-2 mt-1 px-1 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">{children}</Text>
  );
}

function StatusPill({ tone }) {
  const colors = STATUS_TONES[tone] || STATUS_TONES.action;
  return (
    <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: colors.bg }}>
      <Text className="text-[11px] font-semibold" style={{ color: colors.text }}>{colors.label}</Text>
    </View>
  );
}

function Row({ icon, title, subtitle, onPress, right, danger, disabled, last, iconColor }) {
  return (
    <TouchableOpacity
      className="flex-row items-center px-4 py-3.5"
      activeOpacity={0.7}
      onPress={onPress}
      disabled={disabled}
    >
      <View className={`h-10 w-10 items-center justify-center rounded-2xl ${danger ? 'bg-red-50' : 'bg-[#f3f4f6]'}`}>
        <Ionicons name={icon} size={20} color={danger ? '#dc2626' : iconColor || '#1f2937'} />
      </View>
      <View className="ml-3 flex-1 pr-2">
        <Text className={`text-[15px] font-medium ${danger ? 'text-red-600' : 'text-gray-900'}`}>{title}</Text>
        {subtitle ? <Text className="mt-0.5 text-[13px] text-gray-500" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right !== undefined ? right : <Ionicons name="chevron-forward" size={18} color="#c0c4cc" />}
      {!last ? <View className="absolute bottom-0 left-[68px] right-4 bg-gray-100" style={{ height: 1 }} /> : null}
    </TouchableOpacity>
  );
}

function Card({ children, className = '' }) {
  return <View className={`mb-5 overflow-hidden rounded-[24px] bg-white ${className}`}>{children}</View>;
}

function StatTile({ value, label, icon, iconColor, onPress }) {
  return (
    <TouchableOpacity
      className="flex-1 items-center rounded-2xl bg-[#f6f7f3] px-2 py-3"
      activeOpacity={onPress ? 0.7 : 1}
      onPress={onPress}
      disabled={!onPress}
    >
      <View className="flex-row items-center">
        <Ionicons name={icon} size={14} color={iconColor} />
        <Text className="ml-1 text-[16px] font-bold text-gray-900" numberOfLines={1}>{value}</Text>
      </View>
      <Text className="mt-0.5 text-[11px] font-medium text-gray-500" numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

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
  const [completedRides, setCompletedRides] = useState(0);
  const [captainStatus, setCaptainStatus] = useState(null);
  const [captainStatusError, setCaptainStatusError] = useState('');
  const [loadingCaptainStatus, setLoadingCaptainStatus] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [updatingProfileImage, setUpdatingProfileImage] = useState(false);
  const [showProfileImagePreview, setShowProfileImagePreview] = useState(false);
  const [showEmergencySheet, setShowEmergencySheet] = useState(false);
  const refetchRef = useRef(refetchDriverStatus);
  refetchRef.current = refetchDriverStatus;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const captainHasLoadedRef = useRef(false);
  const captainRequestIdRef = useRef(0);

  const refreshCaptainStatus = useCallback(async ({ silent = false } = {}) => {
    const requestId = ++captainRequestIdRef.current;
    if (!silent) {
      setLoadingCaptainStatus(true);
    }

    try {
      const token = await getTokenRef.current();
      if (!token) {
        if (requestId !== captainRequestIdRef.current) return;
        setCaptainStatusError('Sign in to view Captain rewards.');
        return;
      }

      const res = await fetch(getApiUrl('/api/drivers/captain-status'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (requestId !== captainRequestIdRef.current) return;

      if (!res.ok) {
        setCaptainStatusError(data?.error || 'Could not load Captain rewards.');
        return;
      }

      setCaptainStatusError('');
      setCaptainStatus(data);
      captainHasLoadedRef.current = true;
    } catch {
      if (requestId !== captainRequestIdRef.current) return;
      if (!captainHasLoadedRef.current) {
        setCaptainStatusError('Could not load Captain rewards.');
      }
    } finally {
      if (requestId === captainRequestIdRef.current) {
        setLoadingCaptainStatus(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshCaptainStatus({ silent: captainHasLoadedRef.current });
    }, [refreshCaptainStatus])
  );

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
    if (contextDriverStatus !== undefined) {
      setDriverStatus(contextDriverStatus ?? null);
      setLoading(false);
    }
  }, [contextDriverStatus]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const loadRatingSummary = async () => {
        try {
          const token = await getTokenRef.current();
          if (!token) return;
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
          setCompletedRides(Number(summary.completedRides || 0));
        } catch {
          if (cancelled) return;
          setAverageRating(null);
          setRatingCount(0);
          setCompletedRides(0);
        }
      };

      loadRatingSummary();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This permanently deletes your driver account. If your wallet still has funds, deletion will be blocked until the balance is cleared.',
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
  const approvedTierName = String(vehicle?.vehicleTierName || '').trim();

  const allVerified = phoneVerified && profileApproved && vehicleApproved;
  const driverName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.firstName || 'Driver';
  const driverEmail = user?.primaryEmailAddress?.emailAddress || 'No email connected';
  // API merges Clerk OAuth avatar into `image_url`; only `privateMetadata.profileImageUrl` is an in-app upload.
  const appProfileImageUrl = resolveUploadedMediaUrl(profileData?.privateMetadata?.profileImageUrl);
  const driverProfileImageReview = profileData?.profileImageReview || null;
  const pendingProfileImageUrl = resolveUploadedMediaUrl(
    driverProfileImageReview?.pendingImageUrl || profileData?.privateMetadata?.pendingDriverProfileImageUrl
  );
  const profileImageReviewStatus = String(
    driverProfileImageReview?.status || profileData?.privateMetadata?.driverProfileImageReviewStatus || ''
  ).trim().toLowerCase();
  const profileImageReviewRejectionReason =
    driverProfileImageReview?.rejectionReason || profileData?.privateMetadata?.driverProfileImageRejectionReason || '';
  const hasPendingProfileImageReview = profileImageReviewStatus === 'pending' && !!pendingProfileImageUrl;
  const hasRejectedProfileImageReview = profileImageReviewStatus === 'rejected' && !!pendingProfileImageUrl;
  const clerkFallback = String(user?.imageUrl || '').trim();
  const displayProfileImageUrl =
    appProfileImageUrl ||
    resolveUploadedMediaUrl(profileData?.image_url) ||
    clerkFallback ||
    null;
  const profileImagePreviewUrl = pendingProfileImageUrl || appProfileImageUrl || displayProfileImageUrl;

  const truckDriver = isTruckDriver(driverStatus);
  const verificationHeadline = allVerified
    ? (truckDriver ? 'Ready for hire jobs' : 'Ready to drive')
    : 'Verification in progress';
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
        truckDriver ? 'Change truck?' : 'Change car?',
        truckDriver
          ? 'Changing your truck will submit the new vehicle for admin review. You will stay offline for rides until hiring documents are approved.'
          : 'Changing your car will submit the new vehicle for admin review. You will be taken offline and cannot go online again until the new car is approved.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Continue',
            onPress: () => {
              const rootNavigation = navigation.getParent()?.getParent();
              if (rootNavigation?.navigate) {
                rootNavigation.navigate(getDriverVehicleRoute(driverStatus), { driverStatus, changeVehicle: true });
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
      title: truckDriver ? 'Truck registration' : 'Car registration',
      subtitle: !vehicle
        ? 'Not registered'
        : vehicle.status === 'approved'
          ? approvedTierName
            ? `Verified · ${approvedTierName}`
            : 'Verified'
          : vehicle.status === 'pending'
            ? 'Under review'
            : 'Rejected',
      verified: vehicle?.status === 'approved',
      icon: truckDriver ? 'bus-outline' : 'car-outline',
      changeableWhenVerified: vehicle?.status === 'approved',
      vehicleRegistrationReviewOnly: vehicleRegistrationAwaitingReviewOnly,
      onPress: handleCarRegistrationPress,
    },
  ];

  const earningsRows = [
    {
      key: 'smile-cash',
      title: 'Online wallet',
      subtitle: driverStatus?.driverProfile?.smileCashStatus === 'active'
        ? driverStatus.driverProfile.smileCashMobile
        : 'Link your SmileCash wallet',
      icon: 'wallet-outline',
      onPress: () => navigation.navigate('DriverSmileCash'),
    },
    {
      key: 'income',
      title: 'Income',
      subtitle: 'Earnings and weekly goal',
      icon: 'stats-chart-outline',
      onPress: () => navigation.navigate('DriverIncomeStack'),
    },
    {
      key: 'ride-history',
      title: 'Ride history',
      subtitle: completedRides > 0 ? `${completedRides} completed` : null,
      icon: 'time-outline',
      onPress: () => navigation.navigate('DriverRideHistory'),
    },
    {
      key: 'reviews',
      title: 'Reviews',
      subtitle: ratingCount > 0 ? `${ratingCount} review${ratingCount === 1 ? '' : 's'}` : 'No reviews yet',
      icon: 'star-outline',
      onPress: () => navigation.navigate('DriverReviews'),
    },
    {
      key: 'hire-vehicles',
      title: 'Hire vehicles',
      subtitle: 'Trucks and vans you offer for hire',
      icon: 'bus-outline',
      onPress: () => navigation.navigate('DriverHireVehicles'),
    },
  ];

  const helpRows = [
    {
      key: 'support',
      title: 'Support',
      subtitle: 'Chat with the support team',
      icon: 'headset-outline',
      onPress: () => navigation.navigate('DriverSupportChat'),
    },
    {
      key: 'emergency',
      title: 'Emergency numbers',
      subtitle: 'Police, ambulance, fire brigade',
      icon: 'alert-circle-outline',
      iconColor: '#dc2626',
      onPress: () => setShowEmergencySheet(true),
    },
  ];

  const legalRows = [
    {
      key: 'privacy',
      title: 'Privacy policy',
      icon: 'shield-outline',
      onPress: () => navigation.navigate('DriverLegalDocument', { document: 'privacy' }),
    },
    {
      key: 'terms',
      title: 'Terms of use',
      icon: 'document-text-outline',
      onPress: () => navigation.navigate('DriverLegalDocument', { document: 'terms' }),
    },
  ];

  const emergencyContacts = [
    { key: 'police', label: 'Police', number: '995', icon: 'shield-checkmark-outline' },
    { key: 'ambulance', label: 'Ambulance', number: '994', icon: 'medkit-outline' },
    { key: 'fire', label: 'Fire brigade', number: '993', icon: 'flame-outline' },
  ];

  const verificationRowTone = (row) => {
    if (row.key === 'phone') return phoneVerified ? 'done' : 'action';
    const status = String((row.key === 'docs' ? profile?.status : vehicle?.status) || '').trim().toLowerCase();
    if (row.key === 'car' && !vehicle) return 'action';
    if (row.key === 'docs' && (!hasSubmittedProfileDocs || onlyEnhancedSelfieMissing)) return 'action';
    if (status === 'approved' || status === 'verified') return 'done';
    if (status === 'rejected') return 'rejected';
    if (status === 'pending') return 'review';
    return 'action';
  };
  const verifiedCount = verificationRows.filter((row) => verificationRowTone(row) === 'done').length;
  const driverContact = user?.primaryEmailAddress?.emailAddress || user?.primaryPhoneNumber?.phoneNumber || profileData?.email || '';
  const appVersion = Constants.expoConfig?.version || null;
  const captainTierLabel = loadingCaptainStatus && !captainStatus
    ? '…'
    : captainStatus?.enabled === false
      ? 'Off'
      : captainStatus?.tierName || 'None';

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
      Alert.alert('Submitted for review', 'Your new profile picture was submitted for admin approval.');
    } catch (error) {
      Alert.alert('Update failed', error?.message || 'Could not update your profile picture.');
    } finally {
      setUpdatingProfileImage(false);
    }
  };

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center bg-[#f6f7f3]"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 10 }}
      >
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => navigation.getParent()?.navigate?.('DriverHome')}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="ml-3 text-[22px] font-bold text-gray-900">Account</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Card className="p-4">
          <View className="flex-row items-center">
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => (profileImagePreviewUrl ? setShowProfileImagePreview(true) : handleChangeProfilePhoto())}
              disabled={updatingProfileImage}
              className="relative"
            >
              <View className="h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-full bg-[#e8f1ff]">
                {displayProfileImageUrl ? (
                  <Image source={{ uri: displayProfileImageUrl }} style={{ width: 72, height: 72 }} resizeMode="cover" />
                ) : (
                  <Ionicons name="person" size={30} color="#1f2937" />
                )}
              </View>
              <TouchableOpacity
                className="absolute -bottom-1 -right-1 h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#1f2937]"
                activeOpacity={0.8}
                onPress={handleChangeProfilePhoto}
                disabled={updatingProfileImage}
              >
                {updatingProfileImage ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="camera" size={14} color="#fff" />
                )}
              </TouchableOpacity>
            </TouchableOpacity>

            <View className="ml-4 flex-1">
              <Text className="text-[19px] font-bold text-gray-950" numberOfLines={1}>{driverName}</Text>
              {driverContact ? (
                <Text className="mt-0.5 text-[13px] text-gray-500" numberOfLines={1}>{driverContact}</Text>
              ) : null}
              <View className="mt-2 flex-row">
                <View className="flex-row items-center rounded-full px-2.5 py-1" style={{ backgroundColor: verificationTone.bg }}>
                  <Ionicons
                    name={allVerified ? 'checkmark-circle' : 'time-outline'}
                    size={13}
                    color={verificationTone.text}
                  />
                  <Text className="ml-1 text-[11px] font-semibold" style={{ color: verificationTone.text }}>
                    {verificationHeadline}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {hasPendingProfileImageReview ? (
            <View className="mt-4 flex-row items-center rounded-2xl bg-amber-50 px-3 py-2.5">
              <Ionicons name="hourglass-outline" size={16} color="#b45309" />
              <Text className="ml-2 flex-1 text-[13px] font-medium text-amber-800">
                New profile picture is waiting for approval
              </Text>
            </View>
          ) : null}
          {hasRejectedProfileImageReview ? (
            <View className="mt-4 rounded-2xl bg-red-50 px-3 py-2.5">
              <Text className="text-[13px] font-semibold text-red-700">Profile picture not approved</Text>
              <Text className="mt-0.5 text-[13px] text-red-600">
                {profileImageReviewRejectionReason || 'Upload a clearer photo and submit it again.'}
              </Text>
            </View>
          ) : null}

          <View className="mt-4 flex-row gap-2">
            <StatTile
              icon="star"
              iconColor="#f59e0b"
              value={averageRating !== null ? averageRating.toFixed(1) : '–'}
              label={ratingCount > 0 ? `${ratingCount} rating${ratingCount === 1 ? '' : 's'}` : 'Rating'}
              onPress={() => navigation.navigate('DriverReviews')}
            />
            <StatTile
              icon="car-sport"
              iconColor={PRIMARY_BLUE}
              value={String(completedRides)}
              label="Trips"
              onPress={() => navigation.navigate('DriverRideHistory')}
            />
            <StatTile
              icon="ribbon"
              iconColor={captainStatus?.badgeColor || '#7c3aed'}
              value={captainTierLabel}
              label="Captain tier"
              onPress={captainStatus && captainStatus.enabled !== false ? () => navigation.navigate('DriverCaptainRewards') : undefined}
            />
          </View>
          {vehicleApproved && approvedTierName ? (
            <Text className="mt-3 text-center text-[12px] font-medium text-gray-500">
              Approved for {approvedTierName}
            </Text>
          ) : null}
        </Card>

        <View className="flex-row items-end justify-between">
          <SectionTitle>Verification</SectionTitle>
          {!loading ? (
            <Text className="mb-2 px-1 text-xs font-medium text-gray-400">
              {verifiedCount} of {verificationRows.length} done
            </Text>
          ) : null}
        </View>
        <Card>
          {loading ? (
            <View className="items-center py-8">
              <ActivityIndicator size="small" color={PRIMARY_BLUE} />
            </View>
          ) : (
            verificationRows.map((row, index) => (
              <Row
                key={row.key}
                icon={row.icon}
                title={row.title}
                subtitle={row.subtitle}
                last={index === verificationRows.length - 1}
                onPress={() => (row.onPress ? row.onPress() : navigation.navigate(row.screen, { driverStatus }))}
                right={(
                  <View className="flex-row items-center">
                    <StatusPill tone={verificationRowTone(row)} />
                    {row.changeableWhenVerified || verificationRowTone(row) !== 'done' ? (
                      <Ionicons name="chevron-forward" size={18} color="#c0c4cc" style={{ marginLeft: 4 }} />
                    ) : null}
                  </View>
                )}
              />
            ))
          )}
        </Card>

        <SectionTitle>Earnings & trips</SectionTitle>
        <Card>
          {earningsRows.map((row, index) => (
            <Row key={row.key} {...row} last={index === earningsRows.length - 1} />
          ))}
        </Card>

        <SectionTitle>Security</SectionTitle>
        <Card>
          <BiometricSignInSetting role="driver" />
        </Card>

        <SectionTitle>Help & safety</SectionTitle>
        <Card>
          {helpRows.map((row, index) => (
            <Row key={row.key} {...row} last={index === helpRows.length - 1} />
          ))}
        </Card>

        <SectionTitle>Legal</SectionTitle>
        <Card>
          {legalRows.map((row, index) => (
            <Row key={row.key} {...row} last={index === legalRows.length - 1} />
          ))}
        </Card>

        <TouchableOpacity
          className="mb-4 flex-row items-center justify-center rounded-[24px] bg-white px-5 py-4"
          onPress={() => signOut()}
          activeOpacity={0.8}
        >
          <Ionicons name="log-out-outline" size={20} color="#dc2626" />
          <Text className="ml-2 text-base font-semibold text-red-600">Sign out</Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="items-center py-2"
          onPress={handleDeleteAccount}
          disabled={deleting}
          activeOpacity={0.7}
        >
          {deleting ? (
            <ActivityIndicator size="small" color="#dc2626" />
          ) : (
            <Text className="text-[13px] font-medium text-gray-400">Delete account</Text>
          )}
        </TouchableOpacity>
        {appVersion ? (
          <Text className="mt-1 text-center text-[12px] text-gray-300">Trust Express v{appVersion}</Text>
        ) : null}
      </ScrollView>

      <Modal
        visible={showEmergencySheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEmergencySheet(false)}
      >
        <TouchableOpacity
          className="flex-1 bg-black/40"
          activeOpacity={1}
          onPress={() => setShowEmergencySheet(false)}
        />
        <View className="rounded-t-[28px] bg-white px-5 pt-3" style={{ paddingBottom: insets.bottom + 16 }}>
          <View className="mb-4 h-1 w-10 self-center rounded-full bg-gray-200" />
          <Text className="text-lg font-bold text-gray-900">Emergency numbers</Text>
          <Text className="mb-4 mt-1 text-sm text-gray-500">Tap a service to call it.</Text>
          {emergencyContacts.map((contact) => (
            <TouchableOpacity
              key={contact.key}
              className="mb-2 flex-row items-center rounded-2xl bg-[#fef2f2] px-4 py-3.5"
              activeOpacity={0.75}
              onPress={() => {
                setShowEmergencySheet(false);
                handleEmergencyCall(contact.label, contact.number);
              }}
            >
              <Ionicons name={contact.icon} size={22} color="#dc2626" />
              <Text className="ml-3 flex-1 text-[15px] font-semibold text-gray-900">{contact.label}</Text>
              <Text className="mr-3 text-[15px] font-bold text-red-600">{contact.number}</Text>
              <Ionicons name="call" size={18} color="#dc2626" />
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

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
          {profileImagePreviewUrl ? (
            <Image
              source={{ uri: profileImagePreviewUrl }}
              style={{ width: 320, height: 320, borderRadius: 160 }}
              resizeMode="cover"
            />
          ) : null}
          <TouchableOpacity
            className="mt-8 flex-row items-center rounded-full bg-white px-5 py-3"
            activeOpacity={0.8}
            onPress={() => {
              setShowProfileImagePreview(false);
              handleChangeProfilePhoto();
            }}
          >
            <Ionicons name="camera-outline" size={18} color="#111827" />
            <Text className="ml-2 text-sm font-semibold text-gray-900">Change photo</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

export default DriverAccountScreen;
