import React, { useEffect, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import DriverHomeStack from './DriverHomeStack';
import DriverWalletScreen from './DriverWalletScreen';
import DriverDiscountReimbursementsScreen from './DriverDiscountReimbursementsScreen';
import DriverHireStack from './DriverHireStack';
import DriverAccountStack from './DriverAccountStack';
import { PRIMARY_BLUE } from '../../constants/colors';

const Tab = createBottomTabNavigator();
const ICON_SIZE = 24;

export default function DriverTabNavigator({ route }) {
  const driverStatus = route?.params?.driverStatus ?? null;
  const [hiringBadgeCount, setHiringBadgeCount] = useState(0);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('TrustHiringNewRequest', () => {
      setHiringBadgeCount((count) => Math.min(count + 1, 99));
    });
    return () => subscription.remove();
  }, []);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PRIMARY_BLUE,
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: { borderTopColor: '#f3f4f6' },
        tabBarLabelStyle: { fontSize: 14, fontWeight: '500' },
      }}
    >
      <Tab.Screen
        name="DriverHome"
        component={DriverHomeStack}
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Ionicons name="home-outline" size={ICON_SIZE} color={color} />,
        }}
      />
      <Tab.Screen
        name="DriverWallet"
        component={DriverWalletScreen}
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color }) => <Ionicons name="wallet-outline" size={ICON_SIZE} color={color} />,
        }}
      />
      <Tab.Screen
        name="DriverReimbursements"
        component={DriverDiscountReimbursementsScreen}
        options={{
          title: 'Discounts',
          tabBarIcon: ({ color }) => <Ionicons name="cash-outline" size={ICON_SIZE} color={color} />,
        }}
      />
      <Tab.Screen
        name="DriverHireJobs"
        component={DriverHireStack}
        listeners={{
          tabPress: () => setHiringBadgeCount(0),
          focus: () => setHiringBadgeCount(0),
        }}
        options={{
          title: 'Hiring',
          tabBarIcon: ({ color }) => <Ionicons name="notifications-outline" size={ICON_SIZE} color={color} />,
          tabBarBadge: hiringBadgeCount > 0 ? hiringBadgeCount : undefined,
        }}
      />
      <Tab.Screen
        name="DriverAccount"
        component={DriverAccountStack}
        initialParams={{ driverStatus }}
        options={{
          title: 'Account',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={ICON_SIZE} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}
