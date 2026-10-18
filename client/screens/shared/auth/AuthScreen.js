import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { KeyboardAwareScrollView, KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AuthFeedbackModal from '../../../components/AuthFeedbackModal';
import { useSignIn } from '../../../auth/AuthProvider';
import {
  completePhoneSignUp,
  emailSignIn,
  emailSignUp,
  forgotPassword,
  getAuthErrorMessage,
  resendEmailCode,
  resetPassword,
  sendPhoneCode,
  verifyEmailCode,
  verifyPhoneCode,
} from '../../../auth/authApi';
import { lookupAccountRole, registerUser } from '../../../api';
import { useAgentInvite } from '../../../context/AgentInviteContext';
import { usePassengerReferral } from '../../../context/PassengerReferralContext';
import {
  BIOMETRIC_LABEL,
  clearBiometricCredentials,
  getBiometricAccount,
  isWrongPasswordError,
  offerBiometricSignIn,
  readBiometricCredentials,
} from '../../../services/biometricSignIn';

const ROLE_STORAGE_KEY = 'trust_express_role';
// TODO: re-enable WhatsApp OTP once the WhatsApp template is approved.
const WHATSAPP_OTP_ENABLED = false;
const DEFAULT_PHONE_CHANNEL = WHATSAPP_OTP_ENABLED ? 'whatsapp' : 'sms';
const CHANNEL_LABELS = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'email' };

function Field({ label, right, children }) {
  return (
    <View>
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-sm font-medium text-gray-700">{label}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function Input(props) {
  return (
    <TextInput
      className="rounded-xl border border-gray-200 bg-white p-4 text-base"
      placeholderTextColor="#9ca3af"
      autoCapitalize="none"
      {...props}
    />
  );
}

function PasswordInput({ value, onChangeText, placeholder, onSubmitEditing }) {
  const [visible, setVisible] = useState(false);
  return (
    <View className="flex-row items-center rounded-xl border border-gray-200 bg-white px-4">
      <TextInput
        className="flex-1 py-4 text-base"
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!visible}
        autoCapitalize="none"
        onSubmitEditing={onSubmitEditing}
      />
      <TouchableOpacity onPress={() => setVisible((current) => !current)} className="pl-3">
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={22} color="#6b7280" />
      </TouchableOpacity>
    </View>
  );
}

function PrimaryButton({ label, onPress, loading, icon = 'arrow-forward' }) {
  return (
    <TouchableOpacity
      className={`flex-row items-center justify-center gap-2 rounded-xl p-4 ${loading ? 'opacity-90' : ''}`}
      style={{ backgroundColor: '#374151' }}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <>
          <Text className="text-base font-semibold text-white">{label}</Text>
          <Ionicons name={icon} size={18} color="#fff" />
        </>
      )}
    </TouchableOpacity>
  );
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <View className="flex-row rounded-xl bg-gray-100 p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <TouchableOpacity
            key={option.value}
            onPress={() => onChange(option.value)}
            className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-2.5 ${active ? 'bg-white' : ''}`}
            style={active ? { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 1 } : null}
          >
            {option.icon ? <Ionicons name={option.icon} size={16} color={active ? '#111827' : '#6b7280'} /> : null}
            <Text className={`text-sm font-semibold ${active ? 'text-gray-900' : 'text-gray-500'}`}>{option.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function useCountdown() {
  const [secondsLeft, setSecondsLeft] = useState(0);
  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setTimeout(() => setSecondsLeft((current) => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);
  return [secondsLeft, setSecondsLeft];
}

/**
 * Sign-in and sign-up for one role. Steps: main form, email code, phone code, name for new phone
 * accounts, forgot password, reset password.
 */
export default function AuthScreen({ navigation, role, mode }) {
  const isSignUp = mode === 'sign_up';
  const otherRole = role === 'driver' ? 'passenger' : 'driver';
  const insets = useSafeAreaInsets();
  const { completeSignIn } = useSignIn();
  const { inviteToken, clearInvite } = useAgentInvite();
  const { referrerEmail, clearReferral } = usePassengerReferral();

  const [step, setStep] = useState('main');
  const [method, setMethod] = useState('email');
  const [loading, setLoading] = useState(false);
  const [modalState, setModalState] = useState({ visible: false, title: '', message: '', tone: 'error' });

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState(DEFAULT_PHONE_CHANNEL);
  const [code, setCode] = useState('');
  const [signupToken, setSignupToken] = useState('');
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetChannel, setResetChannel] = useState('email');
  const [biometricAccount, setBiometricAccount] = useState(null);
  const [resendIn, setResendIn] = useCountdown();
  const createdAccountRef = useRef(false);

  useEffect(() => {
    if (isSignUp) return undefined;
    let cancelled = false;
    getBiometricAccount(role).then((account) => {
      if (cancelled) return;
      setBiometricAccount(account);
      if (account) setEmail((current) => current || account);
    });
    return () => {
      cancelled = true;
    };
  }, [isSignUp, role]);

  const closeModal = () => setModalState((current) => ({ ...current, visible: false }));
  const showInfo = (title, message) => setModalState({ visible: true, title, message, tone: 'info' });
  const showError = (title, message) => setModalState({ visible: true, title, message, tone: 'error' });
  const showApiError = (error, title = 'Something went wrong') => showError(title, getAuthErrorMessage(error));

  const goToStep = (nextStep) => {
    setCode('');
    setStep(nextStep);
  };

  /** Shared finish for every flow that ends with a session. */
  const finishSignIn = async (result, { biometricPassword } = {}) => {
    await AsyncStorage.setItem(ROLE_STORAGE_KEY, role);
    if (createdAccountRef.current) {
      await registerUser(result.accessToken, {
        role,
        email: result.user?.email || undefined,
        inviteToken: inviteToken || undefined,
        ...(role === 'passenger' && referrerEmail ? { referrerEmail } : {}),
      })
        .then(() => {
          if (inviteToken) clearInvite().catch(() => {});
          if (role === 'passenger' && referrerEmail) clearReferral().catch(() => {});
        })
        .catch((error) => console.warn('[AuthScreen] registerUser after sign-up failed', error?.message));
    }
    if (biometricPassword && result.user?.email) {
      await offerBiometricSignIn(role, result.user.email, biometricPassword);
    }
    await completeSignIn(result);
  };

  /** Accounts are per role; point people to the other side when their email belongs there. */
  const explainWrongSide = async (identifier) => {
    try {
      const lookup = await lookupAccountRole(identifier);
      if (lookup?.exists && lookup?.role === otherRole) {
        showError(
          `This is a ${otherRole} account`,
          `${identifier} is registered as a ${otherRole}. Go back and choose ${otherRole === 'driver' ? 'Driver' : 'Passenger'} to sign in.`
        );
        return true;
      }
    } catch {
      // Lookup is only a hint.
    }
    return false;
  };

  // ---------- Email ----------

  const signInWithEmail = async (identifier, secret, { fromBiometric = false } = {}) => {
    const result = await emailSignIn({ email: identifier.trim(), password: secret, role });
    if (result.status === 'verify_email') {
      setResendIn(result.resendAfterSeconds || 30);
      goToStep('email_code');
      return;
    }
    await finishSignIn(result, { biometricPassword: fromBiometric ? null : secret });
  };

  const handleEmailSignIn = async () => {
    if (!email.trim() || !password) {
      showInfo('Missing details', 'Enter both your email and password before you continue.');
      return;
    }
    setLoading(true);
    try {
      await signInWithEmail(email, password);
    } catch (error) {
      if (error?.code === 'PASSWORD_RESET_REQUIRED') {
        setResetIdentifier(email.trim());
        setResetChannel('email');
        showInfo('Set a new password', 'For your security, please set a new password. We will send a code to your email.');
        goToStep('forgot');
      } else if (error?.code === 'INVALID_CREDENTIALS' && await explainWrongSide(email.trim())) {
        // Explained in the modal.
      } else {
        showApiError(error, 'Could not sign in');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricSignIn = async () => {
    if (loading) return;
    let credentials;
    try {
      credentials = await readBiometricCredentials(role);
    } catch {
      setBiometricAccount(null);
      showInfo(`${BIOMETRIC_LABEL} sign-in reset`, `Sign in with your password once to turn ${BIOMETRIC_LABEL} sign-in back on.`);
      return;
    }
    if (!credentials) return;
    setLoading(true);
    try {
      await signInWithEmail(credentials.identifier, credentials.password, { fromBiometric: true });
    } catch (error) {
      if (isWrongPasswordError(error) || error?.code === 'PASSWORD_RESET_REQUIRED') {
        await clearBiometricCredentials(role);
        setBiometricAccount(null);
        showError('Password changed', `Your saved login no longer works. Sign in with your password to turn ${BIOMETRIC_LABEL} sign-in back on.`);
      } else {
        showApiError(error, 'Could not sign in');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignUp = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password || !confirmPassword) {
      showInfo('Missing details', 'Fill in your first name, last name, email and password.');
      return;
    }
    if (password.length < 8) {
      showInfo('Password too short', 'Use at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      showError('Passwords do not match', 'Your password and confirm password need to match.');
      return;
    }
    setLoading(true);
    try {
      const result = await emailSignUp({ email: email.trim(), password, firstName: firstName.trim(), lastName: lastName.trim(), role });
      createdAccountRef.current = true;
      setResendIn(result.resendAfterSeconds || 30);
      goToStep('email_code');
    } catch (error) {
      if (error?.code === 'EMAIL_IN_USE') {
        showError('Account already exists', 'That email already has an account. Please sign in instead.');
      } else {
        showApiError(error, 'Could not create account');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmail = async () => {
    if (!code.trim()) {
      showInfo('Missing code', 'Enter the code we sent to your email.');
      return;
    }
    setLoading(true);
    try {
      const result = await verifyEmailCode({ email: email.trim(), role, code: code.trim() });
      await finishSignIn(result, { biometricPassword: password || null });
    } catch (error) {
      showApiError(error, 'Code not accepted');
    } finally {
      setLoading(false);
    }
  };

  const handleResendEmailCode = async () => {
    if (resendIn > 0 || loading) return;
    setLoading(true);
    try {
      const result = await resendEmailCode({ email: email.trim(), role });
      setResendIn(result.resendAfterSeconds || 30);
      showInfo('Code sent', `We sent a new code to ${email.trim()}.`);
    } catch (error) {
      showApiError(error, 'Could not send code');
    } finally {
      setLoading(false);
    }
  };

  // ---------- Phone ----------

  const requestPhoneCode = async (nextChannel = channel) => {
    if (!phone.trim()) {
      showInfo('Phone number needed', 'Enter your phone number, e.g. 0771234567.');
      return false;
    }
    setLoading(true);
    try {
      const result = await sendPhoneCode({ phone: phone.trim(), role, channel: nextChannel });
      setChannel(nextChannel);
      setResendIn(result.resendAfterSeconds || 30);
      return true;
    } catch (error) {
      if (error?.retryAfterSeconds) setResendIn(error.retryAfterSeconds);
      showApiError(error, 'Could not send code');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleSendPhoneCode = async () => {
    if (await requestPhoneCode()) goToStep('phone_code');
  };

  const handleVerifyPhone = async () => {
    if (!code.trim()) {
      showInfo('Missing code', `Enter the code we sent by ${CHANNEL_LABELS[channel]}.`);
      return;
    }
    setLoading(true);
    try {
      const result = await verifyPhoneCode({ phone: phone.trim(), role, code: code.trim() });
      if (result.status === 'needs_profile') {
        setSignupToken(result.signupToken);
        goToStep('phone_profile');
        return;
      }
      await finishSignIn(result);
    } catch (error) {
      showApiError(error, 'Code not accepted');
    } finally {
      setLoading(false);
    }
  };

  const handleCompletePhoneProfile = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      showInfo('Name needed', 'Enter your first and last name.');
      return;
    }
    setLoading(true);
    try {
      const result = await completePhoneSignUp({
        signupToken,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || undefined,
      });
      createdAccountRef.current = true;
      await finishSignIn(result);
    } catch (error) {
      if (error?.code === 'SIGNUP_EXPIRED') {
        showError('Code expired', 'Please request a new code.');
        goToStep('main');
      } else {
        showApiError(error, 'Could not create account');
      }
    } finally {
      setLoading(false);
    }
  };

  // ---------- Password reset ----------

  const startForgotPassword = () => {
    setResetIdentifier(method === 'phone' ? phone.trim() : email.trim());
    setResetChannel(method === 'phone' ? DEFAULT_PHONE_CHANNEL : 'email');
    goToStep('forgot');
  };

  const resetUsesPhone = Boolean(resetIdentifier.trim()) && !resetIdentifier.includes('@');

  const handleSendResetCode = async () => {
    const identifier = resetIdentifier.trim();
    if (!identifier) {
      showInfo('Email or phone needed', 'Enter the email or phone number on your account.');
      return;
    }
    const sendChannel = resetUsesPhone ? (resetChannel === 'email' ? DEFAULT_PHONE_CHANNEL : resetChannel) : 'email';
    setLoading(true);
    try {
      const result = await forgotPassword({ identifier, role, channel: sendChannel });
      setResetChannel(sendChannel);
      setResendIn(result.resendAfterSeconds || 30);
      setPassword('');
      setConfirmPassword('');
      goToStep('reset');
    } catch (error) {
      showApiError(error, 'Could not send code');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!code.trim() || !password || !confirmPassword) {
      showInfo('Missing details', 'Enter the code, your new password and the confirmation.');
      return;
    }
    if (password.length < 8) {
      showInfo('Password too short', 'Use at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      showError('Passwords do not match', 'New password and confirmation must match.');
      return;
    }
    setLoading(true);
    try {
      const result = await resetPassword({
        identifier: resetIdentifier.trim(),
        role,
        channel: resetChannel,
        code: code.trim(),
        newPassword: password,
      });
      await clearBiometricCredentials(role);
      await finishSignIn(result, { biometricPassword: password });
    } catch (error) {
      showApiError(error, 'Could not reset password');
    } finally {
      setLoading(false);
    }
  };

  // ---------- UI ----------

  const resendLink = (onPress, label = 'Resend code') => (
    <TouchableOpacity onPress={onPress} disabled={resendIn > 0 || loading} className="mt-4 items-center">
      <Text className={`text-sm font-medium ${resendIn > 0 ? 'text-gray-400' : 'text-primary'}`}>
        {resendIn > 0 ? `${label} in ${resendIn}s` : label}
      </Text>
    </TouchableOpacity>
  );

  const channelPicker = (value, onChange) => (
    <View>
      <Text className="mb-2 text-sm font-medium text-gray-700">Send the code by</Text>
      <SegmentedControl
        value={value}
        onChange={onChange}
        options={[
          { value: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' },
          { value: 'sms', label: 'SMS', icon: 'chatbubble-outline' },
        ]}
      />
    </View>
  );

  let title;
  let subtitle;
  let body;
  let onBack = () => goToStep('main');

  if (step === 'email_code') {
    title = 'Verify your email';
    subtitle = `Enter the 6-digit code we sent to ${email.trim()}.`;
    body = (
      <>
        <Field label="Verification code">
          <Input placeholder="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoFocus />
        </Field>
        <PrimaryButton label="Verify" icon="checkmark-circle" onPress={handleVerifyEmail} loading={loading} />
        {resendLink(handleResendEmailCode)}
      </>
    );
  } else if (step === 'phone_code') {
    const otherChannel = channel === 'whatsapp' ? 'sms' : 'whatsapp';
    title = 'Enter your code';
    subtitle = `We sent a 6-digit code by ${CHANNEL_LABELS[channel]} to ${phone.trim()}.`;
    body = (
      <>
        <Field label="Verification code">
          <Input placeholder="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoFocus />
        </Field>
        <PrimaryButton label="Continue" onPress={handleVerifyPhone} loading={loading} />
        {resendLink(() => requestPhoneCode(channel))}
        {WHATSAPP_OTP_ENABLED ? (
          <TouchableOpacity onPress={() => requestPhoneCode(otherChannel)} disabled={resendIn > 0 || loading} className="mt-3 items-center">
            <Text className={`text-sm font-medium ${resendIn > 0 ? 'text-gray-400' : 'text-primary'}`}>
              Send by {CHANNEL_LABELS[otherChannel]} instead
            </Text>
          </TouchableOpacity>
        ) : null}
      </>
    );
  } else if (step === 'phone_profile') {
    title = 'Your details';
    subtitle = 'New here? Tell us your name to finish creating your account.';
    body = (
      <>
        <Field label="First name">
          <Input placeholder="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
        </Field>
        <Field label="Last name">
          <Input placeholder="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="words" />
        </Field>
        <Field label="Email (optional)">
          <Input placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" />
        </Field>
        <PrimaryButton label="Create account" onPress={handleCompletePhoneProfile} loading={loading} />
      </>
    );
  } else if (step === 'forgot') {
    title = 'Forgot password';
    subtitle = 'Enter the email or phone number on your account and we will send you a code.';
    body = (
      <>
        <Field label="Email or phone number">
          <Input placeholder="you@example.com or 0771234567" value={resetIdentifier} onChangeText={setResetIdentifier} />
        </Field>
        {resetUsesPhone && WHATSAPP_OTP_ENABLED
          ? channelPicker(resetChannel === 'email' ? DEFAULT_PHONE_CHANNEL : resetChannel, setResetChannel)
          : null}
        <PrimaryButton label="Send code" onPress={handleSendResetCode} loading={loading} />
      </>
    );
  } else if (step === 'reset') {
    title = 'Set a new password';
    subtitle = `Enter the code we sent by ${CHANNEL_LABELS[resetChannel]} and choose a new password.`;
    onBack = () => goToStep('forgot');
    body = (
      <>
        <Field label="Code">
          <Input placeholder="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
        </Field>
        <Field label="New password">
          <PasswordInput placeholder="At least 8 characters" value={password} onChangeText={setPassword} />
        </Field>
        <Field label="Confirm new password">
          <PasswordInput placeholder="Repeat new password" value={confirmPassword} onChangeText={setConfirmPassword} />
        </Field>
        <PrimaryButton label="Reset password" icon="checkmark-circle" onPress={handleResetPassword} loading={loading} />
        {resendLink(handleSendResetCode)}
      </>
    );
  } else {
    onBack = null;
    title = isSignUp ? 'Create your account' : 'Welcome back';
    subtitle = isSignUp
      ? `Sign up as a ${role} with your email or phone number.`
      : `Log in to your ${role} account to continue.`;
    body = (
      <>
        <SegmentedControl
          value={method}
          onChange={setMethod}
          options={[
            { value: 'email', label: 'Email', icon: 'mail-outline' },
            { value: 'phone', label: 'Phone', icon: 'call-outline' },
          ]}
        />
        {method === 'phone' ? (
          <>
            <Field label="Phone number">
              <Input placeholder="0771234567" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            </Field>
            {WHATSAPP_OTP_ENABLED ? channelPicker(channel, setChannel) : null}
            <PrimaryButton label="Send code" onPress={handleSendPhoneCode} loading={loading} />
          </>
        ) : isSignUp ? (
          <>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field label="First name">
                  <Input placeholder="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
                </Field>
              </View>
              <View className="flex-1">
                <Field label="Last name">
                  <Input placeholder="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="words" />
                </Field>
              </View>
            </View>
            <Field label="Email">
              <Input placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" />
            </Field>
            <Field label="Password">
              <PasswordInput placeholder="At least 8 characters" value={password} onChangeText={setPassword} />
            </Field>
            <Field label="Confirm password">
              <PasswordInput placeholder="Repeat password" value={confirmPassword} onChangeText={setConfirmPassword} />
            </Field>
            <PrimaryButton label="Create account" onPress={handleEmailSignUp} loading={loading} />
          </>
        ) : (
          <>
            <Field label="Email">
              <Input placeholder="Enter your email" value={email} onChangeText={setEmail} keyboardType="email-address" />
            </Field>
            <Field
              label="Password"
              right={(
                <TouchableOpacity onPress={startForgotPassword}>
                  <Text className="text-sm font-medium text-primary">Forgot Password?</Text>
                </TouchableOpacity>
              )}
            >
              <PasswordInput placeholder="Enter your password" value={password} onChangeText={setPassword} onSubmitEditing={handleEmailSignIn} />
            </Field>
            <PrimaryButton label="Continue" onPress={handleEmailSignIn} loading={loading} />
            {biometricAccount ? (
              <TouchableOpacity
                className={`items-center rounded-xl border border-gray-200 bg-white p-4 ${loading ? 'opacity-60' : ''}`}
                onPress={handleBiometricSignIn}
                disabled={loading}
              >
                <View className="flex-row items-center gap-2">
                  <Ionicons name="finger-print" size={22} color="#374151" />
                  <Text className="text-base font-semibold text-gray-900">Sign in with {BIOMETRIC_LABEL}</Text>
                </View>
                <Text className="mt-1 text-xs text-gray-500" numberOfLines={1}>{biometricAccount}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </>
    );
  }

  const switchRoute = role === 'driver'
    ? (isSignUp ? 'DriverLogin' : 'DriverCreateAccount')
    : (isSignUp ? 'PassengerLogin' : 'PassengerCreateAccount');

  return (
    <View className="flex-1 bg-white">
      <TouchableOpacity
        className="absolute left-4 z-10 h-10 w-10 items-center justify-center rounded-full"
        style={{ top: Math.max(insets.top, 12) + 8, backgroundColor: 'rgba(255,255,255,0.85)' }}
        onPress={onBack || (() => navigation.goBack())}
      >
        <Ionicons name={onBack ? 'arrow-back' : 'close'} size={22} color="#374151" />
      </TouchableOpacity>

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1 }}>
        <KeyboardAwareScrollView
          bottomOffset={24}
          extraKeyboardSpace={120}
          disableScrollOnKeyboardHide
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ height: Math.max(insets.top, 12) + 56 }} />

          <View className="flex-1 bg-white px-6 pb-2 pt-8">
            {step === 'main' ? (
              <Text className="mb-6 text-center text-[28px] font-extrabold tracking-[0.15em] text-gray-900">TRUST EXPRESS</Text>
            ) : null}
            <View className="mb-6">
              <Text className={`mb-1 font-semibold text-gray-900 ${step === 'main' ? 'text-lg' : 'text-2xl'}`}>{title}</Text>
              <Text className="text-sm text-gray-500">{subtitle}</Text>
            </View>

            <View className="mb-6 gap-4">{body}</View>

            {step === 'main' ? (
              <View className="items-center" style={{ paddingBottom: Math.max(insets.bottom, 32) }}>
                <Text className="text-sm text-gray-600">
                  {isSignUp ? 'Already have an account? ' : 'New to Trust Express? '}
                  <Text className="font-semibold text-primary" onPress={() => navigation.replace(switchRoute)}>
                    {isSignUp ? 'Log in' : 'Create Account'}
                  </Text>
                </Text>
              </View>
            ) : null}
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
    </View>
  );
}
