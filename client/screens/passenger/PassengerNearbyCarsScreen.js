import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline } from '../../components/maps/MapViewCompat';
import { useAuth } from '@clerk/clerk-expo';
import {
  cancelRideRequest,
  declineRideDriver,
  getApiUrl,
  getDirectionsRoute,
  getPassengerRideRequestStatus,
  selectRideDriver,
} from '../../api';
import { PASSENGER_CANCELLATION_REASONS } from '../../constants/cancellationReasons';
import { PRIMARY_BLUE } from '../../constants/colors';
import { BULAWAYO_GEO_LOCK_ENABLED, BULAWAYO_SERVICE_BOUNDS_ARRAY } from '../../constants/serviceArea';
import { connectRealtime } from '../../realtime';

const REQUEST_EXPIRY_POLL_MS = 1000;
const EMPTY_ROUTE_COORDINATES = [];

function normalizeRouteCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function normalizeRouteCoordinates(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeRouteCoordinate).filter(Boolean);
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

function normalizeDriverProfileImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (raw.startsWith('/')) return getApiUrl(raw);
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return raw;
    return null;
  } catch {
    return null;
  }
}

function DriverFacePreview({ driver, size = 34 }) {
  const imageUri = normalizeDriverProfileImageUrl(driver?.profileImageUrl);
  const initials = String(driver?.driverName || 'D')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'D';

  if (imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={{ width: size, height: size, borderRadius: size / 2, marginRight: 8, borderWidth: 2, borderColor: '#fff' }}
      />
    );
  }

  return (
    <View
      className="items-center justify-center rounded-full bg-blue-100"
      style={{ width: size, height: size, marginRight: 8, borderWidth: 2, borderColor: '#fff' }}
    >
      <Text className="text-[11px] font-bold text-blue-700">{initials}</Text>
    </View>
  );
}

async function fetchRouteCoordinates(token, origin, destination) {
  if (!token || !origin || !destination) return null;
  const data = await getDirectionsRoute(token, { origin, destination, cacheTtlSeconds: 1800 });
  const coordinates = data?.route?.coordinates;
  return Array.isArray(coordinates) && coordinates.length > 1 ? coordinates : null;
}

function getRemainingSeconds(expiresAt) {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function getEffectiveRemainingSeconds(expiresAt, serverRemainingSeconds = null, capturedAtMs = null) {
  if (Number.isFinite(Number(serverRemainingSeconds)) && Number(serverRemainingSeconds) >= 0) {
    const base = Number(serverRemainingSeconds);
    if (!Number.isFinite(Number(capturedAtMs))) return Math.max(0, Math.floor(base));
    const elapsed = Math.max(0, Math.floor((Date.now() - Number(capturedAtMs)) / 1000));
    return Math.max(0, Math.floor(base) - elapsed);
  }
  return getRemainingSeconds(expiresAt);
}

function formatCountdown(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds || 0));
  const m = Math.floor(safeSeconds / 60);
  const s = safeSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

// ── Driver card ──────────────────────────────────────────────────────────────
function DriverCard({ driver, estimatedAmount, remainingSeconds, onAccept, onDecline, isSubmitting }) {
  const faceUri = normalizeDriverProfileImageUrl(driver.profileImageUrl);
  const carUri =
    normalizeVehicleImageUrl(driver.carImage) ||
    'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80';

  return (
    <View className="mb-3 overflow-hidden rounded-2xl border border-gray-100 bg-white">
      {/* Status strip */}
      <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <View className="flex-row items-center gap-1.5">
          <View className="h-2 w-2 rounded-full bg-green-500" />
          <Text className="text-[11px] font-bold uppercase tracking-widest text-green-600">Driver accepted</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Ionicons name="time-outline" size={12} color="#6b7280" />
          <Text className="text-[11px] font-semibold text-gray-500">
            {formatCountdown(remainingSeconds)}
          </Text>
        </View>
      </View>

      {/* Body */}
      <View className="px-4 py-3">
        <View className="flex-row items-center">
          {/* Car image */}
          {faceUri ? (
            <Image
              source={{ uri: faceUri }}
              resizeMode="cover"
              className="h-16 w-16 rounded-xl bg-gray-100"
            />
          ) : (
            <Image
              source={{ uri: carUri }}
              resizeMode="cover"
              className="h-16 w-16 rounded-xl bg-gray-100"
            />
          )}

          {/* Driver info */}
          <View className="ml-3 flex-1">
            <Text className="text-base font-bold text-gray-900" numberOfLines={1}>
              {driver.driverName}
            </Text>
            <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
              {driver.carName} · {driver.plate}
            </Text>
            <View className="mt-1.5 flex-row items-center gap-1">
              <Ionicons name="star" size={12} color="#f59e0b" />
              <Text className="text-[11px] font-semibold text-gray-600">
                {driver.rating?.toFixed(2)} · {driver.trips} rides
              </Text>
            </View>
          </View>

          {/* Price + ETA */}
          <View className="items-end">
            <Text className="text-[22px] font-extrabold tracking-tight text-gray-900">
              ${Number(driver.amount || estimatedAmount || 0).toFixed(2)}
            </Text>
            <Text className="mt-0.5 text-xs font-semibold text-gray-700">
              {driver.etaMinutes ? `${driver.etaMinutes} min away` : 'Locating…'}
            </Text>
            <Text className="mt-0.5 text-[11px] text-gray-400">
              {Number.isFinite(Number(driver.driverDistanceKm))
                ? `${Number(driver.driverDistanceKm).toFixed(1)} km`
                : '—'}
            </Text>
          </View>
        </View>

        {/* Actions */}
        <View className="mt-3 flex-row gap-2">
          <TouchableOpacity
            onPress={onDecline}
            className="h-11 flex-1 items-center justify-center rounded-xl border border-gray-200 bg-gray-50"
            activeOpacity={0.75}
          >
            <Text className="text-sm font-semibold text-gray-600">Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onAccept(driver)}
            disabled={isSubmitting}
            className="h-11 flex-[1.6] items-center justify-center rounded-xl"
            style={{ backgroundColor: PRIMARY_BLUE }}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-sm font-bold text-white">Choose driver</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function PassengerNearbyCarsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const navigatedToTrackingRef = useRef(false);
  const expiryNavigationHandledRef = useRef(false);
  const lastStatusRefreshAtRef = useRef(0);

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
    intermediateStops = [],
    pickupLabel,
    dropoffLabel,
    routeCoordinates: initialRouteCoordinates = EMPTY_ROUTE_COORDINATES,
    distanceKm,
    estimatedMinutes,
    estimatedAmount,
    selectedTier,
    rideRequest,
  } = route.params || {};

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const refreshRideStatus = useCallback(async ({ silent = false } = {}) => {
    if (!rideRequest?.id) return null;
    const now = Date.now();
    if (silent && now - lastStatusRefreshAtRef.current < 900) return null;
    lastStatusRefreshAtRef.current = now;
    try {
      if (!silent) setLoadingStatus(true);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const data = await getPassengerRideRequestStatus(token, rideRequest.id);
      setRideStatus(data?.rideRequest ? { ...data.rideRequest, remainingSecondsCapturedAt: Date.now() } : null);
      setAcceptedDrivers(Array.isArray(data?.acceptedDrivers) ? data.acceptedDrivers : []);
      setAssignedDriver(data?.assignedDriver || null);
      return data || null;
    } catch {
      return null;
    } finally {
      setLoadingStatus(false);
    }
  }, [rideRequest?.id]);

  // ── Tick every second ──
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Load route polyline ──
  useEffect(() => {
    if (!pickupCoordinate || !dropoffCoordinate) { setRouteCoordinates([]); return; }
    const normalizedInitialCoordinates = normalizeRouteCoordinates(initialRouteCoordinates);
    if (normalizedInitialCoordinates.length > 1) {
      setRouteCoordinates(normalizedInitialCoordinates); return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getTokenRef.current();
        const coords = await fetchRouteCoordinates(token, pickupCoordinate, dropoffCoordinate);
        if (!cancelled) setRouteCoordinates(normalizeRouteCoordinates(coords));
      } catch {
        if (!cancelled) setRouteCoordinates([]);
      }
    })();
    return () => { cancelled = true; };
  }, [dropoffCoordinate, initialRouteCoordinates, pickupCoordinate]);

  // ── Poll ride status ──
  useEffect(() => {
    if (!rideRequest?.id) return;
    let active = true;
    const loadStatus = async () => {
      if (!active) return;
      await refreshRideStatus({ silent: true });
    };
    refreshRideStatus();
    const interval = setInterval(loadStatus, REQUEST_EXPIRY_POLL_MS);
    return () => { active = false; clearInterval(interval); };
  }, [refreshRideStatus, realtimeSignal, rideRequest?.id]);

  // ── Realtime socket ──
  useEffect(() => {
    if (!rideRequest?.id) return;
    let active = true;
    let localSocket = null;
    (async () => {
      try {
        const token = await getTokenRef.current();
        if (!active || !token) return;
        localSocket = connectRealtime(token);
        if (!localSocket) return;
        const handleRideUpdate = (payload = {}) => {
          if (!active || Number(payload.rideRequestId) !== Number(rideRequest.id)) return;
          if (payload?.status === 'driver_found' && payload?.acceptedDriver) {
            const incoming = payload.acceptedDriver;
            setAcceptedDrivers((cur) => {
              const list = Array.isArray(cur) ? cur : [];
              if (list.some((d) => String(d?.id) === String(incoming?.id))) return list;
              return [incoming, ...list];
            });
            setRideStatus((cur) => ({ ...(cur || {}), status: 'driver_found' }));
          }
          refreshRideStatus({ silent: true });
        };
        localSocket.on('ride_status:updated', handleRideUpdate);
        localSocket.__cleanup = () => localSocket.off('ride_status:updated', handleRideUpdate);
      } catch { /* polling fallback */ }
    })();
    return () => { active = false; localSocket?.__cleanup?.(); };
  }, [refreshRideStatus, rideRequest?.id]);

  // ── Navigate to tracking when driver assigned ──
  useEffect(() => {
    if (!rideRequest?.id || !assignedDriver || navigatedToTrackingRef.current) return;
    navigatedToTrackingRef.current = true;
    navigation.replace('PassengerRideTracking', {
      pickupCoordinate, dropoffCoordinate, pickupLabel, dropoffLabel,
      intermediateStops,
      estimatedAmount: Number(
        rideStatus?.finalEstimatedAmount ??
        rideStatus?.estimatedAmount ??
        rideRequest?.finalEstimatedAmount ??
        rideRequest?.estimatedAmount ??
        estimatedAmount ??
        0
      ),
      selectedTier: assignedDriver.tier || selectedTier,
      driver: assignedDriver,
      rideRequestId: rideRequest.id,
    });
  }, [assignedDriver, dropoffCoordinate, dropoffLabel, estimatedAmount, navigation, pickupCoordinate, pickupLabel, rideRequest?.finalEstimatedAmount, rideRequest?.estimatedAmount, rideRequest?.id, rideStatus?.finalEstimatedAmount, rideStatus?.estimatedAmount, selectedTier]);

  // ── Handle expiry / cancellation ──
  const rideExpiresAt = rideStatus?.expiresAt || rideRequest?.expiresAt || null;
  const rideStatusValue = String(rideStatus?.status || rideRequest?.status || '').toLowerCase();
  const driversViewingCount = Math.max(
    0,
    Number(rideStatus?.driversViewingCount ?? rideRequest?.driversViewingCount ?? 0)
  );
  const visibleDriversPreview = Array.isArray(rideStatus?.visibleDriversPreview)
    ? rideStatus.visibleDriversPreview
    : Array.isArray(rideRequest?.visibleDriversPreview)
      ? rideRequest.visibleDriversPreview
      : [];
  const finalEstimatedAmount = Number(
    rideStatus?.finalEstimatedAmount ??
    rideStatus?.estimatedAmount ??
    rideRequest?.finalEstimatedAmount ??
    rideRequest?.estimatedAmount ??
    estimatedAmount ??
    0
  );
  const remainingSeconds = useMemo(
    () => getEffectiveRemainingSeconds(
      rideExpiresAt,
      rideStatus?.remainingSeconds ?? rideRequest?.remainingSeconds,
      rideStatus?.remainingSecondsCapturedAt ?? rideRequest?.remainingSecondsCapturedAt,
    ),
    [nowTick, rideExpiresAt, rideRequest?.remainingSeconds, rideRequest?.remainingSecondsCapturedAt, rideStatus?.remainingSeconds, rideStatus?.remainingSecondsCapturedAt],
  );

  const isWaitingForDrivers = !assignedDriver && ['requested', 'driver_found', ''].includes(rideStatusValue);
  const shouldForceAcceptedRefresh = !assignedDriver && rideStatusValue === 'driver_found' && acceptedDrivers.length === 0;

  useEffect(() => {
    if (!shouldForceAcceptedRefresh) return;
    const interval = setInterval(() => {
      refreshRideStatus({ silent: true });
    }, 750);
    return () => clearInterval(interval);
  }, [refreshRideStatus, shouldForceAcceptedRefresh]);

  useEffect(() => {
    if (assignedDriver || expiryNavigationHandledRef.current) return;
    if (!['cancelled', 'expired'].includes(rideStatusValue)) return;
    expiryNavigationHandledRef.current = true;
    Alert.alert(
      rideStatusValue === 'expired' ? 'Request expired' : 'Request cancelled',
      rideStatusValue === 'expired' ? 'No driver accepted your trip in time.' : 'Your ride request has been cancelled.',
      [{ text: 'OK', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'PassengerBookingHome', params: { resetRideDraftAt: Date.now() } }] }) }],
    );
  }, [assignedDriver, navigation, rideStatusValue]);

  // ── Actions ──
  const handleAccept = async (driver) => {
    try {
      setIsSubmittingDriverId(driver.id);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      if (!rideRequest?.id) return;
      const data = await selectRideDriver(token, rideRequest.id, driver.id);
      const assigned = data?.assignedDriver || driver || null;
      const nextStatus = String(data?.rideRequest?.status || 'driver_assigned').toLowerCase();
      setAssignedDriver(assigned);
      setRideStatus((current) => current ? {
        ...current,
        status: nextStatus,
        ...(data?.rideRequest?.driverDistanceKm !== undefined ? { driverDistanceKm: Number(data.rideRequest.driverDistanceKm || 0) } : null),
        ...(data?.rideRequest?.driverEtaMinutes !== undefined ? { driverEtaMinutes: Number(data.rideRequest.driverEtaMinutes || 0) } : null),
      } : current);
      navigatedToTrackingRef.current = true;
      navigation.replace('PassengerRideTracking', {
        pickupCoordinate,
        dropoffCoordinate,
        intermediateStops,
        pickupLabel,
        dropoffLabel,
        estimatedAmount: finalEstimatedAmount,
        selectedTier: assigned?.tier || selectedTier,
        driver: assigned,
        rideRequestId: rideRequest.id,
      });
    } catch (error) {
      Alert.alert('Driver selection failed', error?.message || 'Could not assign this driver.');
    } finally {
      setIsSubmittingDriverId('');
    }
  };

  const handleDeclineDriver = async (driver) => {
    try {
      const driverUserId = String(driver?.id || '').trim();
      if (!driverUserId || !rideRequest?.id) return;
      setIsSubmittingDriverId(driverUserId);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await declineRideDriver(token, rideRequest.id, driverUserId);
      let nextAcceptedCount = 0;
      setAcceptedDrivers((current) => {
        const next = current.filter((item) => String(item?.id) !== driverUserId);
        nextAcceptedCount = next.length;
        return next;
      });
      setAssignedDriver((current) => (String(current?.id || '') === driverUserId ? null : current));
      setRideStatus((current) => current ? {
        ...current,
        status: nextAcceptedCount > 0 ? 'driver_found' : 'requested',
      } : current);
      setRealtimeSignal((c) => c + 1);
    } catch (error) {
      Alert.alert('Decline failed', error?.message || 'Could not decline this driver.');
    } finally {
      setIsSubmittingDriverId('');
    }
  };

  const handleCancelRequest = () => { setSelectedCancelReason(''); setShowCancelReasonModal(true); };

  const handleConfirmCancelWithReason = async () => {
    if (!selectedCancelReason || isCancellingRequest) return;
    setShowCancelReasonModal(false);
    setIsCancellingRequest(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      if (rideRequest?.id) await cancelRideRequest(token, rideRequest.id, selectedCancelReason);
      navigation.reset({ index: 0, routes: [{ name: 'PassengerBookingHome', params: { resetRideDraftAt: Date.now() } }] });
    } catch (error) {
      Alert.alert('Cancel request failed', error?.message || 'Could not cancel this request.');
    } finally {
      setIsCancellingRequest(false);
    }
  };

  const hasDrivers = acceptedDrivers.length > 0 && !assignedDriver;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1">
        {/* ── Map ── */}
        <MapView
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          initialRegion={{
            latitude: pickupCoordinate.latitude,
            longitude: pickupCoordinate.longitude,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
          }}
          maxBounds={BULAWAYO_GEO_LOCK_ENABLED ? BULAWAYO_SERVICE_BOUNDS_ARRAY : undefined}
          showsCompass={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          <Marker coordinate={pickupCoordinate} title="Pickup" pinColor={PRIMARY_BLUE} />
          <Marker coordinate={dropoffCoordinate} title="Drop-off" pinColor="#111827" />
          <Polyline
            coordinates={routeCoordinates}
            strokeColor={PRIMARY_BLUE}
            strokeWidth={5}
          />
          {acceptedDrivers.filter((d) => !!d.coordinate).map((driver) => (
            <Marker key={driver.id} coordinate={driver.coordinate} title={driver.driverName}>
              <View className="h-7 w-7 rounded-full border-2 border-white" style={{ backgroundColor: PRIMARY_BLUE }} />
            </Marker>
          ))}
        </MapView>

        {/* dim overlay when drivers appear */}
        {hasDrivers && (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}
          />
        )}

        {/* ── Top header pill ── */}
        <View className="absolute left-0 right-0 px-4" style={{ top: insets.top + 8 }}>
          <View className="flex-row items-center rounded-2xl border border-gray-100 bg-white px-3 py-3">
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-gray-100"
            >
              <Ionicons name="chevron-back" size={22} color="#111827" />
            </TouchableOpacity>

            <View className="flex-1">
              <Text className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Your trip</Text>
              <Text className="mt-0.5 text-sm font-bold text-gray-900" numberOfLines={1}>{pickupLabel}</Text>
              <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>{dropoffLabel}</Text>
            </View>

            {/* Trip meta */}
            <View className="ml-3 items-end gap-0.5">
              <Text className="text-[13px] font-extrabold tracking-tight text-gray-900">
                {formatCurrency(finalEstimatedAmount)}
              </Text>
              <Text className="text-[11px] text-gray-400">
                {distanceKm?.toFixed(1)} km · {estimatedMinutes} min
              </Text>
            </View>

            {/* Countdown badge */}
            {isWaitingForDrivers && (
              <View className="ml-3 items-center rounded-xl bg-blue-50 px-3 py-2">
                <Text className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Left</Text>
                <Text className="text-sm font-extrabold text-gray-900">{formatCountdown(remainingSeconds)}</Text>
              </View>
            )}
          </View>

          {isWaitingForDrivers ? (
            <>
              <View className="mt-3 flex-row items-center justify-between rounded-2xl border border-blue-100 bg-white/95 px-4 py-3">
                <View className="flex-1 flex-row items-center">
                  <View className="h-9 w-9 items-center justify-center rounded-full bg-blue-50">
                    <Ionicons name="people-outline" size={18} color={PRIMARY_BLUE} />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-[11px] font-bold uppercase tracking-[1.2px] text-blue-600">
                      Request visibility
                    </Text>
                    <Text className="mt-0.5 text-sm font-semibold text-gray-900">
                      {driversViewingCount > 0
                        ? `${driversViewingCount} driver${driversViewingCount === 1 ? '' : 's'} viewed your request`
                        : 'Waiting for nearby drivers to view your request'}
                    </Text>
                    {visibleDriversPreview.length ? (
                      <View className="mt-2 flex-row items-center">
                        {visibleDriversPreview.slice(0, 4).map((driver) => (
                          <DriverFacePreview key={driver.id} driver={driver} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
                <View className="rounded-full bg-blue-50 px-3 py-2">
                  <Text className="text-base font-extrabold text-blue-700">{driversViewingCount}</Text>
                </View>
              </View>
            </>
          ) : null}
        </View>

        {/* ── Accepted drivers overlay list ── */}
        {hasDrivers && (
          <View
            className="absolute left-0 right-0 px-4"
            style={{ top: insets.top + 96, maxHeight: '70%', zIndex: 50 }}
            pointerEvents="box-none"
          >
            <View className="rounded-2xl border border-gray-100 bg-white px-3 pt-3 pb-1">
              {/* Section header */}
              <View className="mb-2.5 flex-row items-center justify-between px-1">
                <Text className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
                  {acceptedDrivers.length} driver{acceptedDrivers.length !== 1 ? 's' : ''} accepted
                </Text>
                <Text className="text-[11px] text-gray-400">Scroll to see more</Text>
              </View>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 6 }}
                keyboardShouldPersistTaps="handled"
              >
                {acceptedDrivers.map((driver) => (
                  <DriverCard
                    key={driver.id}
                    driver={driver}
                    estimatedAmount={finalEstimatedAmount}
                    remainingSeconds={remainingSeconds}
                    onAccept={handleAccept}
                    onDecline={() => handleDeclineDriver(driver)}
                    isSubmitting={isSubmittingDriverId === driver.id}
                  />
                ))}
              </ScrollView>
            </View>
          </View>
        )}

        {/* ── Bottom sheet ── */}
        <View
          className="absolute left-0 right-0 rounded-t-3xl border-t border-gray-100 bg-white px-5 pt-3"
          style={{ bottom: tabBarHeight, paddingBottom: Math.max(insets.bottom + 16, 28) }}
        >
          {/* Handle */}
          <View className="mb-4 items-center">
            <View className="h-1 w-12 rounded-full bg-gray-200" />
          </View>

          {!hasDrivers && (
            <View className="items-center">
              {/* Animated waiting state */}
              <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-blue-50">
                <Ionicons name="car-sport-outline" size={30} color={PRIMARY_BLUE} />
              </View>

              <Text className="text-xl font-bold text-gray-900">Finding your driver</Text>
              <Text className="mt-1.5 text-center text-sm text-gray-400">
                Nearby drivers have been notified.{'\n'}Accepted offers will appear here.
              </Text>

              {/* Countdown pill */}
              <View className="mt-5 flex-row items-center gap-2 rounded-xl bg-gray-900 px-5 py-3">
                <Ionicons name="time-outline" size={15} color="#fff" />
                <Text className="text-sm font-bold text-white">
                  Auto-cancels in {formatCountdown(remainingSeconds)}
                </Text>
              </View>

              {/* Cancel */}
              <TouchableOpacity
                onPress={handleCancelRequest}
                className="mt-3 rounded-xl border border-gray-200 px-6 py-3"
                activeOpacity={0.75}
              >
                <Text className="text-sm font-semibold text-red-500">Cancel request</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Collapsed status when drivers shown */}
          {hasDrivers && (
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <View className="h-2 w-2 rounded-full bg-green-500" />
                <Text className="text-sm font-semibold text-gray-700">Review driver offers above</Text>
              </View>
              <TouchableOpacity onPress={handleCancelRequest}>
                <Text className="text-sm font-semibold text-red-500">Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* ── Cancel reason modal ── */}
      <Modal visible={showCancelReasonModal} transparent animationType="slide">
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowCancelReasonModal(false)}
          className="flex-1 justify-end bg-black/50"
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-3xl bg-white px-5 pt-5"
            style={{ paddingBottom: Math.max(insets.bottom + 12, 24) }}
          >
            {/* Handle */}
            <View className="mb-5 items-center">
              <View className="h-1 w-12 rounded-full bg-gray-200" />
            </View>

            <Text className="text-xl font-bold text-gray-900">Why are you cancelling?</Text>
            <Text className="mt-1 text-sm text-gray-400">Select a reason to continue</Text>

            <ScrollView className="mt-4 max-h-64" showsVerticalScrollIndicator={false}>
              {PASSENGER_CANCELLATION_REASONS.map((r) => {
                const selected = selectedCancelReason === r.label;
                return (
                  <TouchableOpacity
                    key={r.id}
                    onPress={() => setSelectedCancelReason(r.label)}
                    className={`mb-2 flex-row items-center justify-between rounded-xl px-4 py-3.5 ${selected ? 'bg-blue-50' : 'bg-gray-50'}`}
                  >
                    <Text className={`flex-1 pr-3 text-sm font-medium ${selected ? 'text-blue-700' : 'text-gray-800'}`}>
                      {r.label}
                    </Text>
                    <View
                      className="h-5 w-5 items-center justify-center rounded-full border-2"
                      style={{ borderColor: selected ? PRIMARY_BLUE : '#d1d5db', backgroundColor: selected ? PRIMARY_BLUE : '#fff' }}
                    >
                      {selected && <Ionicons name="checkmark" size={11} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              onPress={handleConfirmCancelWithReason}
              disabled={!selectedCancelReason || isCancellingRequest}
              className="mt-5 h-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: !selectedCancelReason || isCancellingRequest ? '#bfdbfe' : PRIMARY_BLUE }}
            >
              {isCancellingRequest ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-base font-bold text-white">Confirm cancellation</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowCancelReasonModal(false)}
              className="mt-3 items-center py-3"
            >
              <Text className="text-sm font-semibold text-gray-500">Keep my request</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
