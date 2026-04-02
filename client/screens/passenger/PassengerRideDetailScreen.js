import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPassengerRideDetails, submitPassengerDriverRating } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-ZW', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function PassengerRideDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const rideRequestId = route.params?.rideRequestId;
  const [ride, setRide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');

  useEffect(() => {
    let active = true;

    const loadRide = async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('Not signed in');
        const data = await getPassengerRideDetails(token, rideRequestId);
        if (!active) return;
        setRide(data?.ride || null);
        setRating(Number(data?.ride?.passengerDriverRating || 0));
        setReview(String(data?.ride?.passengerDriverReview || ''));
      } catch (error) {
        if (!active) return;
        Alert.alert('Ride details unavailable', error?.message || 'Could not load this ride.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadRide();
    return () => {
      active = false;
    };
  }, [getToken, rideRequestId]);

  const handleSubmitRating = async () => {
    try {
      if (!rideRequestId || rating < 1) {
        Alert.alert('Choose a rating', 'Select between 1 and 5 stars.');
        return;
      }
      setSubmitting(true);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await submitPassengerDriverRating(token, rideRequestId, { rating, review });
      setRide((current) => current ? {
        ...current,
        passengerDriverRating: rating,
        passengerDriverReview: review,
      } : current);
      Alert.alert('Thanks', 'Your rating was saved.');
    } catch (error) {
      Alert.alert('Rating failed', error?.message || 'Could not save your rating.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-5">
        <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        <Text className="mt-4 text-base text-gray-500">Loading ride details...</Text>
      </View>
    );
  }

  if (!ride) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-5">
        <Text className="text-xl font-bold text-gray-900">Ride not found</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <View className="border-b border-gray-100 bg-white px-5 pb-3" style={{ paddingTop: insets.top + 8 }}>
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-[#f3f6fb]">
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>
          <Text className="text-lg font-bold text-gray-900">Ride Details</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
        <View className="rounded-[28px] border border-gray-100 bg-white px-5 py-5">
          <Text className="text-lg font-bold text-gray-900">{ride.pickupLabel}</Text>
          <Text className="mt-1 text-sm text-gray-500">to {ride.dropoffLabel}</Text>
          <Text className="mt-4 text-3xl font-bold text-gray-900">{formatCurrency(ride.estimatedAmount)}</Text>
          <Text className="mt-1 text-sm text-gray-500">{ride.tierName || 'Ride'}</Text>

          <View className="mt-5 border-t border-gray-100 pt-4">
            <Text className="text-sm text-gray-500">Driver</Text>
            <Text className="mt-1 text-base font-bold text-gray-900">{ride.driverName || 'No driver assigned'}</Text>
            <Text className="mt-1 text-sm text-gray-500">{formatDate(ride.completedAt || ride.requestedAt)}</Text>
          </View>
        </View>

        {ride.canRateDriver ? (
          <View className="mt-5 rounded-[28px] border border-gray-100 bg-white px-5 py-5">
            <Text className="text-xl font-bold text-gray-900">Rate Driver</Text>
            <Text className="mt-2 text-sm text-gray-500">How was your trip with {ride.driverName || 'your driver'}?</Text>

            <View className="mt-5 flex-row items-center justify-between">
              {[1, 2, 3, 4, 5].map((value) => (
                <TouchableOpacity key={value} onPress={() => setRating(value)} className="h-12 w-12 items-center justify-center rounded-full bg-[#f8fafc]">
                  <Ionicons name={value <= rating ? 'star' : 'star-outline'} size={28} color={value <= rating ? '#f59e0b' : '#9ca3af'} />
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              value={review}
              onChangeText={setReview}
              placeholder="Write optional feedback"
              multiline
              textAlignVertical="top"
              className="mt-5 min-h-[120px] rounded-[22px] bg-[#f8fafc] px-4 py-4 text-base text-gray-900"
            />

            <TouchableOpacity
              onPress={handleSubmitRating}
              disabled={submitting}
              className="mt-5 h-14 items-center justify-center rounded-[22px]"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-lg font-bold text-white">Save Rating</Text>}
            </TouchableOpacity>
          </View>
        ) : ride.passengerDriverRating ? (
          <View className="mt-5 rounded-[28px] border border-gray-100 bg-white px-5 py-5">
            <Text className="text-xl font-bold text-gray-900">Your Rating</Text>
            <View className="mt-4 flex-row">
              {[1, 2, 3, 4, 5].map((value) => (
                <Ionicons key={value} name={value <= ride.passengerDriverRating ? 'star' : 'star-outline'} size={24} color={value <= ride.passengerDriverRating ? '#f59e0b' : '#9ca3af'} />
              ))}
            </View>
            {ride.passengerDriverReview ? (
              <Text className="mt-4 text-base text-gray-700">{ride.passengerDriverReview}</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
