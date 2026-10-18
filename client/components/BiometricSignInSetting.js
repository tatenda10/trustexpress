import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Switch,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, useUser } from '../auth/AuthProvider';
import { getAuthErrorMessage, verifyCurrentPassword } from '../auth/authApi';
import { PRIMARY_BLUE } from '../constants/colors';
import {
  BIOMETRIC_LABEL,
  clearBiometricCredentials,
  getBiometricAccount,
  isBiometricSignInSupported,
  isWrongPasswordError,
  saveBiometricCredentials,
} from '../services/biometricSignIn';

export default function BiometricSignInSetting({ role }) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const email = String(user?.primaryEmailAddress?.emailAddress || '').trim().toLowerCase();
  const supported = isBiometricSignInSupported();
  const hasPassword = user?.passwordEnabled !== false;

  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const account = await getBiometricAccount(role);
    setEnabled(Boolean(account) && (!email || account === email));
  }, [email, role]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const closePrompt = () => {
    setShowPasswordPrompt(false);
    setPassword('');
    setShowPassword(false);
    setError('');
  };

  const handleToggle = async (nextValue) => {
    if (busy) return;
    if (!nextValue) {
      setBusy(true);
      await clearBiometricCredentials(role);
      setEnabled(false);
      setBusy(false);
      return;
    }
    setShowPasswordPrompt(true);
  };

  const handleConfirmPassword = async () => {
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await verifyCurrentPassword(await getToken(), password);
    } catch (verifyError) {
      setBusy(false);
      setError(
        isWrongPasswordError(verifyError)
          ? 'That password is not correct.'
          : getAuthErrorMessage(verifyError, 'Could not check your password. Try again.')
      );
      return;
    }
    try {
      await saveBiometricCredentials(role, email, password);
      setEnabled(true);
      closePrompt();
    } catch {
      setError(`${BIOMETRIC_LABEL} was not confirmed. Try again.`);
    } finally {
      setBusy(false);
    }
  };

  let subtitle = `Use ${BIOMETRIC_LABEL} instead of typing your password when you sign in.`;
  if (!supported) subtitle = `Set up ${BIOMETRIC_LABEL} in your phone settings to use this.`;
  else if (!hasPassword) subtitle = 'Only available for accounts that sign in with email and password.';
  else if (!email) subtitle = 'Add an email address to your account to use this.';
  const available = supported && hasPassword && Boolean(email);

  return (
    <>
      <View className="flex-row items-center px-5 py-4">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-[#f3f4f6]">
          <Ionicons name="finger-print" size={22} color="#111827" />
        </View>
        <View className="ml-3 flex-1 pr-3">
          <Text className="text-[15px] font-medium text-gray-900">Sign in with {BIOMETRIC_LABEL}</Text>
          <Text className="mt-0.5 text-sm text-gray-500">{subtitle}</Text>
        </View>
        {busy && !showPasswordPrompt ? (
          <ActivityIndicator size="small" color={PRIMARY_BLUE} />
        ) : (
          <Switch
            value={enabled}
            onValueChange={handleToggle}
            disabled={!available && !enabled}
            trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
            thumbColor={enabled ? PRIMARY_BLUE : '#f9fafb'}
          />
        )}
      </View>

      <Modal visible={showPasswordPrompt} transparent animationType="fade" onRequestClose={closePrompt}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 items-center justify-center bg-black/50 px-6"
        >
          <View className="w-full max-w-[380px] rounded-[24px] bg-white p-5">
            <Text className="text-lg font-bold text-gray-900">Turn on {BIOMETRIC_LABEL} sign-in</Text>
            <Text className="mt-1 text-sm text-gray-500">
              Enter your password once. Next time you can sign in with {BIOMETRIC_LABEL}.
            </Text>
            <View className="mt-4 flex-row items-center rounded-xl border border-gray-200 bg-white px-4">
              <TextInput
                className="flex-1 py-3.5 text-base"
                placeholder="Your password"
                placeholderTextColor="#9ca3af"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoFocus
                editable={!busy}
                onSubmitEditing={handleConfirmPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword((current) => !current)} className="pl-3">
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
            {error ? <Text className="mt-2 text-sm text-red-600">{error}</Text> : null}
            <View className="mt-5 flex-row gap-3">
              <TouchableOpacity
                onPress={closePrompt}
                disabled={busy}
                className="h-12 flex-1 items-center justify-center rounded-[14px] border border-gray-200"
              >
                <Text className="text-sm font-semibold text-gray-700">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmPassword}
                disabled={busy}
                className="h-12 flex-1 items-center justify-center rounded-[14px]"
                style={{ backgroundColor: PRIMARY_BLUE }}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-sm font-semibold text-white">Continue</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
