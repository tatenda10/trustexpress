import React from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveUploadedMediaUrl } from '../../api';
import { paymentMethodLabel } from '../../constants/payment';

const PRIMARY_BLUE = '#2f73c9';

function formatPickupDistance(request) {
  const km = Number((request?.pickupRouteDistanceKm ?? request?.driverDistanceKm) || 0);
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m away`;
  return `${km.toFixed(1)} km away`;
}

function formatTripSummary(request) {
  const km = Number(request?.tripDistanceKm || request?.estimatedDistanceKm || 0);
  const minutes = Number(request?.tripDurationMinutes || request?.estimatedMinutes || 0);
  const parts = [];
  if (km > 0) parts.push(`${km.toFixed(1)} km`);
  if (minutes > 0) parts.push(`${Math.round(minutes)} min`);
  return parts.join(' · ');
}

function formatRequestedAgo(requestedAt, nowMs) {
  const requestedMs = requestedAt ? new Date(requestedAt).getTime() : NaN;
  if (!Number.isFinite(requestedMs)) return '';
  const minutes = Math.floor(Math.max(0, nowMs - requestedMs) / 60000);
  if (minutes < 1) return 'Just now';
  return `${minutes} min ago`;
}

function getFirstName(name) {
  const trimmed = String(name || '').trim();
  return trimmed ? trimmed.split(/\s+/)[0] : 'Passenger';
}

function IncomingRideRequestCard({ request, nowMs, remainingLabel, onSelect, onAccept, onDecline, accepting, acceptDisabled }) {
  const imageUrl = resolveUploadedMediaUrl(request?.passengerProfile?.imageUrl);
  const rating = Number(request?.passengerRating);
  const ratingCount = Number(request?.passengerRatingCount || 0);
  const stopCount = Array.isArray(request?.intermediateStops) ? request.intermediateStops.length : 0;
  const peopleCount = Number(request?.passengerCount || 1);
  const payment = paymentMethodLabel(request?.paymentMethod);
  const tripSummary = formatTripSummary(request);
  const requestedAgo = formatRequestedAgo(request?.requestedAt, nowMs);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onSelect(request)}
      className="mb-3 rounded-[20px] bg-white px-4 pb-4 pt-3.5"
      style={{
        shadowColor: '#0f172a',
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
      }}
    >
      <View className="flex-row items-start justify-between">
        <View>
          <Text className="text-[24px] font-extrabold text-[#111111]">
            ${Number(request?.estimatedAmount || 0).toFixed(2)}
          </Text>
          <Text className="mt-0.5 text-[12px] font-medium text-[#6b7280]">
            {[request?.tierName, payment].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <View className="flex-row items-center rounded-full bg-[#111827] px-2.5 py-1">
          <Ionicons name="time-outline" size={12} color="#fff" />
          <Text className="ml-1 text-[12px] font-bold text-white">{remainingLabel}</Text>
        </View>
      </View>

      <View className="mt-3 flex-row">
        <View className="mr-3 items-center pt-1.5">
          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PRIMARY_BLUE }} />
          <View className="my-1 w-[2px] flex-1 bg-[#e5e7eb]" />
          <View className="h-2.5 w-2.5 rounded-[3px] bg-[#111827]" />
        </View>
        <View className="flex-1">
          <Text className="text-[14px] font-semibold text-[#111827]" numberOfLines={1}>
            {request?.pickup || request?.pickupLabel || 'Pickup'}
          </Text>
          <Text className="mt-0.5 text-[12px] text-[#6b7280]">{formatPickupDistance(request)}</Text>
          <Text className="mt-2 text-[14px] font-semibold text-[#111827]" numberOfLines={1}>
            {request?.dropoff || request?.dropoffLabel || 'Drop-off'}
          </Text>
          <Text className="mt-0.5 text-[12px] text-[#6b7280]">
            {[tripSummary, stopCount > 0 ? `${stopCount} stop${stopCount === 1 ? '' : 's'}` : null]
              .filter(Boolean)
              .join(' · ') || 'Trip'}
          </Text>
        </View>
      </View>

      <View className="mt-3 flex-row items-center border-t border-[#f1f5f9] pt-3">
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: 34, height: 34, borderRadius: 17 }} />
        ) : (
          <View className="h-[34px] w-[34px] items-center justify-center rounded-full bg-[#e0e7ff]">
            <Ionicons name="person" size={16} color={PRIMARY_BLUE} />
          </View>
        )}
        <View className="ml-2.5 flex-1 pr-2">
          <View className="flex-row items-center">
            <Text className="text-[13px] font-semibold text-[#111827]" numberOfLines={1}>
              {getFirstName(request?.passengerName)}
            </Text>
            {Number.isFinite(rating) && rating > 0 ? (
              <View className="ml-1.5 flex-row items-center">
                <Ionicons name="star" size={11} color="#f59e0b" />
                <Text className="ml-0.5 text-[12px] font-semibold text-[#374151]">
                  {rating.toFixed(1)}
                </Text>
                {ratingCount > 0 ? (
                  <Text className="ml-0.5 text-[11px] text-[#9ca3af]">({ratingCount})</Text>
                ) : null}
              </View>
            ) : (
              <Text className="ml-1.5 text-[11px] font-semibold text-[#15803d]">New</Text>
            )}
          </View>
          <Text className="text-[11px] text-[#6b7280]" numberOfLines={1}>
            {[peopleCount === 1 ? '1 person' : `${peopleCount} people`, requestedAgo].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {onDecline ? (
          <TouchableOpacity
            onPress={() => onDecline(request)}
            disabled={accepting}
            className="mr-2 h-10 items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-3.5"
            style={{ opacity: accepting ? 0.5 : 1 }}
          >
            <Text className="text-[13px] font-bold text-[#374151]">Decline</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={() => onAccept(request)}
          disabled={acceptDisabled}
          className="h-10 min-w-[88px] items-center justify-center rounded-[10px] px-4"
          style={{ backgroundColor: PRIMARY_BLUE, opacity: acceptDisabled && !accepting ? 0.5 : 1 }}
        >
          {accepting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-[13px] font-bold text-white">Accept</Text>
          )}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

export default function IncomingRideRequestList({
  requests,
  nowMs,
  getRemainingLabel,
  onSelect,
  onAccept,
  onDecline = null,
  acceptingRideId,
  style = null,
}) {
  return (
    <View className="flex-1 overflow-hidden rounded-[24px] bg-[#f6f7f3]" style={style}>
      <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
        <View>
          <Text className="text-[18px] font-bold text-[#111111]">Ride requests</Text>
          <Text className="mt-0.5 text-[12px] text-[#6b7280]">Tap a request to see the route</Text>
        </View>
        <View className="h-7 min-w-[28px] items-center justify-center rounded-full px-2" style={{ backgroundColor: PRIMARY_BLUE }}>
          <Text className="text-[13px] font-bold text-white">{requests.length}</Text>
        </View>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {requests.map((request) => (
          <IncomingRideRequestCard
            key={String(request.id)}
            request={request}
            nowMs={nowMs}
            remainingLabel={getRemainingLabel(request)}
            onSelect={onSelect}
            onAccept={onAccept}
            onDecline={onDecline}
            accepting={acceptingRideId === request.id}
            acceptDisabled={Boolean(acceptingRideId)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
