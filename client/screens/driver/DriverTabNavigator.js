import React, { useEffect, useState } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

const HIDDEN_TAB_BAR_ROUTES = new Set([
  'DriverHireTrip',
  'DriverWalletTopup',
  'DriverWalletTransactionDetail',
  'DriverRideHistory',
  'RideChat',
  'DriverSupportChat',
]);

const TAB_ICONS = {
  DriverHome: ['home', 'home-outline'],
  DriverWallet: ['wallet', 'wallet-outline'],
  DriverHireJobs: ['bus', 'bus-outline'],
  DriverAccount: ['person', 'person-outline'],
};

export default function DriverTabNavigator({ route }) {
  const insets = useSafeAreaInsets();
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

  const tabBarStyle = {
    height: 58 + insets.bottom,
    paddingTop: 6,
    paddingBottom: Math.max(insets.bottom, 6),
    backgroundColor: '#ffffff',
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    elevation: 0,
    shadowOpacity: 0,
    shadowColor: 'transparent',
  };

  const optionsFor = (title, extra = {}) => ({ route: tabRoute }) => ({
    title,
    tabBarIcon: ({ focused, color }) => {
      const [filled, outline] = TAB_ICONS[tabRoute.name];
      return <Ionicons name={focused ? filled : outline} size={23} color={color} />;
    },
    tabBarStyle: HIDDEN_TAB_BAR_ROUTES.has(getFocusedRouteNameFromRoute(tabRoute) ?? '')
      ? { display: 'none' }
      : tabBarStyle,
    ...extra,
  });

  return (
    <Tab.Navigator
      initialRouteName="DriverHome"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PRIMARY_BLUE,
        tabBarInactiveTintColor: '#9ca3af',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 },
        tabBarStyle,
      }}
    >
      <Tab.Screen name="DriverHome" component={DriverHomeStack} options={optionsFor('Home')} />
      <Tab.Screen name="DriverWallet" component={DriverWalletStack} options={optionsFor('Wallet')} />
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
        options={optionsFor('Hiring', {
          tabBarBadge: hiringBadgeCount > 0 ? hiringBadgeCount : undefined,
          tabBarBadgeStyle: { fontSize: 10, minWidth: 16, height: 16, lineHeight: 16 },
        })}
      />
      <Tab.Screen
        name="DriverAccount"
        component={DriverAccountStack}
        initialParams={{ driverStatus }}
        options={optionsFor('Account')}
        listeners={({ navigation }) => ({
          tabPress: (event) => {
            event.preventDefault();
            navigation.navigate('DriverAccount', { screen: 'DriverAccountMain' });
          },
        })}
      />
    </Tab.Navigator>
  );
}
