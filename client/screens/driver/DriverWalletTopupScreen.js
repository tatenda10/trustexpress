import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { initiateDriverWalletTopup, verifyDriverWalletTopup } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

WebBrowser.maybeCompleteAuthSession();

function formatCardNumber(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 19);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

function parseExpiry(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4);
  return {
    expMonth: digits.slice(0, 2),
    expYear: digits.slice(2, 4),
  };
}

function getCardBrand(cardNumber) {
  const digits = String(cardNumber || '').replace(/\D/g, '');
  if (/^4/.test(digits)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'MC';
  return 'CARD';
}

export default function DriverWalletTopupScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const wallet = route?.params?.wallet || {};
  const providerLabel = wallet.paymentProvider === 'smilepay' ? 'Smile&Pay' : 'Paystack';
  const currency = wallet.currency || 'USD';
  const minAmount = Number(wallet.topupMinAmount || 1);
  const maxAmount = Number(wallet.topupMaxAmount || 500);
  const [amount, setAmount] = useState(String(minAmount || 5));
  const [method, setMethod] = useState(wallet.paymentProvider === 'smilepay' ? 'card' : 'ecocash');
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [ecocashMobile, setEcocashMobile] = useState(
    String(wallet.smileCashMobile || wallet.phoneNumber || '').trim()
  );
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const handleTopup = async () => {
    try {
      const normalizedAmount = Number(String(amount || '').replace(/[^0-9.]/g, ''));
      if (!(normalizedAmount > 0)) {
        Alert.alert('Enter amount', 'Please enter a valid top-up amount.');
        return;
      }
      if (normalizedAmount < minAmount) {
        Alert.alert('Amount too low', `Minimum top-up is ${formatCurrency(minAmount, currency)}.`);
        return;
      }
      if (normalizedAmount > maxAmount) {
        Alert.alert('Amount too high', `Maximum top-up is ${formatCurrency(maxAmount, currency)}.`);
        return;
      }

      const isSmilePayCard = wallet.paymentProvider === 'smilepay' && method === 'card';
      const cleanCardNumber = String(cardNumber || '').replace(/\D/g, '');
      const { expMonth, expYear } = parseExpiry(cardExpiry);
      const cvv = String(cardCvv || '').replace(/\D/g, '');

      if (isSmilePayCard && (cleanCardNumber.length < 12 || !expMonth || !expYear || cvv.length < 3)) {
        Alert.alert('Card details required', 'Enter your card number, expiry date and CVV to continue.');
        return;
      }
      const cleanWalletMobile = String(ecocashMobile || '').replace(/[^\d+]/g, '');
      const isWalletExpress = wallet.paymentProvider === 'smilepay' && (method === 'wallet' || method === 'ecocash');
      if (isWalletExpress && cleanWalletMobile.replace(/\D/g, '').length < 9) {
        Alert.alert(
          method === 'ecocash' ? 'EcoCash number required' : 'Smile&Pay Wallet number required',
          `Enter the ${method === 'ecocash' ? 'EcoCash' : 'Smile&Pay Wallet'} mobile number that should approve this payment.`
        );
        return;
      }

      setStarting(true);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');

      const callbackUrl = ExpoLinking.createURL('driver-wallet-topup');
      const smilePayPayload = method === 'card'
        ? {
            checkoutMode: 'express_mpgs',
            card: {
              pan: cleanCardNumber,
              expMonth,
              expYear,
              securityCode: cvv,
            },
          }
        : {
            checkoutMode: 'express_ecocash',
            mobilePhoneNumber: cleanWalletMobile,
          };

      const topup = await initiateDriverWalletTopup(token, {
        amount: normalizedAmount,
        callbackUrl,
        ...(wallet.paymentProvider === 'smilepay' ? smilePayPayload : {}),
      });

      if (!topup?.authorizationUrl) {
        if (topup?.nextAction === 'poll' || topup?.reference) {
          if (topup?.reference) await verifyDriverWalletTopup(token, topup.reference).catch(() => {});
          Alert.alert('Payment started', 'Smile&Pay Express started. If the bank requires approval, complete it and refresh your wallet.', [
            { text: 'OK', onPress: () => navigation.goBack() },
          ]);
          return;
        }
        throw new Error(`Could not start ${providerLabel} checkout.`);
      }

      const authResult = await WebBrowser.openAuthSessionAsync(topup.authorizationUrl, callbackUrl);
      const references = [topup.reference].filter(Boolean);
      if (authResult?.type === 'success' && authResult?.url) {
        const parsed = ExpoLinking.parse(authResult.url);
        const returnedReference =
          parsed?.queryParams?.reference
          || parsed?.queryParams?.orderReference
          || parsed?.queryParams?.transactionReference;
        if (returnedReference && !references.includes(String(returnedReference))) {
          references.push(String(returnedReference));
        }
      }

      for (const reference of references) {
        await verifyDriverWalletTopup(token, reference).catch(() => {});
      }
      Alert.alert('Payment check complete', 'Your wallet has been refreshed. If payment succeeded, the balance will update shortly.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      Alert.alert('Top-up failed', error?.message || 'Could not start wallet top-up.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <View className="flex-1 bg-gray-50">
      <View
        className="flex-row items-center border-b border-gray-100 bg-white px-5 pb-3"
        style={{ paddingTop: insets.top + 6 }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">Top up wallet</Text>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: Math.max(insets.bottom + 160, 190) }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <View className="rounded-[24px] bg-white px-5 py-5">
            <Text className="text-xs font-semibold uppercase tracking-[2px] text-gray-500">Amount ({currency})</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder={String(minAmount || 5)}
              className="mt-3 h-14 rounded-2xl border border-gray-200 bg-slate-50 px-4 text-center text-lg font-semibold text-gray-900"
            />
          </View>

          {wallet.paymentProvider === 'smilepay' ? (
            <View className="mt-4 rounded-[24px] bg-white px-5 py-5">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-semibold uppercase tracking-[2px] text-gray-500">Select payment method</Text>
                <Text className="text-xs font-semibold" style={{ color: PRIMARY_BLUE }}>Secure</Text>
              </View>
              <View className="mt-3 flex-row gap-3">
                {[
                  { key: 'card', label: 'Credit Card', icon: 'card-outline' },
                  { key: 'wallet', label: 'Smile&Pay Wallet', icon: 'wallet-outline' },
                  { key: 'ecocash', label: 'EcoCash', icon: 'phone-portrait-outline' },
                ].map((option) => {
                  const selected = method === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setMethod(option.key)}
                      disabled={starting}
                      className="min-h-[88px] flex-1 items-center justify-center rounded-xl border-2 px-1"
                      style={{
                        borderColor: selected ? PRIMARY_BLUE : '#e5e7eb',
                        backgroundColor: selected ? '#ffffff' : '#f8fafc',
                      }}
                    >
                      <Ionicons name={option.icon} size={22} color={selected ? PRIMARY_BLUE : '#64748b'} />
                      <Text className="mt-2 text-center text-sm font-semibold" style={{ color: selected ? PRIMARY_BLUE : '#475569' }}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {wallet.paymentProvider === 'smilepay' && method === 'card' ? (
              <View className="mt-4 rounded-[24px] bg-white px-5 py-5">
                <Text className="text-xs font-semibold uppercase tracking-[2px] text-gray-500">Card details</Text>
                <Text className="mt-4 text-xs font-semibold text-gray-700">Card Name</Text>
                <TextInput
                  value={cardName}
                  onChangeText={setCardName}
                  placeholder="Popoola Opeyemi"
                  autoComplete="cc-name"
                  className="mt-2 h-12 rounded bg-gray-100 px-4 text-base text-gray-900"
                />
                <Text className="mt-4 text-xs font-semibold text-gray-700">Card Number</Text>
                <View className="mt-2 h-12 flex-row items-center rounded bg-gray-100 px-4">
                  <TextInput
                    value={cardNumber}
                    onChangeText={(value) => setCardNumber(formatCardNumber(value))}
                    keyboardType="number-pad"
                    placeholder="2763 3482 3580 0394"
                    autoComplete="cc-number"
                    textContentType="creditCardNumber"
                    className="h-12 flex-1 text-base text-gray-900"
                  />
                  <View className="ml-2 rounded-full bg-yellow-400 px-2 py-1">
                    <Text className="text-[10px] font-black text-red-600">{getCardBrand(cardNumber)}</Text>
                  </View>
                </View>
                <View className="mt-4 flex-row gap-4">
                  <View className="flex-1">
                    <Text className="text-xs font-semibold text-gray-700">Expiration</Text>
                    <TextInput
                      value={cardExpiry}
                      onChangeText={(value) => setCardExpiry(formatExpiry(value))}
                      keyboardType="number-pad"
                      placeholder="09/26"
                      maxLength={5}
                      autoComplete="cc-exp"
                      className="mt-2 h-12 rounded bg-gray-100 px-4 text-base text-gray-900"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs font-semibold text-gray-700">CVV</Text>
                    <TextInput
                      value={cardCvv}
                      onChangeText={(value) => setCardCvv(value.replace(/\D/g, '').slice(0, 4))}
                      keyboardType="number-pad"
                      placeholder="799"
                      maxLength={4}
                      secureTextEntry
                      autoComplete="cc-csc"
                      className="mt-2 h-12 rounded bg-gray-100 px-4 text-base text-gray-900"
                    />
                  </View>
                </View>
                <Text className="mt-4 text-xs font-semibold text-gray-700">Postal Code</Text>
                <TextInput
                  value={postalCode}
                  onChangeText={(value) => setPostalCode(value.replace(/[^\d\s-]/g, '').slice(0, 12))}
                  keyboardType="number-pad"
                  placeholder="993483"
                  autoComplete="postal-code"
                  className="mt-2 h-12 rounded bg-gray-100 px-4 text-base tracking-[4px] text-gray-900"
                />
              </View>
          ) : null}

          {wallet.paymentProvider === 'smilepay' && (method === 'wallet' || method === 'ecocash') ? (
            <View className="mt-4 rounded-[24px] bg-blue-50 px-5 py-5">
              <Text className="text-base font-bold text-blue-900">
                {method === 'ecocash' ? 'EcoCash Express' : 'Smile&Pay Wallet Express'}
              </Text>
              <Text className="mt-2 text-sm leading-6 text-blue-800">
                {method === 'ecocash'
                  ? 'Enter the EcoCash number. Smile&Pay will send an approval request to that phone.'
                  : 'Enter the Smile&Pay Wallet number. Smile&Pay will send an approval request to that phone.'}
              </Text>
              <Text className="mt-4 text-xs font-semibold text-blue-900">
                {method === 'ecocash' ? 'EcoCash mobile number' : 'Smile&Pay Wallet mobile number'}
              </Text>
              <TextInput
                value={ecocashMobile}
                onChangeText={(value) => setEcocashMobile(value.replace(/[^\d+]/g, '').slice(0, 15))}
                keyboardType="phone-pad"
                placeholder="0771234567"
                autoComplete="tel"
                className="mt-2 h-12 rounded bg-white px-4 text-base text-gray-900"
              />
            </View>
          ) : null}

          <TouchableOpacity
            onPress={handleTopup}
            disabled={starting}
            className="mt-6 h-14 items-center justify-center rounded-2xl"
            style={{ backgroundColor: PRIMARY_BLUE, opacity: starting ? 0.75 : 1 }}
          >
            {starting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-base font-bold text-white">Continue</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
