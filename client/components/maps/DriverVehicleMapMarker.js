import React, { useEffect, useRef, useState } from 'react';
import { Easing } from 'react-native';
import { AnimatedRegion, MarkerAnimated } from './MapViewCompat';
import {
  calculateDistanceKm,
  normalizeCoordinate,
  normalizeHeading,
  resolveVehicleHeading,
  smoothHeadingDegrees,
} from '../../lib/mapVehicleHeading';

const CAR_ICON_NATIVE_HEADING = 0;
const CAR_WHITE_MARKER_XSMALL = require('../../assets/car-white-marker-xsmall.png');
const CAR_WHITE_MARKER_SMALL = require('../../assets/car-white-marker-small.png');
const CAR_WHITE_MARKER_MEDIUM = require('../../assets/car-white-marker-medium.png');
const CAR_WHITE_MARKER_LARGE = require('../../assets/car-white-marker-large.png');

const MIN_GLIDE_MS = 400;
const MAX_GLIDE_MS = 3000;
// GPS resets / reconnects can move the car far in one tick; jump instead of sliding across the city.
const TELEPORT_DISTANCE_METERS = 800;

function getCarMarkerAsset(size) {
  const numericSize = Number(size || 0);
  if (numericSize <= 18) return CAR_WHITE_MARKER_XSMALL;
  if (numericSize <= 24) return CAR_WHITE_MARKER_SMALL;
  if (numericSize <= 32) return CAR_WHITE_MARKER_MEDIUM;
  return CAR_WHITE_MARKER_LARGE;
}

function toRegionValue(coordinate) {
  return {
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    latitudeDelta: 0,
    longitudeDelta: 0,
  };
}

/**
 * Rotating car marker for live driver tracking on react-native-maps.
 * The car glides between location fixes over roughly the time it took the
 * next fix to arrive, so on-screen movement matches real movement.
 */
export default function DriverVehicleMapMarker({
  coordinate,
  headingDegrees = 0,
  etaLabel = null,
  size = 28,
}) {
  const safeCoordinate = normalizeCoordinate(coordinate);
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const previousCoordinateRef = useRef(null);
  const lastRenderedHeadingRef = useRef(null);
  const animatedCoordinateRef = useRef(null);
  const glideAnimationRef = useRef(null);
  const lastGlideTargetRef = useRef(null);
  const lastFixAtRef = useRef(0);
  const [renderHeading, setRenderHeading] = useState(() => normalizeHeading(headingDegrees));

  if (!animatedCoordinateRef.current && safeCoordinate) {
    animatedCoordinateRef.current = new AnimatedRegion(toRegionValue(safeCoordinate));
  }

  useEffect(() => {
    if (!safeCoordinate) return;
    const resolvedHeading = resolveVehicleHeading({
      currentCoordinate: safeCoordinate,
      previousCoordinate: previousCoordinateRef.current,
      fallbackHeading: headingDegrees,
    });
    previousCoordinateRef.current = safeCoordinate;
    setRenderHeading((current) => smoothHeadingDegrees(current, resolvedHeading));
  }, [safeCoordinate?.latitude, safeCoordinate?.longitude, headingDegrees]);

  useEffect(() => {
    if (!safeCoordinate) return;
    const animated = animatedCoordinateRef.current;
    if (!animated) return;

    const previous = lastGlideTargetRef.current;
    lastGlideTargetRef.current = safeCoordinate;

    const now = Date.now();
    const elapsedMs = lastFixAtRef.current ? now - lastFixAtRef.current : 0;
    lastFixAtRef.current = now;
    glideAnimationRef.current?.stop();
    glideAnimationRef.current = null;

    const movedMeters = previous ? calculateDistanceKm(previous, safeCoordinate) * 1000 : 0;
    if (!previous || !elapsedMs || movedMeters > TELEPORT_DISTANCE_METERS) {
      animated.setValue(toRegionValue(safeCoordinate));
      return;
    }

    const duration = Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, elapsedMs));
    glideAnimationRef.current = animated.timing({
      ...toRegionValue(safeCoordinate),
      duration,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    glideAnimationRef.current.start();
  }, [safeCoordinate?.latitude, safeCoordinate?.longitude]);

  useEffect(() => () => glideAnimationRef.current?.stop(), []);

  useEffect(() => {
    if (!safeCoordinate) return undefined;

    const headingChanged = lastRenderedHeadingRef.current === null
      || Math.abs(Number(lastRenderedHeadingRef.current) - Number(renderHeading)) >= 8;
    lastRenderedHeadingRef.current = renderHeading;

    setTracksViewChanges(true);
    const timer = setTimeout(() => setTracksViewChanges(false), headingChanged ? 700 : 350);
    return () => clearTimeout(timer);
  }, [renderHeading]);

  if (!safeCoordinate || !animatedCoordinateRef.current) return null;

  const rotation = renderHeading - CAR_ICON_NATIVE_HEADING;
  const markerAsset = getCarMarkerAsset(size);

  return (
    <MarkerAnimated
      coordinate={animatedCoordinateRef.current}
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
