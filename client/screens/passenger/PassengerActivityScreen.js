import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPassengerRideHistory } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

function getStatusColors(status) {
  if (status === 'Completed') {
    return {
      backgroundColor: '#dcfce7',
      textColor: '#15803d',
      icon: 'checkmark-circle',
    };
  }

  if (status === 'Cancelled') {
    return {
      backgroundColor: '#fee2e2',
      textColor: '#dc2626',
      icon: 'close-circle',
    };
  }

  return {
    backgroundColor: '#dbeafe',
    textColor: PRIMARY_BLUE,
    icon: 'time',
  };
}

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

const PassengerActivityScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const isFocused = useIsFocused();
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const loadHistoryPage = async (nextPage, showRefreshing = false) => {
    try {
      setError('');
      if (showRefreshing) setRefreshing(true);
      else setLoading(true);

      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const data = await getPassengerRideHistory(token, { page: nextPage, limit: 10 });
      setRides(Array.isArray(data?.rides) ? data.rides : []);
      setPage(Number(data?.pagination?.page || nextPage));
      setPagination({
        page: Number(data?.pagination?.page || nextPage),
        limit: Number(data?.pagination?.limit || 10),
        total: Number(data?.pagination?.total || 0),
        totalPages: Number(data?.pagination?.totalPages || 1),
        hasNextPage: !!data?.pagination?.hasNextPage,
        hasPreviousPage: !!data?.pagination?.hasPreviousPage,
      });
    } catch (loadError) {
      setError(loadError?.message || 'Could not load your ride history.');
      setRides([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isFocused) return undefined;
    let active = true;

    const loadHistory = async () => {
      try {
        setError('');
        setLoading(true);

        const token = await getTokenRef.current();
        if (!token) throw new Error('Not signed in');
        const data = await getPassengerRideHistory(token, { page: 1, limit: 10 });
        if (!active) return;
        setRides(Array.isArray(data?.rides) ? data.rides : []);
        setPage(Number(data?.pagination?.page || 1));
        setPagination({
          page: Number(data?.pagination?.page || 1),
          limit: Number(data?.pagination?.limit || 10),
          total: Number(data?.pagination?.total || 0),
          totalPages: Number(data?.pagination?.totalPages || 1),
          hasNextPage: !!data?.pagination?.hasNextPage,
          hasPreviousPage: !!data?.pagination?.hasPreviousPage,
        });
      } catch (loadError) {
        if (!active) return;
        setError(loadError?.message || 'Could not load your ride history.');
        setRides([]);
      } finally {
        if (!active) return;
        setLoading(false);
        setRefreshing(false);
      }
    };

    loadHistory(false);

    return () => {
      active = false;
    };
  }, [isFocused]);

  const handleRefresh = async () => {
    await loadHistoryPage(page, true);
  };

  return (
    <View className="flex-1 bg-white">
      <View
        className="border-b border-gray-100 bg-white px-5 pb-3"
        style={{ paddingTop: insets.top }}
      >
        <Text className="text-lg font-bold text-gray-900">Activity</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
          <Text className="mt-4 text-base text-gray-500">Loading your ride history...</Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PRIMARY_BLUE} />}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View className="mb-4 rounded-[24px] bg-red-50 px-4 py-4">
              <Text className="text-base font-medium text-red-600">{error}</Text>
            </View>
          ) : null}

          {!rides.length ? (
            <View className="flex-1 items-center justify-center rounded-[28px] bg-[#f8fafc] px-5 py-16">
              <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-[#eff6ff]">
                <Ionicons name="time-outline" size={32} color={PRIMARY_BLUE} />
              </View>
              <Text className="text-xl font-semibold text-gray-900">No rides yet</Text>
              <Text className="mt-2 text-center text-gray-500">
                The rides you request will appear here with their status.
              </Text>
            </View>
          ) : (
            <>
              {rides.map((ride) => {
                const statusStyle = getStatusColors(ride.status);
                return (
                  <TouchableOpacity
                    key={ride.id}
                    onPress={() => navigation.navigate('PassengerRideDetail', { rideRequestId: ride.id })}
                    className="mb-4 rounded-[28px] border border-gray-100 bg-white px-5 py-5"
                  >
                    <View className="flex-row items-start justify-between">
                      <View className="flex-1 pr-4">
                        <Text className="text-lg font-bold text-gray-900">{ride.pickupLabel}</Text>
                        <Text className="mt-1 text-sm text-gray-500">to {ride.dropoffLabel}</Text>
                      </View>
                      <View
                        className="rounded-full px-3 py-2"
                        style={{ backgroundColor: statusStyle.backgroundColor }}
                      >
                        <Text className="text-xs font-bold uppercase" style={{ color: statusStyle.textColor }}>
                          {ride.status}
                        </Text>
                      </View>
                    </View>

                    <View className="mt-4 flex-row items-center justify-between">
                      <Text className="text-2xl font-bold text-gray-900">{formatCurrency(ride.estimatedAmount)}</Text>
                      <View className="flex-row items-center">
                        <Ionicons name={statusStyle.icon} size={18} color={statusStyle.textColor} />
                        <Text className="ml-2 text-sm font-medium text-gray-600">{ride.tierName || 'Ride'}</Text>
                      </View>
                    </View>

                    <View className="mt-4 flex-row items-center justify-between">
                      <Text className="text-sm text-gray-500">{formatDate(ride.requestedAt)}</Text>
                      <Text className="text-sm text-gray-500">{ride.driverName || 'No driver assigned'}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              <View className="mt-2 rounded-[28px] border border-gray-100 bg-[#f8fafc] px-5 py-5">
                <Text className="text-center text-sm text-gray-500">
                  Page {pagination.page} of {pagination.totalPages} - {pagination.total} rides
                </Text>
                <View className="mt-4 flex-row gap-3">
                  <TouchableOpacity
                    disabled={!pagination.hasPreviousPage || loading}
                    onPress={() => loadHistoryPage(page - 1, false)}
                    className="h-12 flex-1 items-center justify-center rounded-[18px] border border-[#d7d9df] bg-white"
                    style={{ opacity: !pagination.hasPreviousPage || loading ? 0.5 : 1 }}
                  >
                    <Text className="text-sm font-bold uppercase text-[#5d6470]">Previous</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={!pagination.hasNextPage || loading}
                    onPress={() => loadHistoryPage(page + 1, false)}
                    className="h-12 flex-1 items-center justify-center rounded-[18px]"
                    style={{ backgroundColor: PRIMARY_BLUE, opacity: !pagination.hasNextPage || loading ? 0.5 : 1 }}
                  >
                    <Text className="text-sm font-bold uppercase text-white">Next</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
};

export default PassengerActivityScreen;
