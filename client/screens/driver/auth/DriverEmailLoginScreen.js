import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSignIn, useAuth, useClerk } from '@clerk/clerk-expo';
import { getMe, registerUser } from '../../../api';

const ROLE_STORAGE_KEY = 'trust_express_role';

const DriverEmailLoginScreen = ({ navigation }) => {
  const { signIn, setActive, isLoaded } = useSignIn();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const ensureDriverRole = async () => {
    const token = await getToken();
    if (!token) return true;
    const profile = await getMe(token);
    if (profile?.role !== 'driver') {
      await AsyncStorage.removeItem(ROLE_STORAGE_KEY).catch(() => {});
      await signOut().catch(() => {});
      Alert.alert(
        'This account is not registered as a driver',
        profile?.role === 'passenger'
          ? 'This email is already registered as a passenger account. Use the passenger app or a different email for driver login.'
          : 'This account is not registered as a driver. Please create a driver account first.',
      );
      return false;
    }
    return true;
  };

  const handleForgotPassword = async () => {
    if (!isLoaded) return;
    const identifier = email.trim();
    if (!identifier) {
      Alert.alert('Email required', 'Enter your email first, then tap Forgot Password.');
      return;
    }

    setLoading(true);
    try {
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier,
      });
      setResetMode(true);
      setResetCode('');
      setNewPassword('');
      setConfirmNewPassword('');
      Alert.alert('Reset code sent', 'Check your email for the password reset code.');
    } catch (error) {
      Alert.alert('Error', error?.errors?.[0]?.message || 'Could not start password reset');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteReset = async () => {
    if (!isLoaded) return;
    const code = resetCode.trim();
    if (!code || !newPassword || !confirmNewPassword) {
      Alert.alert('Missing details', 'Enter code, new password, and confirmation.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      Alert.alert('Passwords do not match', 'New password and confirmation must match.');
      return;
    }

    setLoading(true);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code,
        password: newPassword,
      });
      if (result.status === 'complete') {
        await AsyncStorage.setItem(ROLE_STORAGE_KEY, 'driver');
        await setActive({ session: result.createdSessionId });
        try {
          const token = await getToken();
          if (token) {
            await registerUser(token, { role: 'driver', email: null });
          }
        } catch (e) {
          Alert.alert('Error', e?.message || 'Could not finish account setup.');
          return;
        }
        const allowed = await ensureDriverRole();
        if (!allowed) return;
        setResetMode(false);
        Alert.alert('Success', 'Your password has been reset.');
        return;
      }
      Alert.alert('Error', 'Could not complete password reset. Please check the code and try again.');
    } catch (error) {
      Alert.alert('Error', error?.errors?.[0]?.message || 'Could not reset password');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    if (!isLoaded) return;

    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }

    setLoading(true);
    try {
      const result = await signIn.create({
        strategy: 'password',
        identifier: email.trim(),
        password,
      });

      if (result.status === 'complete') {
        await AsyncStorage.setItem(ROLE_STORAGE_KEY, 'driver');
        await setActive({ session: result.createdSessionId });
        try {
          const token = await getToken();
          if (token) {
            await registerUser(token, { role: 'driver', email: null });
          }
        } catch (e) {
          Alert.alert('Error', e?.message || 'Could not finish account setup.');
          return;
        }
        const allowed = await ensureDriverRole();
        if (!allowed) return;
        navigation.navigate('DriverHome');
      }
    } catch (error) {
      Alert.alert('Error', error.errors?.[0]?.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ flex: 1, padding: 20 }}>
        <View className="mb-8 mt-5">
          <Text className="text-3xl font-bold text-gray-900 mb-2">Sign In</Text>
          <Text className="text-base text-gray-600">Sign in to your driver account</Text>
        </View>

        <View className="gap-4 mb-6">
          <TextInput
            className="border border-gray-300 rounded-xl p-4 text-base bg-gray-50"
            placeholder="Email Address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <TextInput
            className="border border-gray-300 rounded-xl p-4 text-base bg-gray-50"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
          />

          <TouchableOpacity
            className="self-end -mt-2"
            onPress={handleForgotPassword}
          >
            <Text className="text-green-500 text-sm">Forgot Password?</Text>
          </TouchableOpacity>

          {resetMode ? (
            <View className="gap-3 rounded-xl border border-green-100 bg-green-50 p-3">
              <Text className="text-sm font-semibold text-green-900">Complete password reset</Text>
              <TextInput
                className="border border-gray-300 rounded-xl p-3 text-base bg-white"
                placeholder="Reset code"
                value={resetCode}
                onChangeText={setResetCode}
                autoCapitalize="none"
              />
              <TextInput
                className="border border-gray-300 rounded-xl p-3 text-base bg-white"
                placeholder="New password"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoCapitalize="none"
              />
              <TextInput
                className="border border-gray-300 rounded-xl p-3 text-base bg-white"
                placeholder="Confirm new password"
                value={confirmNewPassword}
                onChangeText={setConfirmNewPassword}
                secureTextEntry
                autoCapitalize="none"
              />
              <TouchableOpacity
                className={`bg-green-600 p-3 rounded-xl items-center ${loading ? 'opacity-60' : ''}`}
                onPress={handleCompleteReset}
                disabled={loading}
              >
                <Text className="text-white font-semibold">Reset Password</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity
            className={`bg-green-500 p-4 rounded-xl items-center mt-2 ${loading ? 'opacity-60' : ''}`}
            onPress={handleSignIn}
            disabled={loading}
          >
            <Text className="text-white text-lg font-semibold">
              {loading ? 'Signing In...' : 'Sign In'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          className="items-center p-4"
          onPress={() => navigation.navigate('DriverCreateAccount')}
        >
          <Text className="text-green-500 text-base">
            Don't have an account? Sign Up
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default DriverEmailLoginScreen;
