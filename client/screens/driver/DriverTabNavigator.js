import React, { useEffect, useState } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DriverHomeStack from './DriverHomeStack';
import DriverWalletStack from './DriverWalletStack';
import DriverHireStack from './DriverHireStack';
import DriverAccountStack from './DriverAccountStack';
import { PRIMARY_BLUE } from '../../constants/colors';
import {
  DRIVER_VERIFICATION_REQUIRED_MESSAGE,
  isDriverVerifiedForTrips,
} from '../../constants/driverKind';
import { useDriverStatus } from '../../context/DriverStatusContext';

const Tab = createBottomTabNavigator();
const ICON_SIZE = 24;
const HIDDEN_TAB_BAR_ROUTES = new Set([
  'DriverHireTrip',
  'DriverWalletTransactionDetail',
  'DriverRideHistory',
  'RideChat',
  'DriverSupportChat',
]);

export default function DriverTabNavigator({ route }) {
  const { driverStatus: contextDriverStatus } = useDriverStatus() || {};
  const driverStatus = contextDriverStatus ?? route?.params?.driverStatus ?? null;
  const canAcceptTrips = isDriverVerifiedForTrips(driverStatus);
  const [hiringBadgeCount, setHiringBadgeCount] = useState(0);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('TrustHiringNewRequest', () => {
      setHiringBadgeCount((count) => Math.min(count + 1, 99));
    });
    return () => subscription.remove();
  }, []);

  return (
    <Tab.Navigator
      initialRouteName="DriverHome"
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
        options={({ route }) => ({
          title: 'Home',
          tabBarIcon: ({ color }) => <Ionicons name="home-outline" size={ICON_SIZE} color={color} />,
          tabBarStyle: HIDDEN_TAB_BAR_ROUTES.has(getFocusedRouteNameFromRoute(route) || '')
            ? { display: 'none' }
            : { borderTopColor: '#f3f4f6' },
        })}
      />
      <Tab.Screen
        name="DriverWallet"
        component={DriverWalletStack}
        options={({ route }) => ({
          title: 'Wallet',
          tabBarIcon: ({ color }) => <Ionicons name="wallet-outline" size={ICON_SIZE} color={color} />,
          tabBarStyle: HIDDEN_TAB_BAR_ROUTES.has(getFocusedRouteNameFromRoute(route) || '')
            ? { display: 'none' }
            : { borderTopColor: '#f3f4f6' },
        })}
      />
      <Tab.Screen
        name="DriverHireJobs"
        component={DriverHireStack}
        listeners={{
          tabPress: (event) => {
            setHiringBadgeCount(0);
            if (canAcceptTrips) return;
            event.preventDefault();
            Alert.alert('Not verified', DRIVER_VERIFICATION_REQUIRED_MESSAGE);
          },
          focus: () => setHiringBadgeCount(0),
        }}
        options={({ route }) => ({
          title: 'Hiring',
          tabBarIcon: ({ color }) => <Ionicons name="bus-outline" size={ICON_SIZE} color={color} />,
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
        options={({ route }) => ({
          title: 'Account',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={ICON_SIZE} color={color} />,
          tabBarStyle: HIDDEN_TAB_BAR_ROUTES.has(getFocusedRouteNameFromRoute(route) || '')
            ? { display: 'none' }
            : { borderTopColor: '#f3f4f6' },
        })}
      />
    </Tab.Navigator>
  );
}
