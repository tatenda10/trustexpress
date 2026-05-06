import React, { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDriverRideHistory } from '../../api';
import { downloadReceiptPdf } from '../../services/receiptPrint';
import { PRIMARY_BLUE } from '../../constants/colors';

function getStatusColors(status) {
  if (status === 'Completed') {
    return { backgroundColor: '#dcfce7', textColor: '#15803d', icon: 'checkmark-circle' };
  }
  if (status === 'Cancelled') {
    return { backgroundColor: '#fee2e2', textColor: '#dc2626', icon: 'close-circle' };
  }
  if (status === 'In Progress' || status === 'Assigned' || status === 'Arrived') {
    return { backgroundColor: '#dbeafe', textColor: PRIMARY_BLUE, icon: 'car' };
  }
  return { backgroundColor: '#f3f4f6', textColor: '#4b5563', icon: 'time' };
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

const DriverActivityScreen = () => {
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
    averageRating: null,
    ratingCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [downloadingReceiptId, setDownloadingReceiptId] = useState(null);
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

  const loadHistoryPage = async (nextPage = 1, options = {}) => {
    const append = options?.append === true;
    const showRefreshing = options?.refreshing === true;

    try {
      setError('');
      if (append) setLoadingMore(true);
      else if (showRefreshing) setRefreshing(true);
      else setLoading(true);

      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const data = await getDriverRideHistory(token, { page: nextPage, limit: 10 });
      const nextRides = Array.isArray(data?.rides) ? data.rides : [];
      setRides((currentRides) => {
        if (!append) return nextRides;
        const seen = new Set(currentRides.map((ride) => ride.id));
        const uniqueNextRides = nextRides.filter((ride) => !seen.has(ride.id));
        return [...currentRides, ...uniqueNextRides];
      });
      setSummary({
        totalRides: Number(data?.summary?.totalRides || 0),
        completedRides: Number(data?.summary?.completedRides || 0),
        activeRides: Number(data?.summary?.activeRides || 0),
        totalEarnings: Number(data?.summary?.totalEarnings || 0),
        todayEarnings: Number(data?.summary?.todayEarnings || 0),
        averageRating: data?.summary?.averageRating === null || data?.summary?.averageRating === undefined
          ? null
          : Number(data.summary.averageRating),
        ratingCount: Number(data?.summary?.ratingCount || 0),
      });
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
      const status = loadError?.status;
      const msg = status === 401
        ? 'Session expired or invalid. Please sign out and sign in again.'
        : (loadError?.message || 'Could not load your trip activity.');
      setError(msg);
      if (!append) {
        setRides([]);
        setSummary({
          totalRides: 0,
          completedRides: 0,
          activeRides: 0,
          totalEarnings: 0,
          todayEarnings: 0,
          averageRating: null,
          ratingCount: 0,
        });
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
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
        const data = await getDriverRideHistory(token, { page: 1, limit: 10 });
        if (!active) return;
        setRides(Array.isArray(data?.rides) ? data.rides : []);
        setSummary({
          totalRides: Number(data?.summary?.totalRides || 0),
          completedRides: Number(data?.summary?.completedRides || 0),
          activeRides: Number(data?.summary?.activeRides || 0),
          totalEarnings: Number(data?.summary?.totalEarnings || 0),
          todayEarnings: Number(data?.summary?.todayEarnings || 0),
          averageRating: data?.summary?.averageRating === null || data?.summary?.averageRating === undefined
            ? null
            : Number(data.summary.averageRating),
          ratingCount: Number(data?.summary?.ratingCount || 0),
        });
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
        const status = loadError?.status;
        const msg = status === 401
          ? 'Session expired or invalid. Please sign out and sign in again.'
          : (loadError?.message || 'Could not load your trip activity.');
        setError(msg);
        setRides([]);
      } finally {
        if (!active) return;
        setLoading(false);
        setRefreshing(false);
      }
    };

    loadHistory();

    return () => {
      active = false;
    };
  }, [isFocused]);

  const handleRefresh = async () => {
    await loadHistoryPage(1, { refreshing: true });
  };

  const handleLoadMore = async () => {
    if (loading || refreshing || loadingMore || !pagination.hasNextPage) return;
    await loadHistoryPage(page + 1, { append: true });
  };

  const handleDownloadReceipt = async (ride) => {
    try {
      setDownloadingReceiptId(ride.id);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const result = await downloadReceiptPdf(token, ride.id, {
        audience: 'driver',
      });
      Alert.alert('Receipt downloaded', `${result.fileName} was saved.`);
    } catch (receiptError) {
      Alert.alert('Receipt download failed', receiptError?.message || 'Could not download this trip receipt.');
    } finally {
      setDownloadingReceiptId(null);
    }
  };

  const renderHeader = () => {
    const ratingValue = summary.averageRating === null ? '-' : summary.averageRating.toFixed(2);
    const ratingLabel = summary.ratingCount > 0
      ? `${summary.ratingCount} rating${summary.ratingCount === 1 ? '' : 's'}`
      : 'No ratings';

    return (
      <View>
        {error ? (
          <View className="mb-4 rounded-[12px] bg-red-50 px-4 py-4">
            <Text className="text-base font-medium text-red-600">{error}</Text>
          </View>
        ) : null}

        <View className="mb-4 flex-row gap-2">
          <View className="flex-1 rounded-sm bg-[#eff6ff] px-3 py-3">
            <Text className="text-[11px] font-semibold uppercase text-[#5d6470]">Today</Text>
            <Text className="mt-1 text-lg font-bold text-gray-900">{formatCurrency(summary.todayEarnings)}</Text>
          </View>
          <View className="flex-1 rounded-sm bg-[#f8fafc] px-3 py-3">
            <Text className="text-[11px] font-semibold uppercase text-[#5d6470]">Completed</Text>
            <Text className="mt-1 text-lg font-bold text-gray-900">{summary.completedRides}</Text>
          </View>
          <View className="flex-1 rounded-sm bg-[#fff7ed] px-3 py-3">
            <Text className="text-[11px] font-semibold uppercase text-[#5d6470]">Rating</Text>
            <View className="mt-1 flex-row items-center">
              <Ionicons name="star" size={14} color="#f59e0b" />
              <Text className="ml-1 text-lg font-bold text-gray-900">{ratingValue}</Text>
            </View>
            <Text className="mt-0.5 text-[10px] text-gray-500">{ratingLabel}</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderEmpty = () => {
    if (error) return null;

    return (
      <View className="items-center justify-center rounded-[28px] bg-[#f8fafc] px-5 py-16">
        <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-[#eff6ff]">
          <Ionicons name="car-outline" size={32} color={PRIMARY_BLUE} />
        </View>
        <Text className="text-xl font-semibold text-gray-900">No trips yet</Text>
        <Text className="mt-2 text-center text-gray-500">
          Accepted driver trips will appear here with their status and earnings.
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (!loadingMore) return <View className="h-2" />;
    return (
      <View className="py-4">
        <ActivityIndicator size="small" color={PRIMARY_BLUE} />
      </View>
    );
  };

  const renderRide = ({ item: ride }) => {
    const statusStyle = getStatusColors(ride.status);
    const canDownloadReceipt = ride.rawStatus === 'completed';

    return (
      <View className="mb-4 rounded-[28px] border border-gray-100 bg-white px-5 py-5">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-lg font-bold text-gray-900">{ride.pickupLabel}</Text>
            <Text className="mt-1 text-sm text-gray-500">to {ride.dropoffLabel}</Text>
          </View>
          <View className="rounded-full px-3 py-2" style={{ backgroundColor: statusStyle.backgroundColor }}>
            <Text className="text-xs font-bold uppercase" style={{ color: statusStyle.textColor }}>
              {ride.status}
            </Text>
          </View>
        </View>

        <View className="mt-4 flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-bold text-gray-900">
              {formatCurrency(ride.totalEarned || ride.estimatedAmount)}
            </Text>
            {Number(ride.tipAmount || 0) > 0 ? (
              <Text className="mt-1 text-xs font-semibold text-green-600">
                Includes {formatCurrency(ride.tipAmount)} tip
              </Text>
            ) : null}
          </View>
          <View className="flex-row items-center">
            <Ionicons name={statusStyle.icon} size={18} color={statusStyle.textColor} />
            <Text className="ml-2 text-sm font-medium text-gray-600">{ride.tierName || 'Ride'}</Text>
          </View>
        </View>

        <View className="mt-4 flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-sm text-gray-500">{formatDate(ride.completedAt || ride.assignedAt || ride.requestedAt)}</Text>
            <Text className="mt-1 text-sm text-gray-500">{ride.passengerName || 'Passenger'}</Text>
          </View>
          {canDownloadReceipt ? (
            <TouchableOpacity
              onPress={() => handleDownloadReceipt(ride)}
              disabled={downloadingReceiptId === ride.id}
              className="h-9 flex-row items-center justify-center rounded-[10px] border border-blue-200 bg-white px-3"
              style={{ opacity: downloadingReceiptId === ride.id ? 0.6 : 1 }}
            >
              {downloadingReceiptId === ride.id ? (
                <ActivityIndicator size="small" color={PRIMARY_BLUE} />
              ) : (
                <>
                  <Ionicons name="download-outline" size={15} color={PRIMARY_BLUE} />
                  <Text className="ml-1 text-xs font-bold uppercase" style={{ color: PRIMARY_BLUE }}>
                    Receipt
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-white">
      <View className="border-b border-gray-100 bg-white px-5 pb-3" style={{ paddingTop: insets.top }}>
        <Text className="text-lg font-bold text-gray-900">Activity</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
          <Text className="mt-4 text-base text-gray-500">Loading your driver activity...</Text>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          data={rides}
          keyExtractor={(ride) => String(ride.id)}
          renderItem={renderRide}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PRIMARY_BLUE} />}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
        />
      )}
    </View>
  );
};

export default DriverActivityScreen;
