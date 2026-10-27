import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../auth/AuthProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { initiateDriverWalletTopup, verifyDriverWalletTopup } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

WebBrowser.maybeCompleteAuthSession();

const QUICK_AMOUNTS = [5, 10, 20, 50];

const SMILEPAY_METHODS = [
  { key: 'ecocash', label: 'EcoCash', subtitle: 'Approve on your phone', icon: 'phone-portrait-outline' },
  { key: 'card', label: 'Card', subtitle: 'Visa or Mastercard', icon: 'card-outline' },
  { key: 'wallet', label: 'Smile&Pay Wallet', subtitle: 'Pay from your wallet', icon: 'wallet-outline' },
];

function formatCurrency(value, currency = 'USD') {
  const amount = Number(value || 0);
  return `${currency === 'USD' ? '$' : `${currency} `}${amount.toFixed(2)}`;
}

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
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  return null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSuccessfulTopup(result) {
  const status = String(result?.topup?.status || result?.status || '').trim().toLowerCase();
  return status === 'success' || status === 'successful' || status === 'paid' || status === 'completed';
}

function Field({ label, children }) {
  return (
    <View className="mt-3">
      <Text className="mb-1.5 text-[12px] font-medium text-gray-500">{label}</Text>
      {children}
    </View>
  );
}

const INPUT_CLASS = 'h-12 rounded-[10px] border border-gray-200 bg-[#f9fafb] px-3.5 text-[15px] text-gray-900';

export default function DriverWalletTopupScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const wallet = route?.params?.wallet || {};
  const isSmilePay = wallet.paymentProvider === 'smilepay';
  const providerLabel = isSmilePay ? 'Smile&Pay' : 'Paystack';
  const currency = wallet.currency || 'USD';
  const minAmount = Number(wallet.topupMinAmount || 1);
  const maxAmount = Number(wallet.topupMaxAmount || 500);
  const [amount, setAmount] = useState(String(Math.max(minAmount, 5)));
  const [method, setMethod] = useState('ecocash');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [ecocashMobile, setEcocashMobile] = useState(
    String(wallet.smileCashMobile || wallet.phoneNumber || '').trim()
  );
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const normalizedAmount = Number(String(amount || '').replace(/[^0-9.]/g, ''));
  const amountValid = normalizedAmount >= minAmount && normalizedAmount <= maxAmount;
  const cardBrand = getCardBrand(cardNumber);

  const handleTopup = async () => {
    try {
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

      const isSmilePayCard = isSmilePay && method === 'card';
      const cleanCardNumber = String(cardNumber || '').replace(/\D/g, '');
      const { expMonth, expYear } = parseExpiry(cardExpiry);
      const cvv = String(cardCvv || '').replace(/\D/g, '');

      if (isSmilePayCard && (cleanCardNumber.length < 12 || !expMonth || !expYear || cvv.length < 3)) {
        Alert.alert('Card details required', 'Enter your card number, expiry date and CVV to continue.');
        return;
      }
      const cleanWalletMobile = String(ecocashMobile || '').replace(/[^\d+]/g, '');
      const isWalletExpress = isSmilePay && (method === 'wallet' || method === 'ecocash');
      if (isWalletExpress && cleanWalletMobile.replace(/\D/g, '').length < 9) {
        Alert.alert('Mobile number required', 'Enter the mobile number that should approve this payment.');
        return;
      }

      setStarting(true);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');

      const callbackUrl = ExpoLinking.createURL('driver-wallet-topup');
      const smilePayPayload = (() => {
        if (method === 'card') {
          return {
            checkoutMode: 'express_mpgs',
            card: {
              pan: cleanCardNumber,
              expMonth,
              expYear,
              securityCode: cvv,
            },
          };
        }
        if (method === 'wallet') {
          return {
            checkoutMode: 'hosted',
            mobilePhoneNumber: cleanWalletMobile,
          };
        }
        return {
          checkoutMode: 'express_ecocash',
          mobilePhoneNumber: cleanWalletMobile,
        };
      })();

      console.log('[driver.wallet.topup] client initiate start', {
        amount: normalizedAmount,
        provider: wallet.paymentProvider || null,
        method,
        checkoutMode: smilePayPayload?.checkoutMode || null,
        hasMobileNumber: Boolean(cleanWalletMobile),
        hasCardDetails: Boolean(cleanCardNumber && expMonth && expYear && cvv),
      });
      const topup = await initiateDriverWalletTopup(token, {
        amount: normalizedAmount,
        callbackUrl,
        ...(isSmilePay ? smilePayPayload : {}),
      });
      console.log('[driver.wallet.topup] client initiate result', {
        reference: topup?.reference || null,
        provider: topup?.provider || null,
        checkoutMode: topup?.checkoutMode || null,
        nextAction: topup?.nextAction || null,
        hasAuthorizationUrl: Boolean(topup?.authorizationUrl),
        externalTransactionId: topup?.externalTransactionId || null,
      });

      if (!topup?.authorizationUrl) {
        if (topup?.nextAction === 'poll' || topup?.reference) {
          let lastVerifyResult = null;
          if (topup?.reference) {
            for (let attempt = 0; attempt < 8; attempt += 1) {
              if (attempt > 0) await wait(5000);
              lastVerifyResult = await verifyDriverWalletTopup(token, topup.reference).catch((verifyError) => {
                console.log('[driver.wallet.topup] client verify error', {
                  reference: topup.reference,
                  attempt: attempt + 1,
                  message: verifyError?.message || null,
                  status: verifyError?.status || null,
                });
                return null;
              });
              if (isSuccessfulTopup(lastVerifyResult)) break;
            }
          }
          if (isSuccessfulTopup(lastVerifyResult)) {
            Alert.alert('Top-up successful', 'Your wallet has been credited.', [
              { text: 'OK', onPress: () => navigation.goBack() },
            ]);
            return;
          }
          Alert.alert(
            'Payment pending',
            method === 'card'
              ? 'Your bank is still confirming this card payment. Your balance will update once it is confirmed.'
              : 'Approve the payment request on your phone. Your balance will update once it is confirmed.',
            [{ text: 'OK', onPress: () => navigation.goBack() }]
          );
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

      const verifyAttempts = authResult?.type === 'success' ? 4 : 2;
      let verified = false;
      for (let attempt = 0; attempt < verifyAttempts && !verified; attempt += 1) {
        if (attempt > 0) await wait(3000);
        for (const reference of references) {
          const result = await verifyDriverWalletTopup(token, reference).catch(() => null);
          if (isSuccessfulTopup(result)) {
            verified = true;
            break;
          }
        }
      }
      if (verified) {
        Alert.alert('Top-up successful', 'Your wallet has been credited.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        return;
      }
      Alert.alert(
        'Payment not confirmed yet',
        method === 'card'
          ? 'If you confirmed the payment with your bank, your balance will update shortly. If you closed the bank page before confirming, the payment will not go through and you can try again.'
          : 'If the payment went through, your balance will update shortly.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      Alert.alert('Top-up failed', error?.message || 'Could not start wallet top-up.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center px-5 pb-4"
        style={{ paddingTop: insets.top + 16 }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          className="h-11 w-11 items-center justify-center rounded-full bg-white"
          style={{
            shadowColor: '#0f172a',
            shadowOpacity: 0.06,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 1,
          }}
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="ml-3 text-[20px] font-bold text-gray-900">Top up wallet</Text>
      </View>

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1 }}>
        <KeyboardAwareScrollView
          style={{ flex: 1 }}
          bottomOffset={24}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="rounded-[24px] bg-white px-5 pb-5 pt-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-[13px] font-medium text-gray-500">Amount</Text>
              {Number.isFinite(Number(wallet.availableBalance)) ? (
                <Text className="text-[12px] text-gray-400">
                  Balance {formatCurrency(wallet.availableBalance, currency)}
                </Text>
              ) : null}
            </View>
            <View className="mt-2 flex-row items-center justify-center">
              <Text className="text-[34px] font-bold text-gray-400">{currency === 'USD' ? '$' : currency}</Text>
              <TextInput
                value={amount}
                onChangeText={(value) => setAmount(value.replace(/[^0-9.]/g, '').slice(0, 7))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#d1d5db"
                className="ml-1 min-w-[60px] text-[40px] font-bold text-gray-900"
                style={{ paddingVertical: 0 }}
              />
            </View>
            <Text className={`text-center text-[12px] ${amount && !amountValid ? 'text-red-500' : 'text-gray-400'}`}>
              {formatCurrency(minAmount, currency)} – {formatCurrency(maxAmount, currency)}
            </Text>
            <View className="mt-4 flex-row gap-2">
              {QUICK_AMOUNTS.filter((value) => value >= minAmount && value <= maxAmount).map((value) => {
                const selected = normalizedAmount === value;
                return (
                  <TouchableOpacity
                    key={value}
                    onPress={() => setAmount(String(value))}
                    disabled={starting}
                    className="h-10 flex-1 items-center justify-center rounded-[10px]"
                    style={{ backgroundColor: selected ? PRIMARY_BLUE : '#f3f4f6' }}
                  >
                    <Text className={`text-[14px] font-semibold ${selected ? 'text-white' : 'text-gray-800'}`}>
                      {currency === 'USD' ? '$' : ''}{value}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {isSmilePay ? (
            <>
              <Text className="mb-2 mt-5 px-1 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">
                Pay with
              </Text>
              <View className="overflow-hidden rounded-[24px] bg-white">
                {SMILEPAY_METHODS.map((option, index) => {
                  const selected = method === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setMethod(option.key)}
                      disabled={starting}
                      activeOpacity={0.75}
                      className="flex-row items-center px-4 py-3.5"
                    >
                      <View
                        className="h-10 w-10 items-center justify-center rounded-2xl"
                        style={{ backgroundColor: selected ? '#e8f1ff' : '#f3f4f6' }}
                      >
                        <Ionicons name={option.icon} size={20} color={selected ? PRIMARY_BLUE : '#1f2937'} />
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="text-[15px] font-medium text-gray-900">{option.label}</Text>
                        <Text className="mt-0.5 text-[12px] text-gray-500">{option.subtitle}</Text>
                      </View>
                      <View
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          borderWidth: 2,
                          borderColor: selected ? PRIMARY_BLUE : '#d1d5db',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {selected ? (
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: PRIMARY_BLUE }} />
                        ) : null}
                      </View>
                      {index < SMILEPAY_METHODS.length - 1 ? (
                        <View className="absolute bottom-0 left-[68px] right-4 bg-gray-100" style={{ height: 1 }} />
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View className="mt-4 rounded-[24px] bg-white px-5 pb-5 pt-2">
                {method === 'card' ? (
                  <>
                    <Field label="Card number">
                      <View className="h-12 flex-row items-center rounded-[10px] border border-gray-200 bg-[#f9fafb] px-3.5">
                        <TextInput
                          value={cardNumber}
                          onChangeText={(value) => setCardNumber(formatCardNumber(value))}
                          keyboardType="number-pad"
                          placeholder="0000 0000 0000 0000"
                          placeholderTextColor="#9ca3af"
                          autoComplete="cc-number"
                          textContentType="creditCardNumber"
                          className="h-12 flex-1 text-[15px] text-gray-900"
                        />
                        {cardBrand ? (
                          <Text className="ml-2 text-[12px] font-bold" style={{ color: PRIMARY_BLUE }}>{cardBrand}</Text>
                        ) : null}
                      </View>
                    </Field>
                    <View className="flex-row gap-3">
                      <View className="flex-1">
                        <Field label="Expiry">
                          <TextInput
                            value={cardExpiry}
                            onChangeText={(value) => setCardExpiry(formatExpiry(value))}
                            keyboardType="number-pad"
                            placeholder="MM/YY"
                            placeholderTextColor="#9ca3af"
                            maxLength={5}
                            autoComplete="cc-exp"
                            className={INPUT_CLASS}
                          />
                        </Field>
                      </View>
                      <View className="flex-1">
                        <Field label="CVV">
                          <TextInput
                            value={cardCvv}
                            onChangeText={(value) => setCardCvv(value.replace(/\D/g, '').slice(0, 4))}
                            keyboardType="number-pad"
                            placeholder="123"
                            placeholderTextColor="#9ca3af"
                            maxLength={4}
                            secureTextEntry
                            autoComplete="cc-csc"
                            className={INPUT_CLASS}
                          />
                        </Field>
                      </View>
                    </View>
                  </>
                ) : (
                  <Field label={method === 'ecocash' ? 'EcoCash number' : 'Smile&Pay Wallet number'}>
                    <TextInput
                      value={ecocashMobile}
                      onChangeText={(value) => setEcocashMobile(value.replace(/[^\d+]/g, '').slice(0, 15))}
                      keyboardType="phone-pad"
                      placeholder="0771234567"
                      placeholderTextColor="#9ca3af"
                      autoComplete="tel"
                      className={INPUT_CLASS}
                    />
                  </Field>
                )}
              </View>
            </>
          ) : null}

          <View className="mt-4 flex-row items-center justify-center">
            <Ionicons name="lock-closed" size={12} color="#9ca3af" />
            <Text className="ml-1 text-[12px] text-gray-400">Secured by {providerLabel}</Text>
          </View>
        </KeyboardAwareScrollView>

        <View
          className="bg-[#f6f7f3]"
          style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16) + 16 }}
        >
          <TouchableOpacity
            onPress={handleTopup}
            disabled={starting}
            activeOpacity={0.85}
            style={{
              height: 54,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: PRIMARY_BLUE,
              opacity: starting || !amountValid ? 0.6 : 1,
            }}
          >
            {starting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-[16px] font-bold text-white">
                {amountValid ? `Top up ${formatCurrency(normalizedAmount, currency)}` : 'Top up'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
