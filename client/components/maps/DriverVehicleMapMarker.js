import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Platform } from 'react-native';
import { Marker } from './MapViewCompat';
import {
  normalizeCoordinate,
  normalizeHeading,
  resolveVehicleHeading,
  smoothHeadingDegrees,
} from '../../lib/mapVehicleHeading';

// car-white.svg is byte-identical to trust express.svg; use the existing JPEG raster on maps.
const CAR_MAP_MARKER_IMAGE = require('../../assets/trust express.jpeg');

/**
 * The trust express / car-white artwork points roughly east-southeast at 0deg rotation.
 * Subtract this offset so the hood aligns with the travel bearing (0=north).
 */
const CAR_IMAGE_NATIVE_HEADING = 100;

function isValidCoordinate(value) {
  return Number.isFinite(Number(value?.latitude)) && Number.isFinite(Number(value?.longitude));
}

/**
 * Rotating car marker for live driver tracking on react-native-maps.
 * Android custom marker views need tracksViewChanges while the bitmap is being
 * rebuilt (mount / heading / label), but not on every tiny coordinate tick.
 */
export default function DriverVehicleMapMarker({
  coordinate,
  headingDegrees = 0,
  etaLabel = null,
  size = 44,
}) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const previousCoordinateRef = useRef(null);
  const lastRenderedHeadingRef = useRef(null);
  const [renderHeading, setRenderHeading] = useState(() => normalizeHeading(headingDegrees));

  useEffect(() => {
    if (!isValidCoordinate(coordinate)) return undefined;

    const resolvedHeading = resolveVehicleHeading({
      currentCoordinate: coordinate,
      previousCoordinate: previousCoordinateRef.current,
      fallbackHeading: headingDegrees,
    });

    previousCoordinateRef.current = normalizeCoordinate(coordinate);
    setRenderHeading((current) => smoothHeadingDegrees(current, resolvedHeading));
  }, [coordinate?.latitude, coordinate?.longitude, headingDegrees]);

  useEffect(() => {
    if (!isValidCoordinate(coordinate)) return undefined;

    const headingChanged = lastRenderedHeadingRef.current === null
      || Math.abs(Number(lastRenderedHeadingRef.current) - Number(renderHeading)) >= 8;
    lastRenderedHeadingRef.current = renderHeading;

    // Rebuild the marker bitmap on mount and meaningful visual changes only.
    // Continuous lat/lng updates keep working while tracksViewChanges is false.
    setTracksViewChanges(true);
    const timer = setTimeout(() => setTracksViewChanges(false), headingChanged || etaLabel ? 700 : 350);
    return () => clearTimeout(timer);
  }, [etaLabel, renderHeading]);

  if (!isValidCoordinate(coordinate)) return null;

  const rotation = renderHeading - CAR_IMAGE_NATIVE_HEADING;

  return (
    <Marker
      coordinate={coordinate}
      title="Driver"
      anchor={{ x: 0.5, y: 0.5 }}
      flat
      rotation={Platform.OS === 'android' ? 0 : undefined}
      tracksViewChanges={tracksViewChanges}
      zIndex={20}
    >
      <View className="items-center justify-center" pointerEvents="none">
        <View
          style={{
            width: size,
            height: size,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ rotate: `${rotation}deg` }],
            ...Platform.select({
              ios: {
                shadowColor: '#0f172a',
                shadowOpacity: 0.28,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 2 },
              },
              android: {
                elevation: 5,
              },
              default: {},
            }),
          }}
        >
          <Image
            source={CAR_MAP_MARKER_IMAGE}
            style={{ width: size, height: size }}
            resizeMode="contain"
            accessibilityLabel="Driver car"
          />
        </View>
        {etaLabel ? (
          <View className="mt-1 rounded-full bg-white px-2 py-1">
            <Text className="text-xs font-bold text-gray-900">{etaLabel}</Text>
          </View>
        ) : null}
      </View>
    </Marker>
  );
}
