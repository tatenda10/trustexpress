import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, Linking, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDirectionsRoute, getHireRequest, updateDriverAvailability, updateHireBookingStatus } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { hireContactHref, isLiveHireBooking } from '../../constants/hire';
import { paymentMethodLabel } from '../../constants/payment';
import { connectRealtime } from '../../realtime';
import { DriverTripEmptyState, DriverTripLoadingState, DriverTripMapPanel } from './components/DriverTripComponents';

const FALLBACK_COORDINATE = { latitude: -20.1535, longitude: 28.5870 };
const TRIP_PANEL_MAX_HEIGHT = Math.round(Dimensions.get('window').height * 0.34);

function toCoordinate(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function toCoord(value) {
  return toCoordinate(value?.latitude, value?.longitude);
}

function distanceKm(start, end) {
  const from = toCoord(start);
  const to = toCoord(end);
  if (!from || !to) return 0;
  const toRad = (n) => (n * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export default function DriverHireTripScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const mapRef = useRef(null);
  const watchRef = useRef(null);

  const requestId = route.params?.requestId;
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [request, setRequest] = useState(null);
  const [booking, setBooking] = useState(null);
  const [passenger, setPassenger] = useState(null);
  const [driverCoordinate, setDriverCoordinate] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeMinutes, setRouteMinutes] = useState(0);
  const [routeDistanceKm, setRouteDistanceKm] = useState(0);

  const pickupCoordinate = toCoordinate(request?.pickupLat, request?.pickupLng);
  const dropoffCoordinate = toCoordinate(request?.dropoffLat, request?.dropoffLng);
  const bookingStatus = String(booking?.status || '').toLowerCase();
  const onTrip = bookingStatus === 'in_progress';
  const waiting = bookingStatus === 'driver_arrived';
  const canContactPassenger = isLiveHireBooking(bookingStatus) && !!passenger?.phone;
  const targetCoordinate = onTrip ? dropoffCoordinate : pickupCoordinate;
  const targetLabel = onTrip
    ? (request?.dropoffLabel || 'Drop-off')
    : (request?.pickupLabel || 'Pickup');

  const load = useCallback(async () => {
    try {
      const token = await getTokenRef.current({ skipCache: true });
      const data = await getHireRequest(token, requestId);
      setRequest(data?.request || null);
      setBooking(data?.booking || null);
      setPassenger(data?.passenger || null);
      const live = toCoord(data?.driverCoordinate || data?.driver?.coordinate);
      if (live) setDriverCoordinate((current) => current || live);
    } catch (error) {
      Alert.alert('Hire trip', error?.message || 'Could not load this hire job.');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    let socket = null;
    (async () => {
      try {
        const token = await getTokenRef.current({ skipCache: true });
        socket = connectRealtime(token);
        socket.on('hire_booking:updated', (payload) => {
          if (cancelled) return;
          if (Number(payload?.hireRequestId) !== Number(requestId)) return;
          if (payload?.status) {
            setBooking((current) => (current ? { ...current, status: payload.status } : current));
          }
        });
      } catch {
        // Keep polling via focus/load.
      }
    })();
    return () => {
      cancelled = true;
      socket?.off?.('hire_booking:updated');
    };
  }, [load, requestId]);

  useEffect(() => {
    let active = true;
    const publishLocation = async (coordinate) => {
      const token = await getTokenRef.current();
      await updateDriverAvailability(token, {
        isOnline: true,
        forHire: true,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
      });
    };
    const startWatch = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!active) return;
      if (permission.status !== 'granted') {
        Alert.alert('Location needed', 'Turn on location so the passenger can see you on the hire map.');
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coordinate = toCoordinate(current?.coords?.latitude, current?.coords?.longitude);
      if (coordinate && active) {
        setDriverCoordinate(coordinate);
        try {
          await publishLocation(coordinate);
        } catch {
          // Watch ticks retry.
        }
      }
      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 8 },
        async (position) => {
          const next = toCoordinate(position?.coords?.latitude, position?.coords?.longitude);
          if (!next || !active) return;
          setDriverCoordinate(next);
          try {
            await publishLocation(next);
          } catch {
            // Next GPS tick retries.
          }
        },
      );
    };
    startWatch();
    return () => {
      active = false;
      watchRef.current?.remove?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const origin = driverCoordinate;
    const destination = targetCoordinate;
    if (!origin || !destination) return undefined;
    const loadRoute = async () => {
      try {
        const token = await getTokenRef.current();
        const data = await getDirectionsRoute(token, {
          origin,
          destination,
          cachePrecision: 3,
          cacheTtlSeconds: 30,
        });
        if (cancelled) return;
        const coordinates = Array.isArray(data?.route?.coordinates) ? data.route.coordinates : [];
        setRouteCoordinates(coordinates);
        setRouteMinutes(Number(data?.route?.durationMinutes || Math.max(1, Math.round(distanceKm(origin, destination) * 4))));
        setRouteDistanceKm(Number(data?.route?.distanceKm || distanceKm(origin, destination)));
      } catch {
        if (!cancelled) {
          setRouteCoordinates([origin, destination]);
          setRouteDistanceKm(distanceKm(origin, destination));
          setRouteMinutes(Math.max(1, Math.round(distanceKm(origin, destination) * 4)));
        }
      }
    };
    loadRoute();
    return () => {
      cancelled = true;
    };
  }, [driverCoordinate?.latitude, driverCoordinate?.longitude, targetCoordinate?.latitude, targetCoordinate?.longitude]);

  const mapRegion = useMemo(() => {
    const center = driverCoordinate || pickupCoordinate || FALLBACK_COORDINATE;
    return {
      ...center,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    };
  }, [driverCoordinate, pickupCoordinate]);

  const updateStatus = async (status, successMessage) => {
    if (!booking?.id) return;
    try {
      setSubmitting(true);
      const token = await getTokenRef.current({ skipCache: true });
      const data = await updateHireBookingStatus(token, booking.id, status);
      setBooking(data?.booking || { ...booking, status });
      if (successMessage) Alert.alert('Hire trip', successMessage);
      if (status === 'completed' || status === 'cancelled') navigation.goBack();
    } catch (error) {
      Alert.alert('Could not update trip', error?.message || 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <DriverTripLoadingState color={PRIMARY_BLUE} />;
  if (!booking) {
    return <DriverTripEmptyState onBack={() => navigation.goBack()} />;
  }

  const stageTitle = onTrip
    ? 'On trip'
    : waiting
      ? 'Waiting for passenger'
      : 'Heading to pickup';

  return (
    <View className="flex-1 bg-[#eef2f7]">
      <DriverTripMapPanel
        mapRef={mapRef}
        mapRegion={mapRegion}
        onMapReady={() => {}}
        driverCoordinate={driverCoordinate}
        pickupCoordinate={pickupCoordinate}
        dropoffCoordinate={dropoffCoordinate}
        intermediateStops={[]}
        currentStopIndex={0}
        safeRouteCoordinates={routeCoordinates}
        vehicleHeadingDegrees={0}
        primaryBlue={PRIMARY_BLUE}
        insets={insets}
        targetLabel={targetLabel}
        voiceGuidanceEnabled={false}
        onToggleVoiceGuidance={() => {}}
        showCallPassenger={canContactPassenger}
        onCallPassenger={() => {
          const href = hireContactHref(passenger?.phone, 'tel');
          if (href) Linking.openURL(href);
        }}
        onSendPanicAlert={() => Alert.alert('Support', 'Use Account → Support if you need help on this hire job.')}
        onOpenChat={() => {
          const href = hireContactHref(passenger?.phone, 'sms');
          if (href) Linking.openURL(href);
        }}
        onOpenExternalNavigation={() => {
          if (!targetCoordinate) return;
          Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${targetCoordinate.latitude},${targetCoordinate.longitude}`);
        }}
        tripPanelMaxHeight={TRIP_PANEL_MAX_HEIGHT}
        onCenterDriver={() => {
          if (!driverCoordinate) return;
          mapRef.current?.animateToRegion?.({
            ...driverCoordinate,
            latitudeDelta: 0.012,
            longitudeDelta: 0.012,
          });
        }}
        stageTitle={stageTitle}
        primaryMetric={`${routeDistanceKm.toFixed(1)} km`}
        secondaryMetric={`${Math.max(1, Math.round(routeMinutes))} min`}
        fareText={`${booking?.currency || request?.fareCurrency || 'USD'} ${Number(booking?.amount || request?.passengerOfferAmount || 0).toFixed(2)}`}
        passengerProfileImageUrl={null}
        passengerName={passenger?.name || 'Passenger'}
        passengerSubtitle={[
          paymentMethodLabel(request?.paymentMethod),
          canContactPassenger ? passenger?.phone : null,
        ].filter(Boolean).join(' · ') || 'Hire passenger'}
        passengerConfirmationText={null}
        safetyPinReminderText={null}
        stopTimeline={[request?.pickupLabel, request?.dropoffLabel].filter(Boolean)}
        remainingIntermediateStopsCount={0}
        guidanceText={onTrip ? 'Follow the route to drop-off.' : 'Follow the route to the passenger.'}
        showGuidance
        showMarkArrived={bookingStatus === 'confirmed'}
        showStartRide={waiting}
        startRideLabel="Start Ride"
        startRideDisabled={false}
        showAdvanceStop={false}
        advanceStopLabel=""
        showCompleteRide={onTrip}
        showCancelRide
        submitting={submitting}
        cancellingRide={false}
        onMarkArrived={() => updateStatus('driver_arrived')}
        onStartRide={() => updateStatus('in_progress')}
        onAdvanceStop={() => {}}
        onCompleteRide={() => updateStatus('completed', 'Hire job completed. It is saved in Account → Income.')}
        onCancelRide={() => updateStatus('cancelled', 'This hire job was cancelled.')}
        submittingPanicAlert={false}
      />
    </View>
  );
}
