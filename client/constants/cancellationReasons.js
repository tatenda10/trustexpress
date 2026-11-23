/**
 * Predefined cancellation reasons for drivers and passengers.
 * Used when cancelling a ride to improve tracking and accountability.
 */

export const DRIVER_CANCELLATION_REASONS = [
  { id: 'passenger_no_show', label: 'Passenger did not show up' },
  { id: 'wrong_pickup_location', label: 'Wrong pickup location' },
  { id: 'accepted_by_mistake', label: 'Accepted by mistake' },
  { id: 'safety_concern', label: 'Safety concern' },
  { id: 'refuse_passenger', label: 'I refuse to carry the passenger' },
  { id: 'fare_too_low', label: 'Fare was too low' },
  { id: 'app_glitch', label: 'App glitch' },
  { id: 'other', label: 'Other — please explain', requiresExplanation: true },
];

export const PASSENGER_CANCELLATION_REASONS = [
  { id: 'long_waiting_time', label: 'Long waiting time' },
  { id: 'wrong_pickup_or_destination', label: 'Wrong pickup or destination point' },
  { id: 'change_ride_type', label: 'Want to change ride type' },
  { id: 'accidental_request', label: 'Accidental request' },
  { id: 'better_alternative', label: 'Better alternative found' },
  { id: 'driver_asked_to_cancel', label: 'Driver asked me to cancel' },
  { id: 'safety_concern', label: 'Safety concern' },
  { id: 'extra_person_in_vehicle', label: 'Driver had another person in the vehicle' },
  { id: 'different_vehicle', label: 'Different vehicle arrived' },
  { id: 'different_driver', label: 'Different driver arrived' },
];

export function getDriverReasonLabel(id) {
  return DRIVER_CANCELLATION_REASONS.find((r) => r.id === id)?.label || id || 'Driver cancelled';
}

export function getPassengerReasonLabel(id) {
  return PASSENGER_CANCELLATION_REASONS.find((r) => r.id === id)?.label || id || 'Passenger cancelled';
}
