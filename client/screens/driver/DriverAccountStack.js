import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DriverAccountScreen from './DriverAccountScreen';
import DriverPhoneVerificationPage from './DriverPhoneVerificationPage';
import DriverReviewsScreen from './DriverReviewsScreen';
import DriverEcoCashPayoutScreen from './DriverEcoCashPayoutScreen';
import SupportChatScreen from '../shared/SupportChatScreen';
import LegalDocumentScreen from '../shared/LegalDocumentScreen';
import DriverDocumentationPage from './DriverDocumentationPage';
import DriverCarRegistrationPage from './DriverCarRegistrationPage';

const Stack = createNativeStackNavigator();

export default function DriverAccountStack({ route }) {
  const driverStatus = route.params?.driverStatus ?? null;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="DriverAccountMain"
        component={DriverAccountScreen}
        initialParams={{ driverStatus }}
      />
      <Stack.Screen
        name="DriverPhoneVerification"
        component={DriverPhoneVerificationPage}
        initialParams={{ driverStatus }}
      />
      <Stack.Screen
        name="DriverReviews"
        component={DriverReviewsScreen}
        initialParams={{ driverStatus }}
      />
      <Stack.Screen
        name="DriverEcoCashPayout"
        component={DriverEcoCashPayoutScreen}
        initialParams={{ driverStatus }}
      />
      <Stack.Screen
        name="DriverSupportChat"
        component={SupportChatScreen}
        initialParams={{ role: 'driver' }}
      />
      <Stack.Screen
        name="DriverLegalDocument"
        component={LegalDocumentScreen}
      />
      <Stack.Screen
        name="DriverDocumentation"
        component={DriverDocumentationPage}
        initialParams={{ driverStatus }}
      />
      <Stack.Screen
        name="DriverCarRegistration"
        component={DriverCarRegistrationPage}
        initialParams={{ driverStatus }}
      />
    </Stack.Navigator>
  );
}
