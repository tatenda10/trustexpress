import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl, Alert, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { getDriverWallet, initiateDriverWalletTopup, verifyDriverWalletTopup } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

WebBrowser.maybeCompleteAuthSession();

function formatCurrency(value, currency = 'ZAR') {
  return `${String(currency || 'ZAR').toUpperCase()} ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-ZW', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getTransactionMeta(transaction) {
  if (transaction.transactionType === 'top_up_credit') {
    return {
      icon: 'cash-outline',
      iconBg: '#DCFCE7',
      amountColor: 'text-green-600',
      amountPrefix: '+',
      title: transaction.paymentMethod
        ? `Top-up via ${String(transaction.paymentMethod).replace(/_/g, ' ')}`
        : 'Wallet top-up',
    };
  }
  return {
    icon: 'remove-circle-outline',
    iconBg: '#FEE2E2',
    amountColor: 'text-red-600',
    amountPrefix: '-',
    title: transaction.tripId ? `Trip #${transaction.tripId} service fee` : 'Service fee debit',
  };
}

function formatTransactionTypeLabel(transactionType) {
  const type = String(transactionType || '').trim().toLowerCase();
  if (type === 'commission_debit') return 'SERVICE FEE';
  return String(transactionType || '').replace(/_/g, ' ').toUpperCase();
}

const DriverWalletScreen = () => {
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
  });
  const providerLabel = wallet.paymentProvider === 'smilepay' ? 'Smile&Pay' : 'Paystack';
  const [summary, setSummary] = useState({
    totalTopups: 0,
    totalCommissionPaid: 0,
  });
  const [pendingTopups, setPendingTopups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [topupAmount, setTopupAmount] = useState('5');
  const [startingTopup, setStartingTopup] = useState(false);
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
      });
      setSummary({
        totalTopups: Number(data?.summary?.totalTopups || 0),
        totalCommissionPaid: Number(data?.summary?.totalCommissionPaid || 0),
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
      });
      setSummary({
        totalTopups: 0,
        totalCommissionPaid: 0,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
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

      await loadWallet(false, references);
      Alert.alert('Payment check complete', 'Your wallet has been refreshed. If payment succeeded, the balance will update immediately.');
    } catch (topupError) {
      Alert.alert('Top-up failed', topupError?.message || 'Could not start wallet top-up.');
    } finally {
      setStartingTopup(false);
    }
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
              <Text className="mb-1 text-sm font-medium text-white/90">Current Wallet Balance</Text>
              <Text className="text-3xl font-bold text-white">{formatCurrency(wallet.availableBalance, wallet.currency)}</Text>
              <Text className="mt-1 text-sm text-white/80">
                Minimum required to receive requests: {formatCurrency(wallet.minimumRequiredBalance, wallet.currency)}
              </Text>
              <View className="mt-4 flex-row items-center justify-between border-t border-white/20 pt-3">
                <Text className="text-xs text-white/80">Top-ups: {formatCurrency(summary.totalTopups, wallet.currency)}</Text>
                <Text className="text-xs text-white/80">Service fee paid: {formatCurrency(summary.totalCommissionPaid, wallet.currency)}</Text>
              </View>
            </View>
          </View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 24) }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadWallet(true)} tintColor={PRIMARY_BLUE} />}
            showsVerticalScrollIndicator={false}
          >
            {!wallet.sufficientBalance && wallet.lowBalanceMessage ? (
              <View className="mb-4 rounded-[20px] bg-amber-50 px-4 py-4">
                <Text className="text-sm font-semibold text-amber-700">{wallet.lowBalanceMessage}</Text>
              </View>
            ) : null}

            {!wallet.paymentsEnabled && wallet.paymentsUnavailableMessage ? (
              <View className="mb-4 rounded-[20px] bg-blue-50 px-4 py-4">
                <Text className="text-sm font-semibold text-[#1d4ed8]">{wallet.paymentsUnavailableMessage}</Text>
              </View>
            ) : null}

            <View className="mb-5 rounded-2xl border border-gray-100 bg-white p-4">
              <Text className="text-base font-bold text-gray-900">Top up wallet</Text>
              <Text className="mt-1 text-sm text-gray-500">
                {wallet.paymentsEnabled
                  ? `Enter the amount to add (${formatCurrency(wallet.topupMinAmount, wallet.currency)} – ${formatCurrency(wallet.topupMaxAmount, wallet.currency)}). Service fee on completed trips is ${Number(wallet.commissionRatePercent || 9.5).toFixed(1)}%.`
                  : 'Wallet top-ups are not available yet. You can still view your balance and transaction history here.'}
              </Text>
              {wallet.paymentsEnabled ? (
                <>
              <View className="mt-4 flex-row items-center rounded-2xl border border-gray-200 bg-gray-50 px-4">
                <Text className="mr-2 text-sm font-semibold text-gray-900">{wallet.currency}</Text>
                <TextInput
                  value={topupAmount}
                  onChangeText={setTopupAmount}
                  keyboardType="decimal-pad"
                  placeholder="5.00"
                  className="flex-1 py-4 text-base text-gray-900"
                />
              </View>
              <View className="mt-3 flex-row flex-wrap">
                {[wallet.topupMinAmount, 10, 20]
                  .map((value) => Number(value))
                  .filter((value, index, list) => Number.isFinite(value) && value > 0 && list.indexOf(value) === index)
                  .filter((value) => value <= Number(wallet.topupMaxAmount || 500))
                  .slice(0, 3)
                  .map((preset) => (
                  <TouchableOpacity
                    key={preset}
                    onPress={() => setTopupAmount(String(preset))}
                    className="mr-2 mt-2 rounded-full bg-[#eff6ff] px-4 py-2"
                  >
                    <Text className="text-sm font-semibold" style={{ color: PRIMARY_BLUE }}>
                      {formatCurrency(preset, wallet.currency)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                onPress={handleTopup}
                disabled={startingTopup}
                className="mt-4 h-12 items-center justify-center rounded-2xl"
                style={{ backgroundColor: startingTopup ? '#93c5fd' : PRIMARY_BLUE }}
              >
                <Text className="text-base font-bold text-white">
                  {startingTopup ? `Opening ${providerLabel}...` : 'Top Up'}
                </Text>
              </TouchableOpacity>
                </>
              ) : null}
            </View>

            <View className="mb-8 flex-row justify-between">
              {[
                { key: 'balance', label: 'Balance', value: formatCurrency(wallet.availableBalance, wallet.currency), icon: 'wallet-outline' },
                { key: 'topups', label: 'Top-ups', value: formatCurrency(summary.totalTopups, wallet.currency), icon: 'add-circle-outline' },
                { key: 'commission', label: 'Service fee', value: formatCurrency(summary.totalCommissionPaid, wallet.currency), icon: 'remove-circle-outline' },
              ].map(({ key, label, value, icon }) => (
                <View key={key} className="items-center">
                  <View className="mb-2 h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: '#EFF6FF' }}>
                    <Ionicons name={icon} size={24} color={PRIMARY_BLUE} />
                  </View>
                  <Text className="text-sm font-semibold text-gray-900">{value}</Text>
                  <Text className="text-sm text-gray-500">{label}</Text>
                </View>
              ))}
            </View>

            {pendingTopups.length ? (
              <View className="mb-4 rounded-2xl border border-[#dbeafe] bg-[#eff6ff] px-4 py-4">
                <Text className="text-sm font-semibold text-[#1d4ed8]">Pending top-ups</Text>
                <Text className="mt-1 text-sm text-[#1e3a8a]">
                  {pendingTopups.length} payment{pendingTopups.length === 1 ? '' : 's'} still awaiting final verification.
                </Text>
              </View>
            ) : null}

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
                    <View
                      key={transaction.id}
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
                        {transaction.tripId ? (
                          <Text className="mt-1 text-xs font-semibold text-gray-500">
                            Passenger: {transaction.passengerName || 'Passenger'} | Fare: {formatCurrency(transaction.tripFareAmount, transaction.currency || wallet.currency)}
                          </Text>
                        ) : null}
                        {transaction.paymentMethod ? (
                          <Text className="mt-1 text-xs font-semibold text-green-600">
                            Payment method: {String(transaction.paymentMethod).replace(/_/g, ' ')}
                          </Text>
                        ) : null}
                        <Text className="mt-1 text-xs text-gray-400">
                          Balance: {formatCurrency(transaction.balanceBefore, transaction.currency || wallet.currency)} → {formatCurrency(transaction.balanceAfter, transaction.currency || wallet.currency)}
                        </Text>
                        {transaction.commissionRatePercent ? (
                          <Text className="mt-1 text-xs font-semibold text-amber-600">
                            Service fee: {Number(transaction.commissionRatePercent).toFixed(1)}%
                          </Text>
                        ) : null}
                      </View>
                      <View className="items-end">
                        <Text className={`text-base font-semibold ${meta.amountColor}`}>
                          {meta.amountPrefix}{formatCurrency(Math.abs(Number(transaction.amount || 0)), transaction.currency || wallet.currency)}
                        </Text>
                        <Text className="text-xs text-gray-400">
                          {formatTransactionTypeLabel(transaction.transactionType)}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
};

export default DriverWalletScreen;
