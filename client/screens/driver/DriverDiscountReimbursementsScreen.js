import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDriverDiscountReimbursements } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-ZW', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getStatusColors(status) {
  if (status === 'paid') {
    return {
      backgroundColor: '#DCFCE7',
      textColor: '#15803D',
      icon: 'checkmark-done-circle-outline',
    };
  }
  if (status === 'approved') {
    return {
      backgroundColor: '#DBEAFE',
      textColor: '#1D4ED8',
      icon: 'shield-checkmark-outline',
    };
  }
  return {
    backgroundColor: '#FEF3C7',
    textColor: '#B45309',
    icon: 'time-outline',
  };
}

export default function DriverDiscountReimbursementsScreen() {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState({
    outstandingTotal: 0,
    approvedTotal: 0,
    paidTotal: 0,
    lifetimeTotal: 0,
    totalBatches: 0,
  });
  const [reimbursements, setReimbursements] = useState([]);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const loadReimbursements = async (showRefreshing = false) => {
    try {
      setError('');
      if (showRefreshing) setRefreshing(true);
      else setLoading(true);

      const token = await getTokenRef.current();
      if (!token) throw new Error('Not signed in');
      const data = await getDriverDiscountReimbursements(token);
      setSummary({
        outstandingTotal: Number(data?.summary?.outstandingTotal || 0),
        approvedTotal: Number(data?.summary?.approvedTotal || 0),
        paidTotal: Number(data?.summary?.paidTotal || 0),
        lifetimeTotal: Number(data?.summary?.lifetimeTotal || 0),
        totalBatches: Number(data?.summary?.totalBatches || 0),
      });
      setReimbursements(Array.isArray(data?.reimbursements) ? data.reimbursements : []);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load reimbursements.');
      setSummary({
        outstandingTotal: 0,
        approvedTotal: 0,
        paidTotal: 0,
        lifetimeTotal: 0,
        totalBatches: 0,
      });
      setReimbursements([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isFocused) return undefined;
    loadReimbursements(false);
    return undefined;
  }, [isFocused]);

  return (
    <View className="flex-1 bg-gray-50">
      <View
        className="flex-row items-center justify-between border-b border-gray-100 bg-white"
        style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12 }}
      >
        <View className="w-10" />
        <Text className="text-lg font-bold text-gray-900">Reimbursements</Text>
        <View className="w-10" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center px-5">
          <ActivityIndicator size="large" color={PRIMARY_BLUE} />
          <Text className="mt-4 text-base text-gray-500">Loading reimbursements...</Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, 24) }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadReimbursements(true)} tintColor={PRIMARY_BLUE} />}
          showsVerticalScrollIndicator={false}
        >
          <View className="rounded-2xl p-5" style={{ backgroundColor: PRIMARY_BLUE }}>
            <Text className="mb-1 text-sm font-medium text-white/90">Outstanding reimbursement</Text>
            <Text className="text-3xl font-bold text-white">{formatCurrency(summary.outstandingTotal)}</Text>
            <Text className="mt-1 text-sm text-white/80">{summary.totalBatches} reimbursement batch{summary.totalBatches === 1 ? '' : 'es'}</Text>
            <View className="mt-4 flex-row items-center justify-between border-t border-white/20 pt-3">
              <Text className="text-xs text-white/80">Approved: {formatCurrency(summary.approvedTotal)}</Text>
              <Text className="text-xs text-white/80">Paid: {formatCurrency(summary.paidTotal)}</Text>
            </View>
          </View>

          <View className="mt-5 mb-6 flex-row justify-between">
            {[
              { key: 'lifetime', label: 'Lifetime', value: formatCurrency(summary.lifetimeTotal), icon: 'cash-outline' },
              { key: 'outstanding', label: 'Outstanding', value: formatCurrency(summary.outstandingTotal), icon: 'wallet-outline' },
              { key: 'paid', label: 'Paid', value: formatCurrency(summary.paidTotal), icon: 'checkmark-done-outline' },
            ].map(({ key, label, value, icon }) => (
              <View key={key} className="items-center">
                <View className="mb-2 h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: '#EFF6FF' }}>
                  <Ionicons name={icon} size={24} color={PRIMARY_BLUE} />
                </View>
                <Text className="text-sm font-semibold text-gray-900">{value}</Text>
                <Text className="text-sm text-gray-500">{label}</Text>
              </View>
            ))}
          </View>

          {error ? (
            <View className="mb-4 rounded-[20px] bg-red-50 px-4 py-4">
              <Text className="text-base font-medium text-red-600">{error}</Text>
            </View>
          ) : null}

          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-gray-900">Discount reimbursement batches</Text>
          </View>

          <View className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
            {!reimbursements.length ? (
              <View className="px-5 py-10">
                <Text className="text-center text-base text-gray-500">No reimbursement batches yet.</Text>
              </View>
            ) : (
              reimbursements.map((item, index) => {
                const statusStyle = getStatusColors(item.status);
                return (
                  <View
                    key={item.id}
                    className="px-4 py-4"
                    style={index < reimbursements.length - 1 ? { borderBottomWidth: 1, borderBottomColor: '#f9fafb' } : undefined}
                  >
                    <View className="flex-row items-start justify-between">
                      <View className="mr-3 flex-1">
                        <Text className="text-base font-semibold text-gray-900">
                          {formatDate(item.periodStart)} - {formatDate(item.periodEnd)}
                        </Text>
                        <Text className="mt-1 text-sm text-gray-500">
                          {Number(item.rideCount || 0)} discounted ride{Number(item.rideCount || 0) === 1 ? '' : 's'}
                        </Text>
                        {item.adminNote ? (
                          <Text className="mt-2 text-sm text-gray-600">{item.adminNote}</Text>
                        ) : null}
                        {item.paidAt ? (
                          <Text className="mt-2 text-xs text-green-600">Paid on {formatDate(item.paidAt)}</Text>
                        ) : item.approvedAt ? (
                          <Text className="mt-2 text-xs text-blue-600">Approved on {formatDate(item.approvedAt)}</Text>
                        ) : null}
                      </View>
                      <View className="items-end">
                        <View className="flex-row items-center rounded-full px-3 py-1.5" style={{ backgroundColor: statusStyle.backgroundColor }}>
                          <Ionicons name={statusStyle.icon} size={14} color={statusStyle.textColor} />
                          <Text className="ml-1.5 text-xs font-bold uppercase" style={{ color: statusStyle.textColor }}>
                            {item.status}
                          </Text>
                        </View>
                        <Text className="mt-3 text-lg font-bold text-gray-900">{formatCurrency(item.totalDiscountReimbursement)}</Text>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
