import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, Alert, ScrollView, ActivityIndicator, TextInput, Platform, Modal, Vibration, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline } from '../../components/maps/MapViewCompat';
import * as Speech from 'expo-speech';
import { cancelRideRequest, getApiUrl, getDirectionsRoute, getPassengerRideRequestStatus, reportLostItem, resolveUploadedMediaUrl, submitPassengerDriverRating, tipDriver, confirmPassengerPickup } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { PASSENGER_CANCELLATION_REASONS } from '../../constants/cancellationReasons';
import { BULAWAYO_GEO_LOCK_ENABLED, BULAWAYO_SERVICE_BOUNDS_ARRAY } from '../../constants/serviceArea';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { connectRealtime } from '../../realtime';

const TRACKING_STATUS_REFRESH_MS = 5000;
const PICKUP_WAIT_SECONDS = 5 * 60;
const ROUTE_REFRESH_DISTANCE_METERS = 250;
const ROUTE_REFRESH_MIN_INTERVAL_MS = 8000;
const LIVE_DIRECTIONS_CACHE_TTL_SECONDS = 0;

function mapRideStatusToStage(status) {
  switch (String(status || '').toLowerCase()) {
    case 'driver_arrived':
      return 'waiting_at_pickup';
    case 'in_progress':
      return 'on_trip';
    case 'completed':
      return 'completed';
    default:
      return '';
  }
}

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

function formatCountdown(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function parseTimestampMs(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
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

async function fetchTrackingDirections(token, origin, destination) {
  if (!token || !origin || !destination) return null;

  const data = await getDirectionsRoute(token, {
    origin,
    destination,
    cacheTtlSeconds: LIVE_DIRECTIONS_CACHE_TTL_SECONDS,
  });
  const route = data?.route || {};

  return {
    coordinates: Array.isArray(route.coordinates) ? route.coordinates : [],
    distanceMeters: Number(route.distanceMeters || 0),
    durationSeconds: Number(route.durationSeconds || 0),
    nextInstruction: route.nextInstruction || '',
  };
}

export default function PassengerRideTrackingScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { getToken } = useAuth();
  const mapRef = useRef(null);
  const lastArrivalAnnouncementRef = useRef('');
  const lastRouteOriginRef = useRef(null);
  const lastRouteTargetRef = useRef(null);
  const lastRouteFetchedAtRef = useRef(0);
  const routeRequestIdRef = useRef(0);
  const hasAutoFitMapRef = useRef(false);
  const lastAutoFitStageRef = useRef('');
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
  const [submittingTip, setSubmittingTip] = useState(false);
  const [showCancelReasonModal, setShowCancelReasonModal] = useState(false);
  const [realtimeSignal, setRealtimeSignal] = useState(0);
  const [nowTick, setNowTick] = useState(Date.now());
  const [showDriverRatingModal, setShowDriverRatingModal] = useState(false);
  const [rideSheetCollapsed, setRideSheetCollapsed] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [tripRouteCoordinates, setTripRouteCoordinates] = useState([]);
  const [routeDistanceMeters, setRouteDistanceMeters] = useState(0);
  const [routeDurationSeconds, setRouteDurationSeconds] = useState(0);
  const [tripDistanceMeters, setTripDistanceMeters] = useState(0);
  const [tripDurationSeconds, setTripDurationSeconds] = useState(0);
  const [nextInstruction, setNextInstruction] = useState('');
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [lostItemDescription, setLostItemDescription] = useState('');
  const [lostItemContactPhone, setLostItemContactPhone] = useState('');
  const [submittingLostItem, setSubmittingLostItem] = useState(false);
  const ratingDraftTouchedRef = useRef(false);
  const lastRatingModalStateRef = useRef(false);
  const bottomActionInset = Math.max(insets.bottom + tabBarHeight - 8, 20);
  const collapsedSheetHeight = Math.max(300, bottomActionInset + 220);

  const exitToPassengerHome = () => {
    if (navigation?.canGoBack?.()) {
      try {
        navigation.popToTop();
        return;
      } catch {
        // Fall through to a direct route replace when popToTop is unavailable.
      }
    }

    try {
      navigation.replace('PassengerBookingHome');
    } catch {
      try {
        navigation.navigate('PassengerBookingHome');
      } catch {
        // noop
      }
    }
  };

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
          const nextStatus = String(payload.status || '').toLowerCase();
          const nextStage = mapRideStatusToStage(nextStatus);
          const nextDriverCoordinate = payload?.driverCoordinate &&
            Number.isFinite(Number(payload.driverCoordinate.latitude)) &&
            Number.isFinite(Number(payload.driverCoordinate.longitude))
            ? {
                latitude: Number(payload.driverCoordinate.latitude),
                longitude: Number(payload.driverCoordinate.longitude),
              }
            : null;
          if (nextStatus || nextDriverCoordinate) {
            setRideStatus((current) => (current ? {
              ...current,
              ...(nextStatus ? { status: nextStatus } : null),
              stage: nextStage || current.stage,
              ...(nextDriverCoordinate ? { driverCoordinate: nextDriverCoordinate } : {}),
              ...(payload?.arrivedAt ? { arrivedAt: payload.arrivedAt } : {}),
              ...(payload?.confirmedAt ? { passengerConfirmedAt: payload.confirmedAt } : {}),
            } : current));
          }
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
      exitToPassengerHome();
    }
  }, [rideStatus?.status]);

  const pickupCoordinate = rideStatus?.pickupCoordinate || initialPickupCoordinate;
  const dropoffCoordinate = rideStatus?.dropoffCoordinate || initialDropoffCoordinate;
  const pickupLabel = rideStatus?.pickupLabel || initialPickupLabel;
  const dropoffLabel = rideStatus?.dropoffLabel || initialDropoffLabel;
  const estimatedAmount = Number(rideStatus?.estimatedAmount || initialEstimatedAmount || 0);
  const tipAmount = Number(rideStatus?.tipAmount || 0);
  const totalAmount = Number(rideStatus?.totalAmount || (estimatedAmount + tipAmount) || 0);
  const stage = rideStatus?.stage || 'driver_on_the_way';
  const isCompleted = stage === 'completed';
  const driverCoordinate = rideStatus?.driverCoordinate || driver?.coordinate || null;
  const hasDriverCoordinate = !!driverCoordinate;
  const activeTarget = stage === 'on_trip' ? dropoffCoordinate : pickupCoordinate;
  const driverProfileImageUrl = resolveUploadedMediaUrl(driver?.profileImageUrl);
  const tipOptions = [1, 2, 5, 10];

  useEffect(() => {
    if (stage !== 'waiting_at_pickup') return undefined;
    setNowTick(Date.now());
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [stage]);

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
    if (!driverCoordinate || !activeTarget || isCompleted) {
      setRouteCoordinates([]);
      setRouteDistanceMeters(0);
      setRouteDurationSeconds(0);
      setNextInstruction('');
      setRouteError('');
      return undefined;
    }

    const previousOrigin = lastRouteOriginRef.current;
    const previousTarget = lastRouteTargetRef.current;
    const movedDistanceMeters = previousOrigin
      ? calculateDistanceKm(previousOrigin, driverCoordinate) * 1000
      : Infinity;
    const targetChanged = previousTarget
      ? calculateDistanceKm(previousTarget, activeTarget) * 1000 >= 30
      : true;
    const routeAgeMs = Date.now() - lastRouteFetchedAtRef.current;
    if (
      !targetChanged &&
      routeCoordinates.length > 0 &&
      movedDistanceMeters < ROUTE_REFRESH_DISTANCE_METERS &&
      routeAgeMs < ROUTE_REFRESH_MIN_INTERVAL_MS
    ) {
      return undefined;
    }

    let cancelled = false;
    const currentRequestId = routeRequestIdRef.current + 1;
    routeRequestIdRef.current = currentRequestId;
    lastRouteOriginRef.current = driverCoordinate;
    lastRouteTargetRef.current = activeTarget;
    lastRouteFetchedAtRef.current = Date.now();

    const loadDirections = async () => {
      try {
        setRouteLoading(true);
        setRouteError('');
        const token = await getToken();
        const route = await fetchTrackingDirections(token, driverCoordinate, activeTarget);
        if (cancelled || routeRequestIdRef.current !== currentRequestId) return;

        setRouteCoordinates(Array.isArray(route?.coordinates) && route.coordinates.length > 1
          ? route.coordinates
          : [driverCoordinate, activeTarget].filter(Boolean));
        setRouteDistanceMeters(route?.distanceMeters || 0);
        setRouteDurationSeconds(route?.durationSeconds || 0);
        setNextInstruction(route?.nextInstruction || '');
      } catch (error) {
        if (cancelled || routeRequestIdRef.current !== currentRequestId) return;
        setRouteCoordinates([driverCoordinate, activeTarget].filter(Boolean));
        setRouteDistanceMeters(0);
        setRouteDurationSeconds(0);
        setNextInstruction('');
        setRouteError(error?.message || 'Could not load road directions.');
      } finally {
        if (!cancelled && routeRequestIdRef.current === currentRequestId) {
          setRouteLoading(false);
        }
      }
    };

    loadDirections();

    return () => {
      cancelled = true;
    };
  }, [activeTarget, driverCoordinate, getToken, isCompleted, routeCoordinates.length]);

  useEffect(() => {
    if (!pickupCoordinate || !dropoffCoordinate || isCompleted) {
      setTripRouteCoordinates([]);
      setTripDistanceMeters(0);
      setTripDurationSeconds(0);
      return undefined;
    }

    let cancelled = false;

    const loadTripRoute = async () => {
      try {
        const token = await getToken();
        const route = await fetchTrackingDirections(token, pickupCoordinate, dropoffCoordinate);
        if (cancelled) return;
        setTripRouteCoordinates(
          Array.isArray(route?.coordinates) && route.coordinates.length > 1
            ? route.coordinates
            : [pickupCoordinate, dropoffCoordinate].filter(Boolean)
        );
        setTripDistanceMeters(Number(route?.distanceMeters || 0));
        setTripDurationSeconds(Number(route?.durationSeconds || 0));
      } catch {
        if (cancelled) return;
        setTripRouteCoordinates([pickupCoordinate, dropoffCoordinate].filter(Boolean));
        setTripDistanceMeters(0);
        setTripDurationSeconds(0);
      }
    };

    loadTripRoute();

    return () => {
      cancelled = true;
    };
  }, [dropoffCoordinate, getToken, isCompleted, pickupCoordinate]);

  const liveDriverDistanceKm = useMemo(
    () => {
      if (routeDistanceMeters > 0) return routeDistanceMeters / 1000;
      if (Number(rideStatus?.driverDistanceKm || 0) > 0 && stage !== 'on_trip') {
        return Number(rideStatus.driverDistanceKm);
      }
      return calculateDistanceKm(driverCoordinate, activeTarget);
    },
    [activeTarget, driverCoordinate, rideStatus?.driverDistanceKm, routeDistanceMeters, stage]
  );

  const liveEtaMinutes = useMemo(
    () => {
      if (routeDurationSeconds > 0) return Math.max(1, Math.round(routeDurationSeconds / 60));
      if (Number(rideStatus?.driverEtaMinutes || 0) > 0 && stage !== 'on_trip') {
        return Number(rideStatus.driverEtaMinutes);
      }
      return Math.max(1, Math.round(liveDriverDistanceKm * 4));
    },
    [liveDriverDistanceKm, rideStatus?.driverEtaMinutes, routeDurationSeconds, stage]
  );
  const tripDistanceKm = useMemo(() => {
    if (tripDistanceMeters > 0) return tripDistanceMeters / 1000;
    const estimated = Number(rideStatus?.estimatedDistanceKm || 0);
    return estimated > 0 ? estimated : 0;
  }, [rideStatus?.estimatedDistanceKm, tripDistanceMeters]);
  const tripEtaMinutes = useMemo(() => {
    if (tripDurationSeconds > 0) return Math.max(1, Math.round(tripDurationSeconds / 60));
    const estimated = Number(rideStatus?.estimatedMinutes || 0);
    return estimated > 0 ? estimated : 0;
  }, [rideStatus?.estimatedMinutes, tripDurationSeconds]);
  const hasRoadDistance = routeDistanceMeters > 0;
  const liveEtaText = hasDriverCoordinate ? `${liveEtaMinutes} min` : 'Locating';
  const liveDistanceText = hasDriverCoordinate ? `${liveDriverDistanceKm.toFixed(1)} km` : 'Waiting for driver location';
  const activeRouteCoordinates = useMemo(() => {
    if (stage === 'on_trip') {
      if (routeCoordinates.length > 1) return routeCoordinates;
      if (tripRouteCoordinates.length > 1) return tripRouteCoordinates;
      return [pickupCoordinate, dropoffCoordinate].filter(Boolean);
    }
    if (routeCoordinates.length > 1) return routeCoordinates;
    return [driverCoordinate, pickupCoordinate].filter(Boolean);
  }, [driverCoordinate, dropoffCoordinate, pickupCoordinate, routeCoordinates, stage, tripRouteCoordinates]);

  const pickupWaitRemainingSeconds = useMemo(() => {
    if (stage !== 'waiting_at_pickup') return null;
    const arrivedAtMs = parseTimestampMs(rideStatus?.arrivedAt);
    if (!arrivedAtMs) return PICKUP_WAIT_SECONDS;
    const elapsedSeconds = Math.floor((nowTick - arrivedAtMs) / 1000);
    return Math.max(0, PICKUP_WAIT_SECONDS - elapsedSeconds);
  }, [nowTick, rideStatus?.arrivedAt, stage]);
  const pickupWaitCountdownText = pickupWaitRemainingSeconds === null ? '' : formatCountdown(pickupWaitRemainingSeconds);
  const pickupWaitExpired = pickupWaitRemainingSeconds === 0;
  const trackingRegion = useMemo(
    () => buildTrackingRegion(driverCoordinate, pickupCoordinate, dropoffCoordinate, stage),
    [driverCoordinate, dropoffCoordinate, pickupCoordinate, stage]
  );
  const currentMapRegionRef = useRef(trackingRegion);

  const handleMapRegionChangeComplete = (nextRegion) => {
    currentMapRegionRef.current = nextRegion;
  };

  const handleAdjustMapZoom = (deltaMultiplier) => {
    const sourceRegion = currentMapRegionRef.current || trackingRegion;
    if (!sourceRegion || !mapRef.current?.animateToRegion) return;

    const nextRegion = {
      ...sourceRegion,
      latitudeDelta: Math.min(Math.max(sourceRegion.latitudeDelta * deltaMultiplier, 0.0025), 2.5),
      longitudeDelta: Math.min(Math.max(sourceRegion.longitudeDelta * deltaMultiplier, 0.0025), 2.5),
    };

    currentMapRegionRef.current = nextRegion;
    mapRef.current.animateToRegion(nextRegion, 250);
  };

  useEffect(() => {
    if (!mapRef.current || activeRouteCoordinates.length < 2) return undefined;
    const stageChanged = lastAutoFitStageRef.current !== String(stage || '');
    if (hasAutoFitMapRef.current && !stageChanged) return undefined;
    hasAutoFitMapRef.current = true;
    lastAutoFitStageRef.current = String(stage || '');

    const timeout = setTimeout(() => {
      try {
        mapRef.current?.fitToCoordinates(activeRouteCoordinates, {
          edgePadding: { top: 90, right: 28, bottom: 220, left: 28 },
          animated: true,
        });
      } catch {
        // Keep tracking UI resilient if the map rejects a fit request.
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [activeRouteCoordinates, stage]);

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
    exitToPassengerHome();
  };

  const handleDone = async () => {
    exitToPassengerHome();
  };

  const handleSkipRating = () => {
    ratingDraftTouchedRef.current = false;
    setShowDriverRatingModal(false);
    exitToPassengerHome();
  };

  const handleConfirmPickup = async () => {
    try {
      const token = await getToken();
      if (token && rideRequestId) {
        await confirmPassengerPickup(token, rideRequestId);
        // Update local state
        setRideStatus((current) => current ? {
          ...current,
          passengerConfirmedAt: new Date().toISOString(),
        } : current);
      }
    } catch (error) {
      Alert.alert('Confirmation failed', error?.message || 'Could not confirm pickup.');
    }
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
      Alert.alert('Thanks', 'Your driver rating was saved.', [{ text: 'OK', onPress: exitToPassengerHome }]);
    } catch (error) {
      Alert.alert('Rating failed', error?.message || 'Could not save your rating.');
    } finally {
      setSubmittingRating(false);
    }
  };

  const handleSendTip = async (amount) => {
    try {
      setSubmittingTip(true);
      const token = await getToken();
      if (!token || !rideRequestId) throw new Error('Not signed in');
      await tipDriver(token, rideRequestId, amount);
      setRideStatus((current) => current ? {
        ...current,
        tipAmount: Number(amount),
        totalAmount: Number(current.estimatedAmount || 0) + Number(amount),
        canTipDriver: false,
      } : current);
      Alert.alert('Tip sent', `Your $${Number(amount).toFixed(2)} tip was added.`);
    } catch (error) {
      Alert.alert('Tip failed', error?.message || 'Could not send your tip.');
    } finally {
      setSubmittingTip(false);
    }
  };

  const handleReportLostItem = async () => {
    const itemDescription = String(lostItemDescription || '').trim();
    const contactPhone = String(lostItemContactPhone || '').trim();
    if (!itemDescription) {
      Alert.alert('Missing details', 'Please describe the lost item.');
      return;
    }

    try {
      setSubmittingLostItem(true);
      const token = await getToken();
      if (!token || !rideRequestId) throw new Error('Not signed in');
      await reportLostItem(token, rideRequestId, {
        itemDescription,
        contactPhone: contactPhone || undefined,
      });
      setLostItemDescription('');
      setLostItemContactPhone('');
      Alert.alert('Reported', 'Your lost item report has been sent to support.');
    } catch (error) {
      Alert.alert('Report failed', error?.message || 'Could not submit your lost item report.');
    } finally {
      setSubmittingLostItem(false);
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
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'left', 'right']}>
      <View className="flex-1">
        <MapView
          ref={mapRef}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          initialRegion={trackingRegion}
          maxBounds={BULAWAYO_GEO_LOCK_ENABLED ? BULAWAYO_SERVICE_BOUNDS_ARRAY : undefined}
          showsCompass={false}
          toolbarEnabled={false}
          onRegionChangeComplete={handleMapRegionChangeComplete}
          scrollEnabled
          zoomEnabled
          rotateEnabled={false}
          pitchEnabled={false}
        >
          {driverCoordinate ? (
            <Marker coordinate={driverCoordinate} title="Driver" tracksViewChanges={false}>
              <View className="items-center">
                <View
                  className="h-12 w-12 items-center justify-center rounded-full border-4 border-white"
                  style={{ backgroundColor: PRIMARY_BLUE }}
                >
                  <Ionicons name="car-sport" size={22} color="#fff" />
                </View>
                <View className="mt-1 rounded-full bg-white px-2 py-1">
                  <Text className="text-xs font-bold text-gray-900">{liveEtaText}</Text>
                </View>
              </View>
            </Marker>
          ) : null}
          <Marker coordinate={pickupCoordinate} title="Pickup" pinColor="#1d4ed8" tracksViewChanges={false} />
          <Marker coordinate={dropoffCoordinate} title="Drop-off" pinColor="#111827" tracksViewChanges={false} />
          <Polyline
            coordinates={activeRouteCoordinates}
            strokeColor={PRIMARY_BLUE}
            strokeWidth={5}
          />
        </MapView>

        <View pointerEvents="none" className="absolute inset-0 bg-white/10" />

        <View
          pointerEvents="box-none"
          className="absolute right-5"
          style={{ bottom: collapsedSheetHeight + bottomActionInset + 24 }}
        >
          <TouchableOpacity
            onPress={() => handleAdjustMapZoom(0.6)}
            activeOpacity={0.85}
            className="h-14 w-14 items-center justify-center rounded-[20px] bg-white"
          >
            <Ionicons name="add" size={26} color="#111827" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleAdjustMapZoom(1.6)}
            activeOpacity={0.85}
            className="mt-3 h-14 w-14 items-center justify-center rounded-[20px] bg-white"
          >
            <Ionicons name="remove" size={26} color="#111827" />
          </TouchableOpacity>
        </View>

        <View pointerEvents="box-none" className="px-5" style={{ paddingTop: insets.top + 10 }}>
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
                      ? 'Trip in progress'
                      : 'Driver is on the way'}
              </Text>
              <Text className="mt-1 text-sm text-gray-500">
                {isCompleted
                  ? 'You can rate your driver now or skip and do it later.'
                  : stage === 'waiting_at_pickup'
                    ? pickupWaitExpired
                      ? 'Pickup wait time has ended. Please contact your driver.'
                      : rideStatus?.passengerConfirmedAt
                        ? `Confirmed! ${pickupWaitCountdownText} remaining.`
                        : `${pickupWaitCountdownText} to meet your driver at pickup.`
                    : stage === 'on_trip'
                      ? (dropoffLabel || 'Heading to your destination')
                    : hasDriverCoordinate
                      ? `${liveEtaText} away - ${liveDistanceText}`
                      : liveDistanceText}
              </Text>
            </View>
          </View>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={insets.top + 80}
          pointerEvents="box-none"
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View
            className="mt-auto rounded-t-[30px] bg-[#f8fafc]"
            style={{ height: rideSheetCollapsed ? collapsedSheetHeight : '78%' }}
          >
            <ScrollView
              className="flex-1 px-5 pt-4"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: bottomActionInset + 20 }}
            >
              <TouchableOpacity
                onPress={() => setRideSheetCollapsed((current) => !current)}
                activeOpacity={0.8}
                className="items-center"
              >
                <View className="h-2 w-16 rounded-full bg-gray-300" />
                <View className="mt-3 flex-row items-center">
                  <Text className="text-sm font-semibold text-gray-500">
                    {rideSheetCollapsed ? 'Show trip details' : 'Hide trip details'}
                  </Text>
                  <Ionicons
                    name={rideSheetCollapsed ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#6b7280"
                    style={{ marginLeft: 6 }}
                  />
                </View>
              </TouchableOpacity>

              {stage !== 'on_trip' ? (
                <View className="mt-4 rounded-[22px] bg-white px-4 py-3">
                  <Text className="text-xs font-semibold uppercase tracking-[1px] text-gray-400">
                    {stage === 'waiting_at_pickup' ? 'Pickup status' : 'Driver status'}
                  </Text>
                  <Text className="mt-1 text-base font-bold text-gray-900">
                    {stage === 'waiting_at_pickup'
                      ? pickupWaitExpired
                        ? 'Pickup wait time ended'
                        : `${pickupWaitCountdownText} at pickup`
                      : hasDriverCoordinate
                        ? `${liveEtaText} away - ${liveDistanceText}`
                        : liveDistanceText}
                  </Text>
                </View>
              ) : null}

              {stage === 'on_trip' ? (
                <View className="mt-4 rounded-[22px] bg-white px-4 py-4">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <Text className="text-sm font-medium text-gray-500">
                        {hasRoadDistance ? 'Distance to destination' : 'Estimated distance'}
                      </Text>
                      <Text className="mt-1 text-2xl font-bold text-gray-900">{liveDistanceText}</Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-sm font-medium text-gray-500">Fare</Text>
                      <Text className="mt-1 text-2xl font-bold text-gray-900">${totalAmount.toFixed(2)}</Text>
                    </View>
                  </View>
                </View>
              ) : null}

              {!rideSheetCollapsed ? (
                <>
                  {stage === 'waiting_at_pickup' ? (
                    <View className="mt-4 rounded-[22px] border border-amber-200 bg-[#fff7ed] px-4 py-3">
                      <Text className="text-xs font-semibold uppercase tracking-[2px] text-amber-600">
                        Pickup timer
                      </Text>
                      <Text className="mt-1 text-3xl font-bold text-gray-900">{pickupWaitCountdownText}</Text>
                      <Text className="mt-1 text-sm text-gray-600">
                        {pickupWaitExpired
                          ? 'The pickup wait time has ended. Message or call your driver now.'
                          : rideStatus?.passengerConfirmedAt
                            ? 'You confirmed you\'re coming. Your driver is waiting.'
                            : 'Please meet your driver at the pickup point.'}
                      </Text>
                    </View>
                  ) : null}

                  {stage !== 'on_trip' ? (
                    <View className="mt-4 rounded-[22px] bg-white px-4 py-4">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-xs font-semibold uppercase tracking-[1px] text-gray-400">
                          Trip status
                        </Text>
                        {routeLoading ? <ActivityIndicator size="small" color={PRIMARY_BLUE} /> : null}
                      </View>
                      <Text className="mt-2 text-base font-bold text-gray-900">
                        {stage === 'waiting_at_pickup'
                          ? 'Driver is at your pickup point.'
                          : 'Driver is heading to your pickup.'}
                      </Text>
                      <Text className="mt-1 text-sm text-gray-500">
                        {hasDriverCoordinate
                          ? `${liveEtaText} - ${liveDistanceText} ${hasRoadDistance ? 'road distance' : 'estimated distance'}`
                          : liveDistanceText}
                      </Text>
                      <Text className="mt-1 text-xs text-gray-400">
                        Road distance refreshes about every 30 seconds or sooner if the car changes direction.
                      </Text>
                      {routeError ? (
                        <Text className="mt-2 text-sm text-amber-600">{routeError}</Text>
                      ) : null}
                    </View>
                  ) : null}

                  <View className="mt-5 rounded-[28px] border border-gray-100 bg-white p-5">
                    <View className="flex-row items-center">
                      <View className="items-center">
                        {driverProfileImageUrl ? (
                          <Image
                            source={{ uri: driverProfileImageUrl }}
                            style={{ width: 62, height: 62, borderRadius: 31 }}
                          />
                        ) : (
                          <View className="h-[62px] w-[62px] items-center justify-center rounded-full bg-[#e0e7ff]">
                            <Ionicons name="person" size={26} color={PRIMARY_BLUE} />
                          </View>
                        )}
                        <Image
                          source={{ uri: normalizeVehicleImageUrl(driver?.carImage) || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80' }}
                          style={{ marginTop: 10, width: 96, height: 72, borderRadius: 18 }}
                        />
                      </View>
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

                    <View className="mt-5 rounded-[22px] bg-[#eff5ff] px-4 py-4">
                      <View className={stage === 'on_trip' ? 'items-center' : 'flex-row items-center justify-between'}>
                        {stage === 'on_trip' ? (
                          <>
                            <Text className="text-sm font-medium text-gray-500">
                              {hasRoadDistance ? 'Distance to destination' : 'Estimated distance to destination'}
                            </Text>
                            <Text className="mt-1 text-3xl font-bold text-gray-900">{liveDistanceText}</Text>
                            <Text className="mt-2 text-sm text-gray-500">
                              {tripDistanceKm > 0
                                ? `Trip route ${tripDistanceKm.toFixed(1)} km${tripEtaMinutes > 0 ? ` • ${tripEtaMinutes} min` : ''}`
                                : 'Trip route details updating...'}
                            </Text>
                          </>
                        ) : (
                          <>
                            <View>
                              <Text className="text-sm font-medium text-gray-500">{stage === 'waiting_at_pickup' ? 'Live arrival' : 'Driver arrival'}</Text>
                              <Text className="mt-1 text-2xl font-bold text-gray-900">
                                {stage === 'waiting_at_pickup' ? 'Arrived' : liveEtaText}
                              </Text>
                            </View>
                            <View className="items-end">
                              <Text className="text-sm font-medium text-gray-500">
                                {hasRoadDistance ? 'Road distance' : 'Estimated distance'}
                              </Text>
                              <Text className="mt-1 text-2xl font-bold text-gray-900">{liveDistanceText}</Text>
                            </View>
                          </>
                        )}
                      </View>
                    </View>

                    {stage === 'on_trip' ? (
                      <View className="mt-5 border-t border-gray-100 pt-4">
                        <Text className="text-sm text-gray-500">{selectedTier?.tierName || driver?.tier?.tierName || 'Ride'}</Text>
                        {tipAmount > 0 ? (
                          <Text className="mt-2 text-sm font-medium text-green-600">
                            Includes ${tipAmount.toFixed(2)} tip
                          </Text>
                        ) : null}
                      </View>
                    ) : null}

                    {!rideSheetCollapsed && stage !== 'on_trip' ? (
                      <View className="mt-5 border-t border-gray-100 pt-4">
                        <Text className="text-sm font-medium text-gray-500">Fare</Text>
                        <Text className="mt-1 text-3xl font-bold text-gray-900">${totalAmount.toFixed(2)}</Text>
                        <Text className="mt-1 text-sm text-gray-500">{selectedTier?.tierName || driver?.tier?.tierName || 'Ride'}</Text>
                        {tipAmount > 0 ? (
                          <Text className="mt-2 text-sm font-medium text-green-600">
                            Includes ${tipAmount.toFixed(2)} tip
                          </Text>
                        ) : null}
                      </View>
                    ) : null}

                    {stage !== 'on_trip' ? (
                      <View className="mt-5 rounded-[22px] bg-[#f8fafc] p-4">
                        <Text className="text-sm font-medium text-gray-500">Trip</Text>
                        <Text className="mt-2 text-base font-bold text-gray-900">{pickupLabel}</Text>
                        <Text className="mt-1 text-sm text-gray-500">to</Text>
                        <Text className="mt-1 text-base font-bold text-gray-900">{dropoffLabel}</Text>
                      </View>
                    ) : null}
                  </View>

                  {isCompleted ? (
                    <>
                      {(rideStatus?.canTipDriver || tipAmount > 0) ? (
                        <View className="mt-5 rounded-[28px] border border-gray-100 bg-white px-5 py-5">
                          <Text className="text-xl font-bold text-gray-900">Tip driver</Text>
                          <Text className="mt-2 text-sm text-gray-500">
                            Add an optional thank-you tip for {driver?.driverName || 'your driver'}.
                          </Text>
                          {tipAmount > 0 ? (
                            <Text className="mt-4 text-2xl font-bold text-green-600">${tipAmount.toFixed(2)} added</Text>
                          ) : (
                            <View className="mt-5 flex-row flex-wrap">
                              {tipOptions.map((amount) => (
                                <TouchableOpacity
                                  key={amount}
                                  onPress={() => handleSendTip(amount)}
                                  disabled={submittingTip}
                                  className="mb-3 mr-3 h-12 min-w-[72px] items-center justify-center rounded-full border border-blue-200 bg-[#eff6ff] px-4"
                                >
                                  <Text className="text-base font-bold" style={{ color: PRIMARY_BLUE }}>
                                    ${amount.toFixed(2)}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                          {submittingTip ? (
                            <View className="mt-2 flex-row items-center">
                              <ActivityIndicator size="small" color={PRIMARY_BLUE} />
                              <Text className="ml-2 text-sm text-gray-500">Sending tip...</Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}

                      <View className="mt-5 rounded-[28px] border border-gray-100 bg-white px-5 py-5">
                        <Text className="text-xl font-bold text-gray-900">Lost item</Text>
                        <Text className="mt-2 text-sm text-gray-500">
                          Left something in the car? Send the details to support.
                        </Text>
                        <TextInput
                          value={lostItemDescription}
                          onChangeText={setLostItemDescription}
                          placeholder="Describe the item you lost"
                          multiline
                          textAlignVertical="top"
                          className="mt-4 min-h-[110px] rounded-[18px] bg-[#f8fafc] px-4 py-4 text-base text-gray-900"
                        />
                        <TextInput
                          value={lostItemContactPhone}
                          onChangeText={setLostItemContactPhone}
                          placeholder="Contact phone (optional)"
                          keyboardType="phone-pad"
                          className="mt-3 h-12 rounded-[18px] bg-[#f8fafc] px-4 text-base text-gray-900"
                        />
                        <TouchableOpacity
                          onPress={handleReportLostItem}
                          disabled={submittingLostItem}
                          className="mt-4 h-12 items-center justify-center rounded-[18px]"
                          style={{ backgroundColor: PRIMARY_BLUE, opacity: submittingLostItem ? 0.7 : 1 }}
                        >
                          {submittingLostItem ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text className="text-sm font-bold uppercase text-white">Report lost item</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : null}

                  {stage === 'completed' ? (
                    <TouchableOpacity
                      onPress={handleDone}
                      className="mt-4 h-14 rounded-[22px] items-center justify-center"
                      style={{ backgroundColor: PRIMARY_BLUE }}
                    >
                      <Text className="text-lg font-bold text-white">Done</Text>
                    </TouchableOpacity>
                  ) : null}

                </>
              ) : null}

              {!isCompleted ? (
                <View
                  className="border-t border-gray-200 bg-[#f8fafc] pt-4"
                  style={{ paddingBottom: bottomActionInset }}
                >
                  {stage === 'on_trip' ? (
                    <View className="flex-row items-center gap-3">
                      <TouchableOpacity
                        onPress={handleCancelRide}
                        className="flex-1 h-14 rounded-[22px] border border-red-200 items-center justify-center bg-white"
                      >
                        <Text className="text-lg font-bold text-red-500">Cancel ride</Text>
                      </TouchableOpacity>
                    </View>
                  ) : stage !== 'on_trip' ? (
                    <View className="flex-row items-center gap-3">
                      {!rideStatus?.passengerConfirmedAt ? (
                        <TouchableOpacity
                          onPress={handleConfirmPickup}
                          className="flex-1 h-14 rounded-[22px] items-center justify-center"
                          style={{ backgroundColor: PRIMARY_BLUE }}
                        >
                          <Text className="text-lg font-bold text-white">Confirm I'm coming</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          onPress={handleCancelRide}
                          className="flex-1 h-14 rounded-[22px] border border-red-200 items-center justify-center bg-white"
                        >
                          <Text className="text-lg font-bold text-red-500">Cancel ride</Text>
                        </TouchableOpacity>
                      )}
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
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
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

      <Modal visible={showDriverRatingModal} transparent animationType="fade" onRequestClose={handleSkipRating}>
        <View className="flex-1 items-center justify-center bg-black/20 px-5">
          <View className="w-full max-w-[380px] rounded-[28px] bg-white px-5 pt-5 pb-5">
            <Text className="text-2xl font-bold text-gray-900">Rate Driver</Text>
            <Text className="mt-2 text-sm text-gray-500">
              Tell us how this trip went, or skip for now.
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
            {(rideStatus?.canTipDriver || tipAmount > 0) ? (
              <View className="mt-4 rounded-[22px] bg-[#f8fafc] px-4 py-4">
                <Text className="text-sm font-semibold uppercase tracking-[1px] text-gray-500">Optional tip</Text>
                {tipAmount > 0 ? (
                  <Text className="mt-2 text-base font-bold text-green-600">
                    Tip added: ${tipAmount.toFixed(2)}
                  </Text>
                ) : (
                  <View className="mt-3 flex-row flex-wrap">
                    {tipOptions.map((amount) => (
                      <TouchableOpacity
                        key={amount}
                        onPress={() => handleSendTip(amount)}
                        disabled={submittingTip}
                        className="mb-2 mr-2 rounded-full border border-blue-200 bg-white px-4 py-2"
                      >
                        <Text className="text-sm font-bold" style={{ color: PRIMARY_BLUE }}>
                          ${amount.toFixed(2)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {submittingTip ? (
                  <View className="mt-2 flex-row items-center">
                    <ActivityIndicator size="small" color={PRIMARY_BLUE} />
                    <Text className="ml-2 text-sm text-gray-500">Sending tip...</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <TouchableOpacity
              onPress={handleSubmitRating}
              disabled={submittingRating}
              className="mt-4 h-14 rounded-[22px] items-center justify-center"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: submittingRating ? 0.7 : 1 }}
            >
              {submittingRating ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-lg font-bold text-white">Done</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSkipRating}
              disabled={submittingRating}
              className="mt-3 h-12 items-center justify-center"
            >
              <Text className="text-base font-semibold text-gray-500">Skip for now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
