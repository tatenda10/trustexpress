import React from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveUploadedMediaUrl } from '../../api';
import { paymentMethodLabel } from '../../constants/payment';

const PRIMARY_BLUE = '#2f73c9';

function formatPickupDistance(request) {
  const km = Number((request?.pickupRouteDistanceKm ?? request?.driverDistanceKm) || 0);
  if (km < 1) return `~${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `~${km.toFixed(1)} km`;
}

function formatRequestedAgo(requestedAt, nowMs) {
  const requestedMs = requestedAt ? new Date(requestedAt).getTime() : NaN;
  if (!Number.isFinite(requestedMs)) return '';
  const minutes = Math.floor(Math.max(0, nowMs - requestedMs) / 60000);
  if (minutes < 1) return 'Just now';
  return `${minutes} min.`;
}

function getFirstName(name) {
  const trimmed = String(name || '').trim();
  return trimmed ? trimmed.split(/\s+/)[0] : 'Passenger';
}

function IncomingRideRequestRow({ request, nowMs, remainingLabel, onSelect, onAccept, accepting, acceptDisabled }) {
  const imageUrl = resolveUploadedMediaUrl(request?.passengerProfile?.imageUrl);
  const rating = Number(request?.passengerRating);
  const ratingCount = Number(request?.passengerRatingCount || 0);
  const stopCount = Array.isArray(request?.intermediateStops) ? request.intermediateStops.length : 0;
  const peopleCount = Number(request?.passengerCount || 1);
  const payment = paymentMethodLabel(request?.paymentMethod);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onSelect(request)}
      className="flex-row border-b border-[#eef2f7] bg-white px-4 py-3.5"
    >
      <View className="mr-3 w-16 items-center">
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: 48, height: 48, borderRadius: 24 }} />
        ) : (
          <View className="h-12 w-12 items-center justify-center rounded-full bg-[#e0e7ff]">
            <Ionicons name="person" size={22} color={PRIMARY_BLUE} />
          </View>
        )}
        <Text className="mt-1 text-xs font-semibold text-[#111827]" numberOfLines={1}>
          {getFirstName(request?.passengerName)}
        </Text>
        {Number.isFinite(rating) && rating > 0 ? (
          <View className="mt-0.5 flex-row items-center">
            <Ionicons name="star" size={11} color="#f59e0b" />
            <Text className="ml-0.5 text-[11px] font-semibold text-[#374151]">
              {rating.toFixed(2).replace(/0$/, '')}
            </Text>
            {ratingCount > 0 ? (
              <Text className="ml-0.5 text-[11px] text-[#6b7280]">({ratingCount})</Text>
            ) : null}
          </View>
        ) : (
          <Text className="mt-0.5 text-[11px] font-semibold text-[#15803d]">New</Text>
        )}
        <Text className="mt-0.5 text-[11px] text-[#6b7280]">{formatRequestedAgo(request?.requestedAt, nowMs)}</Text>
      </View>

      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-medium text-[#6b7280]">{formatPickupDistance(request)}</Text>
          <View className="rounded-full bg-[#111827] px-2.5 py-0.5">
            <Text className="text-[11px] font-bold text-white">{remainingLabel}</Text>
          </View>
        </View>
        <Text className="mt-0.5 text-2xl font-extrabold text-[#111111]">
          ${Number(request?.estimatedAmount || 0).toFixed(2)}
        </Text>
        <Text className="mt-0.5 text-[15px] font-semibold text-[#111827]" numberOfLines={2}>
          {request?.pickup || request?.pickupLabel || 'Pickup'}
        </Text>
        <Text className="mt-0.5 text-sm text-[#5a6474]" numberOfLines={2}>
          {stopCount > 0 ? `via ${stopCount} stop${stopCount === 1 ? '' : 's'} · ` : ''}
          {request?.dropoff || request?.dropoffLabel || 'Drop-off'}
        </Text>
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="flex-1 pr-2 text-xs font-semibold uppercase text-[#2f73c9]" numberOfLines={1}>
            {peopleCount === 1 ? '1 person' : `${peopleCount} people`}
            {payment ? ` · ${payment}` : ''}
          </Text>
          <TouchableOpacity
            onPress={() => onAccept(request)}
            disabled={acceptDisabled}
            className="h-9 min-w-[88px] items-center justify-center rounded-[12px] px-4"
            style={{ backgroundColor: PRIMARY_BLUE, opacity: acceptDisabled && !accepting ? 0.5 : 1 }}
          >
            {accepting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-xs font-bold uppercase text-white">Accept</Text>
            )}
          </TouchableOpacity>
        </View>
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
  acceptingRideId,
  style = null,
}) {
  return (
    <View className="overflow-hidden rounded-[24px] bg-white" style={[{ maxHeight: '100%' }, style]}>
      <View className="flex-row items-center justify-between border-b border-[#eef2f7] px-4 py-3">
        <Text className="text-base font-bold text-[#111111]">Ride requests</Text>
        <View className="rounded-full bg-[#2f73c9] px-2.5 py-0.5">
          <Text className="text-xs font-bold text-white">{requests.length}</Text>
        </View>
      </View>
      <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} showsVerticalScrollIndicator={false}>
        {requests.map((request) => (
          <IncomingRideRequestRow
            key={String(request.id)}
            request={request}
            nowMs={nowMs}
            remainingLabel={getRemainingLabel(request)}
            onSelect={onSelect}
            onAccept={onAccept}
            accepting={acceptingRideId === request.id}
            acceptDisabled={Boolean(acceptingRideId)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
