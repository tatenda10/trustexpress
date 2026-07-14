import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Share,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { applyPassengerReferral, getPassengerReferralDashboard } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

function formatReferralDate(value) {
  if (!value) return 'Recently';
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return 'Recently';
  }
}

export default function PassengerReferralsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [referrerEmailInput, setReferrerEmailInput] = useState('');

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!isFocused) return undefined;
    let active = true;

    const loadDashboard = async () => {
      try {
        setLoading(true);
        const token = await getTokenRef.current();
        if (!token) throw new Error('Not signed in');
        const data = await getPassengerReferralDashboard(token);
        if (!active) return;
        setDashboard(data);
      } catch (error) {
        if (!active) return;
        Alert.alert('Could not load referrals', error?.message || 'Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadDashboard();
    return () => {
      active = false;
    };
  }, [isFocused]);

  const handleShareInvite = async () => {
    try {
      await Share.share({ message: dashboard?.shareMessage || 'Join me on Trust Express!' });
    } catch {
      // User cancelled share sheet.
    }
  };

  const handleApplyReferral = async () => {
    const raw = String(referrerEmailInput || '').trim().toLowerCase();
    if (!raw || !raw.includes('@')) {
      Alert.alert('Enter an email', 'Add the email address of the friend who invited you.');
      return;
    }

    try {
      setSubmitting(true);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const result = await applyPassengerReferral(token, { referrerEmail: raw });
      const data = await getPassengerReferralDashboard(token);
      setDashboard(data);
      setReferrerEmailInput('');
      Alert.alert(
        result?.alreadyExists ? 'Already linked' : 'Referral linked',
        result?.alreadyExists
          ? 'Your account is already linked to a referrer.'
          : 'Thanks! Your friend has been recorded as your referrer.',
      );
    } catch (error) {
      Alert.alert('Referral failed', error?.message || 'Could not apply this referral.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#f6f7f3]">
        <ActivityIndicator size="large" color={PRIMARY_BLUE} />
      </View>
    );
  }

  const hasReferrer = !!dashboard?.referredBy;
  const referralCount = Number(dashboard?.stats?.totalReferrals || 0);
  const shareEmail = dashboard?.referrerEmail || '';

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#f6f7f3]"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center px-5 py-4">
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-white"
          >
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-900">Invite friends</Text>
        </View>

        <ScrollView
          className="flex-1 px-5"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) + 24 }}
        >
          <View className="rounded-[28px] bg-white px-5 py-5">
            <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Your referral email</Text>
            <Text className="mt-3 text-xl font-bold text-[#111827]">
              {shareEmail || 'Add an email to your account to share referrals'}
            </Text>
            <Text className="mt-3 text-sm leading-6 text-gray-500">
              Friends should enter this email when they create their passenger account.
            </Text>

            <TouchableOpacity
              onPress={handleShareInvite}
              disabled={!shareEmail}
              className="mt-5 h-14 items-center justify-center rounded-[20px]"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: shareEmail ? 1 : 0.5 }}
            >
              <Text className="text-base font-bold text-white">Share invite message</Text>
            </TouchableOpacity>
          </View>

          <View className="mt-5 rounded-[28px] bg-white px-5 py-5">
            <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Your invites</Text>
            <Text className="mt-2 text-3xl font-bold text-[#111827]">{referralCount}</Text>
            <Text className="mt-1 text-sm text-gray-500">Passengers who joined using your email</Text>

            {dashboard?.referrals?.length ? (
              <View className="mt-4">
                {dashboard.referrals.map((item, index) => (
                  <View
                    key={String(item.id)}
                    className={`flex-row items-center py-3 ${index < dashboard.referrals.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <View className="h-11 w-11 items-center justify-center rounded-full bg-[#eff6ff]">
                      <Ionicons name="person-outline" size={20} color={PRIMARY_BLUE} />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-base font-medium text-gray-900">{item.displayName}</Text>
                      <Text className="mt-0.5 text-sm text-gray-500">{formatReferralDate(item.createdAt)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="mt-4 text-sm text-gray-500">No invited passengers yet. Share your email to get started.</Text>
            )}
          </View>

          {!hasReferrer ? (
            <View className="mt-5 rounded-[28px] bg-white px-5 py-5">
              <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Were you invited?</Text>
              <Text className="mt-2 text-sm leading-6 text-gray-500">
                Enter the email address of the friend who invited you.
              </Text>
              <TextInput
                className="mt-4 rounded-[18px] border border-gray-200 bg-[#f8fafc] px-4 py-4 text-base text-gray-900"
                placeholder="friend@email.com"
                placeholderTextColor="#9ca3af"
                value={referrerEmailInput}
                onChangeText={setReferrerEmailInput}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={handleApplyReferral}
                disabled={submitting}
                className="mt-4 h-14 items-center justify-center rounded-[20px] border border-[#d7d9df] bg-white"
                style={{ opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={PRIMARY_BLUE} />
                ) : (
                  <Text className="text-base font-bold text-[#111827]">Link my referrer</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View className="mt-5 rounded-[28px] bg-white px-5 py-5">
              <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Your referrer</Text>
              <Text className="mt-2 text-lg font-semibold text-gray-900">
                {dashboard.referredBy.referrerName || dashboard.referredBy.referrerEmail || 'Friend'}
              </Text>
              {dashboard.referredBy.referrerEmail ? (
                <Text className="mt-1 text-sm text-gray-500">{dashboard.referredBy.referrerEmail}</Text>
              ) : null}
            </View>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
