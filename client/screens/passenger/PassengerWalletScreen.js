import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIMARY_BLUE } from '../../constants/colors';

const TRANSACTIONS = [
  { id: '1', icon: 'car', iconBg: '#EFF6FF', title: 'Ride to Avondale', subtitle: 'Today • 2:30 PM', amount: -12.0, status: 'COMPLETED' },
  { id: '2', icon: 'wallet', iconBg: '#DCFCE7', title: 'Wallet Top Up', subtitle: 'Oct 23 • 9:15 AM', amount: 250.0, status: 'COMPLETED' },
  { id: '3', icon: 'bag-handle', iconBg: '#F3F4F6', title: 'Food Delivery - Amanzi', subtitle: 'Oct 22 • 7:45 PM', amount: -45.5, status: 'COMPLETED' },
  { id: '4', icon: 'gift', iconBg: '#EFF6FF', title: 'Transfer to John M.', subtitle: 'Oct 21 • 1:20 PM', amount: -20.0, status: 'COMPLETED' },
];

const PassengerWalletScreen = () => {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-gray-50">
      <View
        className="flex-row items-center justify-between bg-white border-b border-gray-100"
        style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12 }}
      >
        <View className="w-10" />
        <Text className="text-lg font-bold text-gray-900">Wallet</Text>
        <View className="w-10" />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: Math.max(insets.bottom, 24) }}
        showsVerticalScrollIndicator={false}
      >
        <View
          className="rounded-2xl p-5 mb-6"
          style={{ backgroundColor: PRIMARY_BLUE }}
        >
          <Text className="text-white/90 text-sm font-medium mb-1">Current Balance</Text>
          <Text className="text-white text-3xl font-bold">$1,240.50 USD</Text>
          <Text className="text-white/80 text-sm mt-1">≈ 16,840.25 ZiG</Text>
          <View className="flex-row items-center justify-between mt-4 pt-3 border-t border-white/20">
            <Text className="text-white/80 text-xs">Trust Express Wallet ID: 882-991</Text>
            <TouchableOpacity className="flex-row items-center gap-1 py-1 px-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
              <Ionicons name="eye-outline" size={14} color="#fff" />
              <Text className="text-white text-xs font-medium">Details</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View className="flex-row justify-between mb-8">
          {[
            { key: 'topup', label: 'Top Up', icon: 'add' },
            { key: 'send', label: 'Send', icon: 'paper-plane-outline' },
            { key: 'history', label: 'History', icon: 'time-outline' },
          ].map(({ key, label, icon }) => (
            <TouchableOpacity key={key} className="items-center">
              <View className="w-14 h-14 rounded-full items-center justify-center mb-2" style={{ backgroundColor: '#EFF6FF' }}>
                <Ionicons name={icon} size={26} color={PRIMARY_BLUE} />
              </View>
              <Text className="text-sm font-medium text-gray-700">{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-lg font-bold text-gray-900">Recent Transactions</Text>
          <TouchableOpacity>
            <Text className="text-sm font-medium" style={{ color: PRIMARY_BLUE }}>See All</Text>
          </TouchableOpacity>
        </View>

        <View className="bg-white rounded-2xl overflow-hidden border border-gray-100">
          {TRANSACTIONS.map((tx, index) => (
            <View
              key={tx.id}
              className="flex-row items-center py-4 px-4"
              style={index < TRANSACTIONS.length - 1 ? { borderBottomWidth: 1, borderBottomColor: '#f9fafb' } : {}}
            >
              <View className="w-10 h-10 rounded-xl items-center justify-center mr-3" style={{ backgroundColor: tx.iconBg }}>
                <Ionicons name={tx.icon} size={20} color={PRIMARY_BLUE} />
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-gray-900">{tx.title}</Text>
                <Text className="text-sm text-gray-500">{tx.subtitle}</Text>
              </View>
              <View className="items-end">
                <Text className={`text-base font-semibold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {tx.amount >= 0 ? '+' : ''}${Math.abs(tx.amount).toFixed(2)}
                </Text>
                <Text className="text-xs text-gray-400">{tx.status}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

export default PassengerWalletScreen;
