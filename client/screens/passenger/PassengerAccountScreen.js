import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Switch,
  Linking,
  Image,
  Modal,
} from 'react-native';
import { useUser, useClerk, useAuth } from '../../auth/AuthProvider';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { deleteMe, getMe, getPassengerRideHistory, resolveUploadedMediaUrl, updateMe, uploadFile } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import BiometricSignInSetting from '../../components/BiometricSignInSetting';

const STATUS_TONES = {
  done: { bg: '#dcfce7', text: '#166534', label: 'Verified' },
  review: { bg: '#e0ecff', text: '#1d4ed8', label: 'Under review' },
  action: { bg: '#fef3c7', text: '#92400e', label: 'Action needed' },
  rejected: { bg: '#fee2e2', text: '#b91c1c', label: 'Resubmit' },
};

const EMERGENCY_CONTACTS = [
  { key: 'police', label: 'Police', number: '995', icon: 'shield-checkmark-outline' },
  { key: 'ambulance', label: 'Ambulance', number: '994', icon: 'medkit-outline' },
  { key: 'fire', label: 'Fire brigade', number: '993', icon: 'flame-outline' },
];

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
      activeOpacity={onPress ? 0.7 : 1}
      onPress={onPress}
      disabled={disabled || !onPress}
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

const PassengerAccountScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [phoneVisibleToDrivers, setPhoneVisibleToDrivers] = useState(false);
  const [updatingProfileImage, setUpdatingProfileImage] = useState(false);
  const [showProfileImagePreview, setShowProfileImagePreview] = useState(false);
  const [showEmergencySheet, setShowEmergencySheet] = useState(false);
  const [completedTrips, setCompletedTrips] = useState(null);
  const [averageRating, setAverageRating] = useState(null);
  const [ratingCount, setRatingCount] = useState(0);

  useEffect(() => {
    if (!isFocused) return undefined;
    let active = true;

    const loadProfile = async () => {
      try {
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

    const loadTripStats = async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) return;
        const data = await getPassengerRideHistory(token, { page: 1, limit: 50, status: 'completed' });
        if (!active) return;
        const rides = Array.isArray(data?.rides) ? data.rides : [];
        const ratings = rides
          .map((ride) => Number(ride.driverPassengerRating))
          .filter((value) => Number.isFinite(value) && value > 0);
        setCompletedTrips(Number(data?.pagination?.total ?? rides.length));
        setRatingCount(ratings.length);
        setAverageRating(ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null);
      } catch {
        // Stats are optional; keep the tiles empty.
      }
    };

    loadProfile();
    loadTripStats();
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

  const passengerName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.firstName || 'Passenger';
  const passengerContact = profile?.email
    || user?.primaryEmailAddress?.emailAddress
    || user?.primaryPhoneNumber?.phoneNumber
    || '';
  const appProfileImageUrl = resolveUploadedMediaUrl(profile?.privateMetadata?.profileImageUrl);
  const displayProfileImageUrl =
    appProfileImageUrl
    || resolveUploadedMediaUrl(profile?.image_url)
    || String(user?.imageUrl || '').trim()
    || null;

  const phoneVerified = profile?.phoneVerified === true;
  const passengerIdentity = profile?.passengerIdentity || null;
  const identityStatus = String(passengerIdentity?.status || 'not_submitted').toLowerCase();
  const identityDocsSubmitted = !!(passengerIdentity?.nationalIdFrontUrl && passengerIdentity?.nationalIdBackUrl);
  const identityApproved = identityStatus === 'approved' || identityStatus === 'verified';
  const identityPending = identityStatus === 'pending' && identityDocsSubmitted;
  const identityRejected = identityStatus === 'rejected';
  const allVerified = phoneVerified && identityApproved;
  const verificationTone = allVerified || phoneVerified
    ? { bg: '#dcfce7', text: '#166534' }
    : { bg: '#fef3c7', text: '#92400e' };
  const verificationHeadline = allVerified ? 'Fully verified' : phoneVerified ? 'Phone verified' : 'Verification needed';
  const walletActive = passengerIdentity?.smileCashStatus === 'active';
  const appVersion = Constants.expoConfig?.version || null;

  const verificationRows = [
    {
      key: 'phone',
      icon: 'phone-portrait-outline',
      title: 'Phone number',
      subtitle: phoneVerified ? (profile?.phone_number || 'Verified') : 'Add and verify your phone number',
      tone: phoneVerified ? 'done' : 'action',
      onPress: () => navigation.navigate('PassengerPhoneVerificationDetails'),
    },
    {
      key: 'identity',
      icon: 'card-outline',
      title: 'Identity documents',
      subtitle: identityApproved
        ? 'Approved'
        : identityPending
          ? 'Under review'
          : identityRejected
            ? 'Needs resubmission'
            : 'Upload selfie and national ID',
      tone: identityApproved ? 'done' : identityPending ? 'review' : identityRejected ? 'rejected' : 'action',
      onPress: () => {
        if (identityPending) {
          Alert.alert(
            'Documents under review',
            'We are reviewing your submission. You will be notified when there is an update.',
          );
          return;
        }
        navigation.navigate('PassengerIdentityVerification');
      },
    },
  ];
  const verifiedCount = verificationRows.filter((row) => row.tone === 'done').length;

  const accountRows = [
    {
      key: 'profile',
      title: 'Profile details',
      subtitle: 'Name and personal info',
      icon: 'person-outline',
      onPress: () => navigation.navigate('PassengerProfileDetails'),
    },
    {
      key: 'smile-cash',
      title: 'Online wallet',
      subtitle: walletActive ? passengerIdentity.smileCashMobile : 'Link your SmileCash wallet',
      icon: 'wallet-outline',
      onPress: () => navigation.navigate('PassengerSmileCash'),
    },
    {
      key: 'reviews',
      title: 'Reviews',
      subtitle: ratingCount > 0 ? `${ratingCount} review${ratingCount === 1 ? '' : 's'} from drivers` : 'See what drivers said about you',
      icon: 'star-outline',
      onPress: () => navigation.navigate('PassengerReviews'),
    },
    {
      key: 'referrals',
      title: 'Invite friends',
      subtitle: 'Share Trust Express and earn rewards',
      icon: 'gift-outline',
      iconColor: PRIMARY_BLUE,
      onPress: () => navigation.navigate('PassengerReferrals'),
    },
  ];

  const helpRows = [
    {
      key: 'support',
      title: 'Support',
      subtitle: 'Chat with the support team',
      icon: 'headset-outline',
      onPress: () => navigation.navigate('PassengerSupportChat'),
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
      onPress: () => navigation.navigate('PassengerLegalDocument', { document: 'privacy' }),
    },
    {
      key: 'terms',
      title: 'Terms of use',
      icon: 'document-text-outline',
      onPress: () => navigation.navigate('PassengerLegalDocument', { document: 'terms' }),
    },
  ];

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center bg-[#f6f7f3]"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 10 }}
      >
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => navigation?.getParent?.()?.navigate?.('PassengerHome')}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="ml-3 text-[22px] font-bold text-gray-900">Account</Text>
      </View>

      {loading && !profile ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View className="mb-4 rounded-2xl bg-red-50 px-4 py-3">
              <Text className="text-[13px] font-medium text-red-600">{error}</Text>
            </View>
          ) : null}

          <Card className="p-4">
            <View className="flex-row items-center">
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => (appProfileImageUrl ? setShowProfileImagePreview(true) : handleChangeProfilePhoto())}
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
                <Text className="text-[19px] font-bold text-gray-950" numberOfLines={1}>{passengerName}</Text>
                {passengerContact ? (
                  <Text className="mt-0.5 text-[13px] text-gray-500" numberOfLines={1}>{passengerContact}</Text>
                ) : null}
                <View className="mt-2 flex-row">
                  <View className="flex-row items-center rounded-full px-2.5 py-1" style={{ backgroundColor: verificationTone.bg }}>
                    <Ionicons
                      name={phoneVerified ? 'checkmark-circle' : 'time-outline'}
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

            <View className="mt-4 flex-row gap-2">
              <StatTile
                icon="star"
                iconColor="#f59e0b"
                value={averageRating !== null ? averageRating.toFixed(1) : '–'}
                label={ratingCount > 0 ? `${ratingCount} rating${ratingCount === 1 ? '' : 's'}` : 'Rating'}
                onPress={() => navigation.navigate('PassengerReviews')}
              />
              <StatTile
                icon="car-sport"
                iconColor={PRIMARY_BLUE}
                value={completedTrips === null ? '–' : String(completedTrips)}
                label="Trips"
                onPress={() => navigation.getParent?.()?.navigate?.('PassengerActivity')}
              />
              <StatTile
                icon="wallet"
                iconColor="#16a34a"
                value={walletActive ? 'Linked' : 'Off'}
                label="Wallet"
                onPress={() => navigation.navigate('PassengerSmileCash')}
              />
            </View>
          </Card>

          <View className="flex-row items-end justify-between">
            <SectionTitle>Verification</SectionTitle>
            <Text className="mb-2 px-1 text-xs font-medium text-gray-400">
              {verifiedCount} of {verificationRows.length} done
            </Text>
          </View>
          <Card>
            {verificationRows.map((row, index) => (
              <Row
                key={row.key}
                icon={row.icon}
                title={row.title}
                subtitle={row.subtitle}
                last={index === verificationRows.length - 1}
                onPress={row.onPress}
                right={(
                  <View className="flex-row items-center">
                    <StatusPill tone={row.tone} />
                    {row.tone !== 'done' ? (
                      <Ionicons name="chevron-forward" size={18} color="#c0c4cc" style={{ marginLeft: 4 }} />
                    ) : null}
                  </View>
                )}
              />
            ))}
          </Card>

          <SectionTitle>Account</SectionTitle>
          <Card>
            {accountRows.map((row, index) => (
              <Row key={row.key} {...row} last={index === accountRows.length - 1} />
            ))}
          </Card>

          <SectionTitle>Privacy & security</SectionTitle>
          <Card>
            <Row
              icon="eye-outline"
              title="Show my phone to drivers"
              subtitle={phoneVisibleToDrivers ? 'Drivers can see your number' : 'Your number stays hidden'}
              right={savingVisibility ? (
                <ActivityIndicator size="small" color={PRIMARY_BLUE} />
              ) : (
                <Switch
                  value={phoneVisibleToDrivers}
                  onValueChange={handleTogglePhoneVisibility}
                  trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
                  thumbColor={phoneVisibleToDrivers ? PRIMARY_BLUE : '#f9fafb'}
                />
              )}
            />
            <BiometricSignInSetting role="passenger" />
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
      )}

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
          {EMERGENCY_CONTACTS.map((contact) => (
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
          {appProfileImageUrl ? (
            <Image
              source={{ uri: appProfileImageUrl }}
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

export default PassengerAccountScreen;
