import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { cashOutDriverWallet, getDriverWallet, initiateDriverWalletTopup, verifyDriverWalletTopup } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import {
  formatTransactionTypeLabel,
  formatWalletCurrency as formatCurrency,
  formatWalletDate as formatDate,
  getTransactionMeta,
} from './walletTransactionMeta';

WebBrowser.maybeCompleteAuthSession();

const DriverWalletScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const isFocused = useIsFocused();
  const [transactions, setTransactions] = useState([]);
  const [wallet, setWallet] = useState({
    availableBalance: 0,
    currency: 'ZAR',
    minimumRequiredBalance: 1,
    topupMinAmount: 1,
    topupMaxAmount: 500,
    commissionRatePercent: 9.5,
    paymentsEnabled: false,
    paymentProvider: 'paystack',
    paymentsUnavailableMessage: '',
    sufficientBalance: true,
    lowBalanceMessage: '',
    withdrawableBalance: 0,
    smileCashMobile: null,
  });
  const providerLabel = wallet.paymentProvider === 'smilepay' ? 'Smile&Pay' : 'Paystack';
  const [pendingTopups, setPendingTopups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [topupAmount, setTopupAmount] = useState('5');
  const [topupModalVisible, setTopupModalVisible] = useState(false);
  const [startingTopup, setStartingTopup] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const loadWallet = async (showRefreshing = false, verifyReferences = []) => {
    try {
      setError('');
      if (showRefreshing) setRefreshing(true);
      else setLoading(true);

      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const referencesToVerify = Array.isArray(verifyReferences)
        ? verifyReferences.filter(Boolean)
        : [];
      for (const reference of referencesToVerify) {
        try {
          await verifyDriverWalletTopup(token, reference);
        } catch (verifyError) {
          console.log('[driver.wallet] top-up verification skipped', {
            reference,
            message: verifyError?.message || null,
          });
        }
      }
      const data = await getDriverWallet(token, { limit: 30 });
      setTransactions(Array.isArray(data?.transactions) ? data.transactions : []);
      setPendingTopups(Array.isArray(data?.pendingTopups) ? data.pendingTopups : []);
      setWallet({
        availableBalance: Number(data?.wallet?.availableBalance || 0),
        currency: data?.wallet?.currency || 'ZAR',
        minimumRequiredBalance: Number(data?.wallet?.minimumRequiredBalance || 1),
        topupMinAmount: Number(data?.wallet?.topupMinAmount || data?.settings?.topupMinAmount || 1),
        topupMaxAmount: Number(data?.wallet?.topupMaxAmount || data?.settings?.topupMaxAmount || 500),
        commissionRatePercent: Number(data?.wallet?.commissionRatePercent || data?.settings?.commissionRatePercent || 9.5),
        paymentsEnabled: data?.wallet?.paymentsEnabled === true || data?.settings?.paymentsEnabled === true,
        paymentProvider: String(data?.wallet?.paymentProvider || data?.settings?.paymentProvider || 'paystack').toLowerCase(),
        paymentsUnavailableMessage: data?.wallet?.paymentsUnavailableMessage || data?.settings?.paymentsUnavailableMessage || '',
        sufficientBalance: data?.wallet?.sufficientBalance !== false,
        lowBalanceMessage: data?.wallet?.lowBalanceMessage || '',
        withdrawableBalance: Number(data?.wallet?.withdrawableBalance || 0),
        smileCashMobile: data?.wallet?.smileCashMobile || null,
      });
    } catch (loadError) {
      setError(loadError?.message || 'Could not load wallet activity.');
      setTransactions([]);
      setPendingTopups([]);
      setWallet({
        availableBalance: 0,
        currency: 'ZAR',
        minimumRequiredBalance: 1,
        topupMinAmount: 1,
        topupMaxAmount: 500,
        commissionRatePercent: 9.5,
        paymentsEnabled: false,
        paymentProvider: 'paystack',
        paymentsUnavailableMessage: '',
        sufficientBalance: true,
        lowBalanceMessage: '',
        withdrawableBalance: 0,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const openTopupModal = () => {
    if (!wallet.paymentsEnabled) {
      Alert.alert('Top-ups unavailable', wallet.paymentsUnavailableMessage || 'Wallet top-ups are not available yet. Please check back soon.');
      return;
    }
    setTopupAmount(String(wallet.topupMinAmount || 5));
    setTopupModalVisible(true);
  };

  const closeTopupModal = () => {
    if (startingTopup) return;
    setTopupModalVisible(false);
  };

  const handleTopup = async () => {
    if (!wallet.paymentsEnabled) {
      Alert.alert('Top-ups unavailable', wallet.paymentsUnavailableMessage || 'Wallet top-ups are not available yet. Please check back soon.');
      return;
    }
    try {
      const amount = Number(String(topupAmount || '').replace(/[^0-9.]/g, ''));
      if (!(amount > 0)) {
        Alert.alert('Enter amount', 'Please enter a valid top-up amount.');
        return;
      }
      if (amount < Number(wallet.topupMinAmount || 1)) {
        Alert.alert('Amount too low', `Minimum top-up is ${formatCurrency(wallet.topupMinAmount, wallet.currency)}.`);
        return;
      }
      if (amount > Number(wallet.topupMaxAmount || 500)) {
        Alert.alert('Amount too high', `Maximum top-up is ${formatCurrency(wallet.topupMaxAmount, wallet.currency)}.`);
        return;
      }
      setStartingTopup(true);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');

      const callbackUrl = ExpoLinking.createURL('driver-wallet-topup');
      const topup = await initiateDriverWalletTopup(token, {
        amount,
        callbackUrl,
      });

      if (!topup?.authorizationUrl) {
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

      setTopupModalVisible(false);
      await loadWallet(false, references);
      Alert.alert('Payment check complete', 'Your wallet has been refreshed. If payment succeeded, the balance will update immediately.');
    } catch (topupError) {
      Alert.alert('Top-up failed', topupError?.message || 'Could not start wallet top-up.');
    } finally {
      setStartingTopup(false);
    }
  };

  const handleCashOut = async () => {
    const balance = Number(wallet.withdrawableBalance || 0);
    if (!(balance > 0)) {
      Alert.alert('No balance', 'You do not have a withdrawable wallet balance yet.');
      return;
    }

    Alert.alert(
      'Cash out wallet?',
      `Send ${formatCurrency(balance, wallet.currency)} to your wallet now. This is your passenger-payment balance after the service fee.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Cash out',
          onPress: async () => {
            try {
              setCashingOut(true);
              const token = await getTokenRef.current();
              if (!token) throw new Error('Not signed in');
              await cashOutDriverWallet(token, {});
              await loadWallet(false);
              Alert.alert('Cash out sent', 'Your wallet balance was sent.');
            } catch (cashoutError) {
              Alert.alert('Cash out failed', cashoutError?.message || 'Could not cash out your wallet.');
            } finally {
              setCashingOut(false);
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    if (!isFocused) return undefined;
    loadWallet(false);
    return undefined;
  }, [isFocused]);

  return (
    <View className="flex-1 bg-gray-50">
      <View
        className="flex-row items-center justify-between border-b border-gray-100 bg-white"
        style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12 }}
      >
        <View className="w-10" />
        <Text className="text-lg font-bold text-gray-900">Wallet</Text>
        <View className="w-10" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
          <Text className="mt-4 text-base text-gray-500">Loading wallet activity...</Text>
        </View>
      ) : (
        <View className="flex-1">
          <View
            className="px-5 pt-5"
            style={{ backgroundColor: '#f9fafb' }}
          >
            <View className="mb-5 rounded-2xl p-5" style={{ backgroundColor: PRIMARY_BLUE }}>
              <Text className="mb-1 text-sm font-medium text-white/90">Balance</Text>
              <Text className="text-3xl font-bold text-white">
                {formatCurrency(wallet.availableBalance, wallet.currency)}
              </Text>
              <View className="mt-4 flex-row gap-3">
                <TouchableOpacity
                  onPress={openTopupModal}
                  disabled={startingTopup}
                  className="h-12 flex-1 items-center justify-center rounded-2xl bg-white"
                >
                  <Text className="text-base font-bold" style={{ color: PRIMARY_BLUE }}>Top up</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleCashOut}
                  disabled={cashingOut || Number(wallet.withdrawableBalance || 0) <= 0}
                  className="h-12 flex-1 items-center justify-center rounded-2xl bg-white/15"
                  style={{ opacity: cashingOut || Number(wallet.withdrawableBalance || 0) <= 0 ? 0.65 : 1 }}
                >
                  <Text className="text-base font-bold text-white">
                    {cashingOut ? 'Cashing out...' : 'Cash out'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 24) }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadWallet(true)} tintColor={PRIMARY_BLUE} />}
            showsVerticalScrollIndicator={false}
          >
            {pendingTopups.length ? (
              <View className="mb-4 rounded-2xl border border-[#dbeafe] bg-[#eff6ff] px-4 py-4">
                <Text className="text-sm font-semibold text-[#1d4ed8]">Pending top-ups</Text>
                <Text className="mt-1 text-sm text-[#1e3a8a]">
                  {pendingTopups.length} payment{pendingTopups.length === 1 ? '' : 's'} still awaiting final verification.
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              onPress={() => navigation.navigate('DriverRideHistory')}
              className="mb-4 flex-row items-center rounded-2xl border border-gray-100 bg-white px-4 py-4"
              activeOpacity={0.8}
            >
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#eff6ff]">
                <Ionicons name="time-outline" size={20} color={PRIMARY_BLUE} />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-base font-semibold text-gray-900">Ride history</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
            </TouchableOpacity>

            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-bold text-gray-900">Transaction History</Text>
            </View>

            {error ? (
              <View className="mb-4 rounded-[20px] bg-red-50 px-4 py-4">
                <Text className="text-base font-medium text-red-600">{error}</Text>
              </View>
            ) : null}

            <View className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
              {!transactions.length ? (
                <View className="px-5 py-10">
                  <Text className="text-center text-base text-gray-500">No wallet transactions yet.</Text>
                </View>
              ) : (
                transactions.map((transaction, index) => {
                  const meta = getTransactionMeta(transaction);
                  return (
                    <TouchableOpacity
                      key={transaction.id}
                      activeOpacity={0.75}
                      onPress={() => navigation.navigate('DriverWalletTransactionDetail', {
                        transaction,
                        currency: wallet.currency,
                      })}
                      className="flex-row items-center px-4 py-4"
                      style={index < transactions.length - 1 ? { borderBottomWidth: 1, borderBottomColor: '#f9fafb' } : undefined}
                    >
                      <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: meta.iconBg }}>
                        <Ionicons name={meta.icon} size={20} color={PRIMARY_BLUE} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-base font-semibold text-gray-900">{meta.title}</Text>
                        <Text className="text-sm text-gray-500">
                          {formatDate(transaction.createdAt)}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className={`text-base font-semibold ${meta.amountColor}`}>
                          {meta.amountPrefix}{formatCurrency(Math.abs(Number(transaction.amount || 0)), transaction.currency || wallet.currency)}
                        </Text>
                        <Text className="text-xs text-gray-400">
                          {formatTransactionTypeLabel(transaction.transactionType)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </ScrollView>
        </View>
      )}

      <Modal
        visible={topupModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeTopupModal}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View className="flex-1 items-center justify-center bg-black/50 px-6">
            <Pressable
              style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
              onPress={closeTopupModal}
            />
            <View className="w-full max-w-[360px] rounded-[24px] bg-white px-5 py-5">
              <Text className="text-center text-lg font-bold text-gray-900">Top up</Text>
              <Text className="mb-2 mt-4 text-xs font-semibold uppercase text-gray-500">
                Amount ({wallet.currency})
              </Text>
              <TextInput
                value={topupAmount}
                onChangeText={setTopupAmount}
                keyboardType="decimal-pad"
                placeholder={String(wallet.topupMinAmount || 5)}
                autoFocus
                className="h-12 rounded-2xl border border-gray-200 bg-slate-50 px-4 text-center text-base"
              />
              <View className="mt-3 flex-row flex-wrap justify-center">
                {[wallet.topupMinAmount, 10, 20]
                  .map((value) => Number(value))
                  .filter((value, index, list) => Number.isFinite(value) && value > 0 && list.indexOf(value) === index)
                  .filter((value) => value <= Number(wallet.topupMaxAmount || 500))
                  .slice(0, 3)
                  .map((preset) => (
                    <TouchableOpacity
                      key={preset}
                      onPress={() => setTopupAmount(String(preset))}
                      className="mx-1 mt-2 rounded-full bg-[#eff6ff] px-4 py-2"
                    >
                      <Text className="text-sm font-semibold" style={{ color: PRIMARY_BLUE }}>
                        {formatCurrency(preset, wallet.currency)}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </View>
              <View className="mt-5 flex-row gap-3">
                <TouchableOpacity
                  onPress={closeTopupModal}
                  disabled={startingTopup}
                  className="h-12 flex-1 items-center justify-center rounded-2xl bg-slate-100"
                >
                  <Text className="font-semibold text-gray-700">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleTopup}
                  disabled={startingTopup}
                  className="h-12 flex-1 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: PRIMARY_BLUE, opacity: startingTopup ? 0.7 : 1 }}
                >
                  {startingTopup ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="font-semibold text-white">Continue</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

export default DriverWalletScreen;
