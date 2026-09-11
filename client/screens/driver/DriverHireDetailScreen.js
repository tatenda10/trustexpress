import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  acceptPassengerHireOffer,
  createHireQuote,
  getHireRequest,
  listHireVehicles,
  resolveUploadedMediaUrl,
} from '../../api';
import HireRouteOverview from '../../components/hire/HireRouteOverview';
import { PRIMARY_BLUE } from '../../constants/colors';

export default function DriverHireDetailScreen({ navigation, route }) {
  const requestId = route.params?.requestId;
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [request, setRequest] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState(null);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async ({ silent = false, pull = false } = {}) => {
    try {
      if (!silent && !hasLoadedRef.current) setLoading(true);
      if (pull) setRefreshing(true);
      const token = await getTokenRef.current({ skipCache: true });
      const [requestResult, vehicleResult] = await Promise.allSettled([
        getHireRequest(token, requestId),
        listHireVehicles(token),
      ]);
      if (requestResult.status === 'rejected') throw requestResult.reason;
      const nextRequest = requestResult.value?.request || null;
      setRequest(nextRequest);
      if (nextRequest?.passengerOfferAmount != null) {
        setAmount((current) => (current ? current : String(Number(nextRequest.passengerOfferAmount))));
      }
      const approved = (vehicleResult.status === 'fulfilled' ? vehicleResult.value?.vehicles : [])
        .filter((item) => item.status === 'approved');
      setVehicles(approved);
      setVehicleId((current) => {
        if (approved.some((vehicle) => String(vehicle.id) === String(current))) return current;
        return approved[0]?.id || null;
      });
      hasLoadedRef.current = true;
    } catch (err) {
      if (!hasLoadedRef.current) {
        Alert.alert('Hire job', err?.message || 'Could not load job');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [requestId]);

  useFocusEffect(
    useCallback(() => {
      load({ silent: hasLoadedRef.current });
    }, [load])
  );

  const canRespond = ['open', 'quoted'].includes(request?.status);
  const passengerOffer = Number(request?.passengerOfferAmount);
  const hasPassengerOffer = Number.isFinite(passengerOffer) && passengerOffer > 0;

  const submitQuote = async () => {
    try {
      if (!vehicleId) {
        Alert.alert('Vehicle required', 'Add and get an approved hire vehicle first.');
        return;
      }
      const quoteAmount = Number(amount);
      if (!(quoteAmount > 0)) {
        Alert.alert('Amount required', 'Enter a valid quote amount.');
        return;
      }
      setSubmitting(true);
      const token = await getTokenRef.current({ skipCache: true });
      await createHireQuote(token, requestId, {
        hireVehicleId: vehicleId,
        amount: quoteAmount,
        currency: request?.fareCurrency || 'USD',
        message: message.trim() || undefined,
      });
      setMessage('');
      Alert.alert('Quote sent', 'Your hire quote was submitted.');
      navigation.goBack();
    } catch (err) {
      Alert.alert('Quote failed', err?.message || 'Could not submit quote');
    } finally {
      setSubmitting(false);
    }
  };

  const acceptPassengerOffer = async () => {
    try {
      if (!vehicleId) {
        Alert.alert('Vehicle required', 'Add and get an approved hire vehicle first.');
        return;
      }
      if (!hasPassengerOffer) {
        Alert.alert('No offer', 'Passenger has not set an offer yet.');
        return;
      }
      setSubmitting(true);
      const token = await getTokenRef.current({ skipCache: true });
      await acceptPassengerHireOffer(token, requestId, {
        hireVehicleId: vehicleId,
        message: message.trim() || undefined,
      });
      Alert.alert('Offer accepted', 'Job booked at the passenger offer. It is now closed.');
      navigation.goBack();
    } catch (err) {
      Alert.alert('Accept failed', err?.message || 'Could not accept passenger offer');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !hasLoadedRef.current) {
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
          {request?.title || request?.publicId || 'Hire job'}
        </Text>
        <View className="h-10 w-10" />
      </View>

      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 28 }}
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
          {hasPassengerOffer ? (
            <Text className="mt-2 text-base font-bold text-gray-900">
              Passenger offer: {request?.fareCurrency || 'USD'} {passengerOffer.toFixed(2)}
            </Text>
          ) : (
            <Text className="mt-2 text-sm text-gray-500">No passenger offer yet — send your own quote.</Text>
          )}
        </View>

        <View className="mt-3 rounded-[24px] bg-white px-4 py-4">
          <Text className="text-xs font-bold uppercase tracking-wide text-gray-400">Description</Text>
          <Text className="mt-2 text-sm leading-5 text-gray-800">
            {request?.notes?.trim() || 'No specs or notes added.'}
          </Text>
        </View>

        {!canRespond ? (
          <View className="mt-4 rounded-[24px] bg-white px-4 py-5">
            <Text className="text-base font-bold text-gray-900">Job closed</Text>
            <Text className="mt-1 text-sm text-gray-500">
              This hire request is no longer open for quotes.
            </Text>
          </View>
        ) : (
          <View className="mt-4 rounded-[24px] bg-white px-4 py-4">
            <Text className="text-base font-bold text-gray-900">Respond</Text>
            <Text className="mt-1 text-sm text-gray-500">
              Accept the passenger offer, or enter your own amount below.
            </Text>

            <Text className="mb-2 mt-4 text-xs font-semibold uppercase text-gray-500">Vehicle</Text>
            {vehicles.length === 0 ? (
              <Text className="text-sm text-rose-600">You need an approved hiring vehicle first.</Text>
            ) : (
              vehicles.map((vehicle) => {
                const displayPhoto = vehicle.photoUrls?.[0] ? resolveUploadedMediaUrl(vehicle.photoUrls[0]) : null;
                return (
                  <TouchableOpacity
                    key={vehicle.id}
                    onPress={() => setVehicleId(vehicle.id)}
                    className="mb-2 flex-row items-center rounded-2xl border px-3 py-3"
                    style={{ borderColor: vehicleId === vehicle.id ? PRIMARY_BLUE : '#e2e8f0' }}
                  >
                    {displayPhoto ? (
                      <Image source={{ uri: displayPhoto }} className="mr-3 h-14 w-14 rounded-xl" />
                    ) : (
                      <View className="mr-3 h-14 w-14 items-center justify-center rounded-xl bg-slate-100">
                        <Ionicons name="car-outline" size={22} color="#94a3b8" />
                      </View>
                    )}
                    <View className="flex-1">
                      <Text className="font-semibold text-gray-900">{vehicle.title}</Text>
                      <Text className="mt-1 text-xs text-gray-500">
                        {[vehicle.make, vehicle.model, vehicle.category].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {vehicleId === vehicle.id ? (
                      <Ionicons name="checkmark-circle" size={22} color={PRIMARY_BLUE} />
                    ) : null}
                  </TouchableOpacity>
                );
              })
            )}

            {hasPassengerOffer ? (
              <TouchableOpacity
                onPress={acceptPassengerOffer}
                disabled={submitting}
                className="mt-3 h-12 items-center justify-center rounded-2xl bg-emerald-600"
                style={{ opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : (
                  <Text className="font-semibold text-white">
                    Accept offer ({request?.fareCurrency || 'USD'} {passengerOffer.toFixed(2)})
                  </Text>
                )}
              </TouchableOpacity>
            ) : null}

            <Text className="mb-2 mt-4 text-xs font-semibold uppercase text-gray-500">
              Your quote amount (USD)
            </Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder={hasPassengerOffer ? String(passengerOffer) : '120'}
              className="h-12 rounded-2xl border border-gray-200 bg-slate-50 px-4 text-base"
            />
            <Text className="mb-2 mt-3 text-xs font-semibold uppercase text-gray-500">Message</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Optional note"
              className="h-12 rounded-2xl border border-gray-200 bg-slate-50 px-4 text-base"
            />

            <TouchableOpacity
              onPress={submitQuote}
              disabled={submitting}
              className="mt-4 h-12 items-center justify-center rounded-2xl"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : (
                <Text className="font-semibold text-white">
                  {hasPassengerOffer ? 'Send your own quote' : 'Submit quote'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}
