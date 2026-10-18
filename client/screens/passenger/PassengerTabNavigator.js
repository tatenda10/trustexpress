import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PassengerHomeStack from './PassengerHomeStack';
import PassengerActivityStack from './PassengerActivityStack';
import PassengerHireStack from './PassengerHireStack';
import PassengerAccountStack from './PassengerAccountStack';
import { PRIMARY_BLUE } from '../../constants/colors';

const Tab = createBottomTabNavigator();

const HIDDEN_TAB_BAR_ROUTES = new Set([
  'PassengerChooseRide',
  'PassengerNearbyCars',
  'PassengerRideTracking',
  'PassengerHireTracking',
  'RideChat',
  'PassengerSupportChat',
]);

const TAB_ICONS = {
  PassengerHome: ['home', 'home-outline'],
  PassengerHiring: ['bus', 'bus-outline'],
  PassengerActivity: ['receipt', 'receipt-outline'],
  PassengerAccount: ['person', 'person-outline'],
};

function shouldHideTabBar(route) {
  const focusedRouteName = getFocusedRouteNameFromRoute(route) ?? '';
  if (HIDDEN_TAB_BAR_ROUTES.has(focusedRouteName)) return true;
  const nestedState = route.state;
  const focusedNested = nestedState?.routes?.[nestedState.index ?? 0];
  return Boolean(focusedNested?.params?.bookingMap);
}

export default function PassengerTabNavigator() {
  const insets = useSafeAreaInsets();

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

  const optionsFor = (title) => ({ route }) => ({
    title,
    tabBarIcon: ({ focused, color }) => {
      const [filled, outline] = TAB_ICONS[route.name];
      return <Ionicons name={focused ? filled : outline} size={23} color={color} />;
    },
    tabBarStyle: shouldHideTabBar(route) ? { display: 'none' } : tabBarStyle,
  });

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PRIMARY_BLUE,
        tabBarInactiveTintColor: '#9ca3af',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 },
        tabBarStyle,
      }}
    >
      <Tab.Screen name="PassengerHome" component={PassengerHomeStack} options={optionsFor('Home')} />
      <Tab.Screen name="PassengerHiring" component={PassengerHireStack} options={optionsFor('Hiring')} />
      <Tab.Screen name="PassengerActivity" component={PassengerActivityStack} options={optionsFor('Activity')} />
      <Tab.Screen
        name="PassengerAccount"
        component={PassengerAccountStack}
        options={optionsFor('Account')}
        listeners={({ navigation }) => ({
          tabPress: (event) => {
            event.preventDefault();
            navigation.navigate('PassengerAccount', { screen: 'PassengerAccountMain' });
          },
        })}
      />
    </Tab.Navigator>
  );
}
