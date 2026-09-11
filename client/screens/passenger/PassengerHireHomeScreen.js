import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { browseHireFleet, listHireRequests, resolveUploadedMediaUrl } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

const CATEGORY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'truck', label: 'Truck' },
  { value: 'moving_van', label: 'Moving' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'van', label: 'Van' },
  { value: 'bus', label: 'Bus' },
  { value: 'suv', label: 'SUV' },
];

export default function PassengerHireHomeScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [tab, setTab] = useState(route.params?.initialTab === 'jobs' ? 'jobs' : 'fleet'); // fleet | jobs
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [vehicles, setVehicles] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);
  const searchTimerRef = useRef(null);
  const lastRefreshAtRef = useRef(null);

  useEffect(() => {
    const nextTab = route.params?.initialTab;
    const refreshAt = route.params?.refreshAt;
    if (nextTab === 'jobs' || nextTab === 'fleet') {
      hasLoadedRef.current = false;
      setTab(nextTab);
    }
    if (refreshAt && refreshAt !== lastRefreshAtRef.current) {
      lastRefreshAtRef.current = refreshAt;
      hasLoadedRef.current = false;
    }
  }, [route.params?.initialTab, route.params?.refreshAt]);

  const load = useCallback(async ({ silent = false, pull = false, nextSearch = search, nextCategory = category } = {}) => {
    const requestId = ++requestIdRef.current;
    try {
      if (!silent && !hasLoadedRef.current) setLoading(true);
      if (pull) setRefreshing(true);
      const token = await getTokenRef.current({ skipCache: true });
      if (requestId !== requestIdRef.current) return;

      if (tab === 'fleet') {
        const data = await browseHireFleet(token, {
          q: nextSearch.trim() || undefined,
          category: nextCategory || undefined,
        });
        if (requestId !== requestIdRef.current) return;
        setVehicles(Array.isArray(data?.vehicles) ? data.vehicles : []);
      } else {
        const data = await listHireRequests(token);
        if (requestId !== requestIdRef.current) return;
        setRequests(Array.isArray(data?.requests) ? data.requests : []);
      }
      hasLoadedRef.current = true;
    } catch {
      if (requestId !== requestIdRef.current) return;
      if (!hasLoadedRef.current) {
        setVehicles([]);
        setRequests([]);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [category, search, tab]);

  useFocusEffect(
    useCallback(() => {
      load({ silent: hasLoadedRef.current });
    }, [load])
  );

  const onChangeSearch = (value) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      load({ silent: true, nextSearch: value });
    }, 350);
  };

  const showInitialSpinner = loading && !hasLoadedRef.current;

  const openCreateJob = (vehicle = null) => {
    navigation.navigate('PassengerHireCreate', {
      category: vehicle?.category || 'truck',
      preferredVehicle: vehicle || undefined,
    });
  };

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 10 }}>
        <Text className="text-[22px] font-bold text-gray-900">Hiring</Text>

        <View className="mt-3 flex-row rounded-[18px] bg-white p-1">
          {[
            { key: 'fleet', label: 'Fleet' },
            { key: 'jobs', label: 'My jobs' },
          ].map((item) => (
            <TouchableOpacity
              key={item.key}
              onPress={() => {
                hasLoadedRef.current = false;
                setTab(item.key);
              }}
              className="flex-1 items-center rounded-[14px] py-2.5"
              style={{ backgroundColor: tab === item.key ? PRIMARY_BLUE : 'transparent' }}
            >
              <Text
                className="text-sm font-bold"
                style={{ color: tab === item.key ? '#fff' : '#64748b' }}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'fleet' ? (
          <>
            <View className="mt-3 flex-row items-center rounded-[18px] bg-white px-3">
              <Ionicons name="search" size={18} color="#64748b" />
              <TextInput
                value={search}
                onChangeText={onChangeSearch}
                placeholder="Search trucks, vans, rates..."
                className="ml-2 h-11 flex-1 text-base text-gray-900"
                autoCapitalize="none"
              />
              {search ? (
                <TouchableOpacity onPress={() => onChangeSearch('')}>
                  <Ionicons name="close-circle" size={18} color="#94a3b8" />
                </TouchableOpacity>
              ) : null}
            </View>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {CATEGORY_FILTERS.map((item) => (
                <TouchableOpacity
                  key={item.value || 'all'}
                  onPress={() => {
                    setCategory(item.value);
                    load({ silent: true, nextCategory: item.value });
                  }}
                  className="rounded-full px-3 py-1.5"
                  style={{ backgroundColor: category === item.value ? PRIMARY_BLUE : '#fff' }}
                >
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: category === item.value ? '#fff' : '#475569' }}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}
      </View>

      {showInitialSpinner ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={PRIMARY_BLUE} />
        </View>
      ) : tab === 'fleet' ? (
        <FlatList
          data={vehicles}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load({ silent: true, pull: true })}
              tintColor={PRIMARY_BLUE}
            />
          )}
          ListEmptyComponent={(
            <View className="rounded-[24px] bg-white px-5 py-8 items-center">
              <Text className="text-base font-semibold text-gray-900">No hire vehicles yet</Text>
              <Text className="mt-2 text-center text-sm text-gray-500">
                Approved fleet vehicles will appear here with their rates.
              </Text>
            </View>
          )}
          renderItem={({ item }) => {
            const photo = item.photoUrls?.[0] ? resolveUploadedMediaUrl(item.photoUrls[0]) : null;
            return (
              <TouchableOpacity
                onPress={() => openCreateJob(item)}
                activeOpacity={0.85}
                className="mb-3 overflow-hidden rounded-[24px] bg-white"
              >
                {photo ? (
                  <Image source={{ uri: photo }} className="h-40 w-full" resizeMode="cover" />
                ) : (
                  <View className="h-28 w-full items-center justify-center bg-slate-100">
                    <Ionicons name="bus-outline" size={28} color="#94a3b8" />
                  </View>
                )}
                <View className="px-4 py-4">
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 pr-3">
                      <Text className="text-[16px] font-bold text-gray-900">{item.title}</Text>
                      <Text className="mt-1 text-sm text-gray-500">
                        {[item.category, item.make, item.model, item.seatCount ? `${item.seatCount} seats` : null]
                          .filter(Boolean)
                          .join(' · ')
                          .replace(/_/g, ' ')}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-xs font-semibold uppercase text-slate-400">From</Text>
                      <Text className="text-base font-bold text-gray-900">
                        {item.dailyRate != null
                          ? `${item.currency || 'USD'} ${Number(item.dailyRate).toFixed(0)}`
                          : 'Quote'}
                      </Text>
                    </View>
                  </View>
                  {item.description ? (
                    <Text numberOfLines={2} className="mt-2 text-sm text-gray-600">{item.description}</Text>
                  ) : null}
                  <View className="mt-3 self-start rounded-full bg-[#eff6ff] px-3 py-1.5">
                    <Text className="text-xs font-bold" style={{ color: PRIMARY_BLUE }}>Request this vehicle</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load({ silent: true, pull: true })}
              tintColor={PRIMARY_BLUE}
            />
          )}
          ListEmptyComponent={(
            <View className="rounded-[24px] bg-white px-5 py-8 items-center">
              <Text className="text-base font-semibold text-gray-900">No hire jobs yet</Text>
              <Text className="mt-2 text-center text-sm text-gray-500">
                Post a job from the fleet tab or home map hire flow.
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => navigation.navigate('PassengerHireDetail', { requestId: item.id })}
              className="mb-3 rounded-[24px] bg-white px-4 py-4"
            >
              <View className="flex-row items-center justify-between">
                <Text className="flex-1 text-[15px] font-bold text-gray-900" numberOfLines={1}>
                  {item.title || item.publicId}
                </Text>
                <Text className="ml-2 text-xs font-semibold uppercase text-slate-500">{item.status}</Text>
              </View>
              {item.title ? (
                <Text className="mt-0.5 text-xs text-gray-400">{item.publicId}</Text>
              ) : null}
              <Text className="mt-2 text-sm text-gray-700">{item.pickupLabel}</Text>
              {item.dropoffLabel ? (
                <Text className="mt-1 text-sm text-gray-500">To {item.dropoffLabel}</Text>
              ) : null}
              <Text className="mt-1 text-xs text-gray-500">
                {item.startAt ? new Date(item.startAt).toLocaleString() : ''}
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
