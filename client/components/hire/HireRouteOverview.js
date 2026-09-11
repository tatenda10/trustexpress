import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import MapView, { Marker, Polyline } from '../maps/MapViewCompat';
import { getDirectionsRoute } from '../../api';
import { calculateDistanceKm } from '../../lib/mapVehicleHeading';
import { PRIMARY_BLUE } from '../../constants/colors';

function toCoord(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function regionFromPoints(points) {
  if (!points.length) {
    return {
      latitude: -20.1535,
      longitude: 28.587,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    };
  }
  if (points.length === 1) {
    return {
      latitude: points[0].latitude,
      longitude: points[0].longitude,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    };
  }

  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLng = points[0].longitude;
  let maxLng = points[0].longitude;
  points.forEach((point) => {
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLng = Math.min(minLng, point.longitude);
    maxLng = Math.max(maxLng, point.longitude);
  });

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.02),
  };
}

/**
 * Shared hire job map: route line, markers, and full distance.
 */
export default function HireRouteOverview({ request, getToken, height = 260 }) {
  const mapRef = useRef(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [distanceKm, setDistanceKm] = useState(null);
  const [durationMinutes, setDurationMinutes] = useState(null);
  const [loadingRoute, setLoadingRoute] = useState(false);

  const pickup = useMemo(
    () => toCoord(request?.pickupLat, request?.pickupLng),
    [request?.pickupLat, request?.pickupLng]
  );
  const dropoff = useMemo(
    () => toCoord(request?.dropoffLat, request?.dropoffLng),
    [request?.dropoffLat, request?.dropoffLng]
  );

  const straightLineKm = useMemo(() => {
    if (!pickup || !dropoff) return null;
    const km = calculateDistanceKm(pickup, dropoff);
    return Number.isFinite(km) && km > 0 ? km : null;
  }, [pickup, dropoff]);

  useEffect(() => {
    let cancelled = false;

    async function loadRoute() {
      if (!pickup || !dropoff || !getToken) {
        setRouteCoordinates(pickup && dropoff ? [pickup, dropoff] : []);
        setDistanceKm(straightLineKm);
        setDurationMinutes(null);
        return;
      }

      setLoadingRoute(true);
      try {
        const token = await getToken({ skipCache: true });
        if (cancelled) return;
        const data = await getDirectionsRoute(token, {
          origin: pickup,
          destination: dropoff,
          cacheTtlSeconds: 1800,
        });
        if (cancelled) return;
        const coords = Array.isArray(data?.route?.coordinates) ? data.route.coordinates : [];
        const roadKm = Number(data?.route?.distanceKm || 0);
        const mins = Number(data?.route?.durationMinutes || 0);
        if (coords.length > 1) {
          setRouteCoordinates(coords);
        } else {
          setRouteCoordinates([pickup, dropoff]);
        }
        setDistanceKm(roadKm > 0 ? roadKm : straightLineKm);
        setDurationMinutes(mins > 0 ? mins : null);
      } catch {
        if (cancelled) return;
        setRouteCoordinates([pickup, dropoff]);
        setDistanceKm(straightLineKm);
        setDurationMinutes(null);
      } finally {
        if (!cancelled) setLoadingRoute(false);
      }
    }

    loadRoute();
    return () => {
      cancelled = true;
    };
  }, [dropoff, getToken, pickup, straightLineKm]);

  useEffect(() => {
    const points = [
      ...(routeCoordinates.length ? routeCoordinates : []),
      ...(pickup ? [pickup] : []),
      ...(dropoff ? [dropoff] : []),
    ];
    if (!points.length || !mapRef.current) return;
    const region = regionFromPoints(points);
    const timer = setTimeout(() => {
      mapRef.current?.animateToRegion?.(region, 350);
    }, 80);
    return () => clearTimeout(timer);
  }, [dropoff, pickup, routeCoordinates]);

  const displayDistance = distanceKm ?? straightLineKm;
  const hasMap = Boolean(pickup || dropoff);

  return (
    <View>
      <View className="overflow-hidden rounded-[24px] bg-white" style={{ height }}>
        {hasMap ? (
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            initialRegion={regionFromPoints([pickup, dropoff].filter(Boolean))}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            showsCompass={false}
            toolbarEnabled={false}
          >
            {pickup ? (
              <Marker coordinate={pickup} title="Start" pinColor={PRIMARY_BLUE} />
            ) : null}
            {dropoff ? (
              <Marker coordinate={dropoff} title="End" pinColor="#111827" />
            ) : null}
            {routeCoordinates.length > 1 ? (
              <Polyline
                coordinates={routeCoordinates}
                strokeColor={PRIMARY_BLUE}
                strokeWidth={5}
              />
            ) : null}
          </MapView>
        ) : (
          <View className="flex-1 items-center justify-center bg-slate-100 px-6">
            <Text className="text-center text-sm text-gray-500">
              No map pins for this job yet. Locations are listed below.
            </Text>
          </View>
        )}
        {loadingRoute ? (
          <View className="absolute bottom-3 right-3 rounded-full bg-white/95 px-3 py-2">
            <ActivityIndicator color={PRIMARY_BLUE} size="small" />
          </View>
        ) : null}
      </View>

      <View className="mt-3 rounded-[20px] bg-white px-4 py-3">
        <Text className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Distance</Text>
        <Text className="mt-1 text-lg font-bold text-gray-900">
          {displayDistance != null
            ? `${Number(displayDistance).toFixed(1)} km`
            : 'Distance unavailable'}
          {durationMinutes != null ? ` · ~${Math.round(durationMinutes)} min` : ''}
        </Text>
        <Text className="mt-2 text-sm font-semibold text-gray-900" numberOfLines={2}>
          {request?.pickupLabel || 'Start'}
        </Text>
        {request?.dropoffLabel ? (
          <Text className="mt-1 text-sm text-gray-500" numberOfLines={2}>
            To {request.dropoffLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
