import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listHireVehicles, resolveUploadedMediaUrl } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

function statusColor(status) {
  if (status === 'approved') return '#059669';
  if (status === 'rejected') return '#e11d48';
  return '#d97706';
}

export default function DriverHireVehiclesScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError('');
      const token = await getToken({ skipCache: true });
      const data = await listHireVehicles(token);
      setVehicles(Array.isArray(data?.vehicles) ? data.vehicles : []);
    } catch (err) {
      setError(err?.message || 'Could not load hire vehicles');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
        <Text className="text-[18px] font-bold text-gray-900">Hire vehicles</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('DriverHireVehicleForm')}
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
          data={vehicles}
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
              <Text className="text-base font-semibold text-gray-900">No hire vehicles yet</Text>
              <Text className="mt-2 text-center text-sm text-gray-500">
                Add a vehicle to receive hire quotes from passengers.
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('DriverHireVehicleForm')}
                className="mt-5 h-11 px-5 items-center justify-center rounded-[18px]"
                style={{ backgroundColor: PRIMARY_BLUE }}
              >
                <Text className="text-sm font-bold text-white">Add vehicle</Text>
              </TouchableOpacity>
            </View>
          )}
          ListHeaderComponent={error ? (
            <Text className="mb-3 text-sm text-rose-600">{error}</Text>
          ) : null}
          renderItem={({ item }) => {
            const photo = item.photoUrls?.[0] ? resolveUploadedMediaUrl(item.photoUrls[0]) : null;
            return (
              <TouchableOpacity
                onPress={() => navigation.navigate('DriverHireVehicleForm', { vehicle: item })}
                className="mb-3 overflow-hidden rounded-[24px] bg-white"
                activeOpacity={0.85}
              >
                {photo ? (
                  <Image source={{ uri: photo }} className="h-36 w-full" resizeMode="cover" />
                ) : (
                  <View className="h-28 w-full items-center justify-center bg-slate-100">
                    <Ionicons name="car-outline" size={28} color="#94a3b8" />
                  </View>
                )}
                <View className="px-4 py-4">
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 text-[16px] font-bold text-gray-900">{item.title}</Text>
                    <Text className="text-xs font-semibold uppercase" style={{ color: statusColor(item.status) }}>
                      {item.status}
                    </Text>
                  </View>
                  <Text className="mt-1 text-sm text-gray-500">
                    {[item.make, item.model, item.category].filter(Boolean).join(' · ')}
                  </Text>
                  {item.rejectionReason ? (
                    <Text className="mt-2 text-sm text-rose-600">{item.rejectionReason}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}
