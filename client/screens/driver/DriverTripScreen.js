import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, ScrollView, Dimensions, TextInput, Platform, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline } from 'react-native-maps';
import {
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
import { connectRealtime } from '../../realtime';
import {
  hideTripOverlay,
  isTripOverlaySupported,
  openTripOverlaySettings,
  showTripOverlay,
} from '../../services/tripOverlay';

const ROUTE_REFRESH_DISTANCE_METERS = 2000;
const ROUTE_REFRESH_MIN_INTERVAL_MS = 90000;
const LOCATION_UPDATE_DISTANCE_METERS = 35;
const LOCATION_UPDATE_INTERVAL_MS = 12000;
const TRIP_PANEL_MAX_HEIGHT = Math.round(Dimensions.get('window').height * 0.38);
const TRIP_STATUS_REFRESH_MS = 8000;
const PICKUP_WAIT_SECONDS = 5 * 60;
const DRIVER_VOICE_GUIDANCE_KEY = 'trust_express_driver_voice_guidance';
const DEFAULT_LAT_DELTA = 0.03;
const DEFAULT_LNG_DELTA = 0.03;
const DRIVER_FOLLOW_LAT_DELTA = 0.012;
const DRIVER_FOLLOW_LNG_DELTA = 0.012;
const SPEECH_MIN_INTERVAL_MS = 3500;
const SPEECH_STABILIZE_MS = 900;
const SPEECH_MIN_CHARS = 8;

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
  const valid = coordinates.filter(Boolean);
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
  if (Array.isArray(routeCoordinates) && routeCoordinates.length > 1) {
    return [driverCoordinate, ...routeCoordinates.slice(0, 18), targetCoordinate].filter(Boolean);
  }
  return [driverCoordinate, targetCoordinate].filter(Boolean);
}

function toGoogleMapsLink(label, coordinate) {
  if (!coordinate) return '';
  const lat = Number(coordinate.latitude);
  const lng = Number(coordinate.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  const query = encodeURIComponent(label ? `${label} (${lat},${lng})` : `${lat},${lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function toGoogleMapsOpenUrls(label, coordinate) {
  if (!coordinate) return [];
  const lat = Number(coordinate.latitude);
  const lng = Number(coordinate.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const encodedLabel = encodeURIComponent(String(label || 'Destination'));
  const latLng = `${lat},${lng}`;

  if (Platform.OS === 'android') {
    return [
      `google.navigation:q=${latLng}`,
      `geo:${latLng}?q=${latLng}(${encodedLabel})`,
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${label || 'Destination'} (${lat},${lng})`)}`,
    ];
  }

  return [
    `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`,
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${label || 'Destination'} (${lat},${lng})`)}`,
  ];
}

async function fetchTripDirections(token, origin, destination) {
  if (!token || !origin || !destination) {
    return null;
  }

  const data = await getDirectionsRoute(token, {
    origin,
    destination,
    cacheTtlSeconds: 120,
  });
  const route = data?.route || {};

  return {
    coordinates: Array.isArray(route.coordinates) ? route.coordinates : [],
    distanceMeters: Number(route.distanceMeters || 0),
    durationSeconds: Number(route.durationSeconds || 0),
    nextInstruction: route.nextInstruction || '',
  };
}

export default function DriverTripScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const mapRef = useRef(null);
  const lastRouteOriginRef = useRef(null);
  const lastRouteTargetRef = useRef(null);
  const lastRouteFetchedAtRef = useRef(0);
  const locationSubscriptionRef = useRef(null);
  const routeRequestIdRef = useRef(0);
  const availabilitySyncInFlightRef = useRef(false);
  const rideLoadInFlightRef = useRef(false);
  const hasAutoFocusedRef = useRef(false);
  const lastAutoFocusStageRef = useRef('');
  const lastSpokenInstructionRef = useRef('');
  const lastSpokenAtRef = useRef(0);
  const lastArrivalAnnouncementStageRef = useRef('');
  const speechDebounceTimeoutRef = useRef(null);
  const overlayPermissionPromptedRef = useRef(false);
  const [ride, setRide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(true);
  const [realtimeSignal, setRealtimeSignal] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeDistanceMeters, setRouteDistanceMeters] = useState(0);
  const [routeDurationSeconds, setRouteDurationSeconds] = useState(0);
  const [nextInstruction, setNextInstruction] = useState('');
  const [liveDriverCoordinate, setLiveDriverCoordinate] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [showPassengerRating, setShowPassengerRating] = useState(false);
  const [completedRideId, setCompletedRideId] = useState(null);
  const [completedRideSnapshot, setCompletedRideSnapshot] = useState(null);
  const [passengerRating, setPassengerRating] = useState(0);
  const [passengerReview, setPassengerReview] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);

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
      try {
        const token = await getToken();
        if (!token) throw new Error('Not signed in');
        const data = await getDriverCurrentRide(token, { suppressAuthErrorHandler: true });
        if (!active) return;
        if (data?.ride || !showPassengerRating) {
          setRide(data?.ride || null);
        }
        if (data?.ride?.driverCoordinate) {
          setLiveDriverCoordinate(data.ride.driverCoordinate);
        }
      } catch {
        if (!active) return;
        setRide(null);
      } finally {
        rideLoadInFlightRef.current = false;
        if (active) setLoading(false);
      }
    };

    loadRide();
    const interval = setInterval(loadRide, TRIP_STATUS_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [getToken, realtimeSignal, showPassengerRating]);

  useEffect(() => {
    let active = true;
    let localSocket = null;

    const initRealtime = async () => {
      try {
        const token = await getToken();
        if (!active || !token) return;
        localSocket = connectRealtime(token);
        if (!localSocket) return;

        const handleRideUpdate = () => {
          if (!active) return;
          setRealtimeSignal((current) => current + 1);
        };

        localSocket.on('driver_ride:updated', handleRideUpdate);

        localSocket.__driverTripCleanup = () => {
          localSocket.off('driver_ride:updated', handleRideUpdate);
        };
      } catch {
        // Polling remains the fallback.
      }
    };

    initRealtime();

    return () => {
      active = false;
      localSocket?.__driverTripCleanup?.();
      if (speechDebounceTimeoutRef.current) {
        clearTimeout(speechDebounceTimeoutRef.current);
        speechDebounceTimeoutRef.current = null;
      }
      Speech.stop();
    };
  }, [getToken]);

  useEffect(() => {
    const normalizedInstruction = normalizeInstructionForSpeech(nextInstruction);
    if (!voiceGuidanceEnabled) {
      if (speechDebounceTimeoutRef.current) {
        clearTimeout(speechDebounceTimeoutRef.current);
        speechDebounceTimeoutRef.current = null;
      }
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
  }, [nextInstruction, ride?.stage, voiceGuidanceEnabled]);

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
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') return;

        const currentPosition = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
        });
        if (active) {
          const currentCoordinate = {
            latitude: currentPosition.coords.latitude,
            longitude: currentPosition.coords.longitude,
          };
          setLiveDriverCoordinate(currentCoordinate);
          try {
            const token = await getToken();
            if (token && !availabilitySyncInFlightRef.current) {
              availabilitySyncInFlightRef.current = true;
              await updateDriverAvailability(token, {
                isOnline: true,
                latitude: currentCoordinate.latitude,
                longitude: currentCoordinate.longitude,
              });
            }
          } catch {
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

            const nextCoordinate = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            };

            setLiveDriverCoordinate(nextCoordinate);

            try {
              const token = await getToken();
              if (!token || availabilitySyncInFlightRef.current) return;
              availabilitySyncInFlightRef.current = true;
              await updateDriverAvailability(token, {
                isOnline: true,
                latitude: nextCoordinate.latitude,
                longitude: nextCoordinate.longitude,
              });
            } catch {
              // Keep the route screen responsive even if the backend write fails.
            } finally {
              availabilitySyncInFlightRef.current = false;
            }
          }
        );
      } catch {
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
      availabilitySyncInFlightRef.current = false;
    };
  }, [getToken, ride]);

  const driverCoordinate = liveDriverCoordinate || ride?.driverCoordinate || ride?.pickupCoordinate || ride?.dropoffCoordinate;
  const targetCoordinate = ride?.stage === 'on_trip' ? ride?.dropoffCoordinate : ride?.pickupCoordinate;

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
      (movedDistanceMeters < ROUTE_REFRESH_DISTANCE_METERS || routeAgeMs < ROUTE_REFRESH_MIN_INTERVAL_MS)
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
        setRouteLoading(true);
        setRouteError('');
        const token = await getToken();
        const route = await fetchTripDirections(token, driverCoordinate, targetCoordinate);
        if (cancelled || routeRequestIdRef.current !== currentRequestId) return;

        setRouteCoordinates(Array.isArray(route?.coordinates) && route.coordinates.length > 1
          ? route.coordinates
          : [driverCoordinate, targetCoordinate].filter(Boolean));
        setRouteDistanceMeters(route?.distanceMeters || 0);
        setRouteDurationSeconds(route?.durationSeconds || 0);
        setNextInstruction(route?.nextInstruction || '');
      } catch (error) {
        if (cancelled || routeRequestIdRef.current !== currentRequestId) return;
        setRouteCoordinates([driverCoordinate, targetCoordinate].filter(Boolean));
        setRouteDistanceMeters(Math.round(calculateDistanceKm(driverCoordinate, targetCoordinate) * 1000));
        setRouteDurationSeconds(0);
        setNextInstruction('');
        setRouteError(error?.message || 'Could not load Google road directions.');
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
  }, [driverCoordinate, getToken, ride?.stage, routeCoordinates.length, targetCoordinate]);

  useEffect(() => {
    const coordinatesToFit = getRoutePreviewCoordinates(routeCoordinates, driverCoordinate, targetCoordinate);

    if (!mapRef.current || coordinatesToFit.length < 2) return;

    const stageChanged = lastAutoFocusStageRef.current !== String(ride?.stage || '');
    if (hasAutoFocusedRef.current && !stageChanged) return;

    const timeout = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coordinatesToFit, {
        edgePadding: { top: 90, right: 28, bottom: 180, left: 28 },
        animated: true,
      });
      hasAutoFocusedRef.current = true;
      lastAutoFocusStageRef.current = String(ride?.stage || '');
    }, 250);

    return () => clearTimeout(timeout);
  }, [driverCoordinate, ride?.stage, routeCoordinates, targetCoordinate]);

  // Live distance from current position to the active target so it updates every location tick.
  const distanceKmText = useMemo(() => {
    const kilometers = calculateDistanceKm(driverCoordinate, targetCoordinate);
    return `${Math.max(0, kilometers).toFixed(1)} km left`;
  }, [driverCoordinate, targetCoordinate]);

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

  useEffect(() => () => {
    hideTripOverlay();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    if (!ride?.id) {
      hideTripOverlay();
      return undefined;
    }

    let active = true;
    const stageLabel = ride.stage === 'on_trip'
      ? 'On trip'
      : ride.stage === 'waiting_for_customer'
        ? 'At pickup'
        : 'To pickup';
    const targetLabel = ride.stage === 'on_trip'
      ? ride.dropoffLabel
      : ride.pickupLabel;
    const meta = ride.stage === 'waiting_for_customer'
      ? pickupWaitExpired
        ? 'Pickup wait ended'
        : `Pickup wait ${pickupWaitCountdownText}`
      : `${distanceKmText} · ${etaText}`;

    const syncOverlay = async () => {
      const shown = await showTripOverlay({
        title: 'Trust Express',
        subtitle: `${stageLabel}: ${targetLabel || 'Trip route'}`,
        meta,
      });

      if (
        active &&
        !shown &&
        isTripOverlaySupported() &&
        !overlayPermissionPromptedRef.current
      ) {
        overlayPermissionPromptedRef.current = true;
        Alert.alert(
          'Floating trip bubble',
          'Allow Trust Express to display over other apps to show a small active trip bubble while you use navigation.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open settings', onPress: openTripOverlaySettings },
          ],
        );
      }
    };

    syncOverlay();

    return () => {
      active = false;
    };
  }, [distanceKmText, etaText, pickupWaitCountdownText, pickupWaitExpired, ride?.dropoffLabel, ride?.id, ride?.pickupLabel, ride?.stage]);

  const handleMarkArrived = async () => {
    try {
      if (!ride?.id) return;
      setSubmitting(true);
      const token = await getToken();
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
  };

  const handleStartRide = async () => {
    try {
      if (!ride?.id) return;
      setSubmitting(true);
      const token = await getToken();
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

  const handleCompleteRide = async () => {
    try {
      if (!ride?.id) return;
      setSubmitting(true);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await completeDriverCurrentRide(token, ride.id, {
        completedRoutePolyline: null,
      }, { suppressAuthErrorHandler: true });
      setCompletedRideSnapshot(ride);
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
      const token = await getToken();
      if (!token || !completedRideId) throw new Error('Not signed in');
      await submitDriverPassengerRating(token, completedRideId, { rating: passengerRating, review: passengerReview.trim() || undefined });
      navigation.goBack();
    } catch (error) {
      Alert.alert('Rating failed', error?.message || 'Could not submit rating.');
    } finally {
      setSubmittingRating(false);
    }
  };

  const handleSkipPassengerRating = () => {
    navigation.goBack();
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
    return (
      <View className="flex-1 items-center justify-center bg-white px-5">
        <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        <Text className="mt-4 text-base text-gray-500">Loading live trip route...</Text>
      </View>
    );
  }

  const ratingRide = ride || completedRideSnapshot;

  if (showPassengerRating && completedRideId && ratingRide) {
    return (
      <View className="flex-1 bg-white px-5" style={{ paddingTop: insets.top + 24 }}>
        <Text className="text-xl font-bold text-gray-900">Rate your passenger</Text>
        <Text className="mt-1 text-base text-gray-500">{ratingRide.passengerName}</Text>
        <View className="mt-6 flex-row items-center justify-between">
          {[1, 2, 3, 4, 5].map((value) => (
            <TouchableOpacity
              key={value}
              onPress={() => setPassengerRating(value)}
              activeOpacity={0.8}
              className="h-14 w-14 items-center justify-center rounded-full bg-[#f8fafc]"
            >
              <Ionicons
                name={value <= passengerRating ? 'star' : 'star-outline'}
                size={30}
                color={value <= passengerRating ? '#f59e0b' : '#9ca3af'}
              />
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 text-base text-gray-900"
          placeholder="Optional review"
          placeholderTextColor="#9ca3af"
          value={passengerReview}
          onChangeText={setPassengerReview}
          multiline
          numberOfLines={3}
        />
        <TouchableOpacity
          onPress={handleSubmitPassengerRating}
          disabled={submittingRating || passengerRating < 1}
          className="mt-6 h-14 items-center justify-center rounded-xl bg-[#2f73c9]"
          style={{ opacity: passengerRating < 1 ? 0.6 : 1 }}
        >
          {submittingRating ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-lg font-bold text-white">Done</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={handleSkipPassengerRating} className="mt-4 items-center py-3">
          <Text className="text-base text-gray-500">Skip</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!ride) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-5">
        <Text className="text-xl font-bold text-gray-900">No active trip</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} className="mt-6 rounded-[18px] bg-[#2f73c9] px-6 py-4">
          <Text className="text-base font-bold text-white">Back to Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const mapRegion = buildRegionFromCoordinates([
    driverCoordinate,
    targetCoordinate,
  ].filter(Boolean));

  const initialCamera = driverCoordinate ? {
    center: driverCoordinate,
    pitch: 0,
    heading: 0,
    altitude: 1200,
    zoom: 16,
  } : null;

  const destinationForMaps = ride.stage === 'on_trip' ? ride.dropoffCoordinate : ride.pickupCoordinate;
  const destinationLabelForMaps = ride.stage === 'on_trip' ? ride.dropoffLabel : ride.pickupLabel;
  const passengerProfileImageUrl = resolveUploadedMediaUrl(ride.passengerProfileImageUrl);

  const handleOpenGoogleMaps = async () => {
    try {
      const fallbackLink = toGoogleMapsLink(destinationLabelForMaps, destinationForMaps);
      const candidateUrls = toGoogleMapsOpenUrls(destinationLabelForMaps, destinationForMaps);
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
      Alert.alert('Navigation unavailable', 'Could not open Google Maps right now.');
    }
  };

  return (
    <View className="flex-1 bg-white">
      <View className="flex-row items-center justify-between bg-white px-5 pb-3" style={{ paddingTop: insets.top + 8 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} className="h-11 w-11 items-center justify-center rounded-full bg-[#f3f6fb]">
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">
          {ride.stage === 'on_trip' ? 'Google Trip Route' : ride.stage === 'waiting_for_customer' ? 'Waiting for Customer' : 'Google Pickup Route'}
        </Text>
        <View className="w-11" />
      </View>

      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={mapRegion}
        initialCamera={initialCamera || undefined}
        showsCompass={false}
        toolbarEnabled={false}
        rotateEnabled={true}
        showsTraffic={true}
      >
        {driverCoordinate ? (
          <Marker coordinate={driverCoordinate} title="Driver">
            <View className="h-12 w-12 items-center justify-center rounded-full border-4 border-white" style={{ backgroundColor: PRIMARY_BLUE }}>
              <Ionicons name="car-sport" size={22} color="#fff" />
            </View>
          </Marker>
        ) : null}
        <Marker coordinate={ride.pickupCoordinate} title="Pickup" pinColor="#1d4ed8" />
        <Marker coordinate={ride.dropoffCoordinate} title="Drop-off" pinColor="#111827" />
        {routeCoordinates.length > 1 ? (
          <>
            <Polyline
              coordinates={routeCoordinates}
              strokeColor="rgba(32,110,255,0.22)"
              strokeWidth={12}
            />
            <Polyline
              coordinates={routeCoordinates}
              strokeColor={PRIMARY_BLUE}
              strokeWidth={6}
            />
          </>
        ) : null}
      </MapView>

      <View
        className="absolute bottom-0 left-0 right-0 rounded-t-[30px] bg-[#f8fafc]"
        style={{ maxHeight: TRIP_PANEL_MAX_HEIGHT }}
      >
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 }}
        >
          <Text className="text-sm font-semibold uppercase tracking-wide text-[#2f73c9]">
            {ride.stage === 'on_trip' ? 'Destination' : ride.stage === 'waiting_for_customer' ? 'Pickup wait timer' : 'Pickup'}
          </Text>
          <Text className="mt-1 text-[30px] font-bold text-gray-900">
            {ride.stage === 'waiting_for_customer' ? pickupWaitCountdownText : distanceKmText}
          </Text>
          <Text className="mt-1 text-base text-gray-500">
            {ride.stage === 'waiting_for_customer'
              ? pickupWaitExpired
                ? 'Pickup wait time has ended.'
                : `${ride.pickupLabel} - passenger has 5 minutes to come out.`
              : etaText}
          </Text>

          <View className="mt-4 rounded-[22px] bg-white px-4 py-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-semibold uppercase tracking-wide text-gray-400">Directions</Text>
              {routeLoading ? <ActivityIndicator size="small" color={PRIMARY_BLUE} /> : null}
            </View>
            <Text className="mt-2 text-base font-semibold text-gray-900">
              {ride.stage === 'waiting_for_customer'
                ? pickupWaitExpired
                  ? 'Pickup wait time has ended. Message or call the passenger before starting.'
                  : ride.passengerConfirmedAt
                    ? 'Passenger confirmed they\'re coming. Ready to start the ride.'
                    : 'Passenger pickup point reached. Wait for the passenger to come out.'
                : nextInstruction || 'Following the live Google Maps road route.'}
            </Text>
            {routeError ? (
              <Text className="mt-2 text-sm text-amber-600">{routeError}</Text>
            ) : null}
          </View>

          <View className="mt-4 rounded-[24px] bg-white p-5">
            <View className="flex-row items-center">
              {passengerProfileImageUrl ? (
                <Image
                  source={{ uri: passengerProfileImageUrl }}
                  style={{ width: 52, height: 52, borderRadius: 26 }}
                />
              ) : (
                <View className="h-[52px] w-[52px] items-center justify-center rounded-full bg-[#e0e7ff]">
                  <Ionicons name="person" size={22} color={PRIMARY_BLUE} />
                </View>
              )}
              <View className="ml-3 flex-1">
                <Text className="text-xl font-bold text-gray-900">{ride.passengerName}</Text>
                <Text className="mt-1 text-sm text-gray-500">{ride.passengerPhone || 'Phone not shared yet'}</Text>
              </View>
            </View>
            <Text className="mt-4 text-sm font-semibold uppercase text-gray-400">Pickup</Text>
            <Text className="mt-1 text-base font-bold text-gray-900">{ride.pickupLabel}</Text>
            <Text className="mt-4 text-sm font-semibold uppercase text-gray-400">Destination</Text>
            <Text className="mt-1 text-base font-bold text-gray-900">{ride.dropoffLabel}</Text>

            <TouchableOpacity
              onPress={handleOpenGoogleMaps}
              className="mt-5 h-12 items-center justify-center rounded-[18px] border border-blue-200 bg-white"
            >
              <Text style={{ color: PRIMARY_BLUE }} className="text-base font-bold">Open in Google Maps</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate('RideChat', {
                rideRequestId: ride.id,
                role: 'driver',
                chatTitle: ride.passengerName || 'Passenger chat',
              })}
              className="mt-3 h-12 items-center justify-center rounded-[18px] border border-blue-200 bg-white"
            >
              <Text style={{ color: PRIMARY_BLUE }} className="text-base font-bold">Message passenger</Text>
            </TouchableOpacity>
          </View>

          <View className="mt-4 rounded-[20px] border border-[#d7d9df] bg-white px-4 py-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-semibold uppercase tracking-wide text-gray-400">Voice guidance</Text>
              <TouchableOpacity
                onPress={handleToggleVoiceGuidance}
                className={`rounded-full px-3 py-1.5 ${voiceGuidanceEnabled ? 'bg-[#dbeafe]' : 'bg-gray-100'}`}
              >
                <Text className={`text-xs font-bold uppercase ${voiceGuidanceEnabled ? 'text-[#1d4ed8]' : 'text-gray-500'}`}>
                  {voiceGuidanceEnabled ? 'On' : 'Off'}
                </Text>
              </TouchableOpacity>
            </View>
            <Text className="mt-2 text-base font-semibold text-gray-900">
              {!voiceGuidanceEnabled
                ? 'Voice guidance is paused. Turn it back on anytime.'
                : ride.stage === 'waiting_for_customer'
                ? 'Voice guidance will continue when the trip starts moving again.'
                : nextInstruction || 'Turn-by-turn voice guidance is active inside the app.'}
            </Text>
          </View>

          {ride.stage === 'to_pickup' ? (
            <TouchableOpacity
              onPress={handleMarkArrived}
              disabled={submitting}
              className="mt-4 h-14 items-center justify-center rounded-[20px]"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-lg font-bold text-white">Mark Arrived</Text>}
            </TouchableOpacity>
          ) : null}

          {ride.stage === 'waiting_for_customer' ? (
            <TouchableOpacity
              onPress={handleStartRide}
              disabled={submitting}
              className="mt-4 h-14 items-center justify-center rounded-[20px]"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-lg font-bold text-white">Start Ride</Text>}
            </TouchableOpacity>
          ) : null}

          {ride.stage === 'on_trip' ? (
            <TouchableOpacity
              onPress={handleCompleteRide}
              disabled={submitting}
              className="mt-4 h-14 items-center justify-center rounded-[20px]"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-lg font-bold text-white">Complete Ride</Text>}
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}
