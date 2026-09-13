import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIMARY_BLUE } from '../../constants/colors';
import { getTransactionDetailRows, getTransactionMeta } from './walletTransactionMeta';

export default function DriverWalletTransactionDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const transaction = route?.params?.transaction || null;
  const currency = route?.params?.currency || transaction?.currency || 'ZAR';
  const meta = getTransactionMeta(transaction);
  const rows = getTransactionDetailRows(transaction, currency);

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
        <Text className="text-[18px] font-bold text-gray-900">Transaction</Text>
        <View className="h-10 w-10" />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-5 items-center rounded-2xl bg-white px-5 py-6">
          <View className="h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: meta.iconBg }}>
            <Ionicons name={meta.icon} size={26} color={PRIMARY_BLUE} />
          </View>
          <Text className="mt-3 text-center text-lg font-bold text-gray-900">
            {transaction ? meta.title : 'Transaction'}
          </Text>
          {transaction ? (
            <Text className={`mt-2 text-2xl font-bold ${meta.amountColor}`}>
              {meta.amountPrefix}
              {String(currency).toUpperCase()} {Number(Math.abs(transaction.amount || 0)).toFixed(2)}
            </Text>
          ) : null}
        </View>

        <View className="overflow-hidden rounded-2xl bg-white px-5 py-2">
          {rows.length ? (
            rows.map(([label, value], index) => (
              <View
                key={label}
                className="flex-row items-start justify-between py-3"
                style={index < rows.length - 1 ? { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' } : undefined}
              >
                <Text className="mr-3 text-sm text-gray-500">{label}</Text>
                <Text className="flex-1 text-right text-sm font-semibold text-gray-900">{value}</Text>
              </View>
            ))
          ) : (
            <Text className="py-6 text-center text-sm text-gray-500">This transaction could not be loaded.</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
