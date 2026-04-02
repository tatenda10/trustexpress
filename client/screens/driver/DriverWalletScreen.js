import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDriverRideHistory } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
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

function getTransactionMeta(ride) {
  if (ride.status === 'Completed') {
    return {
      icon: 'cash-outline',
      iconBg: '#DCFCE7',
      amountColor: 'text-green-600',
      amountPrefix: '+',
    };
  }
  if (ride.status === 'Cancelled') {
    return {
      icon: 'close-circle-outline',
      iconBg: '#FEE2E2',
      amountColor: 'text-red-600',
      amountPrefix: '',
    };
  }
  return {
    icon: 'time-outline',
    iconBg: '#EFF6FF',
    amountColor: 'text-[#2f73c9]',
    amountPrefix: '',
  };
}

const DriverWalletScreen = () => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const isFocused = useIsFocused();
  const [rides, setRides] = useState([]);
  const [summary, setSummary] = useState({
    totalRides: 0,
    completedRides: 0,
    activeRides: 0,
    totalEarnings: 0,
    todayEarnings: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const loadWallet = async (showRefreshing = false) => {
    try {
      setError('');
      if (showRefreshing) setRefreshing(true);
      else setLoading(true);

      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const data = await getDriverRideHistory(token, { page: 1, limit: 10 });
      setRides(Array.isArray(data?.rides) ? data.rides : []);
      setSummary({
        totalRides: Number(data?.summary?.totalRides || 0),
        completedRides: Number(data?.summary?.completedRides || 0),
        activeRides: Number(data?.summary?.activeRides || 0),
        totalEarnings: Number(data?.summary?.totalEarnings || 0),
        todayEarnings: Number(data?.summary?.todayEarnings || 0),
      });
    } catch (loadError) {
      setError(loadError?.message || 'Could not load wallet activity.');
      setRides([]);
      setSummary({
        totalRides: 0,
        completedRides: 0,
        activeRides: 0,
        totalEarnings: 0,
        todayEarnings: 0,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
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
        <TouchableOpacity className="p-2" disabled>
          <Ionicons name="settings-outline" size={24} color="#9ca3af" />
        </TouchableOpacity>
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
              <Text className="mb-1 text-sm font-medium text-white/90">Total Earnings</Text>
              <Text className="text-3xl font-bold text-white">{formatCurrency(summary.totalEarnings)}</Text>
              <Text className="mt-1 text-sm text-white/80">{summary.completedRides} completed trips</Text>
              <View className="mt-4 flex-row items-center justify-between border-t border-white/20 pt-3">
                <Text className="text-xs text-white/80">Today: {formatCurrency(summary.todayEarnings)}</Text>
                <Text className="text-xs text-white/80">Active rides: {summary.activeRides}</Text>
              </View>
            </View>
          </View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 24) }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadWallet(true)} tintColor={PRIMARY_BLUE} />}
            showsVerticalScrollIndicator={false}
          >
            <View className="mb-8 flex-row justify-between">
              {[
                { key: 'today', label: 'Today', value: formatCurrency(summary.todayEarnings), icon: 'today-outline' },
                { key: 'rides', label: 'Trips', value: String(summary.totalRides), icon: 'car-outline' },
                { key: 'done', label: 'Done', value: String(summary.completedRides), icon: 'checkmark-circle-outline' },
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

            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-bold text-gray-900">Recent Ride Earnings</Text>
            </View>

            {error ? (
              <View className="mb-4 rounded-[20px] bg-red-50 px-4 py-4">
                <Text className="text-base font-medium text-red-600">{error}</Text>
              </View>
            ) : null}

            <View className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
              {!rides.length ? (
                <View className="px-5 py-10">
                  <Text className="text-center text-base text-gray-500">No wallet transactions yet.</Text>
                </View>
              ) : (
                rides.map((ride, index) => {
                  const meta = getTransactionMeta(ride);
                  return (
                    <View
                      key={ride.id}
                      className="flex-row items-center px-4 py-4"
                      style={index < rides.length - 1 ? { borderBottomWidth: 1, borderBottomColor: '#f9fafb' } : undefined}
                    >
                      <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: meta.iconBg }}>
                        <Ionicons name={meta.icon} size={20} color={PRIMARY_BLUE} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-base font-semibold text-gray-900">
                          {ride.status === 'Completed' ? `Ride to ${ride.dropoffLabel}` : ride.status}
                        </Text>
                        <Text className="text-sm text-gray-500">
                          {formatDate(ride.completedAt || ride.cancelledAt || ride.assignedAt || ride.requestedAt)}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className={`text-base font-semibold ${meta.amountColor}`}>
                          {meta.amountPrefix}{formatCurrency(ride.estimatedAmount)}
                        </Text>
                        <Text className="text-xs text-gray-400">{ride.status.toUpperCase()}</Text>
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
