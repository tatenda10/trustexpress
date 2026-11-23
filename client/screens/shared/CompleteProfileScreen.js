import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Linking, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, useUser } from '../../auth/AuthProvider';
import { getMe, updateMe } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { configureMarket } from '../../constants/market';
import { configureServiceAreaCountry } from '../../constants/serviceArea';
import CountrySelectField from '../../components/CountrySelectField';

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
    <SafeAreaView className={role === 'driver' ? 'flex-1 bg-[#f6f7fb]' : 'flex-1 bg-white'} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: role === 'driver' ? insets.top + 22 : insets.top + 50, paddingBottom: Math.max(insets.bottom + 24, 32) }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View>
            {role !== 'driver' ? <Text className="text-sm tracking-[0.3em] text-gray-500">TRUST EXPRESS</Text> : null}
            <Text className={`${role === 'driver' ? 'text-2xl' : 'mt-4 text-3xl'} font-bold text-slate-950`}>
              {role === 'driver' ? 'Set up your account' : 'Complete your profile'}
            </Text>
            <Text className="mt-2 text-base leading-6 text-slate-500">
              {role === 'driver'
                ? 'Enter your name and select the country where you will drive.'
                : `Add your real first name and last name to continue using the ${role} app.`}
            </Text>
          </View>

          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={PRIMARY_BLUE} />
            </View>
          ) : (
            <View className={role === 'driver' ? 'mt-6 rounded-3xl border border-slate-100 bg-white p-5' : 'mt-10'}>
              {!!loadWarning && (
                <View className="mb-4 rounded-xl bg-amber-50 px-4 py-3">
                  <Text className="text-sm leading-5 text-amber-800">{loadWarning}</Text>
                </View>
              )}

              <View className="mb-5 h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
                <Ionicons name="person-outline" size={24} color={PRIMARY_BLUE} />
              </View>
              <Text className="mb-2 text-sm font-medium text-slate-700">First name</Text>
              <TextInput
                className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-base"
                placeholder="Enter your first name"
                placeholderTextColor="#9ca3af"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
              />

              <Text className="mb-2 text-sm font-medium text-slate-700">Last name</Text>
              <TextInput
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-base"
                placeholder="Enter your last name"
                placeholderTextColor="#9ca3af"
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
              />

              <View className="mt-5">
                <CountrySelectField
                  label="Registration country"
                  value={registrationCountryCode}
                  onChange={setRegistrationCountryCode}
                />
              </View>

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

            </View>
          )}

          <View className="mt-auto pt-6">
            <TouchableOpacity
              className="h-14 items-center justify-center rounded-2xl"
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
