import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Image,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { KeyboardAwareScrollView, KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSignIn, useOAuth, useAuth, useClerk } from '@clerk/clerk-expo';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AuthFeedbackModal from '../../../components/AuthFeedbackModal';
import { getAuthErrorContent } from '../../../services/authFeedback';
import { getMe } from '../../../api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HEADER_IMAGE_HEIGHT = Dimensions.get('window').height * 0.36;
const AUTH_HEADER_IMAGE = require('../../../assets/passenger-riding.jpg');
const ROLE_STORAGE_KEY = 'trust_express_role';

const PassengerLoginScreen = ({ navigation }) => {
  const { signIn, setActive, isLoaded } = useSignIn();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const { startOAuthFlow: startGoogleOAuth } = useOAuth({ strategy: 'oauth_google' });
  const { startOAuthFlow: startAppleOAuth } = useOAuth({ strategy: 'oauth_apple' });
  const insets = useSafeAreaInsets();

  const getRedirectUrl = useCallback(() => Linking.createURL('oauth-callback', { scheme: 'trustexpress' }), []);
  const [emailOrPhone, setEmailOrPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showEmailCode, setShowEmailCode] = useState(false);
  const [code, setCode] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [modalState, setModalState] = useState({ visible: false, title: '', message: '', tone: 'error' });
  const headerHeight = insets.top + 48;
  const bottomPadding = Math.max(insets.bottom, 24);

  const closeModal = () => setModalState((current) => ({ ...current, visible: false }));

  const showErrorModal = (error, context = 'login') => {
    const content = getAuthErrorContent(error, context);
    setModalState({ visible: true, title: content.title, message: content.message, tone: 'error' });
  };

  const ensurePassengerRole = async () => {
    const token = await getToken();
    if (!token) return true;
    const profile = await getMe(token);
    if (profile?.role !== 'passenger') {
      await AsyncStorage.removeItem(ROLE_STORAGE_KEY).catch(() => {});
      await signOut().catch(() => {});
      setModalState({
        visible: true,
        title: 'This account is not registered as a passenger',
        message:
          profile?.role === 'driver'
            ? 'This email is already registered as a driver account. Please use the driver login side or use a different email for a passenger account.'
            : 'This account is not registered as a passenger. Please create a passenger account first.',
        tone: 'error',
      });
      return false;
    }
    return true;
  };

  const handleLogin = async () => {
    if (!isLoaded) return;
    if (!emailOrPhone || !password) {
      setModalState({
        visible: true,
        title: 'Missing details',
        message: 'Enter both your email and password before you continue.',
        tone: 'info',
      });
      return;
    }

    setLoading(true);
    try {
      const result = await signIn.create({
        strategy: 'password',
        identifier: emailOrPhone.trim(),
        password,
      });

      if (result.status === 'complete') {
        await AsyncStorage.setItem(ROLE_STORAGE_KEY, 'passenger');
        await setActive({ session: result.createdSessionId });
        const allowed = await ensurePassengerRole();
        if (!allowed) return;
        return;
      }

      if (result.status === 'needs_second_factor') {
        const emailFactor = result.supportedSecondFactors?.find((factor) => factor.strategy === 'email_code');
        if (emailFactor?.emailAddressId) {
          await signIn.prepareSecondFactor({ strategy: 'email_code', emailAddressId: emailFactor.emailAddressId });
          setShowEmailCode(true);
          return;
        }
      }

      setModalState({
        visible: true,
        title: 'Login not completed',
        message: 'We could not finish signing you in. Please try again in a moment.',
        tone: 'error',
      });
    } catch (error) {
      showErrorModal(error, 'login');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!isLoaded || !code.trim()) {
      setModalState({
        visible: true,
        title: 'Missing code',
        message: 'Enter the email verification code before you continue.',
        tone: 'info',
      });
      return;
    }

    setLoading(true);
    try {
      const result = await signIn.attemptSecondFactor({ strategy: 'email_code', code: code.trim() });
      if (result.status === 'complete') {
        await AsyncStorage.setItem(ROLE_STORAGE_KEY, 'passenger');
        await setActive({ session: result.createdSessionId });
        const allowed = await ensurePassengerRole();
        if (!allowed) return;
      } else {
        setModalState({
          visible: true,
          title: 'Verification not completed',
          message: 'We still need a valid code before you can continue.',
          tone: 'error',
        });
      }
    } catch (error) {
      showErrorModal(error, 'verify');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!isLoaded || loading) return;
    setLoading(true);
    try {
      const { createdSessionId, setActive: setActiveSession } = await startGoogleOAuth({
        redirectUrl: getRedirectUrl(),
      });
      if (createdSessionId && setActiveSession) {
        await AsyncStorage.setItem(ROLE_STORAGE_KEY, 'passenger');
        await setActiveSession({ session: createdSessionId });
        const allowed = await ensurePassengerRole();
        if (!allowed) return;
      }
    } catch (error) {
      showErrorModal(error, 'login');
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (!isLoaded || loading) return;
    setLoading(true);
    try {
      const { createdSessionId, setActive: setActiveSession } = await startAppleOAuth({
        redirectUrl: getRedirectUrl(),
      });
      if (createdSessionId && setActiveSession) {
        await AsyncStorage.setItem(ROLE_STORAGE_KEY, 'passenger');
        await setActiveSession({ session: createdSessionId });
        const allowed = await ensurePassengerRole();
        if (!allowed) return;
      }
    } catch (error) {
      showErrorModal(error, 'login');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!isLoaded) return;
    const identifier = emailOrPhone.trim();
    if (!identifier) {
      setModalState({
        visible: true,
        title: 'Email required',
        message: 'Enter your email first, then tap Forgot Password.',
        tone: 'info',
      });
      return;
    }

    setLoading(true);
    try {
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier,
      });
      setShowResetPassword(true);
      setResetCode('');
      setNewPassword('');
      setConfirmNewPassword('');
      setModalState({
        visible: true,
        title: 'Reset code sent',
        message: 'Check your email for the reset code, then enter it with your new password.',
        tone: 'info',
      });
    } catch (error) {
      showErrorModal(error, 'forgot-password');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!isLoaded) return;
    const trimmedCode = resetCode.trim();
    if (!trimmedCode || !newPassword || !confirmNewPassword) {
      setModalState({
        visible: true,
        title: 'Missing details',
        message: 'Enter reset code, new password, and confirmation.',
        tone: 'info',
      });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setModalState({
        visible: true,
        title: 'Passwords do not match',
        message: 'New password and confirmation must match.',
        tone: 'error',
      });
      return;
    }

    setLoading(true);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: trimmedCode,
        password: newPassword,
      });

      if (result.status === 'complete') {
        await AsyncStorage.setItem(ROLE_STORAGE_KEY, 'passenger');
        await setActive({ session: result.createdSessionId });
        const allowed = await ensurePassengerRole();
        if (!allowed) return;
        setShowResetPassword(false);
        setModalState({
          visible: true,
          title: 'Password updated',
          message: 'Your password has been reset successfully.',
          tone: 'info',
        });
        return;
      }

      setModalState({
        visible: true,
        title: 'Reset not completed',
        message: 'We could not complete the password reset. Please verify the code and try again.',
        tone: 'error',
      });
    } catch (error) {
      showErrorModal(error, 'forgot-password');
    } finally {
      setLoading(false);
    }
  };

  if (showEmailCode) {
    return (
      <View className="flex-1 bg-white">
        <View
          className="flex-row items-center border-b border-gray-100 bg-white"
          style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12, minHeight: headerHeight }}
        >
          <TouchableOpacity
            onPress={() => {
              setShowEmailCode(false);
              setCode('');
            }}
            className="p-2 -ml-2"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
        </View>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: bottomPadding }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="mb-1.5 text-2xl font-bold text-gray-900">Verify your email</Text>
          <Text className="mb-6 text-sm text-gray-600">A verification code has been sent to your email.</Text>
          <View className="mb-4">
            <Text className="mb-2 text-sm font-medium text-gray-700">Verification code</Text>
            <TextInput
              className="rounded-xl border border-gray-200 bg-white p-4 text-base"
              placeholder="Enter code"
              placeholderTextColor="#9ca3af"
              value={code}
              onChangeText={setCode}
              keyboardType="numeric"
              autoCapitalize="none"
            />
          </View>
          <TouchableOpacity
            className={`flex-row items-center justify-center gap-2 rounded-xl p-4 ${loading ? 'opacity-90' : ''}`}
            style={{ backgroundColor: '#374151' }}
            onPress={handleVerifyCode}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text className="text-lg font-semibold text-white">Verify</Text>
                <Ionicons name="checkmark-circle" size={20} color="white" />
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
        <AuthFeedbackModal
          visible={modalState.visible}
          title={modalState.title}
          message={modalState.message}
          tone={modalState.tone}
          onPrimary={closeModal}
        />
      </View>
    );
  }

  if (showResetPassword) {
    return (
      <View className="flex-1 bg-white">
        <View
          className="flex-row items-center border-b border-gray-100 bg-white"
          style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12, minHeight: headerHeight }}
        >
          <TouchableOpacity
            onPress={() => {
              setShowResetPassword(false);
              setResetCode('');
              setNewPassword('');
              setConfirmNewPassword('');
            }}
            className="p-2 -ml-2"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
        </View>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: bottomPadding }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="mb-1.5 text-2xl font-bold text-gray-900">Reset password</Text>
          <Text className="mb-6 text-sm text-gray-600">Enter the reset code sent to your email and choose a new password.</Text>
          <View className="mb-3">
            <Text className="mb-2 text-sm font-medium text-gray-700">Reset code</Text>
            <TextInput
              className="rounded-xl border border-gray-200 bg-white p-4 text-base"
              placeholder="Enter reset code"
              placeholderTextColor="#9ca3af"
              value={resetCode}
              onChangeText={setResetCode}
              autoCapitalize="none"
            />
          </View>
          <View className="mb-3">
            <Text className="mb-2 text-sm font-medium text-gray-700">New password</Text>
            <TextInput
              className="rounded-xl border border-gray-200 bg-white p-4 text-base"
              placeholder="Enter new password"
              placeholderTextColor="#9ca3af"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>
          <View className="mb-4">
            <Text className="mb-2 text-sm font-medium text-gray-700">Confirm new password</Text>
            <TextInput
              className="rounded-xl border border-gray-200 bg-white p-4 text-base"
              placeholder="Confirm new password"
              placeholderTextColor="#9ca3af"
              value={confirmNewPassword}
              onChangeText={setConfirmNewPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>
          <TouchableOpacity
            className={`flex-row items-center justify-center gap-2 rounded-xl p-4 ${loading ? 'opacity-90' : ''}`}
            style={{ backgroundColor: '#374151' }}
            onPress={handleResetPassword}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text className="text-base font-semibold text-white">Reset Password</Text>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
        <AuthFeedbackModal
          visible={modalState.visible}
          title={modalState.title}
          message={modalState.message}
          tone={modalState.tone}
          onPrimary={closeModal}
        />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <TouchableOpacity
        className="absolute left-4 z-10 h-10 w-10 items-center justify-center rounded-full"
        style={{ top: Math.max(insets.top, 12) + 8, backgroundColor: 'rgba(255,255,255,0.85)' }}
        onPress={() => navigation.goBack()}
      >
        <Ionicons name="close" size={22} color="#374151" />
      </TouchableOpacity>

      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={0}
        style={{ flex: 1 }}
      >
        <KeyboardAwareScrollView
          bottomOffset={24}
          extraKeyboardSpace={120}
          disableScrollOnKeyboardHide
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ width: SCREEN_WIDTH, height: HEADER_IMAGE_HEIGHT }} className="relative overflow-hidden bg-gray-100">
            <Image source={AUTH_HEADER_IMAGE} style={{ width: SCREEN_WIDTH, height: HEADER_IMAGE_HEIGHT }} resizeMode="cover" />
          </View>

          <View className="flex-1 bg-white px-6 pb-2 pt-8">
            <Text className="mb-1 text-center text-sm tracking-[0.3em] text-gray-500">TRUST EXPRESS</Text>
            <View className="mb-6">
              <Text className="mb-1 text-2xl font-semibold text-gray-900">Welcome back</Text>
              <Text className="text-sm text-gray-500">Log in to your passenger account to continue.</Text>
            </View>

            <View className="mb-6 gap-4">
              <View>
                <Text className="mb-2 text-sm font-medium text-gray-700">Email</Text>
                <TextInput
                  className="rounded-xl border border-gray-200 bg-white p-4 text-base"
                  placeholder="Enter your email"
                  placeholderTextColor="#9ca3af"
                  value={emailOrPhone}
                  onChangeText={setEmailOrPhone}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

            <View>
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="text-sm font-medium text-gray-700">Password</Text>
                  <TouchableOpacity
                    onPress={handleForgotPassword}
                  >
                    <Text className="text-sm font-medium text-primary">Forgot Password?</Text>
                  </TouchableOpacity>
              </View>
                <View className="flex-row items-center rounded-xl border border-gray-200 bg-white px-4">
                  <TextInput
                    className="flex-1 py-4 text-base"
                    placeholder="Enter your password"
                    placeholderTextColor="#9ca3af"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowPassword((current) => !current)} className="pl-3">
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color="#6b7280" />
                  </TouchableOpacity>
                </View>
            </View>

              <TouchableOpacity
                className={`flex-row items-center justify-center gap-2 rounded-xl p-4 ${loading ? 'opacity-90' : ''}`}
                style={{ backgroundColor: '#374151' }}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text className="text-base font-semibold text-white">Continue</Text>
                    <Ionicons name="arrow-forward" size={18} color="#fff" />
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/*
            <View className="mb-5 flex-row items-center">
              <View className="h-px flex-1 bg-gray-200" />
              <Text className="mx-3 text-xs text-gray-400">or</Text>
              <View className="h-px flex-1 bg-gray-200" />
            </View>

            <View className="mb-6 gap-3">
              <TouchableOpacity
                className={`flex-row items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white p-4 ${loading ? 'opacity-60' : ''}`}
                onPress={handleGoogleSignIn}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#4285F4" />
                ) : (
                  <>
                    <Ionicons name="logo-google" size={24} color="#4285F4" />
                    <Text className="text-base font-medium text-gray-900">Continue with Google</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                className={`flex-row items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white p-4 ${loading ? 'opacity-60' : ''}`}
                onPress={handleAppleSignIn}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <>
                    <Ionicons name="logo-apple" size={24} color="#000" />
                    <Text className="text-base font-medium text-gray-900">Continue with Apple</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
            */}

            <View className="items-center" style={{ paddingBottom: Math.max(insets.bottom, 32) }}>
              <Text className="text-sm text-gray-600">
                New to Trust Express?{' '}
                <Text className="font-semibold text-primary" onPress={() => navigation.navigate('PassengerCreateAccount')}>
                  Create Account
                </Text>
              </Text>
            </View>
          </View>
        </KeyboardAwareScrollView>
      </KeyboardAvoidingView>

      <AuthFeedbackModal
        visible={modalState.visible}
        title={modalState.title}
        message={modalState.message}
        tone={modalState.tone}
        onPrimary={closeModal}
      />
    </SafeAreaView>
  );
};

export default PassengerLoginScreen;
