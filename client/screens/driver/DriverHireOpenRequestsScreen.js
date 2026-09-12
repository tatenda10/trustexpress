import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listHireBookings, listOpenHireRequests } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { isLiveHireBooking } from '../../constants/hire';
import { paymentMethodLabel } from '../../constants/payment';
import { connectRealtime } from '../../realtime';

export default function DriverHireOpenRequestsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const lastNotificationTsRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [requests, setRequests] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [tab, setTab] = useState(route?.params?.initialTab === 'jobs' ? 'jobs' : 'open');

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError('');
      const token = await getTokenRef.current({ skipCache: true });
      const [openData, bookingData] = await Promise.all([
        listOpenHireRequests(token),
        listHireBookings(token),
      ]);
      setRequests(Array.isArray(openData?.requests) ? openData.requests : []);
      setBookings(Array.isArray(bookingData?.bookings) ? bookingData.bookings : []);
    } catch (err) {
      setRequests([]);
      setError(err?.message || 'Could not load transport requests.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (route?.params?.notificationTs && route.params.notificationTs !== lastNotificationTsRef.current) {
      lastNotificationTsRef.current = route.params.notificationTs;
      load(true);
    }
  }, [load, route?.params?.notificationTs]);

  useEffect(() => {
    let cancelled = false;
    let socket = null;
    const onConfirmed = (payload) => {
      if (cancelled) return;
      const requestId = Number(payload?.hireRequestId);
      if (!Number.isInteger(requestId) || requestId <= 0) return;
      navigation.navigate('DriverHireTrip', { requestId });
    };
    (async () => {
      try {
        const token = await getTokenRef.current({ skipCache: true });
        socket = connectRealtime(token);
        socket.on('hire_booking:confirmed', onConfirmed);
      } catch {
        // Push notification still opens the trip.
      }
    })();
    return () => {
      cancelled = true;
      socket?.off?.('hire_booking:confirmed', onConfirmed);
    };
  }, [navigation]);

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center justify-between"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 14 }}
      >
        {navigation.canGoBack() ? (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            className="h-10 w-10 items-center justify-center rounded-full bg-white"
          >
            <Ionicons name="chevron-back" size={22} color="#111827" />
          </TouchableOpacity>
        ) : (
          <View className="h-10 w-10" />
        )}
        <Text className="text-[18px] font-bold text-gray-900">Hiring</Text>
        <View className="h-10 w-10" />
      </View>

      <View className="mx-5 mb-3 flex-row rounded-[18px] bg-white p-1">
        {[
          { key: 'open', label: 'Open jobs' },
          { key: 'jobs', label: 'My jobs' },
        ].map((item) => (
          <TouchableOpacity
            key={item.key}
            onPress={() => setTab(item.key)}
            className="flex-1 items-center rounded-[14px] py-2.5"
            style={{ backgroundColor: tab === item.key ? PRIMARY_BLUE : 'transparent' }}
          >
            <Text className="text-sm font-bold" style={{ color: tab === item.key ? '#fff' : '#64748b' }}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={PRIMARY_BLUE} />
        </View>
      ) : (
        <FlatList
          data={tab === 'jobs' ? bookings : requests}
          keyExtractor={(item) => `${tab}-${item.id}`}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(true);
              }}
              tintColor={PRIMARY_BLUE}
            />
          )}
          ListEmptyComponent={(
            <View className="mt-10 rounded-[24px] bg-white px-5 py-8 items-center">
              <Text className="text-base font-semibold text-gray-900">
                {error
                  ? 'Could not load transport jobs'
                  : tab === 'jobs'
                    ? 'No booked hire jobs yet'
                    : 'No open transport jobs'}
              </Text>
              <Text className="mt-2 text-center text-sm text-gray-500">
                {error
                  || (tab === 'jobs'
                    ? 'Accepted hire jobs stay here so you can open the live map, start the ride, and complete the trip.'
                    : 'When passengers request truck, moving or travel hire, they will appear here for quoting.')}
              </Text>
            </View>
          )}
          renderItem={({ item }) => {
            if (tab === 'jobs') {
              const request = item.request || {};
              const payLabel = paymentMethodLabel(request.paymentMethod);
              const requestId = request.id || item.hireRequestId;
              const live = isLiveHireBooking(item.status);
              return (
                <TouchableOpacity
                  onPress={() => navigation.navigate(
                    live ? 'DriverHireTrip' : 'DriverHireDetail',
                    { requestId },
                  )}
                  className="mb-3 rounded-[24px] bg-white px-4 py-4"
                  activeOpacity={0.85}
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 text-[15px] font-bold text-gray-900" numberOfLines={1}>
                      {request.title || request.pickupLabel || 'Hire job'}
                    </Text>
                    <Text className="ml-2 text-xs font-semibold uppercase text-slate-500">{item.status}</Text>
                  </View>
                  <Text className="mt-1 text-sm text-gray-700">{request.pickupLabel}</Text>
                  {request.dropoffLabel ? (
                    <Text className="mt-1 text-sm text-gray-500">To {request.dropoffLabel}</Text>
                  ) : null}
                  <Text className="mt-2 text-xs text-gray-500">
                    {request.startAt ? new Date(request.startAt).toLocaleString() : 'Time TBD'}
                    {payLabel ? ` · ${payLabel}` : ''}
                    {item.amount != null ? ` · ${item.currency || 'USD'} ${Number(item.amount).toFixed(2)}` : ''}
                  </Text>
                  <View className="mt-3 flex-row items-center">
                    <Text className="text-sm font-semibold" style={{ color: PRIMARY_BLUE }}>
                      {live ? 'Open live trip' : 'Open job'}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={PRIMARY_BLUE} />
                  </View>
                </TouchableOpacity>
              );
            }

            return (
            <TouchableOpacity
              onPress={() => navigation.navigate('DriverHireDetail', { requestId: item.id })}
              className="mb-3 rounded-[24px] bg-white px-4 py-4"
              activeOpacity={0.85}
            >
              <Text className="text-[15px] font-bold text-gray-900" numberOfLines={1}>
                {item.title || item.pickupLabel}
              </Text>
              {item.title ? (
                <Text className="mt-1 text-sm text-gray-700" numberOfLines={1}>{item.pickupLabel}</Text>
              ) : null}
              {item.dropoffLabel ? (
                <Text className="mt-1 text-sm text-gray-500">To {item.dropoffLabel}</Text>
              ) : null}
              <Text className="mt-2 text-xs text-gray-500">
                {item.startAt ? new Date(item.startAt).toLocaleString() : 'Time TBD'}
                {' · '}
                {item.passengerCount} pax
                {item.tripType ? ` · ${item.tripType}` : ''}
                {item.category ? ` · ${String(item.category).replace(/_/g, ' ')}` : ''}
                {paymentMethodLabel(item.paymentMethod) ? ` · ${paymentMethodLabel(item.paymentMethod)}` : ''}
                {item.quoteCount != null ? ` · ${item.quoteCount} quotes` : ''}
              </Text>
              {item.notes ? (
                <Text className="mt-2 text-sm text-gray-600" numberOfLines={2}>{item.notes}</Text>
              ) : null}
              <View className="mt-3 flex-row items-center">
                <Text className="text-sm font-semibold" style={{ color: PRIMARY_BLUE }}>Open</Text>
                <Ionicons name="chevron-forward" size={16} color={PRIMARY_BLUE} />
              </View>
            </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}
