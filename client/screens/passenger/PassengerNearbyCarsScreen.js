import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, SafeAreaView, TouchableOpacity, ScrollView, ActivityIndicator, Image, Alert, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useAuth } from '@clerk/clerk-expo';
import Constants from 'expo-constants';
import { cancelRideRequest, getApiUrl, getPassengerRideRequestStatus, selectRideDriver } from '../../api';
import { PASSENGER_CANCELLATION_REASONS } from '../../constants/cancellationReasons';
import { PRIMARY_BLUE } from '../../constants/colors';
import { connectRealtime } from '../../realtime';

const REQUEST_EXPIRY_POLL_MS = 2000;

function decodePolyline(encoded) {
  if (!encoded) return [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const coordinates = [];

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = null;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    latitude += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = (result & 1) ? ~(result >> 1) : (result >> 1);
    longitude += deltaLng;

    coordinates.push({
      latitude: latitude / 1e5,
      longitude: longitude / 1e5,
    });
  }

  return coordinates;
}

function getDirectionsApiKey() {
  return (
    Constants.expoConfig?.extra?.googleMapsDirectionsApiKey ||
    Constants.expoConfig?.android?.config?.googleMaps?.apiKey ||
    Constants.expoConfig?.ios?.config?.googleMapsApiKey ||
    ''
  );
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

async function fetchGoogleRoute(origin, destination) {
  const apiKey = getDirectionsApiKey();
  if (!apiKey || !origin || !destination) return null;

  const params = new URLSearchParams({
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    mode: 'driving',
    departure_time: 'now',
    key: apiKey,
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.status !== 'OK' || !Array.isArray(payload?.routes) || !payload.routes[0]) {
    return null;
  }

  const coordinates = decodePolyline(payload.routes[0]?.overview_polyline?.points);
  return Array.isArray(coordinates) && coordinates.length > 1 ? coordinates : null;
}

function getRemainingSeconds(expiresAt) {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function formatCountdown(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function PassengerNearbyCarsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const navigatedToTrackingRef = useRef(false);
  const autoExpiryHandledRef = useRef(false);
  const expiryNavigationHandledRef = useRef(false);
  const [isSubmittingDriverId, setIsSubmittingDriverId] = useState('');
  const [isCancellingRequest, setIsCancellingRequest] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [rideStatus, setRideStatus] = useState(route.params?.rideRequest || null);
  const [acceptedDrivers, setAcceptedDrivers] = useState([]);
  const [assignedDriver, setAssignedDriver] = useState(null);
  const [showCancelReasonModal, setShowCancelReasonModal] = useState(false);
  const [selectedCancelReason, setSelectedCancelReason] = useState('');
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [nowTick, setNowTick] = useState(Date.now());
  const [realtimeSignal, setRealtimeSignal] = useState(0);
  const {
    pickupCoordinate,
    dropoffCoordinate,
    pickupLabel,
    dropoffLabel,
    distanceKm,
    estimatedMinutes,
    estimatedAmount,
    selectedTier,
    rideRequest,
  } = route.params || {};

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!pickupCoordinate || !dropoffCoordinate) {
      setRouteCoordinates([]);
      return undefined;
    }

    let cancelled = false;

    const loadRoute = async () => {
      try {
        const coordinates = await fetchGoogleRoute(pickupCoordinate, dropoffCoordinate);
        if (cancelled) return;
        setRouteCoordinates(coordinates || [pickupCoordinate, dropoffCoordinate]);
      } catch {
        if (cancelled) return;
        setRouteCoordinates([pickupCoordinate, dropoffCoordinate]);
      }
    };

    loadRoute();

    return () => {
      cancelled = true;
    };
  }, [dropoffCoordinate, pickupCoordinate]);

  useEffect(() => {
    if (!rideRequest?.id) return undefined;
    let active = true;

    const loadStatus = async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('Not signed in');
        const data = await getPassengerRideRequestStatus(token, rideRequest.id);
        if (!active) return;
        setRideStatus(data?.rideRequest || null);
        setAcceptedDrivers(Array.isArray(data?.acceptedDrivers) ? data.acceptedDrivers : []);
        setAssignedDriver(data?.assignedDriver || null);
      } catch (error) {
        if (!active) return;
      } finally {
        if (active) setLoadingStatus(false);
      }
    };

    loadStatus();
    const interval = setInterval(loadStatus, REQUEST_EXPIRY_POLL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [getToken, rideRequest?.id, realtimeSignal]);

  useEffect(() => {
    if (!rideRequest?.id) return undefined;
    let active = true;
    let localSocket = null;

    const initRealtime = async () => {
      try {
        const token = await getToken();
        if (!active || !token) return;
        localSocket = connectRealtime(token);
        if (!localSocket) return;

        const handleRideUpdate = (payload = {}) => {
          if (!active || Number(payload.rideRequestId) !== Number(rideRequest.id)) return;
          setRealtimeSignal((current) => current + 1);
        };

        localSocket.on('ride_status:updated', handleRideUpdate);

        localSocket.__passengerNearbyCleanup = () => {
          localSocket.off('ride_status:updated', handleRideUpdate);
        };
      } catch {
        // Polling remains as fallback.
      }
    };

    initRealtime();

    return () => {
      active = false;
      localSocket?.__passengerNearbyCleanup?.();
    };
  }, [getToken, rideRequest?.id]);

  useEffect(() => {
    if (!rideRequest?.id || !assignedDriver || navigatedToTrackingRef.current) return;
    navigatedToTrackingRef.current = true;
    navigation.replace('PassengerRideTracking', {
      pickupCoordinate,
      dropoffCoordinate,
      pickupLabel,
      dropoffLabel,
      estimatedAmount: Number(rideStatus?.estimatedAmount || estimatedAmount || 0),
      selectedTier: assignedDriver.tier || selectedTier,
      driver: assignedDriver,
      rideRequestId: rideRequest.id,
    });
  }, [
    assignedDriver,
    dropoffCoordinate,
    dropoffLabel,
    estimatedAmount,
    navigation,
    pickupCoordinate,
    pickupLabel,
    rideRequest?.id,
    rideStatus?.estimatedAmount,
    selectedTier,
  ]);

  const rideExpiresAt = rideStatus?.expiresAt || rideRequest?.expiresAt || null;
  const rideStatusValue = String(rideStatus?.status || rideRequest?.status || '').toLowerCase();
  const remainingSeconds = useMemo(() => getRemainingSeconds(rideExpiresAt), [rideExpiresAt, nowTick]);
  const isWaitingForDrivers = !assignedDriver && ['requested', 'driver_found', ''].includes(rideStatusValue);

  useEffect(() => {
    if (!rideRequest?.id || !isWaitingForDrivers || remainingSeconds > 0 || autoExpiryHandledRef.current) {
      return;
    }

    autoExpiryHandledRef.current = true;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        await cancelRideRequest(token, rideRequest.id, 'Request timed out');
      } catch {
        // The backend may already have expired the request.
      }
    })();
  }, [getToken, isWaitingForDrivers, remainingSeconds, rideRequest?.id]);

  useEffect(() => {
    if (assignedDriver || expiryNavigationHandledRef.current) return;
    if (!['cancelled', 'expired'].includes(rideStatusValue)) return;

    expiryNavigationHandledRef.current = true;
    Alert.alert(
      rideStatusValue === 'expired' ? 'Request expired' : 'Request cancelled',
      rideStatusValue === 'expired'
        ? 'No driver accepted your trip within 2 minutes.'
        : 'Your ride request has been cancelled.',
      [
        {
          text: 'OK',
          onPress: () => {
            navigation.reset({
              index: 0,
              routes: [
                {
                  name: 'PassengerBookingHome',
                  params: { resetRideDraftAt: Date.now() },
                },
              ],
            });
          },
        },
      ]
    );
  }, [assignedDriver, navigation, rideStatusValue]);

  const handleAccept = async (driver) => {
    try {
      setIsSubmittingDriverId(driver.id);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      if (rideRequest?.id) {
        await selectRideDriver(token, rideRequest.id, driver.id);
      }
    } catch (error) {
      Alert.alert('Driver selection failed', error?.message || 'Could not assign this driver.');
    } finally {
      setIsSubmittingDriverId('');
    }
  };

  const handleCancelRequest = () => {
    setSelectedCancelReason('');
    setShowCancelReasonModal(true);
  };

  const handleConfirmCancelWithReason = async () => {
    if (!selectedCancelReason || isCancellingRequest) return;
    setShowCancelReasonModal(false);
    setIsCancellingRequest(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      if (rideRequest?.id) {
        await cancelRideRequest(token, rideRequest.id, selectedCancelReason);
      }
      navigation.reset({
        index: 0,
        routes: [
          {
            name: 'PassengerBookingHome',
            params: { resetRideDraftAt: Date.now() },
          },
        ],
      });
    } catch (error) {
      Alert.alert('Cancel request failed', error?.message || 'Could not cancel this request.');
    } finally {
      setIsCancellingRequest(false);
    }
  };

  const driversViewingCount = rideStatus?.driversViewingCount ?? 0;
  const infoText = useMemo(() => {
    if (assignedDriver) return `${assignedDriver.driverName} has been assigned`;
    if (acceptedDrivers.length > 0) return `${acceptedDrivers.length} driver${acceptedDrivers.length === 1 ? '' : 's'} accepted your trip`;
    if (driversViewingCount > 0) return `${driversViewingCount} nearby driver${driversViewingCount === 1 ? '' : 's'} notified`;
    return 'Waiting for nearby drivers to accept your request';
  }, [acceptedDrivers.length, assignedDriver, driversViewingCount]);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1">
        <MapView
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          initialRegion={{
            latitude: pickupCoordinate.latitude,
            longitude: pickupCoordinate.longitude,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
          }}
          showsCompass={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          <Marker coordinate={pickupCoordinate} title="Pickup" pinColor={PRIMARY_BLUE} />
          <Marker coordinate={dropoffCoordinate} title="Drop-off" pinColor="#111827" />
          <Polyline coordinates={routeCoordinates.length > 1 ? routeCoordinates : [pickupCoordinate, dropoffCoordinate]} strokeColor={PRIMARY_BLUE} strokeWidth={5} />
          {acceptedDrivers.map((driver) => (
            <Marker key={driver.id} coordinate={driver.coordinate} title={driver.driverName}>
              <View className="h-7 w-7 rounded-full border-2 border-white" style={{ backgroundColor: PRIMARY_BLUE }} />
            </Marker>
          ))}
        </MapView>

        <View className="absolute top-0 left-0 right-0 px-5" style={{ paddingTop: insets.top + 8 }}>
          <View className="flex-row items-center rounded-[26px] bg-white/95 px-4 py-3">
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-[#f3f6fb]"
            >
              <Ionicons name="arrow-back" size={22} color="#111827" />
            </TouchableOpacity>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-gray-500">Your trip</Text>
              <Text className="mt-0.5 text-base font-semibold text-gray-900" numberOfLines={1}>
                {pickupLabel}
              </Text>
              <Text className="mt-0.5 text-sm text-gray-700" numberOfLines={1}>
                {dropoffLabel}
              </Text>
              <Text className="mt-0.5 text-xs text-gray-500">
                {distanceKm.toFixed(1)} km · {estimatedMinutes} min · ${Number(estimatedAmount || 0).toFixed(2)}
              </Text>
            </View>
            {isWaitingForDrivers ? (
              <View className="ml-3 rounded-full bg-[#dbeafe] px-3 py-2">
                <Text className="text-[11px] font-bold uppercase tracking-[1px] text-[#1d4ed8]">Time left</Text>
                <Text className="mt-0.5 text-sm font-extrabold text-[#111827]">{formatCountdown(remainingSeconds)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View
          className="mt-auto rounded-t-[32px] bg-white px-5 pt-4"
          style={{ marginTop: 'auto', minHeight: acceptedDrivers.length ? '52%' : '42%', paddingBottom: Math.max(insets.bottom + 16, 28) }}
        >
          <View className="items-center mb-3">
            <View className="h-1.5 w-14 rounded-full bg-gray-300" />
          </View>

          <View className="rounded-[22px] bg-[#eff5ff] px-4 py-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1 pr-3">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-[#dbeafe]">
                  {loadingStatus ? (
                    <ActivityIndicator size="small" color={PRIMARY_BLUE} />
                  ) : (
                    <Ionicons name="flash-outline" size={20} color={PRIMARY_BLUE} />
                  )}
                </View>
                <Text className="ml-3 flex-1 text-base font-semibold text-gray-900" numberOfLines={2}>
                  {infoText}
                </Text>
              </View>
              {isWaitingForDrivers ? (
                <View className="items-end">
                  <Text className="text-[11px] font-bold uppercase tracking-[1px] text-[#1d4ed8]">Auto-cancel</Text>
                  <Text className="text-lg font-extrabold text-gray-900">{formatCountdown(remainingSeconds)}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <ScrollView
            className="mt-4"
            contentContainerStyle={{ paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {!acceptedDrivers.length ? (
              <View className="mb-4 items-center rounded-[26px] bg-[#f8fafc] px-5 py-8">
                <Ionicons name="car-outline" size={32} color={PRIMARY_BLUE} />
                <Text className="mt-3 text-lg font-bold text-gray-900">Waiting for drivers</Text>
                <Text className="mt-2 text-center text-sm text-gray-500">
                  Nearby drivers have been notified. Accepted offers will appear here.
                </Text>
                <View className="mt-4 rounded-full bg-[#111827] px-4 py-2">
                  <Text className="text-sm font-bold text-white">Auto-cancels in {formatCountdown(remainingSeconds)}</Text>
                </View>
                <TouchableOpacity
                  onPress={handleCancelRequest}
                  className="mt-4 rounded-[18px] border border-red-200 bg-white px-5 py-3"
                  activeOpacity={0.85}
                >
                  <Text className="text-sm font-bold text-red-500">Cancel request</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {acceptedDrivers.map((driver) => (
              <View
                key={driver.id}
                className="mb-4 rounded-[28px] bg-white px-4 py-4"
                style={{ borderWidth: 1, borderColor: '#e5e7eb' }}
              >
                <View className="mb-4 flex-row items-center justify-between">
                  <View className="rounded-full bg-[#dbeafe] px-3 py-1.5">
                    <Text className="text-xs font-bold uppercase tracking-[1px] text-[#1d4ed8]">Driver found</Text>
                  </View>
                  <View className="rounded-full bg-[#f8fafc] px-3 py-1.5">
                    <Text className="text-xs font-semibold text-gray-700">Auto-cancel {formatCountdown(remainingSeconds)}</Text>
                  </View>
                </View>
                <View className="flex-row items-start justify-between">
                  <View className="flex-row flex-1 pr-3">
                    <Image
                      source={{
                        uri:
                          normalizeVehicleImageUrl(driver.carImage) ||
                          'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80',
                      }}
                      style={{ width: 72, height: 72, borderRadius: 22 }}
                    />
                    <View className="ml-3 flex-1">
                      <View className="self-start rounded-full bg-[#d1fae5] px-2.5 py-1">
                        <Text className="text-xs font-semibold text-[#047857]">Your fare</Text>
                      </View>
                      <Text className="mt-2 text-lg font-bold text-gray-900" numberOfLines={1}>
                        {driver.driverName}
                      </Text>
                      <Text className="mt-1 text-sm text-gray-700" numberOfLines={1}>
                        {driver.carName} · {driver.plate}
                      </Text>
                      <View className="mt-2 flex-row items-center">
                        <Ionicons name="star" size={15} color="#f59e0b" />
                        <Text className="ml-1.5 text-xs font-medium text-gray-500">
                          {driver.rating.toFixed(2)} ({driver.trips} rides)
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View className="items-end">
                    <Text className="text-[30px] font-extrabold text-gray-900">
                      ${Number(driver.amount || estimatedAmount || 0).toFixed(2)}
                    </Text>
                    <Text className="mt-1 text-sm font-semibold text-gray-900">
                      {driver.etaMinutes} min
                    </Text>
                    <Text className="mt-0.5 text-xs text-gray-500">
                      {driver.driverDistanceKm.toFixed(1)} km away
                    </Text>
                  </View>
                </View>

                <View className="mt-4 rounded-[22px] bg-[#f8fafc] px-4 py-4">
                  <Text className="text-sm font-medium text-gray-500">Trip summary</Text>
                  <View className="mt-3 flex-row items-start">
                    <View className="mr-3 items-center pt-1">
                      <View className="h-3.5 w-3.5 rounded-full border-[3px] border-green-600" />
                      <View className="my-1 h-8 w-0.5 bg-gray-300" />
                      <View className="h-3.5 w-3.5 rounded-full border-[3px]" style={{ borderColor: PRIMARY_BLUE }} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>{pickupLabel}</Text>
                      <Text className="mt-3 text-sm font-semibold text-gray-900" numberOfLines={1}>{dropoffLabel}</Text>
                    </View>
                  </View>
                </View>

                <View className="mt-4 flex-row gap-3">
                  <TouchableOpacity
                    onPress={handleCancelRequest}
                    className="h-12 flex-1 items-center justify-center rounded-[18px] border border-red-200 bg-white"
                  >
                    <Text className="text-sm font-semibold text-red-500">Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleAccept(driver)}
                    disabled={isSubmittingDriverId === driver.id}
                    className="h-12 flex-[1.4] items-center justify-center rounded-[18px]"
                    style={{ backgroundColor: PRIMARY_BLUE }}
                  >
                    {isSubmittingDriverId === driver.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text className="text-sm font-semibold text-white">Accept driver</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))}

          </ScrollView>
        </View>
      </View>

      <Modal visible={showCancelReasonModal} transparent animationType="fade">
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowCancelReasonModal(false)}
          className="flex-1 justify-end bg-black/50"
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
                  onPress={() => setSelectedCancelReason(r.label)}
                  className="border-b border-gray-100 py-4"
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="pr-4 text-base font-medium text-gray-900">{r.label}</Text>
                    <View
                      className="h-5 w-5 items-center justify-center rounded-full border"
                      style={{
                        borderColor: selectedCancelReason === r.label ? PRIMARY_BLUE : '#d1d5db',
                        backgroundColor: selectedCancelReason === r.label ? PRIMARY_BLUE : '#ffffff',
                      }}
                    >
                      {selectedCancelReason === r.label ? (
                        <Ionicons name="checkmark" size={12} color="#ffffff" />
                      ) : null}
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              onPress={handleConfirmCancelWithReason}
              disabled={!selectedCancelReason || isCancellingRequest}
              className="mt-5 items-center justify-center rounded-[16px] py-3.5"
              style={{ backgroundColor: !selectedCancelReason || isCancellingRequest ? '#93c5fd' : PRIMARY_BLUE }}
            >
              {isCancellingRequest ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-base font-bold text-white">Confirm</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCancelReasonModal(false)} className="mt-3 py-3 items-center">
              <Text className="text-base text-gray-500">Keep request</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
