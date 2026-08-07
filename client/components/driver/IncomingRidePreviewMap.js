import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from '../maps/MapViewCompat';
import { PRIMARY_BLUE } from '../../constants/colors';

function isValidCoord(coordinate) {
  return (
    Number.isFinite(Number(coordinate?.latitude)) &&
    Number.isFinite(Number(coordinate?.longitude))
  );
}

function normalizeCoord(coordinate) {
  if (!isValidCoord(coordinate)) return null;
  return {
    latitude: Number(coordinate.latitude),
    longitude: Number(coordinate.longitude),
  };
}

function normalizeRoute(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
  return coordinates.map(normalizeCoord).filter(Boolean);
}

function regionFromPoints(points) {
  if (!points.length) {
    return {
      latitude: -20.1535,
      longitude: 28.5870,
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

  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  const latDelta = Math.max((maxLat - minLat) * 1.55, 0.02);
  const lngDelta = Math.max((maxLng - minLng) * 1.55, 0.02);

  return {
    latitude: midLat,
    longitude: midLng,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

function LetterMarker({ letter, color, label }) {
  return (
    <View style={{ alignItems: 'center' }}>
      {label ? (
        <View
          style={{
            marginBottom: 4,
            maxWidth: 120,
            borderRadius: 8,
            backgroundColor: color,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ) : null}
      <View
        style={{
          height: 28,
          width: 28,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color,
          borderWidth: 2,
          borderColor: '#fff',
        }}
      >
        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>{letter}</Text>
      </View>
    </View>
  );
}

/**
 * Compact route map for the incoming ride sheet (pickup A, drop-off B, driver).
 */
export default function IncomingRidePreviewMap({
  driverCoordinate,
  request,
  toPickupRoute = [],
  tripRoute = [],
  height = 220,
  pickupEtaLabel,
  tripEtaLabel,
}) {
  const mapRef = useRef(null);
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  const pickup = useMemo(() => normalizeCoord(request?.pickupCoordinate), [request?.pickupCoordinate]);
  const dropoff = useMemo(() => normalizeCoord(request?.dropoffCoordinate), [request?.dropoffCoordinate]);
  const driver = useMemo(() => normalizeCoord(driverCoordinate), [driverCoordinate]);
  const stops = useMemo(
    () =>
      (Array.isArray(request?.intermediateStops) ? request.intermediateStops : [])
        .map((stop) => normalizeCoord(stop?.coordinate))
        .filter(Boolean),
    [request?.intermediateStops],
  );

  const fitPoints = useMemo(() => {
    const points = [];
    if (driver) points.push(driver);
    if (pickup) points.push(pickup);
    stops.forEach((stop) => points.push(stop));
    if (dropoff) points.push(dropoff);
    return points;
  }, [driver, dropoff, pickup, stops]);

  const initialRegion = useMemo(() => regionFromPoints(fitPoints), [fitPoints]);

  const pickupLine = useMemo(() => {
    const fromApi = normalizeRoute(toPickupRoute);
    if (fromApi.length > 1) return fromApi;
    if (driver && pickup) return [driver, pickup];
    return [];
  }, [driver, pickup, toPickupRoute]);

  const tripLine = useMemo(() => {
    const fromApi = normalizeRoute(tripRoute);
    if (fromApi.length > 1) return fromApi;
    const points = [pickup, ...stops, dropoff].filter(Boolean);
    return points.length > 1 ? points : [];
  }, [dropoff, pickup, stops, tripRoute]);

  // Android custom markers need an initial tracksViewChanges pass after mount.
  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => setTracksViewChanges(false), 750);
    return () => clearTimeout(timer);
  }, [request?.id, pickupEtaLabel, tripEtaLabel]);

  useEffect(() => {
    if (!mapRef.current || fitPoints.length < 1) return undefined;

    const timer = setTimeout(() => {
      try {
        if (fitPoints.length === 1) {
          mapRef.current?.animateToRegion?.(regionFromPoints(fitPoints), 250);
          return;
        }
        mapRef.current?.fitToCoordinates?.(fitPoints, {
          edgePadding: { top: 60, right: 48, bottom: 44, left: 48 },
          animated: false,
        });
      } catch {
        // ignore map fit errors
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [fitPoints, request?.id, pickupLine.length, tripLine.length]);

  if (fitPoints.length === 0) {
    return (
      <View
        style={{
          height,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#e8eef6',
        }}
      >
        <Text style={{ color: '#5a6474', fontSize: 13, fontWeight: '600' }}>
          Map preview unavailable
        </Text>
      </View>
    );
  }

  return (
    <View style={{ height, overflow: 'hidden', backgroundColor: '#dbe4f0' }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsCompass={false}
        showsScale={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        scrollEnabled
        zoomEnabled
        moveOnMarkerPress={false}
        onMapReady={() => {
          if (fitPoints.length < 2) return;
          try {
            mapRef.current?.fitToCoordinates?.(fitPoints, {
              edgePadding: { top: 60, right: 48, bottom: 44, left: 48 },
              animated: false,
            });
          } catch {
            // ignore
          }
        }}
      >
        {pickupLine.length > 1 ? (
          <Polyline
            coordinates={pickupLine}
            strokeColor="rgba(47,115,201,0.35)"
            strokeWidth={Platform.OS === 'ios' ? 6 : 5}
          />
        ) : null}
        {pickupLine.length > 1 ? (
          <Polyline coordinates={pickupLine} strokeColor={PRIMARY_BLUE} strokeWidth={3} />
        ) : null}

        {tripLine.length > 1 ? (
          <Polyline
            coordinates={tripLine}
            strokeColor="rgba(17,24,39,0.2)"
            strokeWidth={Platform.OS === 'ios' ? 7 : 6}
          />
        ) : null}
        {tripLine.length > 1 ? (
          <Polyline coordinates={tripLine} strokeColor="#111827" strokeWidth={4} />
        ) : null}

        {driver ? (
          <Marker coordinate={driver} title="You" tracksViewChanges={tracksViewChanges} anchor={{ x: 0.5, y: 0.5 }}>
            <View
              style={{
                height: 18,
                width: 18,
                borderRadius: 9,
                backgroundColor: PRIMARY_BLUE,
                borderWidth: 3,
                borderColor: '#fff',
              }}
            />
          </Marker>
        ) : null}

        {pickup ? (
          <Marker
            coordinate={pickup}
            title="Pickup"
            tracksViewChanges={tracksViewChanges}
            anchor={{ x: 0.5, y: 1 }}
          >
            <LetterMarker letter="A" color={PRIMARY_BLUE} label={pickupEtaLabel} />
          </Marker>
        ) : null}

        {stops.map((stop, index) => (
          <Marker
            key={`incoming-preview-stop-${index}`}
            coordinate={stop}
            title={`Stop ${index + 1}`}
            tracksViewChanges={tracksViewChanges}
            anchor={{ x: 0.5, y: 1 }}
          >
            <LetterMarker letter={String(index + 1)} color="#f97316" />
          </Marker>
        ))}

        {dropoff ? (
          <Marker
            coordinate={dropoff}
            title="Drop-off"
            tracksViewChanges={tracksViewChanges}
            anchor={{ x: 0.5, y: 1 }}
          >
            <LetterMarker letter="B" color="#111827" label={tripEtaLabel} />
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}
