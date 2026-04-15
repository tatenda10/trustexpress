import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDriverRideHistory } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

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

function Stars({ value }) {
  return (
    <View className="flex-row items-center">
      {[1, 2, 3, 4, 5].map((star) => (
        <Ionicons
          key={star}
          name={star <= value ? 'star' : 'star-outline'}
          size={16}
          color="#f59e0b"
          style={{ marginRight: 2 }}
        />
      ))}
    </View>
  );
}

export default function DriverReviewsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const loadReviews = async (isRefresh = false) => {
    try {
      setError('');
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const data = await getDriverRideHistory(token, { page: 1, limit: 50 });
      const rides = Array.isArray(data?.rides) ? data.rides : [];
      setReviews(
        rides.filter((ride) => ride.passengerDriverRating !== null || String(ride.passengerDriverReview || '').trim())
      );
    } catch (loadError) {
      setError(loadError?.message || 'Could not load your reviews.');
      setReviews([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadReviews();
  }, []);

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center justify-between bg-[#f6f7f3]"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 14 }}
      >
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => navigation.goBack()}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-[18px] font-bold text-gray-900">Your reviews</Text>
        <View className="h-10 w-10" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadReviews(true)} tintColor={PRIMARY_BLUE} />}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View className="mb-4 rounded-[24px] bg-red-50 px-4 py-4">
              <Text className="text-base font-medium text-red-600">{error}</Text>
            </View>
          ) : null}

          {!reviews.length ? (
            <View className="rounded-[28px] bg-white px-5 py-16 items-center">
              <Ionicons name="star-outline" size={34} color="#9ca3af" />
              <Text className="mt-4 text-xl font-semibold text-gray-900">No reviews yet</Text>
              <Text className="mt-2 text-center text-gray-500">
                Passenger reviews will appear here after completed trips.
              </Text>
            </View>
          ) : (
            reviews.map((ride) => (
              <View key={ride.id} className="mb-4 rounded-[28px] bg-white px-5 py-5">
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 pr-4">
                    <Text className="text-sm text-gray-500">Anonymous trip review</Text>
                  </View>
                  <Text className="text-sm text-gray-400">{formatDate(ride.passengerDriverRatedAt || ride.completedAt)}</Text>
                </View>

                {ride.passengerDriverReviewPending ? (
                  <View className="mt-4 rounded-xl bg-[#eff6ff] px-3 py-3">
                    <Text className="text-sm font-medium text-[#1d4ed8]">
                      New feedback received. Details will appear shortly.
                    </Text>
                  </View>
                ) : null}

                {ride.passengerDriverRating !== null ? (
                  <View className="mt-4 flex-row items-center">
                    <Stars value={ride.passengerDriverRating} />
                    <Text className="ml-2 text-base font-semibold text-gray-900">{ride.passengerDriverRating}/5</Text>
                  </View>
                ) : null}

                {ride.passengerDriverReview ? (
                  <Text className="mt-4 text-[15px] leading-6 text-gray-700">{ride.passengerDriverReview}</Text>
                ) : (
                  <Text className="mt-4 text-sm text-gray-400">No written comment on this trip.</Text>
                )}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}
