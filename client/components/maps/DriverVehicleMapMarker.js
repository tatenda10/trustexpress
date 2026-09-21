import React, { useEffect, useRef, useState } from 'react';
import { Marker } from './MapViewCompat';
import {
  normalizeCoordinate,
  normalizeHeading,
  resolveVehicleHeading,
  smoothHeadingDegrees,
} from '../../lib/mapVehicleHeading';

const CAR_ICON_NATIVE_HEADING = 0;
const CAR_WHITE_MARKER_SMALL = require('../../assets/car-white-marker-small.png');
const CAR_WHITE_MARKER_MEDIUM = require('../../assets/car-white-marker-medium.png');
const CAR_WHITE_MARKER_LARGE = require('../../assets/car-white-marker-large.png');

function getCarMarkerAsset(size) {
  const numericSize = Number(size || 0);
  if (numericSize <= 24) return CAR_WHITE_MARKER_SMALL;
  if (numericSize <= 32) return CAR_WHITE_MARKER_MEDIUM;
  return CAR_WHITE_MARKER_LARGE;
}

function isValidCoordinate(value) {
  return Boolean(normalizeCoordinate(value));
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
  size = 28,
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
    const timer = setTimeout(() => setTracksViewChanges(false), headingChanged ? 700 : 350);
    return () => clearTimeout(timer);
  }, [renderHeading]);

  const safeCoordinate = normalizeCoordinate(coordinate);
  if (!safeCoordinate) return null;

  const rotation = renderHeading - CAR_ICON_NATIVE_HEADING;
  const markerAsset = getCarMarkerAsset(size);

  return (
    <Marker
      coordinate={safeCoordinate}
      title={etaLabel ? `Driver · ${etaLabel}` : 'Driver'}
      anchor={{ x: 0.5, y: 0.5 }}
      flat
      rotation={rotation}
      image={markerAsset}
      tracksViewChanges={tracksViewChanges}
      zIndex={20}
    />
  );
}
