import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../auth/AuthProvider';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cashOutDriverWallet, getDriverWallet, verifyDriverWalletTopup } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import {
  formatTransactionTypeLabel,
  formatWalletCurrency as formatCurrency,
  formatWalletDate as formatDate,
  getTransactionMeta,
} from './walletTransactionMeta';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'Money in' },
  { key: 'fees', label: 'Service fees' },
  { key: 'rewards', label: 'Rewards' },
];

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-ZW', { hour: 'numeric', minute: '2-digit' });
}

/** Groups transactions (newest first) under Today / Yesterday / date headings. */
function groupByDay(transactions) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups = [];
  for (const transaction of transactions) {
    const date = new Date(transaction?.createdAt);
    const valid = !Number.isNaN(date.getTime());
    const key = valid ? date.toDateString() : 'unknown';
    let label = 'Earlier';
    if (valid) {
      if (key === today.toDateString()) label = 'Today';
      else if (key === yesterday.toDateString()) label = 'Yesterday';
      else {
        label = date.toLocaleDateString('en-ZW', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
        });
      }
    }
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(transaction);
    else groups.push({ key, label, items: [transaction] });
  }
  return groups;
}

const DriverWalletScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const isFocused = useIsFocused();
  const [transactions, setTransactions] = useState([]);
  const [wallet, setWallet] = useState({
    availableBalance: 0,
    cashBalance: 0,
    promotionalBalance: 0,
    currency: 'USD',
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
  const [pendingTopups, setPendingTopups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

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
        cashBalance: Number(data?.wallet?.cashBalance || 0),
        promotionalBalance: Number(data?.wallet?.promotionalBalance || 0),
        currency: data?.wallet?.currency || 'USD',
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
        cashBalance: 0,
        promotionalBalance: 0,
        currency: 'USD',
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

  const openTopupPage = () => {
    if (!wallet.paymentsEnabled) {
      Alert.alert('Top-ups unavailable', wallet.paymentsUnavailableMessage || 'Wallet top-ups are not available yet. Please check back soon.');
      return;
    }
    navigation.navigate('DriverWalletTopup', { wallet });
  };

  const handleCashOut = async () => {
    const balance = Number(wallet.withdrawableBalance || 0);
    if (!(balance > 0)) {
      Alert.alert('No balance', 'You do not have a withdrawable wallet balance yet.');
      return;
    }

    Alert.alert(
      'Cash out wallet?',
      `Send ${formatCurrency(balance, wallet.currency)} to your wallet now. Only cash earnings can be cashed out; reward balance stays for service fees.`,
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

  const isCredit = (transaction) => getTransactionMeta(transaction).amountPrefix === '+';
  const matchesFilter = (transaction) => {
    const type = String(transaction?.transactionType || '').toLowerCase();
    if (filter === 'in') return isCredit(transaction) && type !== 'captain_promo_credit';
    if (filter === 'fees') return type === 'commission_debit' || type === 'promo_commission_debit';
    if (filter === 'rewards') return type === 'captain_promo_credit' || type === 'promo_commission_debit';
    return true;
  };
  const visibleTransactions = transactions.filter(matchesFilter);
  const transactionGroups = groupByDay(visibleTransactions);
  const withdrawable = Number(wallet.withdrawableBalance || 0);
  const canCashOut = !cashingOut && withdrawable > 0;
  const pendingReferences = pendingTopups.map((topup) => topup?.reference).filter(Boolean);

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center justify-between bg-[#f6f7f3]"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 10 }}
      >
        <Text className="text-[22px] font-bold text-gray-900">Wallet</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('DriverRideHistory')}
          className="flex-row items-center rounded-full bg-white px-3.5 py-2"
          activeOpacity={0.75}
        >
          <Ionicons name="time-outline" size={16} color="#111827" />
          <Text className="ml-1.5 text-[13px] font-semibold text-gray-900">Ride history</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
          <Text className="mt-4 text-base text-gray-500">Loading wallet...</Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 24) + 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadWallet(true)} tintColor={PRIMARY_BLUE} />}
          showsVerticalScrollIndicator={false}
        >
          <View className="mb-4 overflow-hidden rounded-[28px] p-5" style={{ backgroundColor: PRIMARY_BLUE }}>
            <Text className="text-[13px] font-medium text-white/60">Available balance</Text>
            <Text className="mt-1 text-[34px] font-bold text-white">
              {formatCurrency(wallet.availableBalance, wallet.currency)}
            </Text>

            <View className="mt-4 flex-row gap-2">
              <View className="flex-1 rounded-2xl bg-white/10 px-3 py-2.5">
                <Text className="text-[11px] font-medium text-white/60">Cash</Text>
                <Text className="mt-0.5 text-[15px] font-semibold text-white">
                  {formatCurrency(wallet.cashBalance, wallet.currency)}
                </Text>
              </View>
              <View className="flex-1 rounded-2xl bg-white/10 px-3 py-2.5">
                <Text className="text-[11px] font-medium text-white/60">Rewards</Text>
                <Text className="mt-0.5 text-[15px] font-semibold text-white">
                  {formatCurrency(wallet.promotionalBalance, wallet.currency)}
                </Text>
              </View>
              <View className="flex-1 rounded-2xl bg-white/10 px-3 py-2.5">
                <Text className="text-[11px] font-medium text-white/60">Can cash out</Text>
                <Text className="mt-0.5 text-[15px] font-semibold text-white">
                  {formatCurrency(withdrawable, wallet.currency)}
                </Text>
              </View>
            </View>

            <View className="mt-4 flex-row gap-3">
              <TouchableOpacity
                onPress={openTopupPage}
                className="h-12 flex-1 flex-row items-center justify-center rounded-2xl bg-white"
                activeOpacity={0.85}
              >
                <Ionicons name="add-circle" size={20} color="#111827" />
                <Text className="ml-1.5 text-[15px] font-bold text-gray-900">Top up</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCashOut}
                disabled={!canCashOut}
                className="h-12 flex-1 flex-row items-center justify-center rounded-2xl bg-white/15"
                style={{ opacity: canCashOut ? 1 : 0.5 }}
                activeOpacity={0.85}
              >
                {cashingOut ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="arrow-up-circle-outline" size={20} color="#fff" />
                    <Text className="ml-1.5 text-[15px] font-bold text-white">Cash out</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {!wallet.sufficientBalance ? (
            <View className="mb-4 flex-row rounded-[20px] bg-amber-50 px-4 py-3.5">
              <Ionicons name="warning-outline" size={20} color="#b45309" />
              <View className="ml-3 flex-1">
                <Text className="text-[14px] font-semibold text-amber-900">Top up to keep getting rides</Text>
                <Text className="mt-0.5 text-[13px] text-amber-800">
                  {wallet.lowBalanceMessage
                    || `Keep at least ${formatCurrency(wallet.minimumRequiredBalance, wallet.currency)} in your wallet to go online.`}
                </Text>
              </View>
            </View>
          ) : null}

          {pendingTopups.length ? (
            <View className="mb-4 flex-row items-center rounded-[20px] bg-[#eff6ff] px-4 py-3.5">
              <Ionicons name="hourglass-outline" size={20} color="#1d4ed8" />
              <View className="ml-3 flex-1">
                <Text className="text-[14px] font-semibold text-[#1d4ed8]">
                  {pendingTopups.length} top-up{pendingTopups.length === 1 ? '' : 's'} being confirmed
                </Text>
                <Text className="mt-0.5 text-[13px] text-[#1e3a8a]">This usually takes a minute.</Text>
              </View>
              <TouchableOpacity
                onPress={() => loadWallet(true, pendingReferences)}
                disabled={refreshing}
                className="rounded-full bg-white px-3 py-1.5"
                activeOpacity={0.75}
              >
                <Text className="text-[12px] font-semibold text-[#1d4ed8]">Check now</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text className="mb-2 mt-1 px-1 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Activity</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3" contentContainerStyle={{ gap: 8 }}>
            {FILTERS.map((option) => {
              const active = option.key === filter;
              return (
                <TouchableOpacity
                  key={option.key}
                  onPress={() => setFilter(option.key)}
                  className={`rounded-full px-4 py-2 ${active ? 'bg-gray-900' : 'bg-white'}`}
                  activeOpacity={0.8}
                >
                  <Text className={`text-[13px] font-semibold ${active ? 'text-white' : 'text-gray-600'}`}>{option.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {error ? (
            <View className="mb-4 rounded-[20px] bg-red-50 px-4 py-4">
              <Text className="text-[14px] font-medium text-red-600">{error}</Text>
            </View>
          ) : null}

          {!transactionGroups.length ? (
            <View className="items-center rounded-[24px] bg-white px-5 py-10">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-[#f3f4f6]">
                <Ionicons name="receipt-outline" size={22} color="#6b7280" />
              </View>
              <Text className="mt-3 text-[15px] font-semibold text-gray-900">
                {transactions.length ? 'Nothing in this filter' : 'No transactions yet'}
              </Text>
              <Text className="mt-1 text-center text-[13px] text-gray-500">
                {transactions.length ? 'Try another filter.' : 'Top-ups, service fees and cash-outs will show here.'}
              </Text>
            </View>
          ) : (
            transactionGroups.map((group) => (
              <View key={group.key} className="mb-4">
                <Text className="mb-2 px-1 text-[13px] font-semibold text-gray-500">{group.label}</Text>
                <View className="overflow-hidden rounded-[24px] bg-white">
                  {group.items.map((transaction, index) => {
                    const meta = getTransactionMeta(transaction);
                    const credit = meta.amountPrefix === '+';
                    return (
                      <TouchableOpacity
                        key={transaction.id}
                        activeOpacity={0.7}
                        onPress={() => navigation.navigate('DriverWalletTransactionDetail', {
                          transaction,
                          currency: wallet.currency,
                        })}
                        className="flex-row items-center px-4 py-3.5"
                      >
                        <View
                          className="h-10 w-10 items-center justify-center rounded-2xl"
                          style={{ backgroundColor: credit ? '#dcfce7' : '#fee2e2' }}
                        >
                          <Ionicons name={meta.icon} size={20} color={credit ? '#16a34a' : '#dc2626'} />
                        </View>
                        <View className="ml-3 flex-1 pr-2">
                          <Text className="text-[15px] font-medium text-gray-900" numberOfLines={1}>{meta.title}</Text>
                          <Text className="mt-0.5 text-[12px] text-gray-500" numberOfLines={1}>
                            {formatTime(transaction.createdAt)} · {formatTransactionTypeLabel(transaction.transactionType).toLowerCase()}
                          </Text>
                        </View>
                        <Text className={`text-[15px] font-semibold ${credit ? 'text-green-600' : 'text-gray-900'}`}>
                          {meta.amountPrefix}{formatCurrency(Math.abs(Number(transaction.amount || 0)), transaction.currency || wallet.currency)}
                        </Text>
                        {index < group.items.length - 1 ? (
                          <View className="absolute bottom-0 left-[68px] right-4 bg-gray-100" style={{ height: 1 }} />
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
};

export default DriverWalletScreen;
