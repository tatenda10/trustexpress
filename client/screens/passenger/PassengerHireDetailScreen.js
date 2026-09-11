import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  acceptHireQuote,
  cancelHireRequest,
  getHireRequest,
  updateHireRequestOffer,
} from '../../api';
import HireRouteOverview from '../../components/hire/HireRouteOverview';
import { PRIMARY_BLUE } from '../../constants/colors';

export default function PassengerHireDetailScreen({ navigation, route }) {
  const requestId = route.params?.requestId;
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [request, setRequest] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [offerModalVisible, setOfferModalVisible] = useState(false);
  const [offerAmount, setOfferAmount] = useState('');
  const hasLoadedRef = useRef(false);
  const fetchIdRef = useRef(0);
  const lastNotificationTsRef = useRef(null);
  const lastRequestIdRef = useRef(requestId);

  if (lastRequestIdRef.current !== requestId) {
    lastRequestIdRef.current = requestId;
    hasLoadedRef.current = false;
  }

  const load = useCallback(async ({ silent = false, pull = false } = {}) => {
    const fetchId = ++fetchIdRef.current;
    try {
      if (!silent && !hasLoadedRef.current) {
        setLoading(true);
      }
      if (pull) setRefreshing(true);

      const token = await getTokenRef.current({ skipCache: true });
      if (fetchId !== fetchIdRef.current) return;

      const data = await getHireRequest(token, requestId);
      if (fetchId !== fetchIdRef.current) return;

      setRequest(data?.request || null);
      setQuotes(Array.isArray(data?.quotes) ? data.quotes : []);
      hasLoadedRef.current = true;
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      if (!hasLoadedRef.current) {
        Alert.alert('Hire request', err?.message || 'Could not load request');
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [requestId]);

  useFocusEffect(
    useCallback(() => {
      load({ silent: hasLoadedRef.current });
    }, [load])
  );

  useEffect(() => {
    const notificationTs = route?.params?.notificationTs;
    if (!notificationTs || notificationTs === lastNotificationTsRef.current) return;
    lastNotificationTsRef.current = notificationTs;
    load({ silent: true });
  }, [load, route?.params?.notificationTs]);

  const canEdit = ['open', 'quoted'].includes(request?.status);

  const openOfferModal = () => {
    setOfferAmount(
      request?.passengerOfferAmount != null ? String(Number(request.passengerOfferAmount)) : ''
    );
    setOfferModalVisible(true);
  };

  const closeOfferModal = () => {
    Keyboard.dismiss();
    setOfferModalVisible(false);
  };

  const handleSaveOffer = async () => {
    try {
      const amount = Number(offerAmount);
      if (!(amount > 0)) {
        Alert.alert('Offer required', 'Enter a valid offer amount.');
        return;
      }
      setBusyId('offer');
      const token = await getTokenRef.current({ skipCache: true });
      const data = await updateHireRequestOffer(token, requestId, {
        passengerOfferAmount: amount,
        fareCurrency: request?.fareCurrency || 'USD',
      });
      setRequest(data?.request || null);
      closeOfferModal();
      Alert.alert('Offer saved', 'Your offer was updated.');
    } catch (err) {
      Alert.alert('Could not save offer', err?.message || 'Try again');
    } finally {
      setBusyId(null);
    }
  };

  const handleAccept = async (quoteId) => {
    try {
      setBusyId(quoteId);
      const token = await getTokenRef.current({ skipCache: true });
      await acceptHireQuote(token, quoteId);
      Alert.alert('Booked', 'Hire booking confirmed. This job is now closed.', [
        {
          text: 'OK',
          onPress: () => {
            navigation.navigate('PassengerHireHome', {
              initialTab: 'jobs',
              refreshAt: Date.now(),
            });
          },
        },
      ]);
    } catch (err) {
      Alert.alert('Could not accept quote', err?.message || 'Try again');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async () => {
    try {
      setBusyId('cancel');
      const token = await getTokenRef.current({ skipCache: true });
      await cancelHireRequest(token, requestId);
      Alert.alert('Cancelled', 'Your hire request was cancelled.');
      navigation.goBack();
    } catch (err) {
      Alert.alert('Cancel failed', err?.message || 'Try again');
    } finally {
      setBusyId(null);
    }
  };

  const showInitialSpinner = loading && !hasLoadedRef.current;
  const scrollBottomPadding = Math.max(tabBarHeight + insets.bottom + 48, 120);

  if (showInitialSpinner) {
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
        <Text className="text-[18px] font-bold text-gray-900" numberOfLines={1}>
          {request?.title || request?.publicId || 'Hire request'}
        </Text>
        <View className="h-10 w-10" />
      </View>

      <ScrollView
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: scrollBottomPadding }}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ silent: true, pull: true })}
            tintColor={PRIMARY_BLUE}
          />
        )}
      >
        <HireRouteOverview
          request={request}
          getToken={(opts) => getTokenRef.current(opts)}
          height={280}
        />

        <View className="mt-3 rounded-[24px] bg-white px-4 py-4">
          <Text className="text-xs uppercase tracking-wide text-gray-500">
            {request?.status} · {request?.passengerCount} pax
            {request?.category ? ` · ${String(request.category).replace(/_/g, ' ')}` : ''}
          </Text>
          <Text className="mt-1 text-sm text-gray-600">
            {request?.startAt ? new Date(request.startAt).toLocaleString() : ''}
          </Text>
          {request?.passengerOfferAmount ? (
            <Text className="mt-2 text-sm font-semibold text-gray-800">
              Your offer: {request?.fareCurrency || 'USD'} {Number(request.passengerOfferAmount).toFixed(2)}
            </Text>
          ) : (
            <Text className="mt-2 text-sm text-gray-500">No offer set yet.</Text>
          )}
          {canEdit ? (
            <TouchableOpacity
              onPress={openOfferModal}
              disabled={!!busyId}
              className="mt-4 h-11 items-center justify-center rounded-2xl"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: busyId ? 0.7 : 1 }}
            >
              <Text className="font-bold text-white">
                {request?.passengerOfferAmount ? 'Update offer' : 'Add offer'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View className="mt-3 rounded-[24px] bg-white px-4 py-4">
          <Text className="text-xs font-bold uppercase tracking-wide text-gray-400">Description</Text>
          <Text className="mt-2 text-sm leading-5 text-gray-800">
            {request?.notes?.trim() || 'No specs or notes added.'}
          </Text>
        </View>

        <Text className="mb-1 mt-6 text-sm font-bold uppercase tracking-wide text-gray-500">Driver offers</Text>
        <Text className="mb-3 text-xs text-gray-500">Accept the offer you like, or wait for drivers to update their quotes.</Text>
        {quotes.length === 0 ? (
          <View className="rounded-[24px] bg-white px-4 py-6">
            <Text className="text-sm text-gray-500">Waiting for drivers to quote...</Text>
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
                {quote.driverName || 'Driver'} - {quote.vehicle?.title || 'Vehicle'}
              </Text>
              {quote.message ? <Text className="mt-2 text-sm text-gray-500">{quote.message}</Text> : null}
              {quote.status === 'pending' && canEdit ? (
                <TouchableOpacity
                  onPress={() => handleAccept(quote.id)}
                  disabled={!!busyId}
                  className="mt-4 h-11 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: PRIMARY_BLUE, opacity: busyId ? 0.7 : 1 }}
                >
                  {busyId === quote.id ? <ActivityIndicator color="#fff" /> : (
                    <Text className="font-bold text-white">Accept offer</Text>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          ))
        )}

        {canEdit ? (
          <TouchableOpacity
            onPress={handleCancel}
            disabled={!!busyId}
            className="mt-4 mb-2 h-11 items-center justify-center rounded-2xl bg-rose-50"
          >
            <Text className="font-semibold text-rose-600">Cancel request</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      <Modal
        visible={offerModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeOfferModal}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View className="flex-1 items-center justify-center bg-black/50 px-6">
            <Pressable
              style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
              onPress={closeOfferModal}
            />
            <View className="w-full max-w-[360px] rounded-[24px] bg-white px-5 py-5">
              <Text className="text-center text-lg font-bold text-gray-900">
                {request?.passengerOfferAmount ? 'Update offer' : 'Add offer'}
              </Text>
              <Text className="mt-1 text-center text-sm text-gray-500">
                Set what you are willing to pay for this hire job.
              </Text>
              <Text className="mb-2 mt-4 text-xs font-semibold uppercase text-gray-500">
                Amount ({request?.fareCurrency || 'USD'})
              </Text>
              <TextInput
                value={offerAmount}
                onChangeText={setOfferAmount}
                keyboardType="decimal-pad"
                placeholder="120"
                autoFocus
                className="h-12 rounded-2xl border border-gray-200 bg-slate-50 px-4 text-center text-base"
              />
              <View className="mt-5 flex-row gap-3">
                <TouchableOpacity
                  onPress={closeOfferModal}
                  className="h-12 flex-1 items-center justify-center rounded-2xl bg-slate-100"
                >
                  <Text className="font-semibold text-gray-700">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveOffer}
                  disabled={busyId === 'offer'}
                  className="h-12 flex-1 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: PRIMARY_BLUE, opacity: busyId === 'offer' ? 0.7 : 1 }}
                >
                  {busyId === 'offer' ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="font-semibold text-white">Save offer</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
