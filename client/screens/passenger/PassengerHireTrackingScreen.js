import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline } from '../../components/maps/MapViewCompat';
import DriverVehicleMapMarker from '../../components/maps/DriverVehicleMapMarker';
import { getDirectionsRoute, getHireRequest } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';
import { hireContactHref, isLiveHireBooking } from '../../constants/hire';
import { paymentMethodLabel } from '../../constants/payment';
import { connectRealtime } from '../../realtime';

const FALLBACK_COORDINATE = { latitude: -20.1535, longitude: 28.5870 };

function toCoordinate(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function toCoord(value) {
  return toCoordinate(value?.latitude, value?.longitude);
}

function stageCopy(stage) {
  if (stage === 'waiting_at_pickup') return 'Driver has arrived';
  if (stage === 'on_trip') return 'On the way to drop-off';
  if (stage === 'completed') return 'Hire completed';
  if (stage === 'cancelled') return 'Hire cancelled';
  return 'Driver is on the way';
}

export default function PassengerHireTrackingScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const requestId = route.params?.requestId;
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(null);
  const [booking, setBooking] = useState(null);
  const [driver, setDriver] = useState(null);
  const [passengerStage, setPassengerStage] = useState('driver_on_the_way');
  const [driverCoordinate, setDriverCoordinate] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [etaMinutes, setEtaMinutes] = useState(0);
  const mapRef = useRef(null);

  const hireVehicle = driver?.vehicle || booking?.vehicle || null;
  const pickupCoordinate = toCoordinate(request?.pickupLat, request?.pickupLng);
  const dropoffCoordinate = toCoordinate(request?.dropoffLat, request?.dropoffLng);
  const onTrip = passengerStage === 'on_trip';
  const canContactDriver = isLiveHireBooking(booking?.status) && !!driver?.phone;
  const targetCoordinate = onTrip ? dropoffCoordinate : pickupCoordinate;
  const targetLabel = onTrip ? (request?.dropoffLabel || 'Drop-off') : (request?.pickupLabel || 'Pickup');

  const load = useCallback(async () => {
    try {
      const token = await getTokenRef.current({ skipCache: true });
      const data = await getHireRequest(token, requestId);
      setRequest(data?.request || null);
      setBooking(data?.booking || null);
      setDriver(data?.driver || null);
      setPassengerStage(data?.passengerStage || 'driver_on_the_way');
      const live = toCoord(data?.driverCoordinate || data?.driver?.coordinate);
      if (live) setDriverCoordinate(live);
    } catch (error) {
      Alert.alert('Hire trip', error?.message || 'Could not load this hire job.');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    load();
    const finished = ['completed', 'cancelled'].includes(String(booking?.status || passengerStage || '').toLowerCase());
    if (finished) return undefined;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load, booking?.status, passengerStage]);

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
          if (payload?.passengerStage) setPassengerStage(payload.passengerStage);
          const live = toCoord(payload?.driverCoordinate);
          if (live) setDriverCoordinate(live);
          if (payload?.status) {
            setBooking((current) => (current ? { ...current, status: payload.status } : current));
          }
        });
      } catch {
        // Polling still covers updates.
      }
    })();
    return () => {
      cancelled = true;
      socket?.off?.('hire_booking:updated');
    };
  }, [requestId]);

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
        setRouteCoordinates(Array.isArray(data?.route?.coordinates) ? data.route.coordinates : [origin, destination]);
        setEtaMinutes(Number(data?.route?.durationMinutes || 1));
      } catch {
        if (!cancelled) {
          setRouteCoordinates([origin, destination]);
          setEtaMinutes(1);
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
    return { ...center, latitudeDelta: 0.05, longitudeDelta: 0.05 };
  }, [driverCoordinate, pickupCoordinate]);

  useEffect(() => {
    if (!driverCoordinate) return;
    mapRef.current?.animateToRegion?.({
      ...driverCoordinate,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    }, 400);
  }, [driverCoordinate?.latitude, driverCoordinate?.longitude]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color={PRIMARY_BLUE} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#eef2f7]">
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={mapRegion}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {driverCoordinate ? <DriverVehicleMapMarker coordinate={driverCoordinate} /> : null}
        {pickupCoordinate ? (
          <Marker coordinate={pickupCoordinate} title="Pickup" pinColor="#1d4ed8" tracksViewChanges={false} />
        ) : null}
        {dropoffCoordinate ? (
          <Marker coordinate={dropoffCoordinate} title="Drop-off" pinColor="#111827" tracksViewChanges={false} />
        ) : null}
        {routeCoordinates.length > 1 ? (
          <Polyline coordinates={routeCoordinates} strokeColor="#4c1d95" strokeWidth={6} />
        ) : null}
      </MapView>

      <View className="absolute left-4 right-4" style={{ top: insets.top + 10 }}>
        <View className="flex-row items-center rounded-2xl bg-white px-3 py-3">
          <TouchableOpacity onPress={() => navigation.goBack()} className="h-10 w-10 items-center justify-center rounded-full bg-slate-100">
            <Ionicons name="chevron-back" size={20} color="#111827" />
          </TouchableOpacity>
          <View className="ml-3 flex-1">
            <Text className="text-xs font-bold uppercase text-slate-400">Heading to</Text>
            <Text className="text-base font-bold text-gray-900" numberOfLines={1}>{targetLabel}</Text>
          </View>
        </View>
      </View>

      <View
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-white px-5 pt-4"
        style={{ paddingBottom: insets.bottom + 20 }}
      >
        <Text className="text-2xl font-extrabold text-gray-950">{stageCopy(passengerStage)}</Text>
        <Text className="mt-1 text-base font-semibold text-gray-500">
          {Math.max(1, Math.round(etaMinutes))} min · {paymentMethodLabel(request?.paymentMethod) || 'Hire'}
        </Text>
        <View className="mt-4 flex-row items-center rounded-2xl bg-gray-50 px-4 py-3">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-[#e0e7ff]">
            <Ionicons name="car" size={22} color={PRIMARY_BLUE} />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-base font-bold text-gray-900">{driver?.name || 'Driver'}</Text>
            <Text className="mt-0.5 text-sm text-gray-500" numberOfLines={1}>
              {[hireVehicle?.make, hireVehicle?.model, hireVehicle?.title, hireVehicle?.numberPlate]
                .filter(Boolean)
                .join(' · ') || 'Assigned hire driver'}
            </Text>
          </View>
          {canContactDriver ? (
            <View className="ml-2 flex-row">
              <TouchableOpacity
                onPress={() => {
                  const href = hireContactHref(driver.phone, 'tel');
                  if (href) Linking.openURL(href);
                }}
                className="h-11 w-11 items-center justify-center rounded-full bg-green-50"
              >
                <Ionicons name="call-outline" size={20} color="#15803d" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const href = hireContactHref(driver.phone, 'sms');
                  if (href) Linking.openURL(href);
                }}
                className="ml-2 h-11 w-11 items-center justify-center rounded-full bg-slate-100"
              >
                <Ionicons name="chatbubble-ellipses-outline" size={20} color="#111827" />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
        {booking?.amount != null ? (
          <Text className="mt-3 text-sm font-semibold text-gray-700">
            Fare {booking.currency || 'USD'} {Number(booking.amount).toFixed(2)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
