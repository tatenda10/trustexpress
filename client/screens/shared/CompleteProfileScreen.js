import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { getMe, updateMe } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

export default function CompleteProfileScreen({ route, role: roleProp, onCompleted: onCompletedProp }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { user } = useUser();
  const getTokenRef = useRef(getToken);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loadWarning, setLoadWarning] = useState('');

  const role = roleProp || (route?.params?.role === 'driver' ? 'driver' : 'passenger');
  const onCompleted = onCompletedProp || route?.params?.onCompleted;

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    let active = true;

    const loadProfile = async () => {
      setFirstName(user?.firstName || '');
      setLastName(user?.lastName || '');

      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error('Not signed in');
        const profile = await getMe(token);
        if (!active) return;
        setFirstName(profile?.first_name || '');
        setLastName(profile?.last_name || '');
      } catch (error) {
        if (!active) return;
        console.warn('[CompleteProfileScreen] profile bootstrap failed', error);
        setLoadWarning('We could not load your saved profile details, but you can still continue.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async () => {
    const trimmedFirstName = String(firstName || '').trim();
    const trimmedLastName = String(lastName || '').trim();

    if (!trimmedFirstName || !trimmedLastName) {
      Alert.alert('Missing details', 'Enter both your first name and last name before continuing.');
      return;
    }

    try {
      setSaving(true);
      let savedViaClerk = false;

      if (user?.update) {
        await user.update({
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
        });
        savedViaClerk = true;
      }

      const token = await getTokenRef.current();
      if (token) {
        try {
          await updateMe(token, { firstName: trimmedFirstName, lastName: trimmedLastName });
        } catch (error) {
          if (!savedViaClerk) {
            throw error;
          }
          console.warn('[CompleteProfileScreen] backend profile sync failed after Clerk save', error);
        }
      }

      if (typeof onCompleted === 'function') {
        await onCompleted();
      }
    } catch (error) {
      Alert.alert('Save failed', error?.message || 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-1 px-6" style={{ paddingTop: insets.top + 18, paddingBottom: Math.max(insets.bottom + 24, 32) }}>
          <View className="mt-8">
            <Text className="text-sm tracking-[0.3em] text-gray-500">TRUST EXPRESS</Text>
            <Text className="mt-4 text-3xl font-bold text-gray-900">Complete your profile</Text>
            <Text className="mt-2 text-base leading-6 text-gray-500">
              Add your real first name and last name to continue using the {role} app.
            </Text>
          </View>

          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={PRIMARY_BLUE} />
            </View>
          ) : (
            <View className="mt-10">
              {!!loadWarning && (
                <View className="mb-4 rounded-xl bg-amber-50 px-4 py-3">
                  <Text className="text-sm leading-5 text-amber-800">{loadWarning}</Text>
                </View>
              )}

              <Text className="mb-2 text-sm font-medium text-gray-700">First name</Text>
              <TextInput
                className="rounded-xl border border-gray-200 bg-white p-4 text-base mb-4"
                placeholder="Enter your first name"
                placeholderTextColor="#9ca3af"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
              />

              <Text className="mb-2 text-sm font-medium text-gray-700">Last name</Text>
              <TextInput
                className="rounded-xl border border-gray-200 bg-white p-4 text-base"
                placeholder="Enter your last name"
                placeholderTextColor="#9ca3af"
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
              />
            </View>
          )}

          <View className="mt-auto">
            <TouchableOpacity
              className="h-14 items-center justify-center rounded-xl"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: loading || saving ? 0.7 : 1 }}
              disabled={loading || saving}
              onPress={handleSave}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-lg font-bold text-white">Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
