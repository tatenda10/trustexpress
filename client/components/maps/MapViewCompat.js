import React, {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  RasterSource,
} from '@maplibre/maplibre-react-native';

const EMPTY_STYLE = { version: 8, sources: {}, layers: [] };
const BASE_SOURCE_ID = 'trustcars-osm-base';
const BASE_LAYER_ID = 'trustcars-osm-base-layer';
const DEFAULT_TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_LATITUDE_DELTA = 0.05;
const DEFAULT_LONGITUDE_DELTA = 0.05;
const DEFAULT_ZOOM = 14;

const MapCompatContext = createContext(null);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function coordinateToLngLat(coordinate) {
  const latitude = Number(coordinate?.latitude);
  const longitude = Number(coordinate?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return [longitude, latitude];
}

function buildRegion(region) {
  if (!region) return null;
  const latitude = Number(region.latitude);
  const longitude = Number(region.longitude);
  const latitudeDelta = Math.max(Number(region.latitudeDelta || DEFAULT_LATITUDE_DELTA), 0.0001);
  const longitudeDelta = Math.max(Number(region.longitudeDelta || DEFAULT_LONGITUDE_DELTA), 0.0001);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, latitudeDelta, longitudeDelta };
}

function areRegionsClose(a, b) {
  if (!a || !b) return false;
  const zoomA = regionToZoom(a);
  const zoomB = regionToZoom(b);
  return (
    Math.abs(Number(a.latitude) - Number(b.latitude)) < 0.0005 &&
    Math.abs(Number(a.longitude) - Number(b.longitude)) < 0.0005 &&
    Math.abs(zoomA - zoomB) < 0.35
  );
}

function boundsToRegion(bounds) {
  if (!Array.isArray(bounds) || bounds.length < 4) return null;
  const [west, south, east, north] = bounds.map((value) => Number(value));
  if (![west, south, east, north].every(Number.isFinite)) return null;
  return {
    latitude: (south + north) / 2,
    longitude: (west + east) / 2,
    latitudeDelta: Math.max(Math.abs(north - south), 0.0005),
    longitudeDelta: Math.max(Math.abs(east - west), 0.0005),
  };
}

function regionToZoom(region) {
  const safeRegion = buildRegion(region);
  if (!safeRegion) return DEFAULT_ZOOM;
  const longitudeDelta = Math.max(safeRegion.longitudeDelta, 0.0001);
  return clamp(Math.log2(360 / longitudeDelta), 1, 20);
}

function coordinatesToBounds(coordinates = []) {
  const points = coordinates.map(coordinateToLngLat).filter(Boolean);
  if (!points.length) return null;

  let west = points[0][0];
  let east = points[0][0];
  let south = points[0][1];
  let north = points[0][1];

  points.forEach(([longitude, latitude]) => {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  });

  return [west, south, east, north];
}

function buildLineFeature(coordinates = []) {
  const path = coordinates.map(coordinateToLngLat).filter(Boolean);
  if (path.length < 2) return null;
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: path,
    },
    properties: {},
  };
}

function coordinateRenderKey(coordinate) {
  const lngLat = coordinateToLngLat(coordinate);
  if (!lngLat) return 'none';
  return `${lngLat[0].toFixed(6)},${lngLat[1].toFixed(6)}`;
}

function coordinatesRenderKey(coordinates = []) {
  const points = coordinates.map(coordinateToLngLat).filter(Boolean);
  if (!points.length) return 'empty';
  const first = points[0];
  const last = points[points.length - 1];
  return [
    points.length,
    first[0].toFixed(6),
    first[1].toFixed(6),
    last[0].toFixed(6),
    last[1].toFixed(6),
  ].join(':');
}

function DefaultMarkerPin({ pinColor = '#2563eb' }) {
  return (
    <View collapsable={false} style={styles.defaultMarkerWrap}>
      <View style={[styles.defaultMarkerPin, { backgroundColor: pinColor }]} />
    </View>
  );
}

function CompatMarker({
  children,
  coordinate,
  onPress,
  pinColor,
}) {
  const context = useContext(MapCompatContext);
  const lngLat = coordinateToLngLat(coordinate);
  if (!context || !lngLat) return null;

  return (
    <MapLibreMarker
      key={coordinateRenderKey(coordinate)}
      anchor="center"
      lngLat={lngLat}
      onPress={onPress}
    >
      <View collapsable={false}>
        {children || <DefaultMarkerPin pinColor={pinColor} />}
      </View>
    </MapLibreMarker>
  );
}

function CompatPolyline({
  coordinates,
  strokeColor = '#2563eb',
  strokeWidth = 4,
}) {
  const context = useContext(MapCompatContext);
  const feature = useMemo(() => buildLineFeature(coordinates), [coordinates]);
  const renderKey = useMemo(() => coordinatesRenderKey(coordinates), [coordinates]);
  const id = useId().replace(/:/g, '');
  if (!context || !feature) return null;

  return (
    <GeoJSONSource
      key={renderKey}
      id={`trustcars-polyline-source-${id}`}
      data={{
        type: 'FeatureCollection',
        features: [feature],
      }}
    >
      <Layer
        id={`trustcars-polyline-layer-${id}`}
        type="line"
        paint={{
          'line-color': strokeColor,
          'line-width': strokeWidth,
          'line-opacity': 1,
          'line-cap': 'round',
          'line-join': 'round',
        }}
      />
    </GeoJSONSource>
  );
}

function CompatUrlTile() {
  return null;
}

const MapView = forwardRef(function MapView(
  {
    children,
    initialRegion,
    maxBounds,
    onMapReady,
    onPress,
    onRegionChangeComplete,
    pitchEnabled = true,
    region,
    rotateEnabled = true,
    scrollEnabled = true,
    showsCompass = true,
    showsScale = false,
    style,
    zoomEnabled = true,
  },
  ref
) {
  const mapRef = useRef(null);
  const cameraRef = useRef(null);
  const lastRegionRef = useRef(null);
  const readyRef = useRef(false);

  const safeInitialRegion = useMemo(
    () => buildRegion(initialRegion) || buildRegion(region),
    [initialRegion, region]
  );
  const safeMaxBounds = useMemo(
    () => (Array.isArray(maxBounds) && maxBounds.length === 4
      ? maxBounds.map((value) => Number(value))
      : undefined),
    [maxBounds]
  );

  const handleRegionDidChange = (event) => {
    const nextRegion = boundsToRegion(event?.nativeEvent?.bounds);
    if (!nextRegion) return;
    if (areRegionsClose(lastRegionRef.current, nextRegion)) return;
    lastRegionRef.current = nextRegion;
    onRegionChangeComplete?.(nextRegion);
  };

  useImperativeHandle(ref, () => ({
    animateToRegion(nextRegion, duration = 400) {
      const safeRegion = buildRegion(nextRegion);
      if (!safeRegion) return;
      lastRegionRef.current = safeRegion;
      cameraRef.current?.easeTo({
        center: [safeRegion.longitude, safeRegion.latitude],
        zoom: regionToZoom(safeRegion),
        duration,
      });
    },
    animateCamera(nextCamera = {}, options = {}) {
      const center = coordinateToLngLat(nextCamera.center);
      const zoom = Number(nextCamera.zoom);
      if (!center && !Number.isFinite(zoom)) return;
      cameraRef.current?.easeTo({
        ...(center ? { center } : null),
        ...(Number.isFinite(zoom) ? { zoom } : null),
        ...(Number.isFinite(nextCamera.pitch) ? { pitch: Number(nextCamera.pitch) } : null),
        ...(Number.isFinite(nextCamera.heading) ? { bearing: Number(nextCamera.heading) } : null),
        duration: Number(options?.duration || 400),
      });
    },
    fitToCoordinates(coordinates = [], options = {}) {
      const bounds = coordinatesToBounds(coordinates);
      if (!bounds) return;
      const edgePadding = options?.edgePadding || {};
      cameraRef.current?.fitBounds(bounds, {
        padding: {
          top: Number(edgePadding.top || 0),
          right: Number(edgePadding.right || 0),
          bottom: Number(edgePadding.bottom || 0),
          left: Number(edgePadding.left || 0),
        },
        duration: options?.animated === false ? 0 : 450,
      });
    },
  }), []);

  useEffect(() => {
    const safeRegion = buildRegion(region);
    if (!readyRef.current || !safeRegion) return;
    if (areRegionsClose(lastRegionRef.current, safeRegion)) return;
    lastRegionRef.current = safeRegion;
    cameraRef.current?.easeTo({
      center: [safeRegion.longitude, safeRegion.latitude],
      zoom: regionToZoom(safeRegion),
      duration: 450,
    });
  }, [region]);

  return (
    <MapCompatContext.Provider value={{ ready: true }}>
      <MapLibreMap
        ref={mapRef}
        style={style}
        mapStyle={EMPTY_STYLE}
        compass={showsCompass}
        scaleBar={showsScale}
        dragPan={scrollEnabled}
        touchZoom={zoomEnabled}
        doubleTapZoom={zoomEnabled}
        doubleTapHoldZoom={zoomEnabled}
        touchPitch={pitchEnabled}
        touchRotate={rotateEnabled}
        logo={false}
        attribution={false}
        onPress={onPress ? (event) => {
          const lngLat = event?.nativeEvent?.lngLat;
          const coordinate = Array.isArray(lngLat)
            ? { latitude: Number(lngLat[1]), longitude: Number(lngLat[0]) }
            : null;
          onPress({
            ...event,
            nativeEvent: {
              ...event.nativeEvent,
              coordinate,
            },
          });
        } : undefined}
        onDidFinishLoadingMap={() => {
          readyRef.current = true;
          if (safeInitialRegion) {
            lastRegionRef.current = safeInitialRegion;
          }
          onMapReady?.();
        }}
        onRegionDidChange={onRegionChangeComplete ? handleRegionDidChange : undefined}
      >
        <Camera
          ref={cameraRef}
          maxBounds={safeMaxBounds}
          initialViewState={safeInitialRegion ? {
            center: [safeInitialRegion.longitude, safeInitialRegion.latitude],
            zoom: regionToZoom(safeInitialRegion),
          } : undefined}
        />
        <RasterSource
          id={BASE_SOURCE_ID}
          tileSize={256}
          tiles={[DEFAULT_TILE_URL_TEMPLATE]}
          maxzoom={19}
          attribution="OpenStreetMap contributors"
        >
          <Layer id={BASE_LAYER_ID} type="raster" />
        </RasterSource>
        {children}
      </MapLibreMap>
    </MapCompatContext.Provider>
  );
});

const styles = StyleSheet.create({
  defaultMarkerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultMarkerPin: {
    width: 16,
    height: 16,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
});

export default MapView;
export { CompatMarker as Marker, CompatPolyline as Polyline, CompatUrlTile as UrlTile };
