import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getApiUrl } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

const FALLBACK_TIERS = [
  { tierKey: 'blue', tierName: 'Blue Captain', badgeColor: '#2563EB', minRides: 1, maxRides: 9, rewardAmountUsd: 0 },
  { tierKey: 'silver', tierName: 'Silver Captain', badgeColor: '#94A3B8', minRides: 10, maxRides: 19, rewardAmountUsd: 1.5 },
  { tierKey: 'gold', tierName: 'Gold Captain', badgeColor: '#EAB308', minRides: 20, maxRides: 34, rewardAmountUsd: 3 },
  { tierKey: 'diamond', tierName: 'Diamond Captain', badgeColor: '#06B6D4', minRides: 35, maxRides: null, rewardAmountUsd: 5 },
];

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatCycleDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-ZW', { month: 'short', day: 'numeric' });
}

function rideRangeLabel(tier) {
  const minRides = Number(tier?.minRides || 0);
  const maxRides = tier?.maxRides == null ? null : Number(tier.maxRides);
  if (maxRides == null) return `${minRides}+ qualifying rides`;
  if (minRides === maxRides) return `${minRides} qualifying ride${minRides === 1 ? '' : 's'}`;
  return `${minRides}–${maxRides} qualifying rides`;
}

function ineligibleCopy(reason) {
  if (reason === 'not_fully_verified') return 'Finish profile, vehicle, and phone verification to earn rewards.';
  if (reason === 'account_restricted') return 'This account cannot earn rewards right now.';
  return '';
}

export default function DriverCaptainRewardsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const loadStatus = useCallback(async (isRefresh = false) => {
    try {
      setError('');
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const token = await getTokenRef.current();
      if (!token) throw new Error('Sign in to view Captain rewards.');

      const res = await fetch(getApiUrl('/api/drivers/captain-status'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not load Captain rewards.');
      setStatus(data);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load Captain rewards.');
      if (!isRefresh) setStatus(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const tiers = Array.isArray(status?.tiers) && status.tiers.length
    ? status.tiers
    : FALLBACK_TIERS;
  const qualifyingRides = Number(status?.qualifyingRides || 0);
  const currentTierKey = String(status?.tierKey || '').trim().toLowerCase();
  const cycleStart = formatCycleDate(status?.cycle?.startsAt);
  const cycleEnd = formatCycleDate(status?.cycle?.endsAt);
  const daysRemaining = Number(status?.cycle?.daysRemaining || 0);
  const ineligibleNote = status?.eligible === false ? ineligibleCopy(status?.ineligibleReason) : '';

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
        <Text className="text-[17px] font-semibold text-gray-900">Captain rewards</Text>
        <View className="h-10 w-10" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 28 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadStatus(true)} tintColor={PRIMARY_BLUE} />}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View className="mb-3 rounded-2xl bg-red-50 px-4 py-4">
              <Text className="text-base font-medium text-red-600">{error}</Text>
            </View>
          ) : null}

          {status?.enabled === false ? (
            <View className="rounded-[28px] bg-white px-5 py-5">
              <Text className="text-base text-gray-600">
                {status?.unavailableMessage || 'Captain rewards are not active right now.'}
              </Text>
            </View>
          ) : (
            <>
              <View className="overflow-hidden rounded-[28px] bg-white px-5 py-5">
                <Text className="text-xs font-semibold uppercase tracking-[1.1px] text-gray-500">Where you are</Text>
                <View className="mt-3 flex-row items-center">
                  <View
                    className="h-12 w-12 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${status?.badgeColor || PRIMARY_BLUE}22` }}
                  >
                    <Ionicons name="ribbon" size={22} color={status?.badgeColor || PRIMARY_BLUE} />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-xl font-bold text-gray-900">{status?.tierName || 'No tier yet'}</Text>
                    <Text className="mt-0.5 text-sm text-gray-500">
                      {qualifyingRides} qualifying ride{qualifyingRides === 1 ? '' : 's'} this cycle
                    </Text>
                  </View>
                  <View
                    className="rounded-full px-3 py-1.5"
                    style={{ backgroundColor: `${status?.badgeColor || PRIMARY_BLUE}22` }}
                  >
                    <Text className="text-xs font-semibold" style={{ color: status?.badgeColor || PRIMARY_BLUE }}>
                      {status?.rewardStatusLabel || 'In Progress'}
                    </Text>
                  </View>
                </View>

                <View className="mt-4 flex-row">
                  <View className="flex-1 rounded-2xl bg-[#f8fafc] px-3 py-3">
                    <Text className="text-xs text-gray-500">Reward</Text>
                    <Text className="mt-1 text-base font-bold text-gray-900">{formatUsd(status?.currentRewardUsd)}</Text>
                  </View>
                  <View className="ml-3 flex-1 rounded-2xl bg-[#f8fafc] px-3 py-3">
                    <Text className="text-xs text-gray-500">Cycle</Text>
                    <Text className="mt-1 text-base font-bold text-gray-900">
                      {daysRemaining} day{daysRemaining === 1 ? '' : 's'} left
                    </Text>
                    {cycleStart && cycleEnd ? (
                      <Text className="mt-0.5 text-xs text-gray-500">{cycleStart} – {cycleEnd}</Text>
                    ) : null}
                  </View>
                </View>

                {status?.nextTierName ? (
                  <View className="mt-4">
                    <View className="mb-2 flex-row items-center justify-between">
                      <Text className="text-sm text-gray-600">Next: {status.nextTierName}</Text>
                      <Text className="text-sm font-semibold text-gray-800">
                        {Number(status.ridesToNextTier || 0)} more ride{Number(status.ridesToNextTier || 0) === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <View className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <View
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, Number(status.progressPercent || 0))}%`,
                          backgroundColor: status.badgeColor || PRIMARY_BLUE,
                        }}
                      />
                    </View>
                  </View>
                ) : qualifyingRides > 0 ? (
                  <Text className="mt-4 text-sm text-gray-500">You are on the highest tier this cycle.</Text>
                ) : null}

                {ineligibleNote ? (
                  <Text className="mt-4 text-sm text-amber-700">{ineligibleNote}</Text>
                ) : null}
              </View>

              <Text className="mb-3 mt-6 px-1 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Tiers</Text>
              <View className="overflow-hidden rounded-[28px] bg-white">
                {tiers.map((tier, index) => {
                  const minRides = Number(tier.minRides || 0);
                  const reached = qualifyingRides >= minRides && minRides > 0;
                  const isCurrent = currentTierKey
                    ? String(tier.tierKey || '').trim().toLowerCase() === currentTierKey
                    : false;
                  const ridesNeeded = Math.max(0, minRides - qualifyingRides);

                  return (
                    <View
                      key={tier.tierKey || `${tier.tierName}-${index}`}
                      className="px-5 py-4"
                      style={index < tiers.length - 1 ? { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' } : null}
                    >
                      <View className="flex-row items-center">
                        <View
                          className="h-10 w-10 items-center justify-center rounded-full"
                          style={{ backgroundColor: `${tier.badgeColor || PRIMARY_BLUE}22` }}
                        >
                          <View
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: tier.badgeColor || PRIMARY_BLUE }}
                          />
                        </View>
                        <View className="ml-3 flex-1">
                          <View className="flex-row items-center">
                            <Text className="text-[16px] font-semibold text-gray-900">{tier.tierName}</Text>
                            {isCurrent ? (
                              <View className="ml-2 rounded-full bg-gray-900 px-2 py-0.5">
                                <Text className="text-[10px] font-semibold uppercase text-white">Current</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text className="mt-0.5 text-sm text-gray-500">{rideRangeLabel(tier)}</Text>
                        </View>
                        <Text className="text-base font-bold text-gray-900">{formatUsd(tier.rewardAmountUsd)}</Text>
                      </View>
                      <Text className="mt-2 text-sm text-gray-500">
                        {reached
                          ? isCurrent
                            ? `You are here with ${qualifyingRides} qualifying ride${qualifyingRides === 1 ? '' : 's'}.`
                            : 'Reached this cycle.'
                          : `Complete ${ridesNeeded} more qualifying ride${ridesNeeded === 1 ? '' : 's'} to reach this tier.`}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
