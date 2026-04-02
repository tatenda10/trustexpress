import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PassengerAccountScreen from './PassengerAccountScreen';
import PassengerProfileDetailsScreen from './PassengerProfileDetailsScreen';
import PassengerPhoneVerificationScreen from './PassengerPhoneVerificationScreen';
import PassengerReviewsScreen from './PassengerReviewsScreen';
import PassengerIdentityVerificationScreen from './PassengerIdentityVerificationScreen';
import SupportChatScreen from '../shared/SupportChatScreen';
import LegalDocumentScreen from '../shared/LegalDocumentScreen';

const Stack = createNativeStackNavigator();

export default function PassengerAccountStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PassengerAccountMain" component={PassengerAccountScreen} />
      <Stack.Screen name="PassengerProfileDetails" component={PassengerProfileDetailsScreen} />
      <Stack.Screen name="PassengerPhoneVerificationDetails" component={PassengerPhoneVerificationScreen} />
      <Stack.Screen name="PassengerIdentityVerification" component={PassengerIdentityVerificationScreen} />
      <Stack.Screen name="PassengerReviews" component={PassengerReviewsScreen} />
      <Stack.Screen name="PassengerSupportChat" component={SupportChatScreen} initialParams={{ role: 'passenger' }} />
      <Stack.Screen name="PassengerLegalDocument" component={LegalDocumentScreen} />
    </Stack.Navigator>
  );
}
