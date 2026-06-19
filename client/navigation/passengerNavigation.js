export function navigateToPassengerAccountMain(navigation) {
  navigation.navigate('PassengerAccountMain');
}

export function replaceWithPassengerTabs(navigation, nestedParams = undefined) {
  navigation.replace('PassengerTabs', nestedParams);
}

export function replaceWithPassengerPhoneVerification(navigation) {
  replaceWithPassengerTabs(navigation, {
    screen: 'PassengerAccount',
    params: {
      screen: 'PassengerPhoneVerificationDetails',
    },
  });
}

export const passengerPhoneVerificationTabsParams = {
  screen: 'PassengerAccount',
  params: {
    screen: 'PassengerPhoneVerificationDetails',
  },
};
