/**
 * Predefined cancellation reasons for drivers and passengers.
 * Used when cancelling a ride to improve tracking and accountability.
 */

export const DRIVER_CANCELLATION_REASONS = [
  { id: 'passenger_no_show', label: 'Passenger no-show' },
  { id: 'passenger_requested', label: 'Passenger requested cancellation' },
  { id: 'wrong_location', label: 'Wrong pickup/drop-off location' },
  { id: 'safety_concern', label: 'Safety concern' },
  { id: 'vehicle_issue', label: 'Vehicle issue' },
  { id: 'emergency', label: 'Personal emergency' },
  { id: 'too_far', label: 'Pickup too far' },
  { id: 'other', label: 'Other' },
];

export const PASSENGER_CANCELLATION_REASONS = [
  { id: 'found_another_ride', label: 'Found another ride' },
  { id: 'wrong_destination', label: 'Wrong destination entered' },
  { id: 'driver_too_far', label: 'Driver too far / long wait' },
  { id: 'change_of_plans', label: 'Change of plans' },
  { id: 'booking_mistake', label: 'Booking mistake' },
  { id: 'emergency', label: 'Emergency' },
  { id: 'other', label: 'Other' },
];

export function getDriverReasonLabel(id) {
  return DRIVER_CANCELLATION_REASONS.find((r) => r.id === id)?.label || id || 'Driver cancelled';
}

export function getPassengerReasonLabel(id) {
  return PASSENGER_CANCELLATION_REASONS.find((r) => r.id === id)?.label || id || 'Passenger cancelled';
}
