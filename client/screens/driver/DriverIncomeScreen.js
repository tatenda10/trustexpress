import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDriverIncome, setDriverIncomeGoal } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

const PERIODS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatRideTime(value) {
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

const DriverIncomeScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const isFocused = useIsFocused();

  const [period, setPeriod] = useState('day');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [goalDraft, setGoalDraft] = useState('50');

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const loadIncome = async ({ showRefreshing = false } = {}) => {
    try {
      setError('');
      if (showRefreshing) setRefreshing(true);
      else setLoading(true);

      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const data = await getDriverIncome(token, { period, offset });
      setDashboard(data);
      setGoalDraft(String(Math.round(Number(data?.dailyGoal?.amount || 50))));
    } catch (loadError) {
      setError(loadError?.message || 'Could not load income.');
      setDashboard(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isFocused) return undefined;
    loadIncome();
    return undefined;
  }, [isFocused, period, offset]);

  const handlePeriodChange = (nextPeriod) => {
    if (nextPeriod === period) return;
    setPeriod(nextPeriod);
    setOffset(0);
  };

  const handleSaveGoal = async () => {
    const amount = Number(String(goalDraft || '').replace(/[^0-9.]/g, ''));
    if (!(amount >= 1)) {
      Alert.alert('Invalid goal', 'Enter a daily goal of at least $1.');
      return;
    }
    try {
      setSavingGoal(true);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      await setDriverIncomeGoal(token, { dailyGoalAmount: amount });
      setGoalModalVisible(false);
      await loadIncome();
    } catch (saveError) {
      Alert.alert('Could not save goal', saveError?.message || 'Please try again.');
    } finally {
      setSavingGoal(false);
    }
  };

  const earnings = Number(dashboard?.earnings || 0);
  const goalAmount = Number(dashboard?.dailyGoal?.amount || 50);
  const remaining = Number(dashboard?.dailyGoal?.remaining || 0);
  const progressPercent = Number(dashboard?.dailyGoal?.progressPercent || 0);
  const completedRides = Number(dashboard?.completedRides || 0);
  const estimatedOrdersLeft = dashboard?.dailyGoal?.estimatedOrdersLeft;
  const rides = Array.isArray(dashboard?.rides) ? dashboard.rides : [];

  return (
    <View className="flex-1 bg-[#f8fafc]">
      <View className="border-b border-gray-100 bg-white px-5 pb-3" style={{ paddingTop: insets.top + 8 }}>
        <Text className="text-center text-lg font-bold text-gray-900">Income</Text>
      </View>

      {loading && !dashboard ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
          <Text className="mt-4 text-base text-gray-500">Loading income...</Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 28 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadIncome({ showRefreshing: true })} tintColor={PRIMARY_BLUE} />
          }
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View className="mb-4 rounded-2xl bg-red-50 px-4 py-3">
              <Text className="text-sm font-medium text-red-600">{error}</Text>
            </View>
          ) : null}

          <View className="mb-5 flex-row rounded-full bg-gray-100 p-1">
            {PERIODS.map((item) => {
              const active = period === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => handlePeriodChange(item.id)}
                  className="flex-1 items-center rounded-full py-2.5"
                  style={active ? { backgroundColor: PRIMARY_BLUE } : null}
                >
                  <Text className={`text-sm font-semibold ${active ? 'text-white' : 'text-gray-700'}`}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text className="mb-2 text-center text-sm font-medium text-gray-500">
            {dashboard?.label || ''}
          </Text>

          <View className="mb-5 flex-row items-center justify-center">
            <TouchableOpacity
              onPress={() => setOffset((value) => value - 1)}
              className="h-10 w-10 items-center justify-center rounded-full bg-white"
              accessibilityLabel="Previous period"
            >
              <Ionicons name="chevron-back" size={22} color="#111827" />
            </TouchableOpacity>
            <Text className="mx-4 min-w-[140px] text-center text-4xl font-bold text-gray-900">
              {formatCurrency(earnings)}
            </Text>
            <TouchableOpacity
              onPress={() => {
                if (dashboard?.canGoForward) setOffset((value) => Math.min(0, value + 1));
              }}
              disabled={!dashboard?.canGoForward}
              className="h-10 w-10 items-center justify-center rounded-full bg-white"
              style={{ opacity: dashboard?.canGoForward ? 1 : 0.35 }}
              accessibilityLabel="Next period"
            >
              <Ionicons name="chevron-forward" size={22} color="#111827" />
            </TouchableOpacity>
          </View>

          {period === 'day' ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => {
                setGoalDraft(String(Math.round(goalAmount)));
                setGoalModalVisible(true);
              }}
              className="mb-5 rounded-3xl px-5 py-4"
              style={{ backgroundColor: '#dbeafe' }}
            >
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-base font-semibold text-gray-900">Daily income plan</Text>
                <View className="flex-row items-center">
                  <Text className="text-lg font-bold text-gray-900">{formatCurrency(goalAmount)}</Text>
                  <Ionicons name="create-outline" size={16} color="#64748b" style={{ marginLeft: 6 }} />
                </View>
              </View>
              <View className="h-2.5 overflow-hidden rounded-full bg-white">
                <View
                  className="h-full rounded-full"
                  style={{ width: `${progressPercent}%`, backgroundColor: PRIMARY_BLUE }}
                />
              </View>
              <Text className="mt-3 text-sm font-medium text-gray-700">
                {remaining > 0
                  ? `${formatCurrency(remaining)} left${estimatedOrdersLeft ? ` (~${estimatedOrdersLeft} trips)` : ''}`
                  : earnings > 0
                    ? 'Daily goal reached'
                    : `Goal: ${formatCurrency(goalAmount)} · tap to edit`}
              </Text>
            </TouchableOpacity>
          ) : (
            <View className="mb-5 rounded-3xl border border-gray-100 bg-white px-5 py-4">
              <Text className="text-sm font-semibold text-gray-500">Daily goal reference</Text>
              <View className="mt-1 flex-row items-center justify-between">
                <Text className="text-lg font-bold text-gray-900">{formatCurrency(goalAmount)} / day</Text>
                <TouchableOpacity onPress={() => setGoalModalVisible(true)}>
                  <Text className="text-sm font-semibold" style={{ color: PRIMARY_BLUE }}>Edit</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View className="mb-5 flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-gray-100 bg-white px-4 py-3">
              <Text className="text-xs font-semibold uppercase text-gray-500">Trips</Text>
              <Text className="mt-1 text-xl font-bold text-gray-900">{completedRides}</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-gray-100 bg-white px-4 py-3">
              <Text className="text-xs font-semibold uppercase text-gray-500">Avg / trip</Text>
              <Text className="mt-1 text-xl font-bold text-gray-900">
                {formatCurrency(dashboard?.averagePerRide)}
              </Text>
            </View>
          </View>

          {rides.length === 0 ? (
            <View className="mb-5 items-center rounded-3xl bg-white px-5 py-12">
              <View className="mb-3 h-14 w-14 items-center justify-center rounded-full bg-[#eff6ff]">
                <Ionicons name="car-outline" size={28} color={PRIMARY_BLUE} />
              </View>
              <Text className="text-base font-semibold text-gray-900">No completed trips</Text>
              <Text className="mt-1 text-center text-sm text-gray-500">
                Completed passenger trips for this period will show here.
              </Text>
            </View>
          ) : (
            <View className="mb-4">
              <Text className="mb-3 text-base font-bold text-gray-900">This period</Text>
              {rides.map((ride) => (
                <View
                  key={String(ride.id)}
                  className="mb-3 rounded-2xl border border-gray-100 bg-white px-4 py-4"
                >
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 pr-3">
                      <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
                        {ride.pickupLabel || 'Pickup'}
                      </Text>
                      <Text className="mt-0.5 text-sm text-gray-500" numberOfLines={1}>
                        to {ride.dropoffLabel || 'Drop-off'}
                      </Text>
                      <Text className="mt-2 text-xs text-gray-400">{formatRideTime(ride.completedAt)}</Text>
                    </View>
                    <Text className="text-lg font-bold text-gray-900">
                      {formatCurrency(ride.totalEarned)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            onPress={() => navigation.navigate('DriverTripHistory')}
            className="mb-3 flex-row items-center rounded-2xl border border-gray-100 bg-white px-4 py-4"
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-[#eff6ff]">
              <Ionicons name="clipboard-outline" size={20} color={PRIMARY_BLUE} />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-semibold text-gray-900">Trip history</Text>
              <Text className="text-sm text-gray-500">All rides, receipts, and ratings</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>
        </ScrollView>
      )}

      <Modal visible={goalModalVisible} transparent animationType="slide" onRequestClose={() => setGoalModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end bg-black/40"
        >
          <View className="rounded-t-3xl bg-white px-5 pb-8 pt-5" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
            <Text className="text-center text-lg font-bold text-gray-900">Set daily income goal</Text>
            <Text className="mt-1 text-center text-sm text-gray-500">
              Track progress toward the money you want to earn each day.
            </Text>
            <View className="mt-5 flex-row items-center rounded-2xl border border-gray-200 bg-gray-50 px-4">
              <Text className="mr-2 text-base font-semibold text-gray-900">$</Text>
              <TextInput
                value={goalDraft}
                onChangeText={setGoalDraft}
                keyboardType="decimal-pad"
                placeholder="50"
                className="flex-1 py-4 text-base text-gray-900"
              />
            </View>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {[30, 49, 50, 80, 100].map((preset) => (
                <TouchableOpacity
                  key={preset}
                  onPress={() => setGoalDraft(String(preset))}
                  className="rounded-full border border-blue-200 bg-[#eff6ff] px-3 py-2"
                >
                  <Text className="text-sm font-semibold" style={{ color: PRIMARY_BLUE }}>
                    ${preset}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              onPress={handleSaveGoal}
              disabled={savingGoal}
              className="mt-5 items-center rounded-2xl py-4"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: savingGoal ? 0.7 : 1 }}
            >
              {savingGoal ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-base font-bold text-white">Save goal</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setGoalModalVisible(false)} className="mt-3 items-center py-2">
              <Text className="text-sm font-semibold text-gray-500">Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

export default DriverIncomeScreen;
