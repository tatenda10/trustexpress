import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline } from '../../../components/maps/MapViewCompat';
import { LetterMarker, PIN_COLORS, stopLetter } from '../../../components/maps/LetterPin';
import DriverVehicleMapMarker from '../../../components/maps/DriverVehicleMapMarker';
import { receiptPaymentMethodLabel } from '../../../constants/payment';
import RideRatingTagPicker from '../../../components/ride/RideRatingTagPicker';
import {
  DRIVER_PASSENGER_RATING_GROUPS,
  DRIVER_PASSENGER_RATING_SAFETY_NOTE,
} from '../../../constants/rideRatingTags';

export function DriverTripLoadingState({ color }) {
  return (
    <View className="flex-1 items-center justify-center bg-white px-5">
      <ActivityIndicator size="large" color={color} />
      <Text className="mt-4 text-base text-gray-500">Loading live trip route...</Text>
    </View>
  );
}

function RouteLetterMarker({ letter, color, muted = false }) {
  const markerColor = muted ? '#94a3b8' : color;
  return (
    <View className="items-center">
      <View
        className="h-8 w-8 items-center justify-center rounded-full border-2 border-white"
        style={{ backgroundColor: markerColor }}
      >
        <Text className="text-[13px] font-extrabold text-white">{letter}</Text>
      </View>
    </View>
  );
}

export function DriverTripEmptyState({ onBack }) {
  return (
    <View className="flex-1 items-center justify-center bg-white px-5">
      <Text className="text-xl font-bold text-gray-900">No active trip</Text>
      <TouchableOpacity onPress={onBack} className="mt-6 rounded-[18px] bg-[#2f73c9] px-6 py-4">
        <Text className="text-base font-bold text-white">Back to Home</Text>
      </TouchableOpacity>
    </View>
  );
}

export function DriverTripReceiptView({
  insets,
  ratingRide,
  fareAmount,
  passengerFareAmount,
  discountAmount,
  driverReimbursementAmount,
  discountCode,
  tipAmount,
  totalAmount,
  passengerRating,
  passengerReview,
  selectedRatingTags = [],
  submittingRating,
  onSetPassengerRating,
  onSetPassengerReview,
  onTogglePassengerTag,
  onSubmit,
  onSkip,
  formatCurrency,
  formatDateTime,
}) {
  const passengerName = ratingRide.passengerName || 'Passenger';
  const routeLabels = [
    ratingRide.pickupLabel || 'Pickup',
    ...(Array.isArray(ratingRide.intermediateStops)
      ? ratingRide.intermediateStops.map((stop, index) => stop?.label || `Stop ${index + 1}`)
      : []),
    ratingRide.dropoffLabel || 'Drop-off',
  ];
  const hasDiscount = Number(discountAmount || 0) > 0;
  const hasTip = Number(tipAmount || 0) > 0;
  const paymentLabel = receiptPaymentMethodLabel(ratingRide.paymentMethod) || '-';

  const receiptRow = (label, value, valueClassName = 'text-gray-900') => (
    <View className="mt-2 flex-row items-center justify-between">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className={`text-sm font-semibold ${valueClassName}`}>{value}</Text>
    </View>
  );

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-green-50">
            <Ionicons name="checkmark" size={26} color="#16a34a" />
          </View>
          <Text className="mt-2 text-sm font-semibold text-gray-500">Trip completed</Text>
          <Text className="mt-1 text-3xl font-bold text-gray-900">{formatCurrency(totalAmount)}</Text>
          <Text className="mt-1 text-xs text-gray-400">
            {formatDateTime(ratingRide.completedAt) || 'Just now'}
          </Text>
        </View>

        <View className="mt-5 rounded-[10px] bg-[#f8fafc] px-4 py-4">
          <View className="flex-row items-center">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-[#eef4ff]">
              <Ionicons name="person" size={18} color="#2f73c9" />
            </View>
            <Text className="ml-3 flex-1 text-sm font-bold text-gray-900" numberOfLines={1}>{passengerName}</Text>
            <View className="rounded-full bg-white px-2.5 py-1">
              <Text className="text-xs font-semibold text-gray-700">{paymentLabel}</Text>
            </View>
          </View>

          <View className="mt-4">
            {routeLabels.map((label, index) => {
              const isLast = index === routeLabels.length - 1;
              return (
                <View key={`receipt-stop-${index}`} className="flex-row">
                  <View className="mr-3 items-center" style={{ width: 10 }}>
                    <View
                      className="mt-1.5 h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: index === 0 ? PIN_COLORS.start : isLast ? PIN_COLORS.finish : PIN_COLORS.stop }}
                    />
                    {!isLast ? <View className="w-px flex-1 bg-gray-300" style={{ minHeight: 14 }} /> : null}
                  </View>
                  <Text className={`flex-1 text-sm text-gray-800 ${isLast ? '' : 'pb-3'}`} numberOfLines={2}>{label}</Text>
                </View>
              );
            })}
          </View>

          <View className="mt-3 border-t border-gray-200 pt-1">
            {receiptRow('Trip fare', formatCurrency(fareAmount))}
            {hasDiscount ? receiptRow('Passenger promo', `-${formatCurrency(discountAmount)}`, 'text-amber-600') : null}
            {hasDiscount ? receiptRow('Passenger paid', formatCurrency(passengerFareAmount)) : null}
            {hasDiscount ? receiptRow('Reimbursed to you', formatCurrency(driverReimbursementAmount), 'text-indigo-700') : null}
            {hasDiscount && discountCode ? (
              <Text className="mt-1 text-xs text-gray-400">Code applied: {discountCode}</Text>
            ) : null}
            {receiptRow('Tip', formatCurrency(tipAmount), hasTip ? 'text-green-600' : 'text-gray-900')}
            <View className="mt-3 flex-row items-center justify-between">
              <Text className="text-base font-bold text-gray-900">Total</Text>
              <Text className="text-lg font-bold text-gray-900">{formatCurrency(totalAmount)}</Text>
            </View>
          </View>
        </View>

        <View className="mt-6">
          <RideRatingTagPicker
            rating={passengerRating}
            onChangeRating={onSetPassengerRating}
            groups={DRIVER_PASSENGER_RATING_GROUPS}
            selectedTags={selectedRatingTags}
            onToggleTag={onTogglePassengerTag}
            review={passengerReview}
            onChangeReview={onSetPassengerReview}
            title={`How was ${passengerName}?`}
            safetyNote={DRIVER_PASSENGER_RATING_SAFETY_NOTE}
          />
        </View>
      </ScrollView>

      <View className="border-t border-gray-100 bg-white px-4 pb-2 pt-3">
        <TouchableOpacity
          onPress={onSubmit}
          disabled={submittingRating || passengerRating < 1}
          className="h-12 items-center justify-center rounded-[10px] bg-[#2f73c9]"
          style={{ opacity: submittingRating || passengerRating < 1 ? 0.5 : 1 }}
        >
          {submittingRating ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-base font-bold text-white">Submit rating</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={onSkip} disabled={submittingRating} className="h-10 items-center justify-center">
          <Text className="text-sm font-semibold text-gray-500">Skip</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function DriverTripPreviewMap({
  pickupCoordinate,
  dropoffCoordinate,
  intermediateStops,
  routeCoordinates,
  height = 210,
}) {
  const mapRef = useRef(null);
  const stops = Array.isArray(intermediateStops) ? intermediateStops : [];
  const points = [
    pickupCoordinate,
    ...stops.map((stop) => stop?.coordinate),
    dropoffCoordinate,
  ].filter(Boolean);
  const hasRoute = Array.isArray(routeCoordinates) && routeCoordinates.length > 1;
  const regionPoints = hasRoute ? [...points, ...routeCoordinates] : points;
  const initialRegion = (() => {
    if (!regionPoints.length) return undefined;
    const latitudes = regionPoints.map((point) => Number(point.latitude));
    const longitudes = regionPoints.map((point) => Number(point.longitude));
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.01),
      longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.01),
    };
  })();

  const fitMap = () => {
    if (!mapRef.current) return;
    if (regionPoints.length > 1) {
      mapRef.current.fitToCoordinates(regionPoints, {
        edgePadding: { top: 60, right: 40, bottom: 30, left: 40 },
        animated: false,
      });
    } else if (points[0]) {
      mapRef.current.animateToRegion({ ...points[0], latitudeDelta: 0.01, longitudeDelta: 0.01 }, 0);
    }
  };

  return (
    <View className="overflow-hidden bg-[#eef2f7]" style={{ height, borderRadius: 12 }}>
      <MapView
        key={hasRoute ? `route-${routeCoordinates.length}` : 'points'}
        ref={mapRef}
        style={{ flex: 1, borderRadius: 12 }}
        liteMode={Platform.OS === 'android'}
        initialRegion={initialRegion}
        onMapReady={fitMap}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
      >
        {hasRoute ? (
          <Polyline coordinates={routeCoordinates} strokeColor="#2563eb" strokeWidth={4} />
        ) : points.length > 1 ? (
          <Polyline coordinates={points} strokeColor="#64748b" strokeWidth={3} lineDashPattern={[8, 6]} />
        ) : null}
        {pickupCoordinate ? (
          <LetterMarker coordinate={pickupCoordinate} title="Pickup" letter="A" color={PIN_COLORS.start} />
        ) : null}
        {stops.map((stop, index) => (
          stop?.coordinate ? (
            <LetterMarker
              key={`preview-stop-${index}`}
              coordinate={stop.coordinate}
              title={stop.label || `Stop ${index + 1}`}
              letter={stopLetter(index)}
              color={PIN_COLORS.stop}
            />
          ) : null
        ))}
        {dropoffCoordinate ? (
          <LetterMarker coordinate={dropoffCoordinate} title="Drop-off" letter="B" color={PIN_COLORS.finish} />
        ) : null}
      </MapView>
    </View>
  );
}

export function DriverTripTopBar({
  className = '',
  roundedClassName = 'rounded-2xl',
  buttonRoundedClassName = 'rounded-full',
  style,
  targetLabel,
  voiceGuidanceEnabled,
  onToggleVoiceGuidance,
  showCallPassenger,
  onCallPassenger,
  onSendPanicAlert,
  submittingPanicAlert,
  onOpenChat,
  onOpenExternalNavigation,
}) {
  return (
    <View className={`flex-row items-center ${roundedClassName} bg-white px-3 py-3 ${className}`} style={style}>
      <View className={`h-9 w-9 items-center justify-center ${buttonRoundedClassName} bg-red-50`}>
        <Ionicons name="location" size={19} color="#dc2626" />
      </View>
      <Text className="ml-3 flex-1 text-lg font-bold text-gray-900" numberOfLines={1}>
        {targetLabel}
      </Text>
      <TouchableOpacity
        onPress={onToggleVoiceGuidance}
        activeOpacity={0.85}
        className={`ml-2 h-10 w-10 items-center justify-center ${buttonRoundedClassName} ${voiceGuidanceEnabled ? 'bg-orange-500' : 'bg-gray-100'}`}
      >
        <Ionicons name={voiceGuidanceEnabled ? 'volume-high' : 'volume-mute'} size={18} color={voiceGuidanceEnabled ? '#fff' : '#374151'} />
      </TouchableOpacity>
      {showCallPassenger ? (
        <TouchableOpacity
          onPress={onCallPassenger}
          activeOpacity={0.85}
          className={`ml-2 h-10 w-10 items-center justify-center ${buttonRoundedClassName} bg-green-50`}
        >
          <Ionicons name="call-outline" size={19} color="#15803d" />
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        onPress={onSendPanicAlert}
        activeOpacity={0.85}
        className={`ml-2 h-10 w-10 items-center justify-center ${buttonRoundedClassName} bg-red-50`}
      >
        {submittingPanicAlert ? (
          <ActivityIndicator size="small" color="#dc2626" />
        ) : (
          <Ionicons name="warning-outline" size={19} color="#dc2626" />
        )}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onOpenChat}
        activeOpacity={0.85}
        className={`ml-2 h-10 w-10 items-center justify-center ${buttonRoundedClassName} bg-gray-100`}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={19} color="#111827" />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onOpenExternalNavigation}
        activeOpacity={0.85}
        className={`ml-2 h-10 w-10 items-center justify-center ${buttonRoundedClassName} bg-[#dbeafe]`}
      >
        <Ionicons name="navigate" size={19} color="#1d4ed8" />
      </TouchableOpacity>
    </View>
  );
}

export function DriverTripMapPanel({
  mapRef,
  mapRegion,
  onMapReady,
  driverCoordinate,
  pickupCoordinate,
  dropoffCoordinate,
  intermediateStops,
  currentStopIndex,
  safeRouteCoordinates,
  vehicleHeadingDegrees = 0,
  primaryBlue,
  insets,
  targetLabel,
  voiceGuidanceEnabled,
  onToggleVoiceGuidance,
  showCallPassenger,
  onCallPassenger,
  onSendPanicAlert,
  onOpenChat,
  onOpenExternalNavigation,
  tripPanelMaxHeight,
  onCenterDriver,
  stageTitle,
  primaryMetric,
  secondaryMetric,
  fareText,
  passengerProfileImageUrl,
  passengerName,
  passengerSubtitle,
  passengerConfirmationText,
  safetyPinReminderText,
  stopTimeline,
  remainingIntermediateStopsCount,
  guidanceText,
  showGuidance,
  showMarkArrived,
  showStartRide,
  startRideLabel = 'Start Ride',
  startRideDisabled = false,
  showAdvanceStop,
  advanceStopLabel,
  showCompleteRide,
  showCancelRide,
  submitting,
  cancellingRide,
  onMarkArrived,
  onStartRide,
  onAdvanceStop,
  onCompleteRide,
  onCancelRide,
  submittingPanicAlert,
}) {
  return (
    <View className="flex-1 bg-[#eef2f7]">
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={mapRegion}
        onMapReady={onMapReady}
        showsCompass={false}
        toolbarEnabled={false}
        rotateEnabled={true}
        showsTraffic={true}
        mapPadding={{
          top: Math.max(insets.top + 72, 96),
          right: 16,
          bottom: Math.max(tripPanelMaxHeight + 12, 200),
          left: 16,
        }}
      >
        {driverCoordinate ? (
          <DriverVehicleMapMarker
            coordinate={driverCoordinate}
            headingDegrees={vehicleHeadingDegrees}
          />
        ) : null}
        {pickupCoordinate ? (
          <Marker coordinate={pickupCoordinate} title="A · Pickup" anchor={{ x: 0.5, y: 0.5 }}>
            <RouteLetterMarker letter="A" color="#1d4ed8" />
          </Marker>
        ) : null}
        {Array.isArray(intermediateStops) ? intermediateStops.map((stop, index) => (
          stop?.coordinate ? (
            <Marker
              key={`driver-stop-${index}`}
              coordinate={stop.coordinate}
              title={`${String.fromCharCode(67 + index)} · ${stop.label || `Stop ${index + 1}`}`}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <RouteLetterMarker
                letter={String.fromCharCode(67 + index)}
                color="#f97316"
                muted={index < Number(currentStopIndex || 0)}
              />
            </Marker>
          ) : null
        )) : null}
        {dropoffCoordinate ? (
          <Marker coordinate={dropoffCoordinate} title="B · Drop-off" anchor={{ x: 0.5, y: 0.5 }}>
            <RouteLetterMarker letter="B" color="#111827" />
          </Marker>
        ) : null}
        {safeRouteCoordinates.length > 1 ? (
          <>
            <Polyline
              coordinates={safeRouteCoordinates}
              strokeColor="rgba(124,58,237,0.28)"
              strokeWidth={13}
            />
            <Polyline
              coordinates={safeRouteCoordinates}
              strokeColor="#4c1d95"
              strokeWidth={7}
            />
          </>
        ) : null}
      </MapView>

      <DriverTripTopBar
        className="absolute left-4 right-4"
        style={{ top: insets.top + 10 }}
        targetLabel={targetLabel}
        voiceGuidanceEnabled={voiceGuidanceEnabled}
        onToggleVoiceGuidance={onToggleVoiceGuidance}
        showCallPassenger={showCallPassenger}
        onCallPassenger={onCallPassenger}
        onSendPanicAlert={onSendPanicAlert}
        submittingPanicAlert={submittingPanicAlert}
        onOpenChat={onOpenChat}
        onOpenExternalNavigation={onOpenExternalNavigation}
      />

      <TouchableOpacity
        onPress={onCenterDriver}
        className="absolute right-4 h-14 w-14 items-center justify-center rounded-2xl bg-white"
        style={{ bottom: tripPanelMaxHeight + 20 }}
        activeOpacity={0.85}
      >
        <Ionicons name="locate" size={26} color="#4f46e5" />
      </TouchableOpacity>

      <View
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-white"
        style={{
          maxHeight: tripPanelMaxHeight + 8,
          paddingBottom: 8,
          overflow: 'hidden',
        }}
      >
        <ScrollView
          bounces={false}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          style={{ maxHeight: tripPanelMaxHeight }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 }}
        >
          <View className="mb-3 items-center">
            <View className="h-1.5 w-12 rounded-full bg-gray-300" />
          </View>

          <View className="items-center">
            <Text className="text-xs text-gray-500" numberOfLines={1}>{stageTitle}</Text>
            <Text className="mt-0.5 text-lg font-bold text-gray-900" numberOfLines={1}>
              {primaryMetric} · {secondaryMetric}
            </Text>
          </View>

          {showGuidance ? (
            <View className="mt-3 flex-row items-center rounded-[10px] bg-[#eef4ff] px-3 py-2.5">
              <Ionicons name="navigate" size={16} color={primaryBlue} />
              <Text className="ml-2 flex-1 text-sm font-semibold text-gray-900" numberOfLines={2}>
                {guidanceText || 'Follow the route to your destination.'}
              </Text>
            </View>
          ) : null}

          <View className="mt-4 flex-row items-center border-t border-gray-100 pt-4">
            <View
              className="items-center justify-center overflow-hidden rounded-full bg-[#eef4ff]"
              style={{ width: 48, height: 48 }}
            >
              {passengerProfileImageUrl ? (
                <Image source={{ uri: passengerProfileImageUrl }} style={{ width: 48, height: 48 }} />
              ) : (
                <Ionicons name="person" size={20} color={primaryBlue} />
              )}
            </View>
            <View className="ml-3 min-w-0 flex-1">
              <Text className="text-sm font-bold text-gray-900" numberOfLines={1}>{passengerName}</Text>
              {passengerSubtitle ? (
                <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>{passengerSubtitle}</Text>
              ) : null}
            </View>
            <Text className="ml-3 text-base font-bold text-gray-900">{fareText}</Text>
          </View>

          {passengerConfirmationText ? (
            <View className="mt-3 flex-row items-center rounded-[10px] bg-green-50 px-3 py-2">
              <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
              <Text className="ml-2 flex-1 text-xs font-semibold text-green-800" numberOfLines={2}>
                {passengerConfirmationText}
              </Text>
            </View>
          ) : null}

          {safetyPinReminderText ? (
            <View className="mt-2 flex-row items-center rounded-[10px] bg-[#eef4ff] px-3 py-2">
              <Ionicons name="shield-checkmark" size={16} color={primaryBlue} />
              <Text className="ml-2 flex-1 text-xs font-semibold text-gray-800" numberOfLines={2}>
                {safetyPinReminderText}
              </Text>
            </View>
          ) : null}

          {Array.isArray(stopTimeline) && stopTimeline.length ? (
            <View className="mt-4 border-t border-gray-100 pt-4">
              {stopTimeline.map((label, index) => {
                const isPickup = index === 0;
                const isDropoff = index === stopTimeline.length - 1;
                const isPassedStop = !isPickup && !isDropoff && index - 1 < Number(currentStopIndex || 0);
                return (
                  <View key={`${label}-${index}`} className={`flex-row items-start ${index ? 'mt-3' : ''}`}>
                    <View
                      className="mr-3 h-6 w-6 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: isPickup
                          ? PIN_COLORS.start
                          : isDropoff
                            ? PIN_COLORS.finish
                            : isPassedStop ? '#94a3b8' : PIN_COLORS.stop,
                      }}
                    >
                      <Text className="text-[11px] font-extrabold text-white">
                        {isPickup ? 'A' : isDropoff ? 'B' : stopLetter(index - 1)}
                      </Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[11px] text-gray-400">
                        {isPickup ? 'Pick up' : isDropoff ? 'Drop-off' : `Stop ${index}`}
                      </Text>
                      <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>{label}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {showMarkArrived ? (
            <TouchableOpacity
              onPress={onMarkArrived}
              disabled={submitting}
              className="mt-4 h-12 items-center justify-center rounded-[10px]"
              style={{ backgroundColor: primaryBlue, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-base font-bold text-white">Mark Arrived</Text>}
            </TouchableOpacity>
          ) : null}

          {showStartRide ? (
            <TouchableOpacity
              onPress={onStartRide}
              disabled={submitting || startRideDisabled}
              className="mt-4 h-12 items-center justify-center rounded-[10px]"
              style={{ backgroundColor: primaryBlue, opacity: submitting || startRideDisabled ? 0.6 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-base font-bold text-white">{startRideLabel}</Text>}
            </TouchableOpacity>
          ) : null}

          {showAdvanceStop ? (
            <TouchableOpacity
              onPress={onAdvanceStop}
              disabled={submitting}
              className="mt-4 h-12 items-center justify-center rounded-[10px] bg-orange-500"
              style={{ opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-base font-bold text-white">{advanceStopLabel || 'Reached stop'}</Text>}
            </TouchableOpacity>
          ) : null}

          {showCompleteRide ? (
            <TouchableOpacity
              onPress={onCompleteRide}
              disabled={submitting}
              className="mt-4 h-12 items-center justify-center rounded-[10px]"
              style={{ backgroundColor: primaryBlue, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-base font-bold text-white">Complete Ride</Text>}
            </TouchableOpacity>
          ) : null}

          {showCancelRide ? (
            <TouchableOpacity
              onPress={onCancelRide}
              disabled={submitting || cancellingRide}
              className="mt-3 h-12 flex-row items-center justify-center rounded-[10px] bg-red-50"
              style={{ opacity: submitting || cancellingRide ? 0.7 : 1 }}
            >
              {cancellingRide ? (
                <ActivityIndicator size="small" color="#dc2626" />
              ) : (
                <>
                  <Ionicons name="close-circle-outline" size={18} color="#dc2626" />
                  <Text className="ml-2 text-base font-bold text-red-600">Cancel ride</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}
