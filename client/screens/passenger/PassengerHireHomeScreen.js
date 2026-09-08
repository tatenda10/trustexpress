import React, { useCallback, useState } from 'react';
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
import { listHireRequests } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

export default function PassengerHireHomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requests, setRequests] = useState([]);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const token = await getToken({ skipCache: true });
      const data = await listHireRequests(token);
      setRequests(Array.isArray(data?.requests) ? data.requests : []);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center justify-between"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 14 }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-[18px] font-bold text-gray-900">Transport hire</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('PassengerHireCreate')}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="add" size={22} color={PRIMARY_BLUE} />
        </TouchableOpacity>
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
          ListHeaderComponent={(
            <TouchableOpacity
              onPress={() => navigation.navigate('PassengerHireCreate')}
              className="mb-4 rounded-[24px] px-5 py-5"
              style={{ backgroundColor: PRIMARY_BLUE }}
            >
              <Text className="text-base font-bold text-white">Request a hire vehicle</Text>
              <Text className="mt-1 text-sm text-white/85">
                Post your trip details and compare driver quotes.
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={(
            <View className="rounded-[24px] bg-white px-5 py-8 items-center">
              <Text className="text-base font-semibold text-gray-900">No hire requests yet</Text>
              <Text className="mt-2 text-center text-sm text-gray-500">
                Create a request when you need a vehicle for a planned trip.
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => navigation.navigate('PassengerHireDetail', { requestId: item.id })}
              className="mb-3 rounded-[24px] bg-white px-4 py-4"
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-[15px] font-bold text-gray-900">{item.publicId}</Text>
                <Text className="text-xs font-semibold uppercase text-slate-500">{item.status}</Text>
              </View>
              <Text className="mt-2 text-sm text-gray-700">{item.pickupLabel}</Text>
              <Text className="mt-1 text-xs text-gray-500">
                {item.startAt ? new Date(item.startAt).toLocaleString() : ''}
                {item.quoteCount != null ? ` · ${item.quoteCount} quotes` : ''}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
