import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, useUser } from '../../auth/AuthProvider';
import { getMe, updateMe } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { configureMarket } from '../../constants/market';
import { configureServiceAreaCountry } from '../../constants/serviceArea';

export default function CompleteProfileScreen({ route, role: roleProp, onCompleted: onCompletedProp }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { user } = useUser();
  const getTokenRef = useRef(getToken);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [registrationCountryCode, setRegistrationCountryCode] = useState('ZW');
  const [termsAccepted, setTermsAccepted] = useState(false);
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
        setRegistrationCountryCode(profile?.registrationCountryCode === 'ZA' ? 'ZA' : 'ZW');
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
    if (registrationCountryCode === 'ZA' && !termsAccepted) {
      Alert.alert('Consent required', 'Accept the Trust Express terms and privacy policy to create your South African account.');
      return;
    }

    try {
      setSaving(true);
      const token = await getTokenRef.current();
      await updateMe(token, {
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
        registrationCountryCode,
        acceptTermsAndPrivacy: registrationCountryCode === 'ZA' ? true : undefined,
      });
      configureMarket(registrationCountryCode);
      configureServiceAreaCountry(registrationCountryCode);
      await user?.reload?.().catch(() => {});

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

              <Text className="mb-2 mt-5 text-sm font-medium text-gray-700">Registration country</Text>
              <View className="flex-row gap-3">
                {[
                  { code: 'ZW', label: 'Zimbabwe' },
                  { code: 'ZA', label: 'South Africa' },
                ].map((country) => {
                  const selected = registrationCountryCode === country.code;
                  return (
                    <TouchableOpacity
                      key={country.code}
                      onPress={() => setRegistrationCountryCode(country.code)}
                      className={`flex-1 rounded-xl border px-4 py-4 ${selected ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white'}`}
                    >
                      <Text className={`text-center text-base font-semibold ${selected ? 'text-blue-700' : 'text-gray-700'}`}>{country.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text className="mt-2 text-xs leading-5 text-gray-500">
                This controls phone formats, service areas, currency, payments and emergency information in the app.
              </Text>

              {registrationCountryCode === 'ZA' ? (
                <View className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <TouchableOpacity className="flex-row items-start" onPress={() => setTermsAccepted((value) => !value)}>
                    <Ionicons name={termsAccepted ? 'checkbox' : 'square-outline'} size={23} color={termsAccepted ? PRIMARY_BLUE : '#64748b'} />
                    <Text className="ml-3 flex-1 text-sm leading-5 text-gray-700">
                      I accept the Trust Express terms of use and consent to the processing of my personal information as described in the privacy policy.
                    </Text>
                  </TouchableOpacity>
                  <View className="ml-9 mt-3 flex-row gap-5">
                    <TouchableOpacity onPress={() => Linking.openURL('https://trustexpress.co.za/privacy')}>
                      <Text className="text-sm font-semibold text-blue-700">Privacy policy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => Linking.openURL('https://trustexpress.co.za/terms')}>
                      <Text className="text-sm font-semibold text-blue-700">Terms of use</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

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
