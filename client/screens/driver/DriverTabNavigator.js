import React, { useEffect, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DriverHomeStack from './DriverHomeStack';
import DriverWalletScreen from './DriverWalletScreen';
import DriverDiscountReimbursementsScreen from './DriverDiscountReimbursementsScreen';
import DriverHireStack from './DriverHireStack';
import DriverAccountStack from './DriverAccountStack';
import { PRIMARY_BLUE } from '../../constants/colors';
import { isTruckDriver } from '../../constants/driverKind';
import { useDriverStatus } from '../../context/DriverStatusContext';

const Tab = createBottomTabNavigator();
const ICON_SIZE = 24;
const HIDDEN_TAB_BAR_ROUTES = new Set(['DriverHireTrip']);

export default function DriverTabNavigator({ route }) {
  const { driverStatus: contextDriverStatus } = useDriverStatus() || {};
  const driverStatus = contextDriverStatus ?? route?.params?.driverStatus ?? null;
  const truckDriver = isTruckDriver(driverStatus);
  const [hiringBadgeCount, setHiringBadgeCount] = useState(0);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('TrustHiringNewRequest', () => {
      setHiringBadgeCount((count) => Math.min(count + 1, 99));
    });
    return () => subscription.remove();
  }, []);

  return (
    <Tab.Navigator
      initialRouteName={truckDriver ? 'DriverHireJobs' : 'DriverHome'}
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
        options={({ route }) => ({
          title: 'Hiring',
          tabBarIcon: ({ color }) => <Ionicons name="notifications-outline" size={ICON_SIZE} color={color} />,
          tabBarBadge: hiringBadgeCount > 0 ? hiringBadgeCount : undefined,
          tabBarStyle: HIDDEN_TAB_BAR_ROUTES.has(getFocusedRouteNameFromRoute(route) || '')
            ? { display: 'none' }
            : { borderTopColor: '#f3f4f6' },
        })}
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
