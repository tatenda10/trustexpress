import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../auth/AuthProvider';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPassengerRideHistory } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

const PAGE_SIZE = 15;

const FILTERS = [
  { key: 'completed', label: 'Completed' },
  { key: 'ongoing', label: 'Ongoing' },
  { key: 'cancelled', label: 'Cancelled' },
];

const EMPTY_COPY = {
  completed: { title: 'No completed rides yet', body: 'Rides you finish will show up here.' },
  ongoing: { title: 'No ongoing rides', body: 'When you request a ride, you can follow it here.' },
  cancelled: { title: 'No cancelled rides', body: 'Rides that were cancelled or expired show up here.' },
};

const ONGOING_LABELS = {
  requested: 'Finding driver',
  driver_found: 'Finding driver',
  driver_assigned: 'Driver on the way',
  driver_arrived: 'Driver arrived',
  in_progress: 'On trip',
};

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
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function shortPlace(label) {
  return String(label || '')
    .replace(/^(Pickup|Drop-off):\s*/i, '')
    .split(',')[0]
    .trim() || 'Unknown place';
}

function RideRow({ ride, filter, onPress }) {
  const fare = Number(ride?.finalEstimatedAmount ?? ride?.estimatedAmount ?? 0);
  const minutes = Number(ride?.estimatedMinutes || 0);
  const isCancelled = filter === 'cancelled';
  const isOngoing = filter === 'ongoing';
  const meta = [formatCurrency(fare), minutes > 0 ? `${minutes} min` : null].filter(Boolean).join(' · ');

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className="flex-row items-center border-b border-gray-100 py-4"
    >
      <View
        className="h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: isCancelled ? '#fef2f2' : isOngoing ? '#eef4ff' : '#f3f4f6' }}
      >
        <Ionicons
          name={isCancelled ? 'close' : isOngoing ? 'car' : 'location-outline'}
          size={19}
          color={isCancelled ? '#dc2626' : isOngoing ? PRIMARY_BLUE : '#374151'}
        />
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-[15px] font-semibold text-gray-900" numberOfLines={1}>
          {shortPlace(ride.pickupLabel)} → {shortPlace(ride.dropoffLabel)}
        </Text>
        <Text className="mt-0.5 text-[13px] text-gray-600">{meta}</Text>
        <View className="mt-0.5 flex-row items-center">
          {isOngoing ? (
            <Text className="mr-2 text-[12px] font-semibold" style={{ color: PRIMARY_BLUE }}>
              {ONGOING_LABELS[ride.rawStatus] || 'In progress'}
            </Text>
          ) : null}
          <Text className="text-[12px] text-gray-400">{formatDate(ride.requestedAt)}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#c0c4cc" />
    </TouchableOpacity>
  );
}

const PassengerActivityScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const requestIdRef = useRef(0);
  const isFocused = useIsFocused();
  const [filter, setFilter] = useState('completed');
  const [rides, setRides] = useState([]);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const loadPage = useCallback(async (nextPage, mode = 'initial') => {
    const requestId = ++requestIdRef.current;
    if (mode === 'refresh') setRefreshing(true);
    else if (mode === 'more') setLoadingMore(true);
    else setLoading(true);

    try {
      setError('');
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const data = await getPassengerRideHistory(token, { page: nextPage, limit: PAGE_SIZE, status: filter });
      if (requestId !== requestIdRef.current) return;
      const pageRides = Array.isArray(data?.rides) ? data.rides : [];
      setRides((current) => (mode === 'more' ? [...current, ...pageRides] : pageRides));
      setPage(Number(data?.pagination?.page || nextPage));
      setHasNextPage(!!data?.pagination?.hasNextPage);
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setError(loadError?.message || 'Could not load your rides.');
      if (mode !== 'more') setRides([]);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, [filter]);

  useEffect(() => {
    if (!isFocused) return;
    loadPage(1);
  }, [isFocused, loadPage]);

  const handleEndReached = () => {
    if (!hasNextPage || loading || loadingMore || refreshing) return;
    loadPage(page + 1, 'more');
  };

  const emptyCopy = EMPTY_COPY[filter];

  return (
    <View className="flex-1 bg-white">
      <View className="bg-white px-5 pb-3" style={{ paddingTop: insets.top + 10 }}>
        <Text className="text-[26px] font-extrabold text-gray-950">My Rides</Text>
        <View className="mt-4 flex-row rounded-xl bg-[#f3f4f6] p-1">
          {FILTERS.map((item) => {
            const active = item.key === filter;
            return (
              <TouchableOpacity
                key={item.key}
                onPress={() => setFilter(item.key)}
                activeOpacity={0.8}
                className="flex-1 items-center rounded-lg py-2.5"
                style={active ? { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb' } : undefined}
              >
                <Text
                  className="text-[14px] font-semibold"
                  style={{ color: active ? PRIMARY_BLUE : '#6b7280' }}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading && !refreshing ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        </View>
      ) : (
        <FlatList
          data={rides}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <RideRow
              ride={item}
              filter={filter}
              onPress={() => navigation.navigate('PassengerRideDetail', {
                rideRequestId: item.id,
                initialRide: item,
              })}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadPage(1, 'refresh')} tintColor={PRIMARY_BLUE} />
          }
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={error ? (
            <View className="mt-2 rounded-2xl bg-red-50 px-4 py-3">
              <Text className="text-[14px] font-medium text-red-600">{error}</Text>
            </View>
          ) : null}
          ListEmptyComponent={error ? null : (
            <View className="flex-1 items-center justify-center px-6 py-20">
              <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-[#eef4ff]">
                <Ionicons name="receipt-outline" size={30} color={PRIMARY_BLUE} />
              </View>
              <Text className="text-[18px] font-bold text-gray-900">{emptyCopy.title}</Text>
              <Text className="mt-1.5 text-center text-[14px] text-gray-500">{emptyCopy.body}</Text>
            </View>
          )}
          ListFooterComponent={loadingMore ? (
            <View className="py-5">
              <ActivityIndicator size="small" color={PRIMARY_BLUE} />
            </View>
          ) : null}
        />
      )}
    </View>
  );
};

export default PassengerActivityScreen;
