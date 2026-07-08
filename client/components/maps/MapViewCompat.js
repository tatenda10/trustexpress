import React, { forwardRef } from 'react';
import { Platform } from 'react-native';
import RNMapView, {
  Marker as RNMarker,
  Polyline as RNPolyline,
  PROVIDER_GOOGLE,
  PROVIDER_DEFAULT,
} from 'react-native-maps';

const DEFAULT_LATITUDE_DELTA = 0.05;
const DEFAULT_LONGITUDE_DELTA = 0.05;

// Use Google Maps everywhere it is available. Google is fully supported on
// Android and iOS; the default provider is only used as a safety fallback.
const MAP_PROVIDER = Platform.select({
  android: PROVIDER_GOOGLE,
  ios: PROVIDER_GOOGLE,
  default: PROVIDER_DEFAULT,
});

function buildRegion(region) {
  if (!region) return undefined;
  const latitude = Number(region.latitude);
  const longitude = Number(region.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  return {
    latitude,
    longitude,
    latitudeDelta: Math.max(Number(region.latitudeDelta || DEFAULT_LATITUDE_DELTA), 0.0005),
    longitudeDelta: Math.max(Number(region.longitudeDelta || DEFAULT_LONGITUDE_DELTA), 0.0005),
  };
}

/**
 * Thin wrapper around react-native-maps that keeps the react-native-maps API
 * (MapView / Marker / Polyline) the rest of the app already uses, while forcing
 * the Google Maps provider and normalizing the region props.
 *
 * The forwarded ref is the underlying react-native-maps MapView, so callers can
 * keep using animateToRegion / animateCamera / fitToCoordinates unchanged.
 */
const MapView = forwardRef(function MapView(
  {
    children,
    initialRegion,
    region,
    // Accepted for backwards-compatibility with the previous MapLibre shim.
    // react-native-maps does not support hard camera bounds, so this is a no-op.
    maxBounds,
    showsScale = false,
    ...rest
  },
  ref
) {
  return (
    <RNMapView
      ref={ref}
      provider={MAP_PROVIDER}
      initialRegion={buildRegion(initialRegion) || buildRegion(region)}
      region={buildRegion(region)}
      showsScale={showsScale}
      {...rest}
    >
      {children}
    </RNMapView>
  );
});

function CompatUrlTile() {
  return null;
}

export default MapView;
export { RNMarker as Marker, RNPolyline as Polyline, CompatUrlTile as UrlTile };
