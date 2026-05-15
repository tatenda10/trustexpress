import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, Platform } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  cancelDriverCurrentRide,
  completeDriverCurrentRide,
  getDirectionsRoute,
  getDriverCurrentRide,
  markDriverCurrentRideArrived,
  resolveUploadedMediaUrl,
  startDriverCurrentRide,
  submitDriverPassengerRating,
  updateDriverAvailability,
} from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { DRIVER_CANCELLATION_REASONS } from '../../constants/cancellationReasons';
import { connectRealtime } from '../../realtime';
import {
  DriverTripEmptyState,
  DriverTripLoadingState,
  DriverTripMapPanel,
  DriverTripReceiptView,
} from './components/DriverTripComponents';

const ROUTE_REFRESH_DISTANCE_METERS = 250;
const ROUTE_REFRESH_MIN_INTERVAL_MS = 8000;
const LOCATION_UPDATE_DISTANCE_METERS = 15;
const LOCATION_UPDATE_INTERVAL_MS = 8000;
const LIVE_DIRECTIONS_CACHE_TTL_SECONDS = 0;
const AUTO_ARRIVAL_DISTANCE_METERS = 90;
const AUTO_ARRIVAL_STABLE_MS = 3500;
const TRIP_PANEL_MAX_HEIGHT = Math.round(Dimensions.get('window').height * 0.34);
const TRIP_STATUS_REFRESH_MS = 8000;
const PICKUP_WAIT_SECONDS = 5 * 60;
const DRIVER_VOICE_GUIDANCE_KEY = 'trust_express_driver_voice_guidance';
const FALLBACK_DRIVER_COORDINATE = { latitude: -20.1535, longitude: 28.5870 };
const DEFAULT_LAT_DELTA = 0.03;
const DEFAULT_LNG_DELTA = 0.03;
const SPEECH_MIN_INTERVAL_MS = 3500;
const SPEECH_STABILIZE_MS = 900;
const SPEECH_MIN_CHARS = 8;
const TRIP_DEBUG_PREFIX = '[DriverTrip]';

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function normalizeCoordinate(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function normalizeCoordinates(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeCoordinate).filter(Boolean);
}

function calculateDistanceKm(start, end) {
  const safeStart = normalizeCoordinate(start);
  const safeEnd = normalizeCoordinate(end);
  if (!safeStart || !safeEnd) return 0;
  const earthRadiusKm = 6371;
  const dLat = toRadians(safeEnd.latitude - safeStart.latitude);
  const dLng = toRadians(safeEnd.longitude - safeStart.longitude);
  const lat1 = toRadians(safeStart.latitude);
  const lat2 = toRadians(safeEnd.latitude);
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

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-ZW', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseTimestampMs(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInstructionForSpeech(value) {
  const text = String(value || '')
    .replace(/\bN\b/g, 'north')
    .replace(/\bS\b/g, 'south')
    .replace(/\bE\b/g, 'east')
    .replace(/\bW\b/g, 'west')
    .replace(/\bri\b/gi, 'right')
    .replace(/\blt\b/gi, 'left')
    .replace(/\brd\b/gi, 'road')
    .replace(/\bst\b/gi, 'street')
    .replace(/\bave\b/gi, 'avenue')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';

  // If the step text was truncated by upstream formatting, smooth common endings.
  if (/\bturn\s+ri$/i.test(text) || /\bkeep\s+ri$/i.test(text)) {
    return text.replace(/\bri$/i, 'right');
  }
  if (/\bturn\s+le$/i.test(text) || /\bkeep\s+le$/i.test(text)) {
    return text.replace(/\ble$/i, 'left');
  }
  if (/\b(turn|keep|head|continue)\s+[a-z]{1,2}$/i.test(text)) {
    return '';
  }

  return text;
}

function buildRegionFromCoordinates(coordinates) {
  const valid = normalizeCoordinates(coordinates);
  if (!valid.length) {
    return {
      latitude: FALLBACK_DRIVER_COORDINATE.latitude,
      longitude: FALLBACK_DRIVER_COORDINATE.longitude,
      latitudeDelta: DEFAULT_LAT_DELTA,
      longitudeDelta: DEFAULT_LNG_DELTA,
    };
  }
  const latitudes = valid.map((item) => item.latitude);
  const longitudes = valid.map((item) => item.longitude);

  return {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    latitudeDelta: Math.max((Math.max(...latitudes) - Math.min(...latitudes)) * 1.35, DEFAULT_LAT_DELTA),
    longitudeDelta: Math.max((Math.max(...longitudes) - Math.min(...longitudes)) * 1.35, DEFAULT_LNG_DELTA),
  };
}

function getRoutePreviewCoordinates(routeCoordinates, driverCoordinate, targetCoordinate) {
  const safeDriverCoordinate = normalizeCoordinate(driverCoordinate);
  const safeTargetCoordinate = normalizeCoordinate(targetCoordinate);
  const safeRouteCoordinates = normalizeCoordinates(routeCoordinates);
  if (safeRouteCoordinates.length > 1) {
    return [safeDriverCoordinate, ...safeRouteCoordinates.slice(0, 18), safeTargetCoordinate].filter(Boolean);
  }
  return [safeDriverCoordinate, safeTargetCoordinate].filter(Boolean);
}

function toExternalNavigationLink(label, coordinate) {
  if (!coordinate) return '';
  const lat = Number(coordinate.latitude);
  const lng = Number(coordinate.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  const labelQuery = encodeURIComponent(label ? `${label} (${lat},${lng})` : `${lat},${lng}`);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}&query=${labelQuery}`;
}

function toExternalNavigationUrls(label, coordinate) {
  if (!coordinate) return [];
  const lat = Number(coordinate.latitude);
  const lng = Number(coordinate.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const encodedLabel = encodeURIComponent(String(label || 'Destination'));
  const latLng = `${lat},${lng}`;

  if (Platform.OS === 'android') {
    return [
      `geo:${latLng}?q=${latLng}(${encodedLabel})`,
      `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`,
    ];
  }

  return [
    `maps://?daddr=${lat},${lng}&dirflg=d`,
    `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
    `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`,
  ];
}

async function fetchTripDirections(token, origin, destination) {
  if (!token || !origin || !destination) {
    console.log(TRIP_DEBUG_PREFIX, 'fetchTripDirections skipped', {
      hasToken: !!token,
      origin,
      destination,
    });
    return null;
  }

  console.log(TRIP_DEBUG_PREFIX, 'fetchTripDirections start', { origin, destination });
  const data = await getDirectionsRoute(token, {
    origin,
    destination,
    cacheTtlSeconds: LIVE_DIRECTIONS_CACHE_TTL_SECONDS,
  });
  const route = data?.route || {};
  console.log(TRIP_DEBUG_PREFIX, 'fetchTripDirections success', {
    coordinateCount: Array.isArray(route.coordinates) ? route.coordinates.length : 0,
    distanceMeters: Number(route.distanceMeters || 0),
    durationSeconds: Number(route.durationSeconds || 0),
    nextInstruction: route.nextInstruction || '',
  });

  return {
    coordinates: normalizeCoordinates(route.coordinates),
    distanceMeters: Number(route.distanceMeters || 0),
    durationSeconds: Number(route.durationSeconds || 0),
    nextInstruction: route.nextInstruction || '',
  };
}

export default function DriverTripScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const mapRef = useRef(null);
  const realtimeSocketRef = useRef(null);
  const lastRouteOriginRef = useRef(null);
  const lastRouteTargetRef = useRef(null);
  const lastRouteFetchedAtRef = useRef(0);
  const locationSubscriptionRef = useRef(null);
  const activeLocationRideIdRef = useRef(null);
  const routeRequestIdRef = useRef(0);
  const mapReadyRef = useRef(false);
  const availabilitySyncInFlightRef = useRef(false);
  const rideLoadInFlightRef = useRef(false);
  const hasAutoFocusedRef = useRef(false);
  const lastAutoFocusStageRef = useRef('');
  const lastSpokenInstructionRef = useRef('');
  const lastSpokenAtRef = useRef(0);
  const lastArrivalAnnouncementStageRef = useRef('');
  const speechDebounceTimeoutRef = useRef(null);
  const autoArrivalTimerRef = useRef(null);
  const autoArrivalRideIdRef = useRef(null);
  const [ride, setRide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingRide, setCancellingRide] = useState(false);
  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(true);
  const [realtimeSignal, setRealtimeSignal] = useState(0);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeDistanceMeters, setRouteDistanceMeters] = useState(0);
  const [routeDurationSeconds, setRouteDurationSeconds] = useState(0);
  const [nextInstruction, setNextInstruction] = useState('');
  const [liveDriverCoordinate, setLiveDriverCoordinate] = useState(null);
  const [mapRegion, setMapRegion] = useState(() => buildRegionFromCoordinates([FALLBACK_DRIVER_COORDINATE]));
  const [nowTick, setNowTick] = useState(Date.now());
  const [showPassengerRating, setShowPassengerRating] = useState(false);
  const [completedRideId, setCompletedRideId] = useState(null);
  const [completedRideSnapshot, setCompletedRideSnapshot] = useState(null);
  const [passengerRating, setPassengerRating] = useState(0);
  const [passengerReview, setPassengerReview] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);

  const exitPassengerRatingFlow = useCallback(() => {
    setShowPassengerRating(false);
    setCompletedRideId(null);
    setCompletedRideSnapshot(null);
    setPassengerRating(0);
    setPassengerReview('');

    const parentNavigator = navigation.getParent?.();
    if (parentNavigator) {
      parentNavigator.navigate('DriverHome', {
        screen: 'DriverHomeMain',
        params: {
          suppressTripAutoOpenUntil: Date.now() + 8000,
        },
      });
      return;
    }

    navigation.popToTop();
  }, [navigation]);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const stopDriverVoice = useCallback(() => {
    if (speechDebounceTimeoutRef.current) {
      clearTimeout(speechDebounceTimeoutRef.current);
      speechDebounceTimeoutRef.current = null;
    }
    lastSpokenInstructionRef.current = '';
    lastSpokenAtRef.current = 0;
    Speech.stop();
  }, []);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(DRIVER_VOICE_GUIDANCE_KEY)
      .then((value) => {
        if (!active) return;
        setVoiceGuidanceEnabled(value !== 'false');
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadRide = async () => {
      if (rideLoadInFlightRef.current) return;
      rideLoadInFlightRef.current = true;
      console.log(TRIP_DEBUG_PREFIX, 'loadRide start');
      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error('Not signed in');
        const data = await getDriverCurrentRide(token, { suppressAuthErrorHandler: true });
        if (!active) return;
        console.log(TRIP_DEBUG_PREFIX, 'loadRide success', {
          rideId: data?.ride?.id || null,
          status: data?.ride?.status || null,
          stage: data?.ride?.stage || null,
          pickupCoordinate: data?.ride?.pickupCoordinate || null,
          dropoffCoordinate: data?.ride?.dropoffCoordinate || null,
          driverCoordinate: data?.ride?.driverCoordinate || null,
        });
        if (data?.ride || !showPassengerRating) {
          setRide(data?.ride || null);
        }
        const safeDriverCoordinate = normalizeCoordinate(data?.ride?.driverCoordinate);
        if (safeDriverCoordinate) {
          setLiveDriverCoordinate(safeDriverCoordinate);
        }
      } catch (error) {
        console.log(TRIP_DEBUG_PREFIX, 'loadRide failed', {
          message: error?.message || 'unknown error',
        });
        if (!active) return;
        setRide(null);
      } finally {
        rideLoadInFlightRef.current = false;
        console.log(TRIP_DEBUG_PREFIX, 'loadRide end');
        if (active) setLoading(false);
      }
    };

    loadRide();
    const interval = setInterval(loadRide, TRIP_STATUS_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [realtimeSignal, showPassengerRating]);

  useEffect(() => {
    let active = true;
    let localSocket = null;

    const initRealtime = async () => {
      try {
        if (realtimeSocketRef.current) {
          console.log(TRIP_DEBUG_PREFIX, 'realtime init skipped: already connected');
          return;
        }
        const token = await getTokenRef.current();
        if (!active || !token) return;
        localSocket = connectRealtime(token);
        if (!localSocket) return;
        realtimeSocketRef.current = localSocket;
        console.log(TRIP_DEBUG_PREFIX, 'realtime connected');

        const handleRideUpdate = () => {
          if (!active) return;
          console.log(TRIP_DEBUG_PREFIX, 'realtime driver_ride:updated');
          setRealtimeSignal((current) => current + 1);
        };

        localSocket.on('driver_ride:updated', handleRideUpdate);

        localSocket.__driverTripCleanup = () => {
          localSocket.off('driver_ride:updated', handleRideUpdate);
        };
      } catch (error) {
        console.log(TRIP_DEBUG_PREFIX, 'realtime setup failed', {
          message: error?.message || 'unknown error',
        });
        // Polling remains the fallback.
      }
    };

    initRealtime();

    return () => {
      active = false;
      localSocket?.__driverTripCleanup?.();
      if (realtimeSocketRef.current === localSocket) {
        realtimeSocketRef.current = null;
      }
      stopDriverVoice();
    };
  }, [stopDriverVoice]);

  useEffect(() => {
    const normalizedInstruction = normalizeInstructionForSpeech(nextInstruction);
    if (!voiceGuidanceEnabled) {
      stopDriverVoice();
      return undefined;
    }
    if (!normalizedInstruction || ride?.stage === 'waiting_for_customer') return undefined;
    if (normalizedInstruction.length < SPEECH_MIN_CHARS) return undefined;
    if (normalizedInstruction === lastSpokenInstructionRef.current) return undefined;

    if (speechDebounceTimeoutRef.current) {
      clearTimeout(speechDebounceTimeoutRef.current);
      speechDebounceTimeoutRef.current = null;
    }

    speechDebounceTimeoutRef.current = setTimeout(() => {
      const now = Date.now();
      if (now - lastSpokenAtRef.current < SPEECH_MIN_INTERVAL_MS) return;
      Speech.isSpeakingAsync()
        .then((isSpeaking) => {
          if (isSpeaking) return;
          lastSpokenInstructionRef.current = normalizedInstruction;
          lastSpokenAtRef.current = Date.now();
          Speech.speak(normalizedInstruction, {
            rate: 0.92,
            pitch: 1.0,
            language: 'en',
          });
        })
        .catch(() => {});
    }, SPEECH_STABILIZE_MS);

    return () => {
      if (speechDebounceTimeoutRef.current) {
        clearTimeout(speechDebounceTimeoutRef.current);
        speechDebounceTimeoutRef.current = null;
      }
    };
  }, [nextInstruction, ride?.stage, stopDriverVoice, voiceGuidanceEnabled]);

  useEffect(() => {
    if (!voiceGuidanceEnabled) return undefined;
    if (ride?.stage !== 'waiting_for_customer') return undefined;
    if (lastArrivalAnnouncementStageRef.current === ride.stage) return undefined;

    lastArrivalAnnouncementStageRef.current = ride.stage;
    Speech.stop();
    Speech.speak('You have arrived at the pickup point.', {
      rate: 0.95,
      pitch: 1.0,
      language: 'en',
    });

    return undefined;
  }, [ride?.stage, voiceGuidanceEnabled]);

  useEffect(() => {
    if (ride?.stage !== 'waiting_for_customer') return undefined;
    setNowTick(Date.now());
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [ride?.stage]);

  useEffect(() => {
    if (!ride) return undefined;
    let active = true;

    const startLocationTracking = async () => {
      try {
        if (locationSubscriptionRef.current && activeLocationRideIdRef.current === ride?.id) {
          console.log(TRIP_DEBUG_PREFIX, 'location tracking skipped: already subscribed for ride', {
            rideId: ride?.id || null,
          });
          return;
        }
        console.log(TRIP_DEBUG_PREFIX, 'location tracking start', {
          rideId: ride?.id || null,
          stage: ride?.stage || null,
        });
        const permission = await Location.requestForegroundPermissionsAsync();
        console.log(TRIP_DEBUG_PREFIX, 'location permission result', {
          status: permission?.status || 'unknown',
        });
        if (permission.status !== 'granted') return;

        const currentPosition = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
        });
        console.log(TRIP_DEBUG_PREFIX, 'location current position success', {
          latitude: currentPosition?.coords?.latitude,
          longitude: currentPosition?.coords?.longitude,
        });
        if (active) {
          const currentCoordinate = normalizeCoordinate({
            latitude: currentPosition.coords.latitude,
            longitude: currentPosition.coords.longitude,
          });
          if (!currentCoordinate) return;
          setLiveDriverCoordinate(currentCoordinate);
          try {
            const token = await getTokenRef.current();
            if (token && !availabilitySyncInFlightRef.current) {
              availabilitySyncInFlightRef.current = true;
              await updateDriverAvailability(token, {
                isOnline: true,
                latitude: currentCoordinate.latitude,
                longitude: currentCoordinate.longitude,
              });
            }
            console.log(TRIP_DEBUG_PREFIX, 'availability bootstrap sync success', currentCoordinate);
          } catch (error) {
            console.log(TRIP_DEBUG_PREFIX, 'availability bootstrap sync failed', {
              message: error?.message || 'unknown error',
            });
            // Ignore bootstrap location sync errors and continue with live routing.
          } finally {
            availabilitySyncInFlightRef.current = false;
          }
        }

        locationSubscriptionRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: LOCATION_UPDATE_INTERVAL_MS,
            distanceInterval: LOCATION_UPDATE_DISTANCE_METERS,
          },
          async (position) => {
            if (!active) return;

            const nextCoordinate = normalizeCoordinate({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
            if (!nextCoordinate) return;

            console.log(TRIP_DEBUG_PREFIX, 'location watcher update', nextCoordinate);
            setLiveDriverCoordinate(nextCoordinate);

            try {
              const token = await getTokenRef.current();
              if (!token || availabilitySyncInFlightRef.current) return;
              availabilitySyncInFlightRef.current = true;
              await updateDriverAvailability(token, {
                isOnline: true,
                latitude: nextCoordinate.latitude,
                longitude: nextCoordinate.longitude,
              });
              console.log(TRIP_DEBUG_PREFIX, 'availability watcher sync success', nextCoordinate);
            } catch (error) {
              console.log(TRIP_DEBUG_PREFIX, 'availability watcher sync failed', {
                message: error?.message || 'unknown error',
              });
              // Keep the route screen responsive even if the backend write fails.
            } finally {
              availabilitySyncInFlightRef.current = false;
            }
          }
        );
        activeLocationRideIdRef.current = ride?.id || null;
        console.log(TRIP_DEBUG_PREFIX, 'location watcher subscribed');
      } catch (error) {
        console.log(TRIP_DEBUG_PREFIX, 'location tracking failed', {
          message: error?.message || 'unknown error',
        });
        // Ignore location tracking startup failures and keep server-fed coordinates.
      }
    };

    startLocationTracking();

    return () => {
      active = false;
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }
      activeLocationRideIdRef.current = null;
      availabilitySyncInFlightRef.current = false;
    };
  }, [ride?.id]);

  const pickupCoordinate = normalizeCoordinate(ride?.pickupCoordinate);
  const dropoffCoordinate = normalizeCoordinate(ride?.dropoffCoordinate);
  const driverCoordinate = normalizeCoordinate(liveDriverCoordinate)
    || normalizeCoordinate(ride?.driverCoordinate)
    || pickupCoordinate
    || dropoffCoordinate;
  const targetCoordinate = ride?.stage === 'on_trip' ? dropoffCoordinate : pickupCoordinate;

  useEffect(() => {
    console.log(TRIP_DEBUG_PREFIX, 'coordinate snapshot', {
      rideId: ride?.id || null,
      stage: ride?.stage || null,
      pickupCoordinate,
      dropoffCoordinate,
      liveDriverCoordinate,
      resolvedDriverCoordinate: driverCoordinate,
      targetCoordinate,
    });
  }, [driverCoordinate, dropoffCoordinate, liveDriverCoordinate, pickupCoordinate, ride?.id, ride?.stage, targetCoordinate]);

  useEffect(() => {
    if (!ride || ['completed', 'cancelled', 'expired'].includes(String(ride?.status || '').toLowerCase())) {
      stopDriverVoice();
      setRouteCoordinates([]);
      setRouteDistanceMeters(0);
      setRouteDurationSeconds(0);
      setNextInstruction('');
    }
  }, [ride, stopDriverVoice]);

  useEffect(() => {
    if (!driverCoordinate || !targetCoordinate) return undefined;

    const previousOrigin = lastRouteOriginRef.current;
    const previousTarget = lastRouteTargetRef.current;
    const movedDistanceMeters = previousOrigin
      ? calculateDistanceKm(previousOrigin, driverCoordinate) * 1000
      : Infinity;
    const targetChanged = previousTarget
      ? calculateDistanceKm(previousTarget, targetCoordinate) * 1000 >= 30
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
    lastRouteTargetRef.current = targetCoordinate;
    lastRouteFetchedAtRef.current = Date.now();

    const loadDirections = async () => {
      try {
        const token = await getTokenRef.current();
        const route = await fetchTripDirections(token, driverCoordinate, targetCoordinate);
        if (cancelled || routeRequestIdRef.current !== currentRequestId) return;

        setRouteCoordinates(Array.isArray(route?.coordinates) && route.coordinates.length > 1
          ? normalizeCoordinates(route.coordinates)
          : [driverCoordinate, targetCoordinate].filter(Boolean));
        setRouteDistanceMeters(route?.distanceMeters || 0);
        setRouteDurationSeconds(route?.durationSeconds || 0);
        setNextInstruction(route?.nextInstruction || '');
        console.log(TRIP_DEBUG_PREFIX, 'route state updated', {
          routeCoordinateCount: Array.isArray(route?.coordinates) ? route.coordinates.length : 0,
          routeDistanceMeters: route?.distanceMeters || 0,
          routeDurationSeconds: route?.durationSeconds || 0,
        });
      } catch (error) {
        if (cancelled || routeRequestIdRef.current !== currentRequestId) return;
        console.log(TRIP_DEBUG_PREFIX, 'route fetch failed', {
          message: error?.message || 'unknown error',
          driverCoordinate,
          targetCoordinate,
        });
        setRouteCoordinates([driverCoordinate, targetCoordinate].filter(Boolean));
        setRouteDistanceMeters(Math.round(calculateDistanceKm(driverCoordinate, targetCoordinate) * 1000));
        setRouteDurationSeconds(0);
        setNextInstruction('');
      }
    };

    loadDirections();

    return () => {
      cancelled = true;
    };
  }, [driverCoordinate, ride?.stage, routeCoordinates.length, targetCoordinate]);

  useEffect(() => {
    const nextRegion = buildRegionFromCoordinates([driverCoordinate, targetCoordinate].filter(Boolean));
    setMapRegion((current) => {
      const latChanged = Math.abs(Number(current?.latitude || 0) - Number(nextRegion.latitude || 0));
      const lngChanged = Math.abs(Number(current?.longitude || 0) - Number(nextRegion.longitude || 0));
      const latDeltaChanged = Math.abs(Number(current?.latitudeDelta || 0) - Number(nextRegion.latitudeDelta || 0));
      const lngDeltaChanged = Math.abs(Number(current?.longitudeDelta || 0) - Number(nextRegion.longitudeDelta || 0));

      if (
        latChanged < 0.0001 &&
        lngChanged < 0.0001 &&
        latDeltaChanged < 0.0001 &&
        lngDeltaChanged < 0.0001
      ) {
        return current;
      }

      return nextRegion;
    });
  }, [driverCoordinate, targetCoordinate]);

  useEffect(() => {
    const coordinatesToFit = getRoutePreviewCoordinates(routeCoordinates, driverCoordinate, targetCoordinate);

    if (!mapReadyRef.current || !mapRef.current || coordinatesToFit.length < 2) return;

    const stageChanged = lastAutoFocusStageRef.current !== String(ride?.stage || '');
    if (hasAutoFocusedRef.current && !stageChanged) return;

    const timeout = setTimeout(() => {
      try {
        console.log(TRIP_DEBUG_PREFIX, 'fitToCoordinates start', {
          coordinateCount: coordinatesToFit.length,
          stage: ride?.stage || null,
        });
        mapRef.current?.fitToCoordinates(coordinatesToFit, {
          edgePadding: { top: 90, right: 28, bottom: 180, left: 28 },
          animated: true,
        });
        hasAutoFocusedRef.current = true;
        lastAutoFocusStageRef.current = String(ride?.stage || '');
        console.log(TRIP_DEBUG_PREFIX, 'fitToCoordinates success');
      } catch {
        console.log(TRIP_DEBUG_PREFIX, 'fitToCoordinates failed');
        // Avoid hard-crashing the trip screen if the native map rejects a fit request.
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [ride?.stage, routeCoordinates.length, targetCoordinate]);

  // Live distance from current position to the active target so it updates every location tick.
  const distanceKmText = useMemo(() => {
    const kilometers = routeDistanceMeters > 0
      ? routeDistanceMeters / 1000
      : calculateDistanceKm(driverCoordinate, targetCoordinate);
    return `${Math.max(0, kilometers).toFixed(1)} km left`;
  }, [driverCoordinate, routeDistanceMeters, targetCoordinate]);

  const etaText = useMemo(() => {
    if (routeDurationSeconds > 0) {
      return `${Math.max(1, Math.round(routeDurationSeconds / 60))} min away`;
    }
    const fallbackMinutes = Math.max(1, Math.round(calculateDistanceKm(driverCoordinate, targetCoordinate) * 4));
    return `${fallbackMinutes} min away`;
  }, [driverCoordinate, routeDurationSeconds, targetCoordinate]);

  const pickupWaitRemainingSeconds = useMemo(() => {
    if (ride?.stage !== 'waiting_for_customer') return null;
    const arrivedAtMs = parseTimestampMs(ride?.arrivedAt);
    if (!arrivedAtMs) return PICKUP_WAIT_SECONDS;
    const elapsedSeconds = Math.floor((nowTick - arrivedAtMs) / 1000);
    return Math.max(0, PICKUP_WAIT_SECONDS - elapsedSeconds);
  }, [nowTick, ride?.arrivedAt, ride?.stage]);
  const pickupWaitCountdownText = pickupWaitRemainingSeconds === null ? '' : formatCountdown(pickupWaitRemainingSeconds);
  const pickupWaitExpired = pickupWaitRemainingSeconds === 0;

  const handleMarkArrived = useCallback(async () => {
    try {
      if (!ride?.id) return;
      setSubmitting(true);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      await markDriverCurrentRideArrived(token, ride.id, { suppressAuthErrorHandler: true });
      setRide((current) => (current ? { ...current, stage: 'waiting_for_customer', arrivedAt: new Date().toISOString() } : current));
      setRealtimeSignal((current) => current + 1);
      getDriverCurrentRide(token, { suppressAuthErrorHandler: true })
        .then((data) => {
          setRide(data?.ride || null);
        })
        .catch(() => {
          // Keep the action successful even if the follow-up refresh fails.
        });
    } catch (error) {
      Alert.alert('Arrive failed', error?.message || 'Could not update ride status.');
    } finally {
      setSubmitting(false);
    }
  }, [ride?.id]);

  useEffect(() => {
    if (autoArrivalTimerRef.current) {
      clearTimeout(autoArrivalTimerRef.current);
      autoArrivalTimerRef.current = null;
    }

    if (ride?.stage !== 'to_pickup') {
      autoArrivalRideIdRef.current = null;
      return undefined;
    }
    if (!ride?.id || !driverCoordinate || !pickupCoordinate || submitting) return undefined;
    if (autoArrivalRideIdRef.current === ride.id) return undefined;

    const distanceToPickupMeters = calculateDistanceKm(driverCoordinate, pickupCoordinate) * 1000;
    if (!Number.isFinite(distanceToPickupMeters) || distanceToPickupMeters > AUTO_ARRIVAL_DISTANCE_METERS) {
      return undefined;
    }

    autoArrivalTimerRef.current = setTimeout(() => {
      autoArrivalTimerRef.current = null;
      if (autoArrivalRideIdRef.current === ride.id) return;
      autoArrivalRideIdRef.current = ride.id;
      handleMarkArrived();
    }, AUTO_ARRIVAL_STABLE_MS);

    return () => {
      if (autoArrivalTimerRef.current) {
        clearTimeout(autoArrivalTimerRef.current);
        autoArrivalTimerRef.current = null;
      }
    };
  }, [driverCoordinate, handleMarkArrived, pickupCoordinate, ride?.id, ride?.stage, submitting]);

  const handleStartRide = async () => {
    try {
      if (!ride?.id) return;
      setSubmitting(true);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      await startDriverCurrentRide(token, ride.id, { suppressAuthErrorHandler: true });
      setRide((current) => (current ? { ...current, stage: 'on_trip' } : current));
      setRealtimeSignal((current) => current + 1);
      getDriverCurrentRide(token, { suppressAuthErrorHandler: true })
        .then((data) => {
          setRide(data?.ride || null);
        })
        .catch(() => {
          // Keep the action successful even if the follow-up refresh fails.
        });
    } catch (error) {
      Alert.alert('Start ride failed', error?.message || 'Could not start the ride.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRide = useCallback(() => {
    if (!ride?.id || cancellingRide || submitting) return;

    const preferredReasons = [
      DRIVER_CANCELLATION_REASONS.find((item) => item.id === 'passenger_no_show')?.label,
      DRIVER_CANCELLATION_REASONS.find((item) => item.id === 'safety_concern')?.label,
      DRIVER_CANCELLATION_REASONS.find((item) => item.id === 'other')?.label,
    ].filter(Boolean);

    Alert.alert(
      'Cancel ride',
      'Are you sure you want to cancel this ride?',
      [
        { text: 'Keep ride', style: 'cancel' },
        ...preferredReasons.slice(0, 2).map((reasonLabel) => ({
          text: reasonLabel,
          onPress: async () => {
            try {
              setCancellingRide(true);
              const token = await getTokenRef.current();
              if (!token) throw new Error('Not signed in');
              await cancelDriverCurrentRide(token, ride.id, reasonLabel);
              stopDriverVoice();
              setRouteCoordinates([]);
              setRouteDistanceMeters(0);
              setRouteDurationSeconds(0);
              setNextInstruction('');
              setRide(null);
              setRealtimeSignal((current) => current + 1);
              Alert.alert('Ride cancelled', 'The ride has been cancelled.');
              const parentNavigator = navigation.getParent?.();
              if (parentNavigator) parentNavigator.navigate('DriverActivity');
              else navigation.goBack();
            } catch (error) {
              Alert.alert('Cancel ride failed', error?.message || 'Could not cancel this ride.');
            } finally {
              setCancellingRide(false);
            }
          },
          style: 'destructive',
        })),
      ],
    );
  }, [cancellingRide, navigation, ride?.id, stopDriverVoice, submitting]);

  const handleCompleteRide = async () => {
    try {
      if (!ride?.id) return;
      setSubmitting(true);
      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      await completeDriverCurrentRide(token, ride.id, {
        completedRoutePolyline: null,
      }, { suppressAuthErrorHandler: true });
      stopDriverVoice();
      setRouteCoordinates([]);
      setRouteDistanceMeters(0);
      setRouteDurationSeconds(0);
      setNextInstruction('');
      setCompletedRideSnapshot({
        ...ride,
        status: 'completed',
        completedAt: new Date().toISOString(),
        totalAmount: Number(ride.estimatedAmount || 0) + Number(ride.tipAmount || 0),
      });
      setCompletedRideId(ride.id);
      setRide(null);
      setRealtimeSignal((current) => current + 1);
      setShowPassengerRating(true);
    } catch (error) {
      Alert.alert('Complete ride failed', error?.message || 'Could not complete the ride.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitPassengerRating = async () => {
    if (passengerRating < 1 || passengerRating > 5) {
      Alert.alert('Choose a rating', 'Select between 1 and 5 stars.');
      return;
    }
    try {
      setSubmittingRating(true);
      const token = await getTokenRef.current();
      if (!token || !completedRideId) throw new Error('Not signed in');
      await submitDriverPassengerRating(token, completedRideId, { rating: passengerRating, review: passengerReview.trim() || undefined });
      exitPassengerRatingFlow();
    } catch (error) {
      Alert.alert('Rating failed', error?.message || 'Could not submit rating.');
    } finally {
      setSubmittingRating(false);
    }
  };

  const handleSkipPassengerRating = () => {
    exitPassengerRatingFlow();
  };

  const handleToggleVoiceGuidance = async () => {
    const nextValue = !voiceGuidanceEnabled;
    setVoiceGuidanceEnabled(nextValue);
    if (!nextValue) {
      Speech.stop();
    } else if (ride?.stage === 'waiting_for_customer') {
      Speech.speak('You have arrived at the pickup point.', {
        rate: 0.95,
        pitch: 1.0,
        language: 'en',
      });
    } else if (nextInstruction) {
      Speech.speak(normalizeInstructionForSpeech(nextInstruction), {
        rate: 0.95,
        pitch: 1.0,
        language: 'en',
      });
    }
    try {
      await AsyncStorage.setItem(DRIVER_VOICE_GUIDANCE_KEY, nextValue ? 'true' : 'false');
    } catch {
      // Keep the toggle working even if persistence fails.
    }
  };

  if (loading) {
    return <DriverTripLoadingState color={PRIMARY_BLUE} />;
  }

  const ratingRide = ride || completedRideSnapshot;

  if (showPassengerRating && completedRideId && ratingRide) {
    const fareAmount = Number(ratingRide.estimatedAmount || 0);
    const tipAmount = Number(ratingRide.tipAmount || 0);
    const totalAmount = Number(ratingRide.totalAmount || (fareAmount + tipAmount));
    return (
      <DriverTripReceiptView
        insets={insets}
        ratingRide={ratingRide}
        fareAmount={fareAmount}
        tipAmount={tipAmount}
        totalAmount={totalAmount}
        passengerRating={passengerRating}
        passengerReview={passengerReview}
        submittingRating={submittingRating}
        onSetPassengerRating={setPassengerRating}
        onSetPassengerReview={setPassengerReview}
        onSubmit={handleSubmitPassengerRating}
        onSkip={handleSkipPassengerRating}
        formatCurrency={formatCurrency}
        formatDateTime={formatDateTime}
      />
    );
  }

  if (!ride) {
    return <DriverTripEmptyState onBack={() => navigation.goBack()} />;
  }

  const safeRouteCoordinates = normalizeCoordinates(routeCoordinates);
  const destinationForMaps = ride.stage === 'on_trip' ? dropoffCoordinate : pickupCoordinate;
  const destinationLabelForMaps = ride.stage === 'on_trip' ? ride.dropoffLabel : ride.pickupLabel;
  let passengerProfileImageUrl = null;
  try {
    passengerProfileImageUrl = resolveUploadedMediaUrl(ride.passengerProfileImageUrl);
  } catch (error) {
    console.log(TRIP_DEBUG_PREFIX, 'resolveUploadedMediaUrl failed', {
      message: error?.message || 'unknown error',
      rawValue: ride?.passengerProfileImageUrl,
    });
  }
  const isWaitingAtPickup = ride.stage === 'waiting_for_customer';
  const stageTitle = ride.stage === 'on_trip' ? 'Drive' : isWaitingAtPickup ? 'Pickup wait' : 'To pickup';
  const targetLabel = ride.stage === 'on_trip' ? ride.dropoffLabel : ride.pickupLabel;
  const primaryMetric = isWaitingAtPickup ? pickupWaitCountdownText : etaText;
  const secondaryMetric = isWaitingAtPickup
    ? pickupWaitExpired
      ? 'Wait time ended'
      : 'Passenger pickup timer'
    : distanceKmText;
  const guidanceText = normalizeInstructionForSpeech(nextInstruction) || (ride.stage === 'on_trip'
    ? `Continue toward ${ride.dropoffLabel || 'the drop-off point'}`
    : `Continue toward ${ride.pickupLabel || 'the pickup point'}`);

  const handleOpenExternalNavigation = async () => {
    try {
      const fallbackLink = toExternalNavigationLink(destinationLabelForMaps, destinationForMaps);
      const candidateUrls = toExternalNavigationUrls(destinationLabelForMaps, destinationForMaps);
      if (!fallbackLink || !candidateUrls.length) {
        Alert.alert('Navigation unavailable', 'Could not open navigation for this trip.');
        return;
      }

      for (const url of candidateUrls) {
        const supported = await Linking.canOpenURL(url);
        if (supported) {
          await Linking.openURL(url);
          return;
        }
      }

      await Linking.openURL(fallbackLink);
    } catch {
      Alert.alert('Navigation unavailable', 'Could not open a navigation app right now.');
    }
  };

  const handleCallPassenger = async () => {
    const phone = String(ride?.passengerPhone || '').trim();
    if (!phone) {
      Alert.alert('Call unavailable', 'No passenger phone number is available for this ride.');
      return;
    }

    const phoneUrl = `tel:${phone.replace(/[^\d+]/g, '')}`;
    try {
      const supported = await Linking.canOpenURL(phoneUrl);
      if (!supported) {
        Alert.alert('Call unavailable', 'Your device could not open the phone dialer.');
        return;
      }
      await Linking.openURL(phoneUrl);
    } catch {
      Alert.alert('Call unavailable', 'Could not open the phone dialer right now.');
    }
  };

  return (
    <DriverTripMapPanel
      mapRef={mapRef}
      mapRegion={mapRegion}
      onMapReady={() => {
        mapReadyRef.current = true;
        console.log(TRIP_DEBUG_PREFIX, 'map ready');
      }}
      driverCoordinate={driverCoordinate}
      pickupCoordinate={pickupCoordinate}
      dropoffCoordinate={dropoffCoordinate}
      safeRouteCoordinates={safeRouteCoordinates}
      primaryBlue={PRIMARY_BLUE}
      insets={insets}
      targetLabel={targetLabel}
      voiceGuidanceEnabled={voiceGuidanceEnabled}
      onToggleVoiceGuidance={handleToggleVoiceGuidance}
      showCallPassenger={ride.stage === 'waiting_for_customer'}
      onCallPassenger={handleCallPassenger}
      onOpenChat={() => navigation.navigate('RideChat', {
        rideRequestId: ride.id,
        role: 'driver',
        chatTitle: ride.passengerName || 'Passenger chat',
      })}
      onOpenExternalNavigation={handleOpenExternalNavigation}
      tripPanelMaxHeight={TRIP_PANEL_MAX_HEIGHT}
      onCenterDriver={() => {
        if (!mapRef.current || !driverCoordinate) return;
        mapRef.current.animateCamera?.({ center: driverCoordinate, zoom: 17 }, { duration: 450 });
      }}
      stageTitle={stageTitle}
      primaryMetric={primaryMetric}
      secondaryMetric={secondaryMetric}
      fareText={formatCurrency(ride.estimatedAmount)}
      passengerProfileImageUrl={passengerProfileImageUrl}
      passengerName={ride.passengerName}
      passengerSubtitle={ride.passengerPhone || targetLabel}
      guidanceText={guidanceText}
      showGuidance={Boolean(ride.stage === 'on_trip' || nextInstruction)}
      showMarkArrived={ride.stage === 'to_pickup'}
      showStartRide={ride.stage === 'waiting_for_customer'}
      showCompleteRide={ride.stage === 'on_trip'}
      showCancelRide={ride.stage === 'waiting_for_customer' || ride.stage === 'on_trip'}
      submitting={submitting}
      cancellingRide={cancellingRide}
      onMarkArrived={handleMarkArrived}
      onStartRide={handleStartRide}
      onCompleteRide={handleCompleteRide}
      onCancelRide={handleCancelRide}
    />
  );
}
