import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline } from '../../../components/maps/MapViewCompat';
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

function getStopDisplayNumber(index) {
  return Number(index) + 1;
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
  return (
    <ScrollView
      className="flex-1 bg-white px-5"
      contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 }}
      showsVerticalScrollIndicator={false}
    >
      <Text className="text-xl font-bold text-gray-900">Trip receipt</Text>
      <Text className="mt-1 text-base text-gray-500">Saved to your driver activity.</Text>

      <View className="mt-5 rounded-[28px] border border-gray-100 bg-[#f8fafc] px-5 py-5">
        <Text className="text-sm font-semibold uppercase tracking-wide text-gray-400">Passenger</Text>
        <Text className="mt-1 text-xl font-bold text-gray-900">{ratingRide.passengerName || 'Passenger'}</Text>
        <Text className="mt-4 text-sm font-semibold uppercase tracking-wide text-gray-400">Route</Text>
        <Text className="mt-1 text-base font-bold text-gray-900">{ratingRide.pickupLabel || 'Pickup'}</Text>
        {Array.isArray(ratingRide.intermediateStops) && ratingRide.intermediateStops.length ? (
          ratingRide.intermediateStops.map((stop, index) => (
            <React.Fragment key={`receipt-stop-${index}`}>
              <Text className="mt-1 text-sm text-gray-500">via</Text>
              <Text className="mt-1 text-base font-bold text-gray-900">{stop?.label || `Stop ${index + 1}`}</Text>
            </React.Fragment>
          ))
        ) : null}
        <Text className="mt-1 text-sm text-gray-500">to</Text>
        <Text className="mt-1 text-base font-bold text-gray-900">{ratingRide.dropoffLabel || 'Drop-off'}</Text>
        <View className="mt-5 rounded-[22px] bg-white px-4 py-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-gray-500">Fare</Text>
            <Text className="text-base font-bold text-gray-900">{formatCurrency(fareAmount)}</Text>
          </View>
          {Number(discountAmount || 0) > 0 ? (
            <>
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-sm text-gray-500">Passenger promo</Text>
                <Text className="text-base font-bold text-amber-600">-{formatCurrency(discountAmount)}</Text>
              </View>
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-sm text-gray-500">Passenger paid</Text>
                <Text className="text-base font-bold text-gray-900">{formatCurrency(passengerFareAmount)}</Text>
              </View>
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-sm text-gray-500">Admin reimbursement</Text>
                <Text className="text-base font-bold text-indigo-700">{formatCurrency(driverReimbursementAmount)}</Text>
              </View>
              {discountCode ? (
                <Text className="mt-2 text-xs font-semibold text-gray-500">Code applied: {discountCode}</Text>
              ) : null}
            </>
          ) : null}
          <View className="mt-3 flex-row items-center justify-between">
            <Text className="text-sm text-gray-500">Passenger tip</Text>
            <Text className={`text-base font-bold ${Number(tipAmount || 0) > 0 ? 'text-green-600' : 'text-gray-900'}`}>
              {formatCurrency(tipAmount)}
            </Text>
          </View>
          <View className="mt-3 flex-row items-center justify-between">
            <Text className="text-sm text-gray-500">Payment</Text>
            <Text className="text-base font-bold text-gray-900">
              {receiptPaymentMethodLabel(ratingRide.paymentMethod) || '-'}
            </Text>
          </View>
          <View className="mt-4 border-t border-gray-100 pt-4 flex-row items-center justify-between">
            <Text className="text-base font-bold text-gray-900">Total</Text>
            <Text className="text-2xl font-bold text-gray-900">{formatCurrency(totalAmount)}</Text>
          </View>
        </View>
        <Text className="mt-4 text-sm text-gray-500">
          {formatDateTime(ratingRide.completedAt) || 'Completed just now'}
        </Text>
      </View>

      <RideRatingTagPicker
        rating={passengerRating}
        onChangeRating={onSetPassengerRating}
        groups={DRIVER_PASSENGER_RATING_GROUPS}
        selectedTags={selectedRatingTags}
        onToggleTag={onTogglePassengerTag}
        review={passengerReview}
        onChangeReview={onSetPassengerReview}
        title="Please rate your Trust Express Passenger"
        subtitle={ratingRide.passengerName || 'Passenger'}
        safetyNote={DRIVER_PASSENGER_RATING_SAFETY_NOTE}
      />
      <TouchableOpacity
        onPress={onSubmit}
        disabled={submittingRating || passengerRating < 1}
        className="mt-6 h-14 items-center justify-center rounded-xl bg-[#2f73c9]"
        style={{ opacity: passengerRating < 1 ? 0.6 : 1 }}
      >
        {submittingRating ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-lg font-bold text-white">Done</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={onSkip} className="mt-4 items-center py-3">
        <Text className="text-base text-gray-500">Skip</Text>
      </TouchableOpacity>
    </ScrollView>
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
  const isPinStartAction = /pin/i.test(String(startRideLabel || '')) && !startRideDisabled;

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
          bottom: Math.max(tripPanelMaxHeight + insets.bottom + 12, 200),
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

      <View
        className="absolute left-4 right-4 flex-row items-center rounded-2xl bg-white px-3 py-3"
        style={{ top: insets.top + 10 }}
      >
        <View className="h-9 w-9 items-center justify-center rounded-full bg-red-50">
          <Ionicons name="location" size={19} color="#dc2626" />
        </View>
        <Text className="ml-3 flex-1 text-lg font-bold text-gray-900" numberOfLines={1}>
          {targetLabel}
        </Text>
        <TouchableOpacity
          onPress={onToggleVoiceGuidance}
          activeOpacity={0.85}
          className={`ml-2 h-10 w-10 items-center justify-center rounded-full ${voiceGuidanceEnabled ? 'bg-orange-500' : 'bg-gray-100'}`}
        >
          <Ionicons name={voiceGuidanceEnabled ? 'volume-high' : 'volume-mute'} size={18} color={voiceGuidanceEnabled ? '#fff' : '#374151'} />
        </TouchableOpacity>
        {showCallPassenger ? (
          <TouchableOpacity
            onPress={onCallPassenger}
            activeOpacity={0.85}
            className="ml-2 h-10 w-10 items-center justify-center rounded-full bg-green-50"
          >
            <Ionicons name="call-outline" size={19} color="#15803d" />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={onSendPanicAlert}
          activeOpacity={0.85}
          className="ml-2 h-10 w-10 items-center justify-center rounded-full bg-red-50"
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
          className="ml-2 h-10 w-10 items-center justify-center rounded-full bg-gray-100"
        >
          <Ionicons name="chatbubble-ellipses-outline" size={19} color="#111827" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onOpenExternalNavigation}
          activeOpacity={0.85}
          className="ml-2 h-10 w-10 items-center justify-center rounded-full bg-[#dbeafe]"
        >
          <Ionicons name="navigate" size={19} color="#1d4ed8" />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={onCenterDriver}
        className="absolute right-4 h-14 w-14 items-center justify-center rounded-2xl bg-white"
        style={{ bottom: tripPanelMaxHeight + insets.bottom + 20 }}
        activeOpacity={0.85}
      >
        <Ionicons name="locate" size={26} color="#4f46e5" />
      </TouchableOpacity>

      <View
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-white"
        style={{
          maxHeight: tripPanelMaxHeight + Math.max(insets.bottom, 12),
          paddingBottom: Math.max(insets.bottom, 12),
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
            <View className="h-1.5 w-14 rounded-full bg-gray-300" />
          </View>

          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-xl font-extrabold text-gray-950" numberOfLines={1}>{stageTitle}</Text>
              <Text className="mt-1 text-sm font-semibold text-gray-500" numberOfLines={1}>
                {primaryMetric} - {secondaryMetric}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-xs font-bold uppercase tracking-widest text-gray-400">Fare</Text>
              <Text className="mt-1 text-lg font-extrabold text-gray-950">{fareText}</Text>
            </View>
          </View>

          <View className="mt-3 flex-row items-center rounded-2xl bg-gray-50 px-3 py-2.5">
            {passengerProfileImageUrl ? (
              <Image source={{ uri: passengerProfileImageUrl }} style={{ width: 40, height: 40, borderRadius: 20 }} />
            ) : (
              <View className="h-10 w-10 items-center justify-center rounded-full bg-[#e0e7ff]">
                <Ionicons name="person" size={18} color={primaryBlue} />
              </View>
            )}
            <View className="ml-3 flex-1">
              <Text className="text-base font-bold text-gray-900" numberOfLines={1}>{passengerName}</Text>
              <Text className="mt-0.5 text-sm text-gray-500" numberOfLines={1}>{passengerSubtitle}</Text>
            </View>
          </View>

          {passengerConfirmationText ? (
            <View className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
              <Text className="text-xs font-bold uppercase tracking-widest text-emerald-700">Passenger update</Text>
              <Text className="mt-1 text-sm font-semibold text-emerald-900" numberOfLines={2}>{passengerConfirmationText}</Text>
            </View>
          ) : null}

          {safetyPinReminderText ? (
            <View className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
              <Text className="text-xs font-bold uppercase tracking-widest text-indigo-700">Night safety PIN</Text>
              <Text className="mt-1 text-sm font-semibold text-indigo-900" numberOfLines={2}>{safetyPinReminderText}</Text>
            </View>
          ) : null}

          {showGuidance ? (
            <View className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
              <View className="flex-row items-center">
                <View className="h-9 w-9 items-center justify-center rounded-full bg-white">
                  <Ionicons name="navigate" size={16} color="#4338ca" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-xs font-bold uppercase tracking-widest text-indigo-500">Next direction</Text>
                  <Text className="mt-0.5 text-sm font-bold text-gray-900" numberOfLines={2}>
                    {guidanceText || 'Follow the route to your destination.'}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {Array.isArray(stopTimeline) && stopTimeline.length > 2 ? (
            <View className="mt-3 rounded-2xl border border-orange-100 bg-orange-50 px-3 py-3">
              <Text className="text-xs font-bold uppercase tracking-widest text-orange-600">Trip stops</Text>
              <Text className="mt-1 text-sm font-semibold text-orange-900">
                {Number(remainingIntermediateStopsCount || 0) > 0
                  ? `${remainingIntermediateStopsCount} stop${remainingIntermediateStopsCount === 1 ? '' : 's'} remaining before final destination`
                  : 'Final destination leg'}
              </Text>
              <View className="mt-3">
                {stopTimeline.map((label, index) => {
                  const isPickup = index === 0
                  const isDropoff = index === stopTimeline.length - 1
                  const stopSequenceIndex = Math.max(0, index - 1)
                  const isCompletedStop = !isPickup && !isDropoff && stopSequenceIndex < Number(currentStopIndex || 0)
                  const isCurrentStop = !isPickup && !isDropoff && stopSequenceIndex === Number(currentStopIndex || 0)
                  return (
                    <View key={`${label}-${index}`} className="mb-2 flex-row items-start">
                      <View
                        className="mr-3 mt-1 h-3 w-3 rounded-full"
                        style={{
                          backgroundColor: isPickup
                            ? '#2563eb'
                            : isDropoff
                              ? '#111827'
                              : isCompletedStop
                                ? '#94a3b8'
                                : isCurrentStop
                                  ? '#f97316'
                                  : '#cbd5e1',
                        }}
                      />
                      <View className="flex-1">
                        <Text className="text-sm font-semibold text-gray-900">
                          {isPickup ? 'Pickup' : isDropoff ? 'Final destination' : `Stop ${getStopDisplayNumber(stopSequenceIndex)}`}
                        </Text>
                        <Text className="mt-0.5 text-sm text-gray-600">{label}</Text>
                      </View>
                    </View>
                  )
                })}
              </View>
            </View>
          ) : null}

          {showMarkArrived ? (
            <TouchableOpacity
              onPress={onMarkArrived}
              disabled={submitting}
              className="mt-3 h-14 items-center justify-center rounded-[20px]"
              style={{ backgroundColor: primaryBlue, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-lg font-bold text-white">Mark Arrived</Text>}
            </TouchableOpacity>
          ) : null}

          {showStartRide && showCancelRide ? (
            <View className="mt-3 flex-row">
              <TouchableOpacity
                onPress={onCancelRide}
                disabled={submitting || cancellingRide}
                className="mr-2 h-14 flex-1 items-center justify-center rounded-[20px] border border-red-200 bg-red-50"
                style={{ opacity: submitting || cancellingRide ? 0.7 : 1 }}
              >
                {cancellingRide ? <ActivityIndicator size="small" color="#dc2626" /> : <Text className="text-base font-bold text-red-600">Cancel Ride</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onStartRide}
                disabled={submitting || startRideDisabled}
                className={`ml-2 h-14 flex-1 flex-row items-center justify-center rounded-[20px] ${isPinStartAction ? 'border border-indigo-200' : ''}`}
                style={{
                  backgroundColor: isPinStartAction ? '#eef2ff' : primaryBlue,
                  opacity: submitting || startRideDisabled ? 0.7 : 1,
                }}
              >
              {submitting ? (
                <ActivityIndicator size="small" color={isPinStartAction ? '#4338ca' : '#fff'} />
              ) : (
                <>
                  {isPinStartAction ? <Ionicons name="keypad" size={18} color="#4338ca" style={{ marginRight: 7 }} /> : null}
                  <Text className={`text-base font-extrabold ${isPinStartAction ? 'text-indigo-800' : 'text-white'}`}>
                    {startRideLabel}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          ) : null}

          {showAdvanceStop ? (
            <TouchableOpacity
              onPress={onAdvanceStop}
              disabled={submitting}
              className="mt-3 h-14 items-center justify-center rounded-[20px] bg-orange-500"
              style={{ opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-base font-bold text-white">{advanceStopLabel || 'Reached stop'}</Text>}
            </TouchableOpacity>
          ) : null}

          {showCompleteRide && showCancelRide && !showStartRide ? (
            <View className="mt-3 flex-row">
              <TouchableOpacity
                onPress={onCancelRide}
                disabled={submitting || cancellingRide}
                className="mr-2 h-14 flex-1 items-center justify-center rounded-[20px] border border-red-200 bg-red-50"
                style={{ opacity: submitting || cancellingRide ? 0.7 : 1 }}
              >
                {cancellingRide ? <ActivityIndicator size="small" color="#dc2626" /> : <Text className="text-base font-bold text-red-600">Cancel Ride</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onCompleteRide}
                disabled={submitting}
                className="ml-2 h-14 flex-1 items-center justify-center rounded-[20px]"
                style={{ backgroundColor: primaryBlue, opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-base font-bold text-white">Complete Ride</Text>}
              </TouchableOpacity>
            </View>
          ) : null}

          {showCompleteRide && !showCancelRide ? (
            <TouchableOpacity
              onPress={onCompleteRide}
              disabled={submitting}
              className="mt-3 h-14 items-center justify-center rounded-[20px]"
              style={{ backgroundColor: primaryBlue, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-lg font-bold text-white">Complete Ride</Text>}
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}
