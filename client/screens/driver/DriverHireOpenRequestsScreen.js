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
import { listOpenHireRequests } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

export default function DriverHireOpenRequestsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const lastNotificationTsRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError('');
      const token = await getTokenRef.current({ skipCache: true });
      const openData = await listOpenHireRequests(token);
      setRequests(Array.isArray(openData?.requests) ? openData.requests : []);
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

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={PRIMARY_BLUE} />
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => String(item.id)}
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
                {error ? 'Could not load transport jobs' : 'No open transport jobs'}
              </Text>
              <Text className="mt-2 text-center text-sm text-gray-500">
                {error || 'When passengers request truck, moving or travel hire, they will appear here for quoting.'}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
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
                {item.category ? ` · ${String(item.category).replace(/_/g, ' ')}` : ''}
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
          )}
        />
      )}
    </View>
  );
}
