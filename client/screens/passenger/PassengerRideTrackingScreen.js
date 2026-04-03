import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, SafeAreaView, TouchableOpacity, Image, Alert, ScrollView, ActivityIndicator, TextInput, Platform, Modal, Vibration, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Speech from 'expo-speech';
import { cancelRideRequest, completeRideRequest, getApiUrl, getPassengerRideRequestStatus, submitPassengerDriverRating } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { PASSENGER_CANCELLATION_REASONS } from '../../constants/cancellationReasons';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { connectRealtime } from '../../realtime';

const TRACKING_STATUS_REFRESH_MS = 5000;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(start, end) {
  if (!start || !end) return 0;
  const earthRadiusKm = 6371;
  const dLat = toRadians(end.latitude - start.latitude);
  const dLng = toRadians(end.longitude - start.longitude);
  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);
  const a = (
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
  );
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function buildTrackingRegion(driverCoordinate, pickupCoordinate, dropoffCoordinate, stage) {
  const focusCoordinates = stage === 'on_trip'
    ? [driverCoordinate, dropoffCoordinate]
    : [driverCoordinate, pickupCoordinate];
  const coordinates = focusCoordinates.filter(Boolean);
  const latitudes = coordinates.map((item) => item.latitude);
  const longitudes = coordinates.map((item) => item.longitude);

  return {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    latitudeDelta: Math.max((Math.max(...latitudes) - Math.min(...latitudes)) * 1.6, 0.03),
    longitudeDelta: Math.max((Math.max(...longitudes) - Math.min(...longitudes)) * 1.6, 0.03),
  };
}

function normalizeVehicleImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (raw.startsWith('./') || raw.startsWith('../')) return null;
  if (raw.startsWith('/')) return getApiUrl(raw);
  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith('/uploads/')) return getApiUrl(parsed.pathname);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return raw;
    return null;
  } catch {
    if (raw.startsWith('uploads/')) return getApiUrl(`/${raw}`);
    return null;
  }
}

export default function PassengerRideTrackingScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const mapRef = useRef(null);
  const lastArrivalAnnouncementRef = useRef('');
  const {
    pickupCoordinate: initialPickupCoordinate,
    dropoffCoordinate: initialDropoffCoordinate,
    pickupLabel: initialPickupLabel,
    dropoffLabel: initialDropoffLabel,
    estimatedAmount: initialEstimatedAmount,
    selectedTier,
    driver: initialDriver,
    rideRequestId,
  } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [rideStatus, setRideStatus] = useState(null);
  const [driver, setDriver] = useState(initialDriver || null);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [showCancelReasonModal, setShowCancelReasonModal] = useState(false);
  const [realtimeSignal, setRealtimeSignal] = useState(0);
  const [showDriverRatingModal, setShowDriverRatingModal] = useState(false);
  const ratingDraftTouchedRef = useRef(false);
  const lastRatingModalStateRef = useRef(false);

  useEffect(() => {
    if (!rideRequestId) return undefined;
    let active = true;

    const loadStatus = async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('Not signed in');
        const data = await getPassengerRideRequestStatus(token, rideRequestId);
        if (!active) return;
        setRideStatus(data?.rideRequest || null);
        setDriver(data?.assignedDriver || initialDriver || null);
        const savedRating = Number(data?.rideRequest?.passengerDriverRating || 0);
        const savedReview = String(data?.rideRequest?.passengerDriverReview || '');
        if (!ratingDraftTouchedRef.current || savedRating > 0) {
          setRating(savedRating);
          setReview(savedReview);
          if (savedRating > 0) {
            ratingDraftTouchedRef.current = false;
          }
        }
      } catch (error) {
        if (!active) return;
      } finally {
        if (active) setLoading(false);
      }
    };

    loadStatus();
    const interval = setInterval(loadStatus, TRACKING_STATUS_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [getToken, initialDriver, rideRequestId, realtimeSignal]);

  useEffect(() => {
    if (!rideRequestId) return undefined;
    let active = true;
    let localSocket = null;

    const initRealtime = async () => {
      try {
        const token = await getToken();
        if (!active || !token) return;
        localSocket = connectRealtime(token);
        if (!localSocket) return;

        const handleRideUpdate = (payload = {}) => {
          if (!active || Number(payload.rideRequestId) !== Number(rideRequestId)) return;
          setRealtimeSignal((current) => current + 1);
        };

        localSocket.on('ride_status:updated', handleRideUpdate);

        localSocket.__passengerTrackingCleanup = () => {
          localSocket.off('ride_status:updated', handleRideUpdate);
        };
      } catch {
        // Polling remains as fallback.
      }
    };

    initRealtime();

    return () => {
      active = false;
      localSocket?.__passengerTrackingCleanup?.();
    };
  }, [getToken, rideRequestId]);

  useEffect(() => {
    if (rideStatus?.status === 'cancelled') {
      navigation.popToTop?.();
    }
  }, [rideStatus?.status, navigation]);

  const pickupCoordinate = rideStatus?.pickupCoordinate || initialPickupCoordinate;
  const dropoffCoordinate = rideStatus?.dropoffCoordinate || initialDropoffCoordinate;
  const pickupLabel = rideStatus?.pickupLabel || initialPickupLabel;
  const dropoffLabel = rideStatus?.dropoffLabel || initialDropoffLabel;
  const estimatedAmount = Number(rideStatus?.estimatedAmount || initialEstimatedAmount || 0);
  const stage = rideStatus?.stage || 'driver_on_the_way';
  const isCompleted = stage === 'completed';
  const driverCoordinate = rideStatus?.driverCoordinate || driver?.coordinate || pickupCoordinate;
  const activeTarget = stage === 'on_trip' ? dropoffCoordinate : pickupCoordinate;

  useEffect(() => {
    const shouldOpen = stage === 'completed' && !rideStatus?.passengerDriverRating;
    if (lastRatingModalStateRef.current !== shouldOpen) {
      lastRatingModalStateRef.current = shouldOpen;
      setShowDriverRatingModal(shouldOpen);
    }
    if (!shouldOpen) {
      ratingDraftTouchedRef.current = false;
    }
  }, [rideStatus?.passengerDriverRating, stage]);

  useEffect(() => {
    if (stage !== 'waiting_at_pickup') return undefined;
    if (lastArrivalAnnouncementRef.current === String(rideRequestId || '')) return undefined;

    lastArrivalAnnouncementRef.current = String(rideRequestId || '');
    try {
      Vibration.vibrate([250, 120, 250]);
    } catch {
      // Ignore vibration support issues.
    }
    Speech.stop();
    Speech.speak('Your driver has arrived at the pickup point.', {
      rate: 0.95,
      pitch: 1.0,
      language: 'en',
    });

    return undefined;
  }, [rideRequestId, stage]);

  useEffect(() => {
    if (!driverCoordinate || !activeTarget || !mapRef.current) return;
    mapRef.current.animateToRegion(
      buildTrackingRegion(driverCoordinate, pickupCoordinate, dropoffCoordinate, stage),
      700
    );
  }, [activeTarget, driverCoordinate, dropoffCoordinate, pickupCoordinate, stage]);

  const liveDriverDistanceKm = useMemo(
    () => calculateDistanceKm(driverCoordinate, activeTarget),
    [activeTarget, driverCoordinate]
  );

  const liveEtaMinutes = useMemo(
    () => Math.max(1, Math.round(liveDriverDistanceKm * 4)),
    [liveDriverDistanceKm]
  );

  const handleCancelRide = () => {
    setShowCancelReasonModal(true);
  };

  const handleConfirmCancelWithReason = async (reasonLabel) => {
    setShowCancelReasonModal(false);
    try {
      const token = await getToken();
      if (token && rideRequestId) {
        await cancelRideRequest(token, rideRequestId, reasonLabel);
      }
    } catch (error) {
      // allow UI to exit even if cancel sync fails
    }
    Alert.alert('Ride cancelled', 'Your ride request has been cancelled.');
    navigation.popToTop?.();
  };

  const handleDone = async () => {
    try {
      const token = await getToken();
      if (token && rideRequestId) {
        await completeRideRequest(token, rideRequestId);
      }
    } catch (error) {
      // local UI still closes
    }
    navigation.popToTop();
  };

  const handleSubmitRating = async () => {
    try {
      if (rating < 1) {
        Alert.alert('Choose a rating', 'Select between 1 and 5 stars.');
        return;
      }
      setSubmittingRating(true);
      const token = await getToken();
      if (!token || !rideRequestId) throw new Error('Not signed in');
      await submitPassengerDriverRating(token, rideRequestId, { rating, review });
      ratingDraftTouchedRef.current = false;
      setRideStatus((current) => current ? {
        ...current,
        passengerDriverRating: rating,
        passengerDriverReview: review,
      } : current);
      setShowDriverRatingModal(false);
      Alert.alert('Thanks', 'Your driver rating was saved.', [{ text: 'OK', onPress: () => navigation.popToTop?.() }]);
    } catch (error) {
      Alert.alert('Rating failed', error?.message || 'Could not save your rating.');
    } finally {
      setSubmittingRating(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-5">
        <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        <Text className="mt-4 text-base text-gray-500">Loading ride status...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1">
        <MapView
          ref={mapRef}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          initialRegion={buildTrackingRegion(driverCoordinate, pickupCoordinate, dropoffCoordinate, stage)}
          showsCompass={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          {driverCoordinate ? (
            <Marker coordinate={driverCoordinate} title="Driver">
              <View className="items-center">
                <View
                  className="h-12 w-12 items-center justify-center rounded-full border-4 border-white"
                  style={{ backgroundColor: PRIMARY_BLUE }}
                >
                  <Ionicons name="car-sport" size={22} color="#fff" />
                </View>
                <View className="mt-1 rounded-full bg-white px-2 py-1">
                  <Text className="text-xs font-bold text-gray-900">{liveEtaMinutes} min</Text>
                </View>
              </View>
            </Marker>
          ) : null}
          <Marker coordinate={pickupCoordinate} title="Pickup" pinColor="#1d4ed8" />
          <Marker coordinate={dropoffCoordinate} title="Drop-off" pinColor="#111827" />
          <Polyline
            coordinates={stage === 'on_trip' ? [driverCoordinate, dropoffCoordinate] : [driverCoordinate, pickupCoordinate]}
            strokeColor={PRIMARY_BLUE}
            strokeWidth={5}
          />
        </MapView>

        <View className="absolute inset-0 bg-white/10" />

        <View className="px-5" style={{ paddingTop: insets.top + 10 }}>
          <View className="flex-row items-center justify-between rounded-[28px] bg-white/95 px-4 py-4">
            <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3 h-12 w-12 items-center justify-center rounded-full bg-[#f3f6fb]">
              <Ionicons name="arrow-back" size={24} color="#111827" />
            </TouchableOpacity>
            <View className="flex-1">
              <Text className="text-lg font-bold text-gray-900">
                {isCompleted
                  ? 'Trip completed'
                  : stage === 'waiting_at_pickup'
                    ? 'Your driver has arrived'
                    : stage === 'on_trip'
                      ? 'You are on the trip'
                      : 'Driver is on the way'}
              </Text>
              <Text className="mt-1 text-sm text-gray-500">
                {isCompleted
                  ? 'Please rate your driver for this trip.'
                  : stage === 'waiting_at_pickup'
                    ? 'Meet your driver at the pickup point.'
                    : `${liveEtaMinutes} min away - ${liveDriverDistanceKm.toFixed(1)} km`}
              </Text>
            </View>
          </View>
        </View>

        {!isCompleted && (
          <View className="absolute left-5 right-5" style={{ bottom: 360 }}>
            <View className="self-start rounded-[22px] bg-white/95 px-4 py-3">
              <Text className="text-sm font-medium text-gray-500">
                {stage === 'on_trip' ? 'Trip progress' : 'Driver location'}
              </Text>
              <Text className="mt-1 text-base font-bold text-gray-900">
                {stage === 'waiting_at_pickup'
                  ? 'Driver is waiting at pickup.'
                  : `${liveEtaMinutes} min away - ${liveDriverDistanceKm.toFixed(1)} km`}
              </Text>
            </View>
          </View>
        )}

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={insets.top + 80}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View className="mt-auto rounded-t-[30px] bg-[#f8fafc] px-5 pt-4" style={{ height: '78%' }}>
            <View className="items-center">
              <View className="h-2 w-16 rounded-full bg-gray-300" />
            </View>

            {stage === 'on_trip' ? (
              <View className="mt-4 rounded-[22px] border border-blue-100 bg-[#eff5ff] px-4 py-3">
                <Text className="text-xs font-semibold uppercase tracking-[2px]" style={{ color: PRIMARY_BLUE }}>
                  You are on a ride
                </Text>
                <Text className="mt-1 text-sm text-gray-600">
                  Stay connected with your driver while you are on the way to your drop-off.
                </Text>
              </View>
            ) : null}

            <ScrollView
              className="flex-1"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <View className="mt-5 rounded-[28px] border border-gray-100 bg-white p-5">
              <View className="flex-row items-center">
                <Image
                  source={{ uri: normalizeVehicleImageUrl(driver?.carImage) || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80' }}
                  style={{ width: 96, height: 72, borderRadius: 18 }}
                />
                <View className="ml-4 flex-1">
                  <Text className="text-xl font-bold text-gray-900">{driver?.driverName || 'Driver'}</Text>
                  <View className="mt-1 flex-row items-center">
                    <Ionicons name="star" size={16} color="#f59e0b" />
                    <Text className="ml-2 text-sm text-gray-500">{driver?.rating?.toFixed?.(2) || '4.90'} rating</Text>
                  </View>
                  <Text className="mt-2 text-sm text-gray-500">{driver?.carName} - {driver?.plate}</Text>
                  <Text className="mt-1 text-sm font-medium" style={{ color: PRIMARY_BLUE }}>
                    {driver?.phoneNumber || 'Phone not shared'}
                  </Text>
                </View>
              </View>

              <View className="mt-5 flex-row items-center justify-between rounded-[22px] bg-[#eff5ff] px-4 py-4">
                <View>
                  <Text className="text-sm font-medium text-gray-500">{stage === 'on_trip' ? 'Trip status' : 'Live arrival'}</Text>
                  <Text className="mt-1 text-2xl font-bold text-gray-900">
                    {stage === 'waiting_at_pickup' ? 'Arrived' : stage === 'on_trip' ? 'On trip' : `${liveEtaMinutes} min`}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-sm font-medium text-gray-500">Driver distance</Text>
                  <Text className="mt-1 text-2xl font-bold text-gray-900">{liveDriverDistanceKm.toFixed(1)} km</Text>
                </View>
              </View>

              <View className="mt-5 border-t border-gray-100 pt-4">
                <Text className="text-sm font-medium text-gray-500">Fare</Text>
                <Text className="mt-1 text-3xl font-bold text-gray-900">${estimatedAmount.toFixed(2)}</Text>
                <Text className="mt-1 text-sm text-gray-500">{selectedTier?.tierName || driver?.tier?.tierName || 'Ride'}</Text>
              </View>

              <View className="mt-5 rounded-[22px] bg-[#f8fafc] p-4">
                <Text className="text-sm font-medium text-gray-500">Trip</Text>
                <Text className="mt-2 text-base font-bold text-gray-900">{pickupLabel}</Text>
                <Text className="mt-1 text-sm text-gray-500">to</Text>
                <Text className="mt-1 text-base font-bold text-gray-900">{dropoffLabel}</Text>
              </View>
              </View>

              {stage === 'completed' ? (
                <>
                  <TouchableOpacity
                    onPress={handleDone}
                    className="mt-4 h-14 rounded-[22px] items-center justify-center"
                    style={{ backgroundColor: PRIMARY_BLUE }}
                  >
                    <Text className="text-lg font-bold text-white">Done</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </ScrollView>

            {!isCompleted ? (
              <View
                className="border-t border-gray-200 bg-[#f8fafc] pt-4"
                style={{ paddingBottom: Math.max(insets.bottom + 6, 14) }}
              >
                {stage === 'on_trip' ? (
                  <View className="flex-row items-center gap-3">
                    <TouchableOpacity
                      onPress={() => navigation.navigate('RideChat', {
                        rideRequestId,
                        role: 'passenger',
                        chatTitle: driver?.driverName || 'Driver chat',
                      })}
                      className="flex-1 h-14 rounded-[22px] items-center justify-center"
                      style={{ backgroundColor: PRIMARY_BLUE }}
                    >
                      <Text className="text-lg font-bold text-white">Message driver</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => Alert.alert('Call driver', driver?.phoneNumber || 'Phone not shared')}
                      className="h-14 w-14 rounded-[22px] items-center justify-center bg-white border border-blue-200"
                    >
                      <Ionicons name="call" size={22} color={PRIMARY_BLUE} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View className="flex-row items-center gap-3">
                    <TouchableOpacity
                      onPress={handleCancelRide}
                      className="flex-1 h-14 rounded-[22px] border border-red-200 items-center justify-center bg-white"
                    >
                      <Text className="text-lg font-bold text-red-500">Cancel ride</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => navigation.navigate('RideChat', {
                        rideRequestId,
                        role: 'passenger',
                        chatTitle: driver?.driverName || 'Driver chat',
                      })}
                      className="h-14 w-14 rounded-[22px] items-center justify-center bg-white border border-blue-200"
                    >
                      <Ionicons name="chatbubble-ellipses" size={22} color={PRIMARY_BLUE} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => Alert.alert('Call driver', driver?.phoneNumber || 'Phone not shared')}
                      className="h-14 w-14 rounded-[22px] items-center justify-center"
                      style={{ backgroundColor: PRIMARY_BLUE }}
                    >
                      <Ionicons name="call" size={22} color="#fff" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>

      <Modal visible={showCancelReasonModal} transparent animationType="fade">
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowCancelReasonModal(false)}
          className="flex-1 justify-end"
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-2xl bg-white px-5 pt-4"
            style={{ paddingBottom: Math.max(insets.bottom + 12, 24) }}
          >
            <Text className="text-lg font-bold text-gray-900">Why are you cancelling?</Text>
            <ScrollView className="mt-4 max-h-64" showsVerticalScrollIndicator={false}>
              {PASSENGER_CANCELLATION_REASONS.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  onPress={() => handleConfirmCancelWithReason(r.label)}
                  className="border-b border-gray-100 py-4"
                >
                  <Text className="text-base font-medium text-gray-900">{r.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setShowCancelReasonModal(false)} className="mt-4 py-3 items-center">
              <Text className="text-base text-gray-500">Keep ride</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showDriverRatingModal} transparent animationType="fade">
        <View className="flex-1 items-center justify-center bg-black/20 px-5">
          <View className="w-full max-w-[380px] rounded-[28px] bg-white px-5 pt-5 pb-5">
            <Text className="text-2xl font-bold text-gray-900">Rate Driver</Text>
            <Text className="mt-2 text-sm text-gray-500">
              Tell us how this trip went before you finish.
            </Text>
            <View className="mt-5 flex-row items-center justify-between">
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  onPress={() => {
                    ratingDraftTouchedRef.current = true;
                    setRating(value);
                  }}
                  hitSlop={8}
                  className="h-14 w-14 items-center justify-center rounded-full bg-[#f8fafc]"
                  style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
                >
                  <Ionicons name={value <= rating ? 'star' : 'star-outline'} size={28} color={value <= rating ? '#f59e0b' : '#9ca3af'} />
                </Pressable>
              ))}
            </View>
            <TextInput
              value={review}
              onChangeText={(value) => {
                ratingDraftTouchedRef.current = true;
                setReview(value);
              }}
              placeholder="Write optional feedback"
              multiline
              textAlignVertical="top"
              className="mt-4 min-h-[110px] rounded-[22px] bg-[#f8fafc] px-4 py-4 text-base text-gray-900"
            />
            <TouchableOpacity
              onPress={handleSubmitRating}
              disabled={submittingRating}
              className="mt-4 h-14 rounded-[22px] items-center justify-center"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: submittingRating ? 0.7 : 1 }}
            >
              {submittingRating ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-lg font-bold text-white">Done</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
