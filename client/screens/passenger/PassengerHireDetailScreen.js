import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { acceptHireQuote, cancelHireRequest, getHireRequest } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

export default function PassengerHireDetailScreen({ navigation, route }) {
  const requestId = route.params?.requestId;
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [request, setRequest] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const token = await getToken({ skipCache: true });
      const data = await getHireRequest(token, requestId);
      setRequest(data?.request || null);
      setQuotes(Array.isArray(data?.quotes) ? data.quotes : []);
    } catch (err) {
      Alert.alert('Hire request', err?.message || 'Could not load request');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken, requestId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleAccept = async (quoteId) => {
    try {
      setBusyId(quoteId);
      const token = await getToken({ skipCache: true });
      await acceptHireQuote(token, quoteId);
      Alert.alert('Booked', 'Hire booking confirmed.');
      load(true);
    } catch (err) {
      Alert.alert('Could not accept quote', err?.message || 'Try again');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async () => {
    try {
      setBusyId('cancel');
      const token = await getToken({ skipCache: true });
      await cancelHireRequest(token, requestId);
      Alert.alert('Cancelled', 'Your hire request was cancelled.');
      navigation.goBack();
    } catch (err) {
      Alert.alert('Cancel failed', err?.message || 'Try again');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#f6f7f3]">
        <ActivityIndicator color={PRIMARY_BLUE} />
      </View>
    );
  }

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
        <Text className="text-[18px] font-bold text-gray-900">{request?.publicId || 'Hire request'}</Text>
        <View className="h-10 w-10" />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 28 }}
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
      >
        <View className="rounded-[24px] bg-white px-4 py-4">
          <Text className="text-base font-bold text-gray-900">{request?.pickupLabel}</Text>
          {request?.dropoffLabel ? (
            <Text className="mt-1 text-sm text-gray-500">To {request.dropoffLabel}</Text>
          ) : null}
          <Text className="mt-3 text-xs uppercase tracking-wide text-gray-500">
            {request?.status} · {request?.passengerCount} pax
          </Text>
          <Text className="mt-1 text-sm text-gray-600">
            {request?.startAt ? new Date(request.startAt).toLocaleString() : ''}
          </Text>
          {request?.notes ? <Text className="mt-3 text-sm text-gray-700">{request.notes}</Text> : null}
        </View>

        <Text className="mb-3 mt-6 text-sm font-bold uppercase tracking-wide text-gray-500">Quotes</Text>
        {quotes.length === 0 ? (
          <View className="rounded-[24px] bg-white px-4 py-6">
            <Text className="text-sm text-gray-500">Waiting for drivers to quote…</Text>
          </View>
        ) : (
          quotes.map((quote) => (
            <View key={quote.id} className="mb-3 rounded-[24px] bg-white px-4 py-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-base font-bold text-gray-900">
                  {quote.currency} {Number(quote.amount).toFixed(2)}
                </Text>
                <Text className="text-xs font-semibold uppercase text-slate-500">{quote.status}</Text>
              </View>
              <Text className="mt-1 text-sm text-gray-600">
                {quote.driverName || 'Driver'} · {quote.vehicle?.title || 'Vehicle'}
              </Text>
              {quote.message ? <Text className="mt-2 text-sm text-gray-500">{quote.message}</Text> : null}
              {quote.status === 'pending' && ['open', 'quoted'].includes(request?.status) ? (
                <TouchableOpacity
                  onPress={() => handleAccept(quote.id)}
                  disabled={!!busyId}
                  className="mt-4 h-11 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: PRIMARY_BLUE, opacity: busyId ? 0.7 : 1 }}
                >
                  {busyId === quote.id ? <ActivityIndicator color="#fff" /> : (
                    <Text className="font-bold text-white">Accept quote</Text>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          ))
        )}

        {['open', 'quoted'].includes(request?.status) ? (
          <TouchableOpacity
            onPress={handleCancel}
            disabled={!!busyId}
            className="mt-4 h-11 items-center justify-center rounded-2xl bg-rose-50"
          >
            <Text className="font-semibold text-rose-600">Cancel request</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}
