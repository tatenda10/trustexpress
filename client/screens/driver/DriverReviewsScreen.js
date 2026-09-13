import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDriverRideHistory } from '../../api';

const LAST_REVIEWS_FOR_AVERAGE = 31;
const TIPS = [
  'Keep the vehicle clean and tidy.',
  'Arrive at pickup on time.',
  'Drive safely and smoothly.',
  'Be polite and confirm the destination.',
];

function formatDay(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

function dayKey(value) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function reviewTags(ride) {
  const fromPayload = Array.isArray(ride?.passengerDriverFeedbackTags)
    ? ride.passengerDriverFeedbackTags
    : [];
  const fromReview = String(ride?.passengerDriverReview || '')
    .split(/(?:\.\s+|\n+)/)
    .map((part) => part.trim().replace(/\.$/, ''))
    .filter(Boolean);
  return Array.from(new Set([...fromPayload, ...fromReview].map((tag) => String(tag).trim()).filter(Boolean)));
}

function moodForRating(rating) {
  const value = Number(rating);
  if (value >= 4) return { emoji: '😊', background: '#FDE68A' };
  if (value >= 3) return { emoji: '😐', background: '#E5E7EB' };
  return { emoji: '🙁', background: '#FECACA' };
}

function Stars({ value }) {
  const rating = Math.round(Number(value) || 0);
  return (
    <View className="flex-row items-center">
      {[1, 2, 3, 4, 5].map((star) => (
        <Ionicons
          key={star}
          name={star <= rating ? 'star' : 'star-outline'}
          size={15}
          color="#f5b301"
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
  const [showTips, setShowTips] = useState(false);

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

      const collected = [];
      let page = 1;
      let hasNextPage = true;
      while (hasNextPage && page <= 40) {
        const data = await getDriverRideHistory(token, { page, limit: 50, reviewsOnly: true });
        const rides = Array.isArray(data?.rides) ? data.rides : [];
        collected.push(...rides);
        hasNextPage = !!data?.pagination?.hasNextPage;
        if (!rides.length) break;
        page += 1;
      }

      const nextReviews = collected
        .filter((ride) => (
          ride.passengerDriverRating !== null
          || String(ride.passengerDriverReview || '').trim()
          || (Array.isArray(ride.passengerDriverFeedbackTags) && ride.passengerDriverFeedbackTags.length)
          || ride.passengerDriverReviewPending
        ))
        .sort((a, b) => {
          const aTime = new Date(a.passengerDriverRatedAt || a.completedAt || 0).getTime();
          const bTime = new Date(b.passengerDriverRatedAt || b.completedAt || 0).getTime();
          return bTime - aTime;
        });
      setReviews(nextReviews);
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

  const visibleReviews = reviews.filter((ride) => !ride.passengerDriverReviewPending);
  const averageReviews = visibleReviews
    .filter((ride) => ride.passengerDriverRating !== null)
    .slice(0, LAST_REVIEWS_FOR_AVERAGE);
  const averageRating = averageReviews.length
    ? averageReviews.reduce((sum, ride) => sum + Number(ride.passengerDriverRating || 0), 0) / averageReviews.length
    : null;

  const groupedReviews = useMemo(() => {
    const groups = [];
    const indexByDay = new Map();
    reviews.forEach((ride) => {
      const key = dayKey(ride.passengerDriverRatedAt || ride.completedAt);
      if (!indexByDay.has(key)) {
        indexByDay.set(key, groups.length);
        groups.push({
          key,
          dateLabel: formatDay(ride.passengerDriverRatedAt || ride.completedAt) || 'Recent',
          items: [],
        });
      }
      groups[indexByDay.get(key)].items.push(ride);
    });
    return groups;
  }, [reviews]);

  return (
    <View className="flex-1 bg-[#f3f4f6]">
      <View
        className="flex-row items-center justify-between"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10 }}
      >
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => navigation.goBack()}
          className="h-10 w-10 items-center justify-center"
        >
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text className="text-[17px] font-semibold text-gray-900">Rating and feedback</Text>
        <View className="h-10 w-10" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color="#111827" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadReviews(true)} tintColor="#111827" />}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View className="mx-4 mb-3 rounded-2xl bg-red-50 px-4 py-4">
              <Text className="text-base font-medium text-red-600">{error}</Text>
            </View>
          ) : null}

          <View className="items-center px-5 pb-5 pt-2">
            <View className="flex-row items-end">
              <Text className="text-[40px] font-bold leading-none text-gray-900">
                {averageRating === null ? '—' : averageRating.toFixed(3)}
              </Text>
              <Ionicons name="star" size={22} color="#f5b301" style={{ marginLeft: 6, marginBottom: 6 }} />
            </View>
            <Text className="mt-2 text-sm text-gray-500">
              {averageReviews.length
                ? `Based on the last ${averageReviews.length} review${averageReviews.length === 1 ? '' : 's'}`
                : 'No reviews yet'}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => setShowTips(true)}
            activeOpacity={0.8}
            className="mx-0 flex-row items-center border-y border-gray-200 bg-white px-4 py-4"
          >
            <Ionicons name="bulb-outline" size={20} color="#6b7280" />
            <Text className="ml-3 flex-1 text-[16px] text-gray-900">Tips for success</Text>
            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
          </TouchableOpacity>

          {!reviews.length ? (
            <View className="items-center px-8 py-16">
              <Text className="text-base text-gray-500">Passenger reviews will appear here after completed trips.</Text>
            </View>
          ) : (
            groupedReviews.map((group) => (
              <View key={group.key} className="mt-5">
                <View className="mb-1 flex-row items-center justify-between px-4">
                  <Text className="text-[15px] font-semibold text-gray-900">
                    {group.items.length} review{group.items.length === 1 ? '' : 's'}
                  </Text>
                  <Text className="text-sm text-gray-400">{group.dateLabel}</Text>
                </View>

                {group.items.map((ride) => {
                  const tags = reviewTags(ride);
                  const mood = moodForRating(ride.passengerDriverRating);
                  return (
                    <View key={ride.id} className="flex-row px-4 py-3">
                      <View
                        className="mt-0.5 h-8 w-8 items-center justify-center rounded-full"
                        style={{ backgroundColor: mood.background }}
                      >
                        <Text className="text-base">{mood.emoji}</Text>
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="text-[15px] text-gray-500">Passenger</Text>
                        {ride.passengerDriverReviewPending ? (
                          <Text className="mt-1 text-sm text-gray-500">New feedback received. Details will appear shortly.</Text>
                        ) : (
                          <>
                            {ride.passengerDriverRating !== null ? (
                              <View className="mt-1">
                                <Stars value={ride.passengerDriverRating} />
                              </View>
                            ) : null}
                            {tags.length ? (
                              <View className="mt-2 flex-row flex-wrap">
                                {tags.map((tag) => (
                                  <View key={tag} className="mb-2 mr-2 rounded-full bg-[#e5e7eb] px-2.5 py-1">
                                    <Text className="text-[13px] text-gray-600">{tag}</Text>
                                  </View>
                                ))}
                              </View>
                            ) : null}
                          </>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal visible={showTips} transparent animationType="fade" onRequestClose={() => setShowTips(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full rounded-[24px] bg-white px-5 py-5">
            <Text className="text-lg font-bold text-gray-900">Tips for success</Text>
            {TIPS.map((tip) => (
              <View key={tip} className="mt-3 flex-row items-start">
                <Text className="mr-2 text-base text-gray-400">•</Text>
                <Text className="flex-1 text-[15px] leading-6 text-gray-700">{tip}</Text>
              </View>
            ))}
            <TouchableOpacity
              onPress={() => setShowTips(false)}
              className="mt-5 h-12 items-center justify-center rounded-2xl bg-gray-900"
            >
              <Text className="font-semibold text-white">Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
