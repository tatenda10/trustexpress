import * as Location from 'expo-location';
import { getServiceAreaForCoordinate } from '../constants/serviceArea';

let cachedRegistrationCity = null;
let inFlightRegistrationCity = null;

export async function getRegistrationCityPayload() {
  if (cachedRegistrationCity) return cachedRegistrationCity;
  if (inFlightRegistrationCity) return inFlightRegistrationCity;

  inFlightRegistrationCity = (async () => {
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      let status = permission?.status;
      if (status !== 'granted' && permission?.canAskAgain !== false) {
        const requested = await Location.requestForegroundPermissionsAsync();
        status = requested?.status;
      }
      if (status !== 'granted') return {};

      const current = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Registration city location timed out')), 2500);
        }),
      ]);
      const coordinate = {
        latitude: Number(current?.coords?.latitude),
        longitude: Number(current?.coords?.longitude),
      };
      const serviceArea = getServiceAreaForCoordinate(coordinate);
      if (!serviceArea?.label) return {};

      cachedRegistrationCity = {
        registrationCity: serviceArea.label,
        registrationCountryCode: 'ZW',
        registrationLatitude: coordinate.latitude,
        registrationLongitude: coordinate.longitude,
        registrationSource: 'device_location',
      };
      return cachedRegistrationCity;
    } catch {
      return {};
    } finally {
      inFlightRegistrationCity = null;
    }
  })();

  return inFlightRegistrationCity;
}
